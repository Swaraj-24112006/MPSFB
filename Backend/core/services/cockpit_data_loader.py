"""
C6 — CockpitDataLoaderService

Loads ALL data required by the cockpit engine in a single pass.
Builds 9 pre-indexed dicts for O(1) lookups during the computation loop.

This is the ONLY service with DB access in the cockpit pipeline.
CockpitEngineService (C7) receives its output and does ZERO queries.
"""
import logging
from collections import defaultdict
from decimal import Decimal
from django.db.models import Sum, F

logger = logging.getLogger(__name__)


class CockpitDataLoaderService:
    """
    Pre-loads all data for a given month/week into memory dicts.
    Returns a DataPackage dict consumed by CockpitEngineService.compute().
    """

    @classmethod
    def load(cls, month, week_code=None):
        """
        Load all data needed for cockpit computation.

        :param month: Month in YYYY-MM format (e.g. '2026-08')
        :param week_code: Optional specific week code (defaults to week_no=2)
        :return: dict with all pre-loaded data (the "DataPackage")
        """
        from core.models import (
            WeekDefinition, MonthlyPlan, MB51Transaction, BOMMaster,
            BOMFGHeader, StockReport, VendorDeliverySchedule,
            VendorSuppliedComponent, VendorBuyerMaster,
            FGPlanFreeze, MondayReviewAction, RMPMComponentMaster,
        )

        # ── Dict A: Week definitions for this month ──────────────────────
        month_weeks = list(
            WeekDefinition.objects.filter(month=month).order_by('week_no')
        )
        if not month_weeks:
            raise ValueError(f"No week definitions found for month '{month}'. Cannot compute cockpit.")

        # Resolve selected week
        selected_week = None
        if week_code:
            selected_week = next((w for w in month_weeks if w.week_code == week_code), None)
        if not selected_week:
            # Default to week 2 if available, else first week
            selected_week = next((w for w in month_weeks if w.week_no == 2), month_weeks[0])

        prior_weeks = [w for w in month_weeks if w.week_no < selected_week.week_no]

        # ── Dict B: Monthly plans by FG code ─────────────────────────────
        plans = list(
            MonthlyPlan.objects.filter(month=month)
            .select_related('fg')
        )
        plans_by_fg = {p.fg_id: p for p in plans}

        # ── Dict C: MB51 aggregated by (part_number, week_code) ──────────
        # Pre-aggregate in DB to avoid N+1
        week_codes = [w.week_code for w in month_weeks]
        mb51_agg = (
            MB51Transaction.objects
            .filter(
                week_id__in=week_codes,
                classification__in=['FG_PRODUCTION_RECEIPT', 'RMPM_RECEIPT']
            )
            .values('part_number', 'week_id')
            .annotate(total_qty=Sum('quantity'))
        )
        mb51_by_part_week = {}
        for row in mb51_agg:
            key = (row['part_number'], row['week_id'])
            mb51_by_part_week[key] = float(row['total_qty'] or 0)

        # ── Dict D: BOM lines by FG code (active version only) ──────────
        # Get active BOM version per FG
        fg_headers = {h.fg_code: h for h in BOMFGHeader.objects.filter(is_active=True)}

        bom_lines_qs = (
            BOMMaster.objects
            .filter(is_active=True)
            .select_related('fg', 'component')
        )
        bom_lines_by_fg = defaultdict(list)
        for line in bom_lines_qs:
            fg_header = fg_headers.get(line.fg_id)
            if fg_header and line.bom_version == fg_header.active_bom_version:
                bom_lines_by_fg[line.fg_id].append(line)

        # ── Dict E: Stock by part_number ─────────────────────────────────
        # Aggregate stock across storage locations per part
        stock_agg = (
            StockReport.objects
            .values('part_number')
            .annotate(
                total_unrestricted=Sum('unrestricted_stock'),
                total_safety=Sum('safety_stock'),
            )
        )
        stock_by_part = {}
        for row in stock_agg:
            stock_by_part[row['part_number']] = {
                'unrestricted_stock': float(row['total_unrestricted'] or 0),
                'safety_stock': float(row['total_safety'] or 0),
            }

        # ── Dict F: Vendor delivery schedules by (component_code, week_code)
        # Match by week_code OR by expected_delivery_date falling within a week range
        from django.db.models import Q as DQ
        week_date_q = DQ()
        for w in month_weeks:
            week_date_q |= DQ(
                expected_delivery_date__gte=w.start_date,
                expected_delivery_date__lte=w.end_date
            )

        schedules_qs = (
            VendorDeliverySchedule.objects
            .exclude(delivery_status='CANCELLED')
            .filter(DQ(week_id__in=week_codes) | week_date_q)
            .distinct()
        )
        schedules_by_comp_week = defaultdict(list)
        for s in schedules_qs:
            # Resolve which week this schedule belongs to
            resolved_week_code = s.week_id

            if not resolved_week_code:
                # week_code is null — resolve from expected_delivery_date
                for w in month_weeks:
                    if w.start_date <= s.expected_delivery_date <= w.end_date:
                        resolved_week_code = w.week_code
                        break

            if not resolved_week_code:
                # Date is outside all defined weeks — skip this schedule
                continue

            key = (s.component_id, resolved_week_code)
            schedules_by_comp_week[key].append(s)

        # ── Dict G: Vendor-buyer mapping by component_code ───────────────
        vendor_supplied = (
            VendorSuppliedComponent.objects
            .select_related('vendor_buyer')
            .all()
        )
        vendor_by_component = defaultdict(list)
        for vs in vendor_supplied:
            vendor_by_component[vs.component_id].append(vs.vendor_buyer)
        # Sort each vendor list by lead_time_days ASC (primary vendor = shortest lead time)
        for comp_code in vendor_by_component:
            vendor_by_component[comp_code].sort(key=lambda v: v.lead_time_days)

        # ── Dict H: Plan freeze by FG code ───────────────────────────────
        freeze_qs = FGPlanFreeze.objects.filter(
            month=month,
            week_id=selected_week.week_code
        )
        freeze_by_fg = {f.fg_id: f for f in freeze_qs}

        # ── Dict I: Monday review actions by FG code ─────────────────────
        actions_qs = MondayReviewAction.objects.filter(month=month)
        actions_by_fg = defaultdict(list)
        for a in actions_qs:
            actions_by_fg[a.fg_id].append(a)

        # ── Component usage map (which FGs use each component) ───────────
        component_usage_map = defaultdict(list)
        for fg_code, lines in bom_lines_by_fg.items():
            plan = plans_by_fg.get(fg_code)
            fg_desc = plan.fg.fg_description if plan and plan.fg else fg_code
            for line in lines:
                component_usage_map[line.component_id].append({
                    'fg_code': fg_code,
                    'fg_description': fg_desc,
                    'usage_per_fg': float(line.qty),
                })

        # ── Component master lookup ──────────────────────────────────────
        component_master = {
            c.component_code: c
            for c in RMPMComponentMaster.objects.filter(is_active=True)
        }

        data_package = {
            'month': month,
            'month_weeks': month_weeks,
            'selected_week': selected_week,
            'prior_weeks': prior_weeks,
            'plans_by_fg': plans_by_fg,
            'mb51_by_part_week': mb51_by_part_week,
            'bom_lines_by_fg': bom_lines_by_fg,
            'stock_by_part': stock_by_part,
            'schedules_by_comp_week': dict(schedules_by_comp_week),
            'vendor_by_component': dict(vendor_by_component),
            'freeze_by_fg': freeze_by_fg,
            'actions_by_fg': dict(actions_by_fg),
            'component_usage_map': dict(component_usage_map),
            'component_master': component_master,
            'fg_headers': fg_headers,
        }

        logger.info(
            f"CockpitDataLoader: Loaded {len(plans_by_fg)} FG plans, "
            f"{len(bom_lines_by_fg)} BOM groups, {len(stock_by_part)} stock rows, "
            f"{len(freeze_by_fg)} freezes for {month}/{selected_week.week_code}"
        )

        return data_package
