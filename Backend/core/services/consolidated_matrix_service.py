"""
Service 3: ConsolidatedMatrixService

Core computation for the consolidated RM/PM requirements matrix view.
Loads ALL data into dicts before any computation. Zero queries inside the loop.

Adaptation note:
  - BOMMaster uses FK fields: fg_id (→ fg_code), component_id (→ component_code)
  - VendorDeliverySchedule uses FK fields: component_id (→ component_code), week_id (→ week_code)
  - MonthlyPlan uses FK field: fg_id (→ fg_code)
  - VendorSuppliedComponent uses FK field: component_id (→ component_code)
"""
from collections import defaultdict

from django.db.models import Q

from core.models import (
    BOMMaster, BOMFGHeader, MonthlyPlan, WeekDefinition,
    StockReport, VendorDeliverySchedule,
    VendorBuyerMaster, VendorSuppliedComponent,
    FGPlanFreeze, RMPMComponentMaster,
)


class ConsolidatedMatrixService:

    @staticmethod
    def compute(month: str, scope_mode: str = 'WEEK',
                selected_week_code: str = None,
                buyer_filter: str = None,
                category_filter: str = None,
                criticality_filter: str = None,
                search_term: str = None) -> dict:
        """
        Returns the full consolidated matrix for the delivery schedule tab.

        scope_mode: 'WEEK' (selected week only) or 'MONTH' (full month)
        selected_week_code: required when scope_mode='WEEK'

        Returns:
        {
            monthWeeks: [WeekDefinition dicts],
            selectedWeek: WeekDefinition dict or None,
            scopeMode: 'WEEK'|'MONTH',
            rows: [ConsolidatedComponentRow dicts],
            summary: {
                totalComponents, commonPartsCount, shortagesCount,
                totalGrossReq, totalInwardPromised, totalDeficitQty
            }
        }
        """

        # ── Step 1: Load month weeks ──────────────────────────────────────
        month_weeks = list(
            WeekDefinition.objects.filter(month=month).order_by('week_no')
        )
        week_codes = [w.week_code for w in month_weeks]
        selected_week = next(
            (w for w in month_weeks if w.week_code == selected_week_code),
            month_weeks[0] if month_weeks else None
        )

        # ── Step 2: Load all active BOM lines ─────────────────────────────
        bom_lines = list(
            BOMMaster.objects.filter(is_active=True)
            .select_related('fg', 'component')
        )

        # ── Step 3: Load monthly plans for this month ─────────────────────
        monthly_plans = {
            p.fg_id: p
            for p in MonthlyPlan.objects.filter(month=month).select_related('fg')
        }

        # ── Step 4: Pre-aggregate stock by part_number ────────────────────
        component_codes = set(line.component_id for line in bom_lines)
        stock_map = {
            s.part_number: s
            for s in StockReport.objects.filter(
                part_number__in=component_codes
            )
        }

        # ── Step 5: Pre-load vendor-buyer mappings ────────────────────────
        # {component_code: VendorBuyerMaster}
        vsc_rows = VendorSuppliedComponent.objects.select_related('vendor_buyer').all()
        vendor_by_component = {}
        for vsc in vsc_rows:
            comp_code = vsc.component_id  # FK to_field='component_code'
            if comp_code not in vendor_by_component:
                vendor_by_component[comp_code] = vsc.vendor_buyer

        # ── Step 6: Pre-load delivery schedules for this month ────────────
        date_range_q = Q()
        for w in month_weeks:
            date_range_q |= Q(
                expected_delivery_date__gte=w.start_date,
                expected_delivery_date__lte=w.end_date
            )

        schedule_filter = Q(week_id__in=week_codes)
        if date_range_q:
            schedule_filter = schedule_filter | date_range_q

        all_schedules = list(
            VendorDeliverySchedule.objects.exclude(
                delivery_status='CANCELLED'
            ).filter(schedule_filter)
        )

        # Resolve week_code for schedules where it is null
        for sched in all_schedules:
            if not sched.week_id:
                for w in month_weeks:
                    if w.start_date <= sched.expected_delivery_date <= w.end_date:
                        sched.week_id = w.week_code
                        break

        # Build lookup: {(component_code, week_code): [schedules]}
        schedules_by_comp_week = defaultdict(list)
        for sched in all_schedules:
            if sched.week_id:
                schedules_by_comp_week[
                    (sched.component_id, sched.week_id)
                ].append(sched)

        # ── Step 7: Pre-load frozen plans for stock reservation ───────────
        frozen_plans = FGPlanFreeze.objects.filter(
            month=month, status='FROZEN'
        ).values('fg_id', 'week_id')
        frozen_fg_codes = set(fp['fg_id'] for fp in frozen_plans)

        # ── Step 8: Build component map ───────────────────────────────────
        comp_map = defaultdict(lambda: {
            'componentCode': '',
            'componentDescription': '',
            'category': 'RM',
            'uom': 'PC',
            'usedInFGs': [],
        })

        for line in bom_lines:
            fg_code = line.fg_id
            comp_code = line.component_id

            # Only include BOM lines for FGs that have a plan this month
            if fg_code not in monthly_plans:
                continue

            entry = comp_map[comp_code]
            entry['componentCode'] = comp_code
            if line.component:
                entry['componentDescription'] = line.component.component_description
                entry['category'] = line.component.category
                entry['uom'] = line.component.uom

            fg_already_listed = any(
                fg['fgCode'] == fg_code for fg in entry['usedInFGs']
            )
            if not fg_already_listed:
                plan = monthly_plans[fg_code]
                entry['usedInFGs'].append({
                    'fgCode': fg_code,
                    'fgDescription': plan.fg_description,
                    'usagePerFG': float(line.qty),
                })

        # ── Step 9: Compute each row ──────────────────────────────────────
        rows = []

        for comp_code, comp in comp_map.items():
            if not comp['usedInFGs']:
                continue

            # Vendor info
            vb = vendor_by_component.get(comp_code)
            buyer_name = vb.buyer_name if vb else 'Unassigned Buyer'
            vendor_name = vb.vendor_name if vb else 'Direct Vendor'
            vendor_code = vb.vendor_code if vb else 'V-NONE'
            lead_time_days = vb.lead_time_days if vb else 7

            # Stock
            stock_row = stock_map.get(comp_code)
            total_physical_stock = float(stock_row.unrestricted_stock) if stock_row else 0.0

            # Reserved stock (frozen FG plans × bomQty for common parts)
            is_common = len(comp['usedInFGs']) > 1
            reserved_stock = 0.0
            if is_common:
                for fg_usage in comp['usedInFGs']:
                    if fg_usage['fgCode'] in frozen_fg_codes:
                        plan = monthly_plans.get(fg_usage['fgCode'])
                        if plan and selected_week_code:
                            qty_for_week = plan.weekly_breakdown.get(
                                selected_week_code, 0
                            )
                        elif plan:
                            qty_for_week = plan.monthly_target
                        else:
                            qty_for_week = 0
                        reserved_stock += qty_for_week * fg_usage['usagePerFG']

            available_stock = max(0.0, total_physical_stock - reserved_stock)

            # Weekly calculations
            weekly_gross_req = {}
            weekly_inward_deliveries = {}
            weekly_schedules = {}
            month_total_gross_req = 0.0
            month_total_inward = 0.0

            for week in month_weeks:
                # Gross requirement: Σ (plan qty for week × bomQty) across FGs
                gross_req = 0.0
                for fg_usage in comp['usedInFGs']:
                    plan = monthly_plans.get(fg_usage['fgCode'])
                    if plan:
                        fg_week_qty = plan.weekly_breakdown.get(
                            week.week_code, 0
                        )
                        gross_req += fg_week_qty * fg_usage['usagePerFG']
                gross_req = round(gross_req)

                weekly_gross_req[week.week_code] = gross_req
                month_total_gross_req += gross_req

                # Inward deliveries for this week
                schedules_for_week = schedules_by_comp_week.get(
                    (comp_code, week.week_code), []
                )
                weekly_schedules[week.week_code] = schedules_for_week
                week_inward = sum(
                    float(s.promised_qty) for s in schedules_for_week
                )
                weekly_inward_deliveries[week.week_code] = round(week_inward)
                month_total_inward += week_inward

            # Scope metrics
            if scope_mode == 'WEEK' and selected_week:
                selected_scope_gross_req = weekly_gross_req.get(
                    selected_week.week_code, 0
                )
                selected_scope_inward = weekly_inward_deliveries.get(
                    selected_week.week_code, 0
                )
                active_schedules_for_scope = weekly_schedules.get(
                    selected_week.week_code, []
                )
            else:
                selected_scope_gross_req = month_total_gross_req
                selected_scope_inward = month_total_inward
                active_schedules_for_scope = [
                    s for sched_list in weekly_schedules.values()
                    for s in sched_list
                ]

            selected_scope_balance = (
                available_stock + selected_scope_inward - selected_scope_gross_req
            )
            selected_scope_deficit = (
                abs(selected_scope_balance) if selected_scope_balance < 0 else 0
            )
            has_shortage = selected_scope_balance < 0
            month_ending_balance = (
                available_stock + month_total_inward - month_total_gross_req
            )

            # Serialize schedule objects for JSON response
            def serialize_schedule(s):
                return {
                    'id': str(s.id),
                    'poNumber': s.po_number,
                    'componentCode': s.component_id,
                    'vendorCode': s.vendor_code,
                    'vendorName': s.vendor_name,
                    'buyerName': s.buyer_name,
                    'expectedDeliveryDate': (
                        s.expected_delivery_date.isoformat()
                    ),
                    'weekId': s.week_id or '',
                    'promisedQty': float(s.promised_qty),
                    'carrierOrTracking': s.carrier_or_tracking or '',
                    'deliveryStatus': s.delivery_status,
                    'notes': s.notes or '',
                }

            weekly_schedules_serialized = {
                wc: [serialize_schedule(s) for s in slist]
                for wc, slist in weekly_schedules.items()
            }

            rows.append({
                'componentCode': comp_code,
                'componentDescription': comp['componentDescription'],
                'category': comp['category'],
                'uom': comp['uom'],
                'isCommonPart': is_common,
                'usedInFGs': comp['usedInFGs'],
                'sharedInFGsCount': len(comp['usedInFGs']),
                'buyerName': buyer_name,
                'vendorName': vendor_name,
                'vendorCode': vendor_code,
                'leadTimeDays': lead_time_days,
                'totalPhysicalStock': total_physical_stock,
                'reservedStock': round(reserved_stock),
                'availableStock': round(available_stock),
                'weeklyGrossReq': weekly_gross_req,
                'weeklyInwardDeliveries': weekly_inward_deliveries,
                'weeklySchedules': weekly_schedules_serialized,
                'selectedScopeGrossReq': round(selected_scope_gross_req),
                'selectedScopeInward': round(selected_scope_inward),
                'selectedScopeBalance': round(selected_scope_balance),
                'selectedScopeDeficit': round(selected_scope_deficit),
                'hasShortage': has_shortage,
                'activeSchedulesForScope': [
                    serialize_schedule(s) for s in active_schedules_for_scope
                ],
                'monthTotalGrossReq': round(month_total_gross_req),
                'monthTotalInward': round(month_total_inward),
                'monthEndingBalance': round(month_ending_balance),
            })

        # ── Step 10: Sort rows ────────────────────────────────────────────
        # Shortages first → common parts second → alphabetical
        rows.sort(key=lambda r: (
            0 if r['hasShortage'] else 1,
            0 if r['isCommonPart'] else 1,
            r['componentCode']
        ))

        # ── Step 11: Apply UI filters ─────────────────────────────────────
        if buyer_filter and buyer_filter != 'ALL':
            rows = [r for r in rows if r['buyerName'] == buyer_filter]

        if category_filter and category_filter != 'ALL':
            rows = [r for r in rows if r['category'] == category_filter]

        if criticality_filter:
            if criticality_filter == 'SHORTAGES_ONLY':
                rows = [r for r in rows if r['hasShortage']]
            elif criticality_filter == 'COMMON_ONLY':
                rows = [r for r in rows if r['isCommonPart']]
            elif criticality_filter == 'SCHEDULED_ONLY':
                rows = [r for r in rows if r['selectedScopeInward'] > 0]

        if search_term:
            q = search_term.lower()
            rows = [
                r for r in rows
                if (q in r['componentCode'].lower()
                    or q in r['componentDescription'].lower()
                    or q in r['vendorName'].lower()
                    or q in r['buyerName'].lower()
                    or any(
                        q in fg['fgCode'].lower()
                        or q in fg['fgDescription'].lower()
                        for fg in r['usedInFGs']
                    ))
            ]

        # ── Step 12: Summary metrics ──────────────────────────────────────
        summary = {
            'totalComponents': len(rows),
            'commonPartsCount': sum(1 for r in rows if r['isCommonPart']),
            'shortagesCount': sum(1 for r in rows if r['hasShortage']),
            'totalGrossReq': sum(r['selectedScopeGrossReq'] for r in rows),
            'totalInwardPromised': sum(r['selectedScopeInward'] for r in rows),
            'totalDeficitQty': sum(r['selectedScopeDeficit'] for r in rows),
        }

        return {
            'monthWeeks': [
                {
                    'weekCode': w.week_code,
                    'weekNo': w.week_no,
                    'weekLabel': w.week_label,
                    'startDate': w.start_date.isoformat(),
                    'endDate': w.end_date.isoformat(),
                    'daysCount': w.days_count,
                    'workingDays': w.working_days,
                }
                for w in month_weeks
            ],
            'selectedWeek': {
                'weekCode': selected_week.week_code,
                'weekNo': selected_week.week_no,
                'weekLabel': selected_week.week_label,
                'startDate': selected_week.start_date.isoformat(),
                'endDate': selected_week.end_date.isoformat(),
            } if selected_week else None,
            'scopeMode': scope_mode,
            'rows': rows,
            'summary': summary,
        }
