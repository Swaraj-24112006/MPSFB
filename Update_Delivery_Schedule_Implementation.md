# Update Delivery Schedule — End-to-End Backend Implementation Plan

---

## Part 1 — What This Section Does (Complete Feature Map)

The Update Delivery Schedule tab has five distinct functional areas. Every area
has its own backend surface. Build them in the order listed — each depends on
the one before it.

| Area | What It Is | Backend Surface |
|---|---|---|
| A | Consolidated RM/PM Requirements Matrix | Computation endpoint (heavy read) |
| B | Single Schedule CRUD | 4 CRUD endpoints + audit log |
| C | Bulk Excel/CSV Upload | Upload endpoint + file storage |
| D | Auto-Fill Deficits | One-click batch creation endpoint |
| E | Change Log / History Drawer | Read-only query endpoint |
| F | Template Downloads | 3 streaming file download endpoints |

---

## Part 2 — What Data the Consolidated Matrix Needs

The matrix is the main view. Every row is one RM/PM component. The computation
pulls from 6 tables simultaneously. Understanding this first makes every API
decision obvious.

```
For each component found in bom_master:

  1. BOM explosion (bom_master):
       Which FGs use this component?
       What is usagePerFG (qty per unit of FG)?

  2. Monthly plan (monthly_plan.weekly_breakdown JSONB):
       What is the FG plan qty for each week?

  3. Gross Requirement per week:
       grossReq[week] = Σ (planQty[fgCode][week] × usagePerFG[fgCode])
       across ALL FG plans in the month that use this component

  4. Stock (stock_report):
       totalPhysicalStock = unrestricted_stock for this component
       reservedStock = for common parts: sum of (other FROZEN FG plan × bomQty)
       availableStock = max(0, totalPhysicalStock - reservedStock)

  5. Vendor Delivery Schedules (vendor_delivery_schedule):
       For each week: sum promisedQty of non-CANCELLED schedules
       where week_code = week OR expected_delivery_date BETWEEN week.start AND week.end

  6. Vendor-Buyer (vendor_buyer_master + vendor_supplied_components):
       buyerName, vendorName, vendorCode, leadTimeDays for this component

  Computed per component per week:
       weeklyGrossReq[week]       = from step 3
       weeklyInwardDeliveries[week] = from step 5
       weeklySchedules[week]      = schedule objects for that week

  Computed scope metrics (WEEK mode: selected week only; MONTH mode: sum all weeks):
       selectedScopeGrossReq
       selectedScopeInward
       selectedScopeBalance = availableStock + selectedScopeInward - selectedScopeGrossReq
       selectedScopeDeficit = abs(selectedScopeBalance) if < 0 else 0
       hasShortage          = selectedScopeBalance < 0

  Computed month totals (always):
       monthTotalGrossReq
       monthTotalInward
       monthEndingBalance = availableStock + monthTotalInward - monthTotalGrossReq

Sort order: shortages first → common parts second → alphabetical by componentCode
```

---

## Part 3 — Database Tables Required

All four tables from the Monday Cockpit plan must already exist. This section
adds no new tables. Verify before starting:

```sql
\dt vendor_delivery_schedule
\dt delivery_schedule_change_log
\dt fg_plan_freeze
\dt monday_review_action
```

If any are missing, complete the Monday Cockpit database section first.

---

## Part 4 — Django Models (Already Written — Confirm They Match)

Open `core/models.py`. Confirm `VendorDeliverySchedule` has ALL of these fields.
If any are missing, add them and run `python manage.py makemigrations && migrate`:

```
id, po_number, component_code, vendor_code, vendor_name, buyer_name,
expected_delivery_date, week_code, promised_qty, carrier_or_tracking,
delivery_status, notes, upload_batch_id, created_at, updated_at
```

Confirm `DeliveryScheduleChangeLog` has ALL of these fields:

```
id, schedule (FK SET NULL), po_number, component_code,
component_description, vendor_name, changed_by, changed_at,
field_changed, old_value, new_value, reason_for_change
```

---

## Part 5 — Services (Pure Python — Write and Test First)

Write these services before writing any view. They contain all business logic.

---

### Service 1: `AuditLogService`

This is called by EVERY single mutation in this tab. Write it first.

```python
# core/services/audit_log_service.py

from django.utils import timezone
from core.models import DeliveryScheduleChangeLog, VendorDeliverySchedule


class AuditLogService:

    @staticmethod
    def log_create(schedule: VendorDeliverySchedule, changed_by: str, reason: str):
        """
        Writes one change log row when a new delivery schedule is created.
        field_changed = 'New Delivery Commitment Added'
        old_value     = 'None (0 pcs)'
        new_value     = '+{qty} pcs on {date} ({status})'
        """
        DeliveryScheduleChangeLog.objects.create(
            schedule=schedule,
            po_number=schedule.po_number,
            component_code=schedule.component_code,
            component_description='',          # filled by caller if known
            vendor_name=schedule.vendor_name,
            changed_by=changed_by,
            changed_at=timezone.now(),
            field_changed='New Delivery Commitment Added',
            old_value='None (0 pcs)',
            new_value=(
                f"+{int(schedule.promised_qty)} pcs "
                f"on {schedule.expected_delivery_date} "
                f"({schedule.delivery_status})"
            ),
            reason_for_change=reason,
        )

    @staticmethod
    def log_update(schedule: VendorDeliverySchedule, old_snapshot: dict,
                   changed_by: str, reason: str):
        """
        Compares old_snapshot against the current schedule state.
        Writes one log row per changed field.

        old_snapshot is a dict of field_name -> old_value captured BEFORE the update.
        Fields to track: promised_qty, expected_delivery_date, delivery_status,
                         vendor_name, buyer_name, carrier_or_tracking, notes.

        For brevity, also writes a single summary row combining all changes
        (fieldChanged = 'Delivery Commitment Modified').
        The frontend HistoryDrawer can then filter by fieldChanged.
        """
        TRACKED_FIELDS = {
            'promised_qty':           'Promised Quantity',
            'expected_delivery_date': 'Expected Delivery Date',
            'delivery_status':        'Delivery Status',
            'vendor_name':            'Vendor Name',
            'buyer_name':             'Buyer Name',
            'carrier_or_tracking':    'Carrier / Tracking',
            'notes':                  'Notes',
        }

        now = timezone.now()
        changes_made = []

        for field_name, field_label in TRACKED_FIELDS.items():
            old_val = str(old_snapshot.get(field_name, ''))
            new_val = str(getattr(schedule, field_name, ''))
            if old_val != new_val:
                changes_made.append(f"{field_label}: {old_val} → {new_val}")
                DeliveryScheduleChangeLog.objects.create(
                    schedule=schedule,
                    po_number=schedule.po_number,
                    component_code=schedule.component_code,
                    component_description='',
                    vendor_name=schedule.vendor_name,
                    changed_by=changed_by,
                    changed_at=now,
                    field_changed=field_label,
                    old_value=old_val,
                    new_value=new_val,
                    reason_for_change=reason,
                )

        # Also write the consolidated summary row that the frontend shows by default
        if changes_made:
            old_summary = (
                f"{old_snapshot.get('promised_qty')} pcs "
                f"on {old_snapshot.get('expected_delivery_date')} "
                f"({old_snapshot.get('delivery_status')})"
            )
            new_summary = (
                f"{int(schedule.promised_qty)} pcs "
                f"on {schedule.expected_delivery_date} "
                f"({schedule.delivery_status})"
            )
            DeliveryScheduleChangeLog.objects.create(
                schedule=schedule,
                po_number=schedule.po_number,
                component_code=schedule.component_code,
                component_description='',
                vendor_name=schedule.vendor_name,
                changed_by=changed_by,
                changed_at=now,
                field_changed='Delivery Commitment Modified',
                old_value=old_summary,
                new_value=new_summary,
                reason_for_change=reason,
            )

    @staticmethod
    def log_delete(schedule: VendorDeliverySchedule, changed_by: str, reason: str):
        """
        Writes one log row when a schedule is deleted/cancelled.
        The schedule FK is SET NULL after this log is written.
        So write the log BEFORE deleting the schedule object.
        """
        DeliveryScheduleChangeLog.objects.create(
            schedule=schedule,            # FK still valid here
            po_number=schedule.po_number,
            component_code=schedule.component_code,
            component_description='',
            vendor_name=schedule.vendor_name,
            changed_by=changed_by,
            changed_at=timezone.now(),
            field_changed='Delivery Commitment Deleted/Cancelled',
            old_value=(
                f"{int(schedule.promised_qty)} pcs "
                f"on {schedule.expected_delivery_date} "
                f"({schedule.delivery_status})"
            ),
            new_value='REMOVED (0 pcs)',
            reason_for_change=reason,
        )

    @staticmethod
    def log_bulk_upload(schedule: VendorDeliverySchedule, changed_by: str,
                        upload_file_name: str, scope_label: str):
        """
        Writes one log row per row imported via bulk Excel/CSV upload.
        """
        DeliveryScheduleChangeLog.objects.create(
            schedule=schedule,
            po_number=schedule.po_number,
            component_code=schedule.component_code,
            component_description='',
            vendor_name=schedule.vendor_name,
            changed_by=changed_by,
            changed_at=timezone.now(),
            field_changed='Bulk Excel Schedule Import',
            old_value='Prior Schedule State',
            new_value=(
                f"+{int(schedule.promised_qty)} pcs "
                f"on {schedule.expected_delivery_date} "
                f"({schedule.delivery_status})"
            ),
            reason_for_change=(
                f"Excel bulk schedule update ({upload_file_name}) "
                f"for {scope_label}."
            ),
        )

    @staticmethod
    def log_auto_fill(schedule: VendorDeliverySchedule, changed_by: str, deficit_qty: int):
        """
        Writes one log row per auto-generated shortage coverage schedule.
        """
        DeliveryScheduleChangeLog.objects.create(
            schedule=schedule,
            po_number=schedule.po_number,
            component_code=schedule.component_code,
            component_description='',
            vendor_name=schedule.vendor_name,
            changed_by=changed_by,
            changed_at=timezone.now(),
            field_changed='Auto-Fill Shortage Coverage',
            old_value='Deficit / Shortage Uncovered',
            new_value=(
                f"+{int(schedule.promised_qty)} units "
                f"on {schedule.expected_delivery_date}"
            ),
            reason_for_change='1-Click auto-fill coverage generated by Supply Planner.',
        )
```

---

### Service 2: `VendorScheduleWeekResolver`

Used by every create/update to resolve `week_code` from `expected_delivery_date`.

```python
# core/services/vendor_schedule_week_resolver.py

from core.models import WeekDefinition


class VendorScheduleWeekResolver:

    @staticmethod
    def resolve(expected_delivery_date, month: str) -> str | None:
        """
        Given a date and the planning month, returns the week_code of the
        WeekDefinition whose [start_date, end_date] range contains the date.

        Returns None if no week matches (date outside defined calendar).

        Priority: exact date match in week range. Falls back to month's first week.
        """
        weeks = WeekDefinition.objects.filter(month=month).order_by('week_no')

        for week in weeks:
            if week.start_date <= expected_delivery_date <= week.end_date:
                return week.week_code

        # If date is outside defined weeks, assign to closest week
        # (frontend behavior: fall back to activeWeek)
        first_week = weeks.first()
        return first_week.week_code if first_week else None

    @staticmethod
    def resolve_from_week_no(week_no: int, month: str) -> str | None:
        """
        Fallback: resolve week_code from week_no when date-based resolution fails.
        Used by bulk upload when Week_No column is provided but date is ambiguous.
        """
        week = WeekDefinition.objects.filter(month=month, week_no=week_no).first()
        return week.week_code if week else None
```

---

### Service 3: `ConsolidatedMatrixService`

The core computation for the matrix view. This is the heaviest service in this tab.
Load ALL data into dicts before any computation. Zero queries inside the loop.

```python
# core/services/consolidated_matrix_service.py

from collections import defaultdict
from core.models import (
    BOMMaster, MonthlyPlan, WeekDefinition,
    StockReport, VendorDeliverySchedule,
    VendorBuyerMaster, VendorSuppliedComponent,
    FGPlanFreeze
)
from django.db.models import Q


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
            month_weeks: [WeekDefinition dicts],
            selected_week: WeekDefinition dict or None,
            scope_mode: 'WEEK'|'MONTH',
            rows: [ConsolidatedComponentRow dicts],
            summary: {
                total_components, common_parts_count, shortages_count,
                total_gross_req, total_inward_promised, total_deficit_qty
            }
        }
        """

        # ── Step 1: Load month weeks ──────────────────────────────────────────
        month_weeks = list(
            WeekDefinition.objects.filter(month=month).order_by('week_no')
        )
        week_codes   = [w.week_code for w in month_weeks]
        selected_week = next(
            (w for w in month_weeks if w.week_code == selected_week_code),
            month_weeks[0] if month_weeks else None
        )

        # ── Step 2: Load all BOM lines for this month's plans ─────────────────
        # Only active BOM lines, matching the FG's active_bom_version
        bom_lines = list(
            BOMMaster.objects.filter(is_active=True)
            .select_related('fg_header')
            .values(
                'fg_code', 'component_code', 'component_description',
                'qty', 'uom', 'category',
                'fg_header__active_bom_version'
            )
        )
        # Filter to only active BOM version per FG
        active_version_map = {
            line['fg_code']: line['fg_header__active_bom_version']
            for line in bom_lines
        }

        # ── Step 3: Load monthly plans for this month ─────────────────────────
        monthly_plans = {
            p.fg_code: p
            for p in MonthlyPlan.objects.filter(month=month)
        }

        # ── Step 4: Pre-aggregate stock by part_number ────────────────────────
        stock_map = {
            s.part_number: s
            for s in StockReport.objects.filter(
                part_number__in=set(line['component_code'] for line in bom_lines)
            )
        }

        # ── Step 5: Pre-load vendor-buyer mappings ────────────────────────────
        # {component_code: VendorBuyerMaster}
        vsc_rows = VendorSuppliedComponent.objects.select_related('vendor_buyer').all()
        vendor_by_component = {}
        for vsc in vsc_rows:
            if vsc.component_code not in vendor_by_component:
                vendor_by_component[vsc.component_code] = vsc.vendor_buyer

        # ── Step 6: Pre-load delivery schedules for this month ────────────────
        # Match by week_code in month OR by delivery date within a week's range
        date_range_q = Q()
        for w in month_weeks:
            date_range_q |= Q(
                expected_delivery_date__gte=w.start_date,
                expected_delivery_date__lte=w.end_date
            )

        all_schedules = list(
            VendorDeliverySchedule.objects.exclude(
                delivery_status='CANCELLED'
            ).filter(
                Q(week_code__in=week_codes) | date_range_q
            )
        )

        # Resolve week_code for schedules where it is null
        for sched in all_schedules:
            if not sched.week_code:
                for w in month_weeks:
                    if w.start_date <= sched.expected_delivery_date <= w.end_date:
                        sched.week_code = w.week_code
                        break

        # Build lookup: {(component_code, week_code): [schedules]}
        schedules_by_comp_week = defaultdict(list)
        for sched in all_schedules:
            if sched.week_code:
                schedules_by_comp_week[(sched.component_code, sched.week_code)].append(sched)

        # ── Step 7: Pre-load frozen plans for stock reservation ───────────────
        frozen_plans = FGPlanFreeze.objects.filter(
            month=month, status='FROZEN'
        ).values('fg_code', 'week_code')
        frozen_fg_codes = set(fp['fg_code'] for fp in frozen_plans)

        # ── Step 8: Build component map ───────────────────────────────────────
        # {component_code: {componentCode, componentDescription, category, uom,
        #                   usedInFGs: [{fgCode, fgDescription, usagePerFG}]}}
        comp_map = defaultdict(lambda: {
            'componentCode': '',
            'componentDescription': '',
            'category': 'RM',
            'uom': 'PC',
            'usedInFGs': [],
        })

        for line in bom_lines:
            fg_code     = line['fg_code']
            comp_code   = line['component_code']

            # Only include BOM lines for FGs that have a plan this month
            if fg_code not in monthly_plans:
                continue

            # Only include active version
            if line.get('bom_version') and active_version_map.get(fg_code):
                pass  # version filtering handled by is_active=True

            entry = comp_map[comp_code]
            entry['componentCode']        = comp_code
            entry['componentDescription'] = line['component_description']
            entry['category']             = line['category']
            entry['uom']                  = line['uom']

            fg_already_listed = any(
                fg['fgCode'] == fg_code for fg in entry['usedInFGs']
            )
            if not fg_already_listed:
                plan = monthly_plans[fg_code]
                entry['usedInFGs'].append({
                    'fgCode':       fg_code,
                    'fgDescription': plan.fg_description,
                    'usagePerFG':   float(line['qty']),
                })

        # ── Step 9: Compute each row ──────────────────────────────────────────
        rows = []

        for comp_code, comp in comp_map.items():
            if not comp['usedInFGs']:
                continue

            # Vendor info
            vb             = vendor_by_component.get(comp_code)
            buyer_name     = vb.buyer_name  if vb else 'Unassigned Buyer'
            vendor_name    = vb.vendor_name if vb else 'Direct Vendor'
            vendor_code    = vb.vendor_code if vb else 'V-NONE'
            lead_time_days = vb.lead_time_days if vb else 7

            # Stock
            stock_row           = stock_map.get(comp_code)
            total_physical_stock = float(stock_row.unrestricted_stock) if stock_row else 0.0

            # Reserved stock (frozen FG plans × bomQty for common parts)
            is_common       = len(comp['usedInFGs']) > 1
            reserved_stock  = 0.0
            if is_common:
                for fg_usage in comp['usedInFGs']:
                    if fg_usage['fgCode'] in frozen_fg_codes:
                        plan = monthly_plans.get(fg_usage['fgCode'])
                        if plan and selected_week_code:
                            qty_for_week = plan.weekly_breakdown.get(selected_week_code, 0)
                        elif plan:
                            qty_for_week = plan.monthly_target
                        else:
                            qty_for_week = 0
                        reserved_stock += qty_for_week * fg_usage['usagePerFG']

            available_stock = max(0.0, total_physical_stock - reserved_stock)

            # Weekly calculations
            weekly_gross_req         = {}
            weekly_inward_deliveries = {}
            weekly_schedules         = {}
            month_total_gross_req    = 0.0
            month_total_inward       = 0.0

            for week in month_weeks:
                # Gross requirement: Σ (plan qty for week × bomQty) across all FGs
                gross_req = 0.0
                for fg_usage in comp['usedInFGs']:
                    plan = monthly_plans.get(fg_usage['fgCode'])
                    if plan:
                        fg_week_qty = plan.weekly_breakdown.get(week.week_code, 0)
                        gross_req  += fg_week_qty * fg_usage['usagePerFG']
                gross_req = round(gross_req)

                weekly_gross_req[week.week_code] = gross_req
                month_total_gross_req += gross_req

                # Inward deliveries for this week
                schedules_for_week = schedules_by_comp_week.get(
                    (comp_code, week.week_code), []
                )
                weekly_schedules[week.week_code] = schedules_for_week
                week_inward = sum(float(s.promised_qty) for s in schedules_for_week)
                weekly_inward_deliveries[week.week_code] = round(week_inward)
                month_total_inward += week_inward

            # Scope metrics
            if scope_mode == 'WEEK' and selected_week:
                selected_scope_gross_req    = weekly_gross_req.get(selected_week.week_code, 0)
                selected_scope_inward       = weekly_inward_deliveries.get(selected_week.week_code, 0)
                active_schedules_for_scope  = weekly_schedules.get(selected_week.week_code, [])
            else:
                selected_scope_gross_req    = month_total_gross_req
                selected_scope_inward       = month_total_inward
                active_schedules_for_scope  = [
                    s for sched_list in weekly_schedules.values() for s in sched_list
                ]

            selected_scope_balance = (
                available_stock + selected_scope_inward - selected_scope_gross_req
            )
            selected_scope_deficit = abs(selected_scope_balance) if selected_scope_balance < 0 else 0
            has_shortage           = selected_scope_balance < 0
            month_ending_balance   = available_stock + month_total_inward - month_total_gross_req

            # Serialize schedule objects for JSON response
            def serialize_schedule(s):
                return {
                    'id':                   str(s.id),
                    'poNumber':             s.po_number,
                    'componentCode':        s.component_code,
                    'vendorCode':           s.vendor_code,
                    'vendorName':           s.vendor_name,
                    'buyerName':            s.buyer_name,
                    'expectedDeliveryDate': s.expected_delivery_date.isoformat(),
                    'weekId':               s.week_code or '',
                    'promisedQty':          float(s.promised_qty),
                    'carrierOrTracking':    s.carrier_or_tracking or '',
                    'deliveryStatus':       s.delivery_status,
                    'notes':               s.notes or '',
                }

            weekly_schedules_serialized = {
                wc: [serialize_schedule(s) for s in slist]
                for wc, slist in weekly_schedules.items()
            }

            rows.append({
                'componentCode':          comp_code,
                'componentDescription':   comp['componentDescription'],
                'category':               comp['category'],
                'uom':                    comp['uom'],
                'isCommonPart':           is_common,
                'usedInFGs':              comp['usedInFGs'],
                'sharedInFGsCount':       len(comp['usedInFGs']),
                'buyerName':              buyer_name,
                'vendorName':             vendor_name,
                'vendorCode':             vendor_code,
                'leadTimeDays':           lead_time_days,
                'totalPhysicalStock':     total_physical_stock,
                'reservedStock':          round(reserved_stock),
                'availableStock':         round(available_stock),
                'weeklyGrossReq':         weekly_gross_req,
                'weeklyInwardDeliveries': weekly_inward_deliveries,
                'weeklySchedules':        weekly_schedules_serialized,
                'selectedScopeGrossReq':  round(selected_scope_gross_req),
                'selectedScopeInward':    round(selected_scope_inward),
                'selectedScopeBalance':   round(selected_scope_balance),
                'selectedScopeDeficit':   round(selected_scope_deficit),
                'hasShortage':            has_shortage,
                'activeSchedulesForScope': [
                    serialize_schedule(s) for s in active_schedules_for_scope
                ],
                'monthTotalGrossReq':     round(month_total_gross_req),
                'monthTotalInward':       round(month_total_inward),
                'monthEndingBalance':     round(month_ending_balance),
            })

        # ── Step 10: Sort rows ─────────────────────────────────────────────────
        # Shortages first → common parts second → alphabetical
        rows.sort(key=lambda r: (
            0 if r['hasShortage'] else 1,
            0 if r['isCommonPart'] else 1,
            r['componentCode']
        ))

        # ── Step 11: Apply UI filters ─────────────────────────────────────────
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
                        q in fg['fgCode'].lower() or q in fg['fgDescription'].lower()
                        for fg in r['usedInFGs']
                    ))
            ]

        # ── Step 12: Summary metrics ──────────────────────────────────────────
        summary = {
            'totalComponents':     len(rows),
            'commonPartsCount':    sum(1 for r in rows if r['isCommonPart']),
            'shortagesCount':      sum(1 for r in rows if r['hasShortage']),
            'totalGrossReq':       sum(r['selectedScopeGrossReq'] for r in rows),
            'totalInwardPromised': sum(r['selectedScopeInward'] for r in rows),
            'totalDeficitQty':     sum(r['selectedScopeDeficit'] for r in rows),
        }

        return {
            'monthWeeks':   [
                {
                    'weekCode':    w.week_code,
                    'weekNo':      w.week_no,
                    'weekLabel':   w.week_label,
                    'startDate':   w.start_date.isoformat(),
                    'endDate':     w.end_date.isoformat(),
                    'daysCount':   w.days_count,
                    'workingDays': w.working_days,
                }
                for w in month_weeks
            ],
            'selectedWeek': {
                'weekCode':    selected_week.week_code,
                'weekNo':      selected_week.week_no,
                'weekLabel':   selected_week.week_label,
                'startDate':   selected_week.start_date.isoformat(),
                'endDate':     selected_week.end_date.isoformat(),
            } if selected_week else None,
            'scopeMode':    scope_mode,
            'rows':         rows,
            'summary':      summary,
        }
```

---

### Service 4: `BulkScheduleUploadService`

```python
# core/services/bulk_schedule_upload_service.py

import csv
import io
from django.db import transaction
from core.models import (
    VendorDeliverySchedule, BOMMaster,
    VendorBuyerMaster, VendorSuppliedComponent, UploadBatch
)
from core.services.audit_log_service import AuditLogService
from core.services.vendor_schedule_week_resolver import VendorScheduleWeekResolver


VALID_STATUSES = {
    'CONFIRMED_ON_TRACK', 'IN_TRANSIT', 'PARTIAL_PROMISE',
    'DELAYED_AT_RISK', 'CANCELLED', 'CRITICAL_NO_PO'
}


class BulkScheduleUploadService:

    @staticmethod
    def parse_file(file_obj) -> list[dict]:
        """
        Parses .xlsx / .xls using openpyxl.
        Returns list of raw row dicts with normalized (lowercase-no-spaces) keys.
        """
        import openpyxl
        wb = openpyxl.load_workbook(file_obj, data_only=True)
        ws = wb.active
        headers = [
            str(cell.value or '').strip().lower().replace(' ', '').replace('_', '')
            for cell in next(ws.iter_rows(min_row=1, max_row=1))
        ]
        rows = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            if all(v is None for v in row):
                continue
            rows.append(dict(zip(headers, row)))
        return rows

    @staticmethod
    def parse_csv_text(text: str) -> list[dict]:
        """
        Parses CSV text or tab-delimited text (from paste).
        Auto-detects delimiter. Normalizes header keys.
        """
        text = text.strip()
        dialect = csv.Sniffer().sniff(text[:2048])
        reader = csv.DictReader(io.StringIO(text), dialect=dialect)
        rows = []
        for row in reader:
            normalized = {
                k.strip().lower().replace(' ', '').replace('_', ''): v
                for k, v in row.items()
            }
            rows.append(normalized)
        return rows

    @staticmethod
    def normalize_row(raw: dict, month: str,
                      bom_component_codes: set,
                      vendor_by_component: dict,
                      first_week_code: str) -> dict:
        """
        Extracts and normalizes one raw row into a clean schedule payload dict.
        Returns {'data': {...}, 'is_valid': bool, 'validation_status': str,
                 'validation_message': str}
        """

        def get(keys, default=''):
            for k in keys:
                val = raw.get(k)
                if val is not None and str(val).strip():
                    return str(val).strip()
            return default

        comp_code = get(['componentcode', 'component', 'partnumber', 'material', 'itemcode'])
        po_number = get(['ponumber', 'po', 'scheduleref', 'schedulerefid'])
        if not po_number:
            import time
            po_number = f"PO-BULK-{int(time.time())}"

        qty_raw   = get(['promisedquantity', 'promisedqty', 'quantity', 'qty', 'inwardqty'], '0')
        try:
            promised_qty = float(str(qty_raw).replace(',', ''))
        except ValueError:
            promised_qty = 0.0

        date_raw = get(['expecteddeliverydate', 'deliverydate', 'date', 'arrivaldate'])
        # Handle Excel serial date numbers
        if date_raw and date_raw.replace('.', '').isdigit():
            serial = float(date_raw)
            if serial > 40000:
                from datetime import datetime, timedelta
                delivery_date = (datetime(1899, 12, 30) + timedelta(days=serial)).date()
                date_raw = delivery_date.isoformat()

        # Parse date
        from datetime import date
        delivery_date = None
        for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y'):
            try:
                from datetime import datetime
                delivery_date = datetime.strptime(date_raw, fmt).date()
                break
            except (ValueError, TypeError):
                continue

        # Resolve week_code from date first, then Week_No fallback
        week_code = None
        if delivery_date:
            week_code = VendorScheduleWeekResolver.resolve(delivery_date, month)
        if not week_code:
            week_no_raw = get(['weekno', 'week'], '0')
            try:
                week_no = int(float(week_no_raw))
                week_code = VendorScheduleWeekResolver.resolve_from_week_no(week_no, month)
            except (ValueError, TypeError):
                pass
        if not week_code:
            week_code = first_week_code

        # Auto-resolve vendor info from VendorBuyerMaster if not in file
        vb = vendor_by_component.get(comp_code)
        vendor_code = get(['vendorcode'], vb.vendor_code if vb else 'V-NONE')
        vendor_name = get(['vendorname'], vb.vendor_name if vb else 'Designated Supplier')
        buyer_name  = get(['buyername'],  vb.buyer_name  if vb else 'Unassigned Buyer')

        # Normalize delivery status
        raw_status = get(['deliverystatus', 'status'], 'CONFIRMED_ON_TRACK').upper().replace(' ', '_')
        if 'TRANSIT' in raw_status:
            delivery_status = 'IN_TRANSIT'
        elif 'PARTIAL' in raw_status:
            delivery_status = 'PARTIAL_PROMISE'
        elif 'DELAY' in raw_status or 'RISK' in raw_status:
            delivery_status = 'DELAYED_AT_RISK'
        elif 'CANCEL' in raw_status:
            delivery_status = 'CANCELLED'
        elif 'NO_PO' in raw_status or 'NOPO' in raw_status:
            delivery_status = 'CRITICAL_NO_PO'
        else:
            delivery_status = 'CONFIRMED_ON_TRACK'

        carrier = get(['carrierortracking', 'carrier', 'tracking'], 'Direct Road Logistics')
        notes   = get(['notes', 'remark'], 'Uploaded via Excel bulk schedule updater')
        comp_desc = get(
            ['componentdescription', 'description'],
            'Direct Component'
        )

        # Validation
        is_valid           = True
        validation_status  = 'VALID'
        validation_message = 'Valid & verified against Master Data'

        if not comp_code:
            is_valid, validation_status = False, 'ERROR'
            validation_message = 'Missing Component Code'
        elif comp_code not in bom_component_codes:
            validation_status  = 'WARNING'
            validation_message = 'Component not found in BOM master (registered as standalone)'
        if promised_qty <= 0:
            is_valid, validation_status = False, 'ERROR'
            validation_message = 'Promised quantity must be greater than 0'

        return {
            'data': {
                'po_number':              po_number,
                'component_code':         comp_code,
                'component_description':  comp_desc,
                'vendor_code':            vendor_code,
                'vendor_name':            vendor_name,
                'buyer_name':             buyer_name,
                'expected_delivery_date': delivery_date,
                'week_code':              week_code,
                'promised_qty':           promised_qty,
                'carrier_or_tracking':    carrier,
                'delivery_status':        delivery_status,
                'notes':                  notes,
            },
            'is_valid':           is_valid,
            'validation_status':  validation_status,
            'validation_message': validation_message,
        }

    @staticmethod
    @transaction.atomic
    def apply(month: str, parsed_rows: list[dict], import_mode: str,
              upload_scope: str, selected_week_code: str,
              changed_by: str, upload_file_name: str,
              batch: 'UploadBatch') -> dict:
        """
        Applies valid parsed rows to the database.
        import_mode:  'APPEND' | 'OVERWRITE'
        upload_scope: 'SELECTED_WEEK' | 'FULL_MONTH'

        If OVERWRITE:
          - SELECTED_WEEK: cancel all non-cancelled schedules where week_code = selected_week_code
          - FULL_MONTH: cancel all non-cancelled schedules for the entire month

        Creates audit log entries for every new schedule.
        Updates the UploadBatch with final counts.

        Returns {'imported': N, 'skipped': M, 'errors': [...]}
        """
        valid_rows = [r for r in parsed_rows if r['is_valid']]
        error_rows = [r for r in parsed_rows if not r['is_valid']]

        if import_mode == 'OVERWRITE':
            from core.models import WeekDefinition
            month_week_codes = list(
                WeekDefinition.objects.filter(month=month)
                .values_list('week_code', flat=True)
            )
            qs_to_cancel = VendorDeliverySchedule.objects.exclude(
                delivery_status='CANCELLED'
            )
            if upload_scope == 'SELECTED_WEEK' and selected_week_code:
                qs_to_cancel = qs_to_cancel.filter(week_code=selected_week_code)
            else:
                qs_to_cancel = qs_to_cancel.filter(week_code__in=month_week_codes)

            # Audit-log the cancellations
            for s in qs_to_cancel:
                AuditLogService.log_delete(
                    s, changed_by,
                    f'Overwrite import mode: cancelled before bulk import of {upload_file_name}'
                )
            qs_to_cancel.update(delivery_status='CANCELLED')

        new_schedules = []
        for row in valid_rows:
            data = row['data']
            sched = VendorDeliverySchedule.objects.create(
                po_number=data['po_number'],
                component_code=data['component_code'],
                vendor_code=data['vendor_code'],
                vendor_name=data['vendor_name'],
                buyer_name=data['buyer_name'],
                expected_delivery_date=data['expected_delivery_date'],
                week_code=data['week_code'],
                promised_qty=data['promised_qty'],
                carrier_or_tracking=data['carrier_or_tracking'],
                delivery_status=data['delivery_status'],
                notes=data['notes'],
                upload_batch_id=batch.id,
            )
            AuditLogService.log_bulk_upload(
                sched, changed_by, upload_file_name,
                scope_label=(
                    f"Week {selected_week_code}" if upload_scope == 'SELECTED_WEEK'
                    else month
                )
            )
            new_schedules.append(sched)

        # Update batch record
        batch.imported_rows = len(new_schedules)
        batch.error_rows    = len(error_rows)
        batch.status        = 'COMPLETED' if not error_rows else 'PARTIAL'
        batch.error_detail  = [
            {'row': i + 1, 'error': r['validation_message']}
            for i, r in enumerate(error_rows)
        ]
        batch.save()

        return {
            'imported': len(new_schedules),
            'skipped':  len(error_rows),
            'errors':   batch.error_detail,
        }
```

---

### Service 5: `AutoFillDeficitService`

```python
# core/services/auto_fill_deficit_service.py

from django.db import transaction
from core.models import VendorDeliverySchedule
from core.services.audit_log_service import AuditLogService
from core.services.consolidated_matrix_service import ConsolidatedMatrixService


class AutoFillDeficitService:

    @staticmethod
    @transaction.atomic
    def auto_fill(month: str, scope_mode: str, selected_week_code: str,
                  changed_by: str) -> dict:
        """
        For every component with hasShortage=True in the consolidated matrix,
        creates one new VendorDeliverySchedule with:
            promisedQty = selectedScopeDeficit
            expectedDeliveryDate = selected week's start_date (or month-10 fallback)
            deliveryStatus = CONFIRMED_ON_TRACK
            poNumber = auto-generated PO-AUTO-{YYYYMM}-{index}
            notes = 'Auto-generated commitment matching deficit of {qty} {uom}'

        Returns: {'generated': N, 'total_units_committed': M}
        """
        from core.models import WeekDefinition
        selected_week = WeekDefinition.objects.filter(
            week_code=selected_week_code
        ).first()
        default_date = (
            selected_week.start_date if selected_week
            else f"{month}-10"
        )

        # Compute matrix to find shortage items
        matrix = ConsolidatedMatrixService.compute(
            month=month,
            scope_mode=scope_mode,
            selected_week_code=selected_week_code,
        )
        deficit_rows = [r for r in matrix['rows'] if r['hasShortage']]

        if not deficit_rows:
            return {'generated': 0, 'total_units_committed': 0}

        generated_count = 0
        total_units     = 0

        for idx, row in enumerate(deficit_rows):
            po_number = f"PO-AUTO-{month.replace('-', '')}-{8000 + idx}"
            sched = VendorDeliverySchedule.objects.create(
                po_number=po_number,
                component_code=row['componentCode'],
                vendor_code=row['vendorCode'],
                vendor_name=row['vendorName'],
                buyer_name=row['buyerName'],
                expected_delivery_date=default_date,
                week_code=selected_week_code,
                promised_qty=row['selectedScopeDeficit'],
                carrier_or_tracking='Expedited Express Freight',
                delivery_status='CONFIRMED_ON_TRACK',
                notes=(
                    f"Auto-generated commitment matching deficit of "
                    f"{row['selectedScopeDeficit']:,} {row['uom']}"
                ),
            )
            AuditLogService.log_auto_fill(
                sched, changed_by, row['selectedScopeDeficit']
            )
            generated_count += 1
            total_units     += row['selectedScopeDeficit']

        return {
            'generated':              generated_count,
            'total_units_committed':  total_units,
        }
```

---

## Part 6 — Serializers

```python
# core/serializers.py  (add to existing serializers file)

from rest_framework import serializers
from core.models import VendorDeliverySchedule, DeliveryScheduleChangeLog


class VendorDeliveryScheduleSerializer(serializers.ModelSerializer):
    """
    Matches the VendorDeliverySchedule interface in types.ts exactly.
    Note: id is returned as string (str(instance.id)) to match frontend.
    """
    id       = serializers.SerializerMethodField()
    weekId   = serializers.CharField(source='week_code', allow_null=True)

    class Meta:
        model  = VendorDeliverySchedule
        fields = [
            'id', 'poNumber', 'componentCode', 'vendorCode', 'vendorName',
            'buyerName', 'expectedDeliveryDate', 'weekId', 'promisedQty',
            'carrierOrTracking', 'deliveryStatus', 'notes',
        ]

    def get_id(self, obj):
        return str(obj.id)

    # Map snake_case model fields → camelCase JSON keys
    poNumber             = serializers.CharField(source='po_number')
    componentCode        = serializers.CharField(source='component_code')
    vendorCode           = serializers.CharField(source='vendor_code')
    vendorName           = serializers.CharField(source='vendor_name')
    buyerName            = serializers.CharField(source='buyer_name')
    expectedDeliveryDate = serializers.DateField(source='expected_delivery_date')
    promisedQty          = serializers.DecimalField(
        source='promised_qty', max_digits=14, decimal_places=3
    )
    carrierOrTracking    = serializers.CharField(
        source='carrier_or_tracking', allow_blank=True
    )
    deliveryStatus       = serializers.CharField(source='delivery_status')


class DeliveryScheduleChangeLogSerializer(serializers.ModelSerializer):
    """
    Matches the VendorDeliveryScheduleChangeLog interface in types.ts.
    """
    id             = serializers.SerializerMethodField()
    scheduleId     = serializers.SerializerMethodField()
    componentCode  = serializers.CharField(source='component_code')
    componentDescription = serializers.CharField(source='component_description')
    vendorName     = serializers.CharField(source='vendor_name')
    changedBy      = serializers.CharField(source='changed_by')
    changedAt      = serializers.DateTimeField(source='changed_at')
    fieldChanged   = serializers.CharField(source='field_changed')
    oldValue       = serializers.CharField(source='old_value', allow_null=True)
    newValue       = serializers.CharField(source='new_value', allow_null=True)
    reasonForChange = serializers.CharField(source='reason_for_change')
    poNumber       = serializers.CharField(source='po_number')

    class Meta:
        model  = DeliveryScheduleChangeLog
        fields = [
            'id', 'scheduleId', 'poNumber', 'componentCode',
            'componentDescription', 'vendorName', 'changedBy', 'changedAt',
            'fieldChanged', 'oldValue', 'newValue', 'reasonForChange',
        ]

    def get_id(self, obj):
        return str(obj.id)

    def get_scheduleId(self, obj):
        return str(obj.schedule_id) if obj.schedule_id else None
```

---

## Part 7 — Views

```python
# core/views/vendor_schedule_views.py

import io
import csv
from django.http import StreamingHttpResponse
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.db import transaction
from django.utils import timezone

from core.models import (
    VendorDeliverySchedule, DeliveryScheduleChangeLog, UploadBatch
)
from core.serializers import (
    VendorDeliveryScheduleSerializer,
    DeliveryScheduleChangeLogSerializer
)
from core.services.consolidated_matrix_service import ConsolidatedMatrixService
from core.services.audit_log_service import AuditLogService
from core.services.vendor_schedule_week_resolver import VendorScheduleWeekResolver
from core.services.bulk_schedule_upload_service import BulkScheduleUploadService
from core.services.auto_fill_deficit_service import AutoFillDeficitService


# ─────────────────────────────────────────────────────────────────────────────
# View 1: Consolidated RM/PM Requirements Matrix
# GET /api/v1/vendor-schedule/consolidated-matrix/
# ─────────────────────────────────────────────────────────────────────────────

class ConsolidatedMatrixView(APIView):

    def get(self, request):
        month          = request.query_params.get('month')
        scope_mode     = request.query_params.get('scope_mode', 'WEEK')
        week_code      = request.query_params.get('week_code')
        buyer          = request.query_params.get('buyer', 'ALL')
        category       = request.query_params.get('category', 'ALL')
        criticality    = request.query_params.get('criticality')
        search         = request.query_params.get('search', '').strip()

        if not month:
            return Response({'error': 'month is required'}, status=400)

        result = ConsolidatedMatrixService.compute(
            month=month,
            scope_mode=scope_mode,
            selected_week_code=week_code,
            buyer_filter=buyer,
            category_filter=category,
            criticality_filter=criticality,
            search_term=search or None,
        )
        return Response(result)


# ─────────────────────────────────────────────────────────────────────────────
# View 2: List and Create Vendor Delivery Schedules
# GET  /api/v1/vendor-delivery-schedules/
# POST /api/v1/vendor-delivery-schedules/
# ─────────────────────────────────────────────────────────────────────────────

class VendorScheduleListCreateView(APIView):

    def get(self, request):
        month        = request.query_params.get('month')
        week_code    = request.query_params.get('week_code')
        comp_code    = request.query_params.get('component_code')
        vendor_code  = request.query_params.get('vendor_code')
        buyer_name   = request.query_params.get('buyer_name')
        del_status   = request.query_params.get('delivery_status')
        search       = request.query_params.get('search', '').strip()

        qs = VendorDeliverySchedule.objects.all().order_by('-expected_delivery_date')

        if month:
            from core.models import WeekDefinition
            week_codes = list(
                WeekDefinition.objects.filter(month=month)
                .values_list('week_code', flat=True)
            )
            qs = qs.filter(week_code__in=week_codes)
        if week_code:
            qs = qs.filter(week_code=week_code)
        if comp_code:
            qs = qs.filter(component_code=comp_code)
        if vendor_code:
            qs = qs.filter(vendor_code=vendor_code)
        if buyer_name:
            qs = qs.filter(buyer_name=buyer_name)
        if del_status:
            qs = qs.filter(delivery_status=del_status)
        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(po_number__icontains=search)        |
                Q(component_code__icontains=search)   |
                Q(vendor_name__icontains=search)      |
                Q(buyer_name__icontains=search)
            )

        serializer = VendorDeliveryScheduleSerializer(qs, many=True)
        return Response(serializer.data)

    def post(self, request):
        """
        Create one vendor delivery schedule.
        Required: component_code, vendor_code, promised_qty,
                  expected_delivery_date, changed_by, reason_for_change
        reason_for_change must be non-empty (min 10 chars enforced here).
        """
        data           = request.data
        changed_by     = data.get('changed_by', '').strip()
        reason         = data.get('reason_for_change', '').strip()
        comp_code      = data.get('component_code', '').strip()
        promised_qty   = data.get('promised_qty', 0)
        delivery_date  = data.get('expected_delivery_date')
        month          = data.get('month', '')

        # Validation
        if not changed_by:
            return Response({'error': 'changed_by is required'}, status=400)
        if len(reason) < 10:
            return Response(
                {'error': 'reason_for_change must be at least 10 characters'},
                status=400
            )
        if not comp_code:
            return Response({'error': 'component_code is required'}, status=400)
        if float(promised_qty) <= 0:
            return Response({'error': 'promised_qty must be greater than 0'}, status=400)
        if not delivery_date:
            return Response({'error': 'expected_delivery_date is required'}, status=400)

        # Parse and validate delivery date
        from datetime import date as date_type
        try:
            from datetime import datetime
            parsed_date = datetime.strptime(str(delivery_date), '%Y-%m-%d').date()
        except ValueError:
            return Response(
                {'error': 'expected_delivery_date must be YYYY-MM-DD format'},
                status=400
            )

        # Resolve week_code from date
        if not month:
            month = str(parsed_date)[:7]
        week_code = VendorScheduleWeekResolver.resolve(parsed_date, month)

        # Validate delivery status enum
        delivery_status = data.get('delivery_status', 'CONFIRMED_ON_TRACK')
        valid_statuses = {
            'CONFIRMED_ON_TRACK', 'IN_TRANSIT', 'PARTIAL_PROMISE',
            'DELAYED_AT_RISK', 'CANCELLED', 'CRITICAL_NO_PO'
        }
        if delivery_status not in valid_statuses:
            return Response(
                {'error': f'Invalid delivery_status. Must be one of: {valid_statuses}'},
                status=400
            )

        with transaction.atomic():
            sched = VendorDeliverySchedule.objects.create(
                po_number=data.get('po_number', f"PO-{int(timezone.now().timestamp())}"),
                component_code=comp_code,
                vendor_code=data.get('vendor_code', 'V-NONE'),
                vendor_name=data.get('vendor_name', ''),
                buyer_name=data.get('buyer_name', ''),
                expected_delivery_date=parsed_date,
                week_code=week_code,
                promised_qty=float(promised_qty),
                carrier_or_tracking=data.get('carrier_or_tracking', ''),
                delivery_status=delivery_status,
                notes=data.get('notes', ''),
            )
            AuditLogService.log_create(sched, changed_by, reason)

        serializer = VendorDeliveryScheduleSerializer(sched)
        return Response(serializer.data, status=201)


# ─────────────────────────────────────────────────────────────────────────────
# View 3: Retrieve, Update, Delete single schedule
# GET    /api/v1/vendor-delivery-schedules/{id}/
# PATCH  /api/v1/vendor-delivery-schedules/{id}/
# DELETE /api/v1/vendor-delivery-schedules/{id}/
# ─────────────────────────────────────────────────────────────────────────────

class VendorScheduleDetailView(APIView):

    def get_object(self, pk):
        try:
            return VendorDeliverySchedule.objects.get(pk=pk)
        except VendorDeliverySchedule.DoesNotExist:
            return None

    def get(self, request, pk):
        sched = self.get_object(pk)
        if not sched:
            return Response({'error': 'Schedule not found'}, status=404)
        return Response(VendorDeliveryScheduleSerializer(sched).data)

    def patch(self, request, pk):
        """
        Edit an existing delivery schedule.
        REQUIRED in payload: changed_by (str) + reason_for_change (str, min 10 chars)
        ALL other fields are optional; only send changed fields.

        Automatically:
          - Re-resolves week_code if expected_delivery_date changes
          - Writes one DeliveryScheduleChangeLog row per changed field
          - Writes a combined summary log row
        """
        sched = self.get_object(pk)
        if not sched:
            return Response({'error': 'Schedule not found'}, status=404)

        data       = request.data
        changed_by = data.get('changed_by', '').strip()
        reason     = data.get('reason_for_change', '').strip()

        if not changed_by:
            return Response({'error': 'changed_by is required'}, status=400)
        if len(reason) < 10:
            return Response(
                {'error': 'reason_for_change must be at least 10 characters'},
                status=400
            )

        # Snapshot old values for audit log
        old_snapshot = {
            'promised_qty':           float(sched.promised_qty),
            'expected_delivery_date': sched.expected_delivery_date.isoformat(),
            'delivery_status':        sched.delivery_status,
            'vendor_name':            sched.vendor_name,
            'buyer_name':             sched.buyer_name,
            'carrier_or_tracking':    sched.carrier_or_tracking or '',
            'notes':                  sched.notes or '',
        }

        # Apply updates
        updatable_fields = [
            'po_number', 'component_code', 'vendor_code', 'vendor_name',
            'buyer_name', 'carrier_or_tracking', 'delivery_status', 'notes',
        ]
        for field in updatable_fields:
            if field in data:
                setattr(sched, field, data[field])

        if 'promised_qty' in data:
            val = float(data['promised_qty'])
            if val <= 0:
                return Response({'error': 'promised_qty must be greater than 0'}, status=400)
            sched.promised_qty = val

        if 'expected_delivery_date' in data:
            from datetime import datetime
            try:
                parsed_date = datetime.strptime(
                    str(data['expected_delivery_date']), '%Y-%m-%d'
                ).date()
            except ValueError:
                return Response(
                    {'error': 'expected_delivery_date must be YYYY-MM-DD'},
                    status=400
                )
            sched.expected_delivery_date = parsed_date
            # Re-resolve week_code
            month = str(parsed_date)[:7]
            sched.week_code = VendorScheduleWeekResolver.resolve(parsed_date, month)

        with transaction.atomic():
            sched.save()
            AuditLogService.log_update(sched, old_snapshot, changed_by, reason)

        return Response(VendorDeliveryScheduleSerializer(sched).data)

    def delete(self, request, pk):
        """
        Deletes a delivery schedule.
        REQUIRED in request body: changed_by + reason_for_change (min 10 chars)
        Writes audit log BEFORE deleting (FK goes SET NULL after delete).
        """
        sched = self.get_object(pk)
        if not sched:
            return Response({'error': 'Schedule not found'}, status=404)

        data       = request.data
        changed_by = data.get('changed_by', '').strip()
        reason     = data.get('reason_for_change', '').strip()

        if not changed_by:
            return Response({'error': 'changed_by is required'}, status=400)
        if len(reason) < 10:
            return Response(
                {'error': 'reason_for_change must be at least 10 characters'},
                status=400
            )

        with transaction.atomic():
            # Write log BEFORE delete — FK still valid here
            AuditLogService.log_delete(sched, changed_by, reason)
            sched.delete()

        return Response({'deleted': True})


# ─────────────────────────────────────────────────────────────────────────────
# View 4: Bulk Excel/CSV Upload
# POST /api/v1/uploads/vendor-delivery-schedules/
# ─────────────────────────────────────────────────────────────────────────────

class VendorScheduleBulkUploadView(APIView):

    def post(self, request):
        """
        Accepts multipart file (.xlsx / .xls / .csv) OR JSON body with pasted_text.
        Required fields:
            month          : 'YYYY-MM'
            changed_by     : planner name
            import_mode    : 'APPEND' | 'OVERWRITE'
            upload_scope   : 'SELECTED_WEEK' | 'FULL_MONTH'
            week_code      : required if upload_scope='SELECTED_WEEK'
        Optional:
            pasted_text    : raw CSV or tab-separated text if no file
        """
        month         = request.data.get('month')
        changed_by    = request.data.get('changed_by', '').strip()
        import_mode   = request.data.get('import_mode', 'APPEND')
        upload_scope  = request.data.get('upload_scope', 'SELECTED_WEEK')
        week_code     = request.data.get('week_code', '')
        pasted_text   = request.data.get('pasted_text', '')
        file_obj      = request.FILES.get('file')

        if not month:
            return Response({'error': 'month is required'}, status=400)
        if not changed_by:
            return Response({'error': 'changed_by is required'}, status=400)
        if not file_obj and not pasted_text.strip():
            return Response(
                {'error': 'Provide either a file or pasted_text'},
                status=400
            )

        # Verify weeks exist for month
        from core.models import WeekDefinition
        week_qs = WeekDefinition.objects.filter(month=month)
        if not week_qs.exists():
            return Response(
                {'error': f'No week definitions found for {month}. Define weeks first.'},
                status=400
            )

        first_week_code = week_qs.order_by('week_no').first().week_code

        # Pre-load BOM component codes and vendor-buyer mappings
        from core.models import BOMMaster, VendorSuppliedComponent, VendorBuyerMaster
        bom_component_codes = set(
            BOMMaster.objects.filter(is_active=True)
            .values_list('component_code', flat=True)
        )
        vsc_rows = VendorSuppliedComponent.objects.select_related('vendor_buyer').all()
        vendor_by_component = {
            vsc.component_code: vsc.vendor_buyer for vsc in vsc_rows
        }

        # Parse file or pasted text
        file_name = 'Pasted Clipboard Spreadsheet Text'
        try:
            if file_obj:
                file_name = file_obj.name
                ext = file_name.rsplit('.', 1)[-1].lower()
                if ext in ('xlsx', 'xls'):
                    raw_rows = BulkScheduleUploadService.parse_file(file_obj)
                else:
                    text = file_obj.read().decode('utf-8', errors='replace')
                    raw_rows = BulkScheduleUploadService.parse_csv_text(text)
            else:
                raw_rows = BulkScheduleUploadService.parse_csv_text(pasted_text)
        except Exception as e:
            return Response({'error': f'Failed to parse file: {str(e)}'}, status=400)

        if not raw_rows:
            return Response({'error': 'No rows found in the uploaded file'}, status=400)

        # Normalize each row
        parsed_rows = [
            BulkScheduleUploadService.normalize_row(
                raw, month, bom_component_codes,
                vendor_by_component, first_week_code
            )
            for raw in raw_rows
        ]

        # Create upload batch
        batch = UploadBatch.objects.create(
            upload_type='VENDOR_DELIVERY_SCHEDULE',
            uploaded_by=changed_by,
            uploaded_at=timezone.now(),
            file_name=file_name,
            minio_path='',
            status='PROCESSING',
            total_rows=len(raw_rows),
            imported_rows=0,
            error_rows=0,
        )

        # TODO: Upload original file to MinIO and set batch.minio_path
        # minio_path = MinIOService.upload(file_obj, f'uploads/vendor-schedules/{month}/{batch.id}.{ext}')
        # batch.minio_path = minio_path; batch.save()

        # Apply to database
        result = BulkScheduleUploadService.apply(
            month=month,
            parsed_rows=parsed_rows,
            import_mode=import_mode,
            upload_scope=upload_scope,
            selected_week_code=week_code,
            changed_by=changed_by,
            upload_file_name=file_name,
            batch=batch,
        )

        return Response({
            'batch_id':     batch.id,
            'month':        month,
            'total_rows':   len(raw_rows),
            'imported_rows': result['imported'],
            'error_rows':   result['skipped'],
            'errors':       result['errors'],
            'message':      (
                f"Successfully imported {result['imported']} delivery schedule(s) "
                f"for {month}."
            ),
        })


# ─────────────────────────────────────────────────────────────────────────────
# View 5: Auto-Fill All Deficits (1-Click)
# POST /api/v1/vendor-delivery-schedules/auto-fill-deficits/
# ─────────────────────────────────────────────────────────────────────────────

class AutoFillDeficitsView(APIView):

    def post(self, request):
        month      = request.data.get('month')
        scope_mode = request.data.get('scope_mode', 'WEEK')
        week_code  = request.data.get('week_code')
        changed_by = request.data.get('changed_by', '').strip()

        if not month:
            return Response({'error': 'month is required'}, status=400)
        if not changed_by:
            return Response({'error': 'changed_by is required'}, status=400)

        result = AutoFillDeficitService.auto_fill(
            month=month,
            scope_mode=scope_mode,
            selected_week_code=week_code,
            changed_by=changed_by,
        )

        if result['generated'] == 0:
            return Response({
                'generated':             0,
                'total_units_committed': 0,
                'message': 'No shortage items found. All requirements are adequately covered.',
            })

        return Response({
            'generated':             result['generated'],
            'total_units_committed': result['total_units_committed'],
            'message': (
                f"Auto-scheduled {result['generated']} delivery commitments "
                f"covering all deficits "
                f"({result['total_units_committed']:,} total units)."
            ),
        })


# ─────────────────────────────────────────────────────────────────────────────
# View 6: Change Log / History Drawer
# GET /api/v1/vendor-delivery-schedules/change-logs/
# ─────────────────────────────────────────────────────────────────────────────

class DeliveryChangeLogListView(APIView):

    def get(self, request):
        po_number    = request.query_params.get('po_number')
        comp_code    = request.query_params.get('component_code')
        vendor_name  = request.query_params.get('vendor_name')
        changed_by   = request.query_params.get('changed_by')
        schedule_id  = request.query_params.get('schedule_id')
        date_from    = request.query_params.get('date_from')
        date_to      = request.query_params.get('date_to')
        field_type   = request.query_params.get('field_type')  # DATE|QTY|STATUS
        search       = request.query_params.get('search', '').strip()
        page         = int(request.query_params.get('page', 1))
        page_size    = int(request.query_params.get('page_size', 50))

        qs = DeliveryScheduleChangeLog.objects.order_by('-changed_at')

        if po_number:
            qs = qs.filter(po_number__iexact=po_number)
        if comp_code:
            qs = qs.filter(component_code__iexact=comp_code)
        if vendor_name:
            qs = qs.filter(vendor_name__icontains=vendor_name)
        if changed_by:
            qs = qs.filter(changed_by__icontains=changed_by)
        if schedule_id:
            qs = qs.filter(schedule_id=schedule_id)
        if date_from:
            qs = qs.filter(changed_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(changed_at__date__lte=date_to)

        # field_type filter (maps to HistoryDrawer category filter)
        if field_type == 'DATE':
            from django.db.models import Q
            qs = qs.filter(
                Q(field_changed__icontains='date') |
                Q(field_changed__icontains='arrival')
            )
        elif field_type == 'QTY':
            from django.db.models import Q
            qs = qs.filter(
                Q(field_changed__icontains='qty') |
                Q(field_changed__icontains='quantity')
            )
        elif field_type == 'STATUS':
            from django.db.models import Q
            qs = qs.filter(
                Q(field_changed__icontains='status') |
                Q(field_changed__icontains='cancelled')
            )

        if search:
            from django.db.models import Q
            qs = qs.filter(
                Q(po_number__icontains=search)          |
                Q(component_code__icontains=search)     |
                Q(component_description__icontains=search) |
                Q(vendor_name__icontains=search)        |
                Q(changed_by__icontains=search)         |
                Q(field_changed__icontains=search)      |
                Q(reason_for_change__icontains=search)  |
                Q(old_value__icontains=search)          |
                Q(new_value__icontains=search)
            )

        total    = qs.count()
        offset   = (page - 1) * page_size
        page_qs  = qs[offset: offset + page_size]

        serializer = DeliveryScheduleChangeLogSerializer(page_qs, many=True)
        return Response({
            'count':        total,
            'page':         page,
            'page_size':    page_size,
            'total_pages':  (total + page_size - 1) // page_size,
            'results':      serializer.data,
        })


# ─────────────────────────────────────────────────────────────────────────────
# View 7: Download Blank Excel Template
# GET /api/v1/exports/vendor-schedule-blank-template/?month=YYYY-MM
# ─────────────────────────────────────────────────────────────────────────────

class VendorScheduleBlankTemplateView(APIView):

    def get(self, request):
        import openpyxl
        month       = request.query_params.get('month', '')
        week_no     = request.query_params.get('week_no', '1')
        week_start  = request.query_params.get('week_start', f'{month}-10')

        wb  = openpyxl.Workbook()
        ws  = wb.active
        ws.title = 'Schedule_Template'

        headers = [
            'PO_Number', 'Component_Code', 'Component_Description',
            'Vendor_Code', 'Vendor_Name', 'Buyer_Name',
            'Expected_Delivery_Date', 'Week_No', 'Promised_Quantity',
            'Delivery_Status', 'Carrier_Or_Tracking', 'Notes'
        ]
        ws.append(headers)

        # Two sample rows
        ws.append([
            f'PO-{month.replace("-", "")}-8801', '100201',
            'Die-Cast Aluminum Housing (Panther)',
            'V-1020', 'CastAlu Technologies GmbH', 'Rajesh Kumar',
            week_start, int(week_no), 3500,
            'CONFIRMED_ON_TRACK', 'Direct Express Truck (TN-04-AB-9821)',
            'Confirmed by vendor for Monday morning dock receipt'
        ])
        ws.append([
            f'PO-{month.replace("-", "")}-8802', '200405',
            'Composite Carbon Sliding Vane (3-Set)',
            'V-1030', 'CarbonTech Materials AG', 'Ananya Sharma',
            week_start, int(week_no), 4000,
            'CONFIRMED_ON_TRACK', 'DHL Freight Logistics', 'Weekly batch shipment'
        ])

        column_widths = [16, 16, 38, 14, 28, 18, 24, 10, 18, 22, 30, 40]
        for i, width in enumerate(column_widths, 1):
            ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = width

        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        filename = f'SAP_Vendor_Delivery_Schedule_Blank_Template_{month}.xlsx'
        response = StreamingHttpResponse(
            buffer,
            content_type=(
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


# ─────────────────────────────────────────────────────────────────────────────
# View 8: Download Pre-Filled Template with Computed Requirements
# GET /api/v1/exports/vendor-schedule-prefilled/?month=&scope_mode=&week_code=
# ─────────────────────────────────────────────────────────────────────────────

class VendorSchedulePrefilledTemplateView(APIView):

    def get(self, request):
        import openpyxl
        month      = request.query_params.get('month')
        scope_mode = request.query_params.get('scope_mode', 'WEEK')
        week_code  = request.query_params.get('week_code')

        if not month:
            return Response({'error': 'month is required'}, status=400)

        matrix = ConsolidatedMatrixService.compute(
            month=month,
            scope_mode=scope_mode,
            selected_week_code=week_code,
        )

        selected_week  = matrix.get('selectedWeek')
        week_start     = selected_week['startDate'] if selected_week else f'{month}-10'
        week_no_val    = selected_week['weekNo']    if selected_week else 1
        scope_label    = f"Week_{week_no_val}" if scope_mode == 'WEEK' else 'Full_Month'

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = 'Consolidated_Requirements'

        headers = [
            'PO_Number', 'Component_Code', 'Component_Description', 'Category',
            'Is_Common_Part', 'Vendor_Code', 'Vendor_Name', 'Buyer_Name',
            'Lead_Time_Days', 'MB52_Available_Stock', 'Gross_Requirement',
            'Current_Scheduled_Inward', 'Deficit_Shortage',
            'Expected_Delivery_Date', 'Week_No', 'Promised_Quantity',
            'Delivery_Status', 'Carrier_Or_Tracking', 'Notes'
        ]
        ws.append(headers)

        for idx, row in enumerate(matrix['rows']):
            suggested_qty = (
                row['selectedScopeDeficit']
                if row['hasShortage'] else
                max(row['selectedScopeGrossReq'], 1000)
            )
            common_label = (
                f"YES ({row['sharedInFGsCount']} FGs)"
                if row['isCommonPart'] else 'NO'
            )
            ws.append([
                f'PO-{month.replace("-", "")}-{9000 + idx}',
                row['componentCode'],
                row['componentDescription'],
                row['category'],
                common_label,
                row['vendorCode'],
                row['vendorName'],
                row['buyerName'],
                row['leadTimeDays'],
                row['availableStock'],
                row['selectedScopeGrossReq'],
                row['selectedScopeInward'],
                row['selectedScopeDeficit'],
                week_start,
                week_no_val,
                suggested_qty,
                'CONFIRMED_ON_TRACK',
                'Road Logistics Standard',
                (
                    f"Shared in {row['sharedInFGsCount']} FGs — maintain priority inward."
                    if row['isCommonPart']
                    else 'Standard production replenishment'
                ),
            ])

        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        filename = f'SAP_RM_Requirements_PreFilled_{month}_{scope_label}.xlsx'
        response = StreamingHttpResponse(
            buffer,
            content_type=(
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


# ─────────────────────────────────────────────────────────────────────────────
# View 9: Export Consolidated Matrix to Excel Report
# GET /api/v1/exports/vendor-schedule-matrix/?month=&buyer=&category=&criticality=
# ─────────────────────────────────────────────────────────────────────────────

class VendorScheduleMatrixExportView(APIView):

    def get(self, request):
        import openpyxl
        from openpyxl.styles import PatternFill, Font

        month       = request.query_params.get('month')
        scope_mode  = request.query_params.get('scope_mode', 'MONTH')
        week_code   = request.query_params.get('week_code')
        buyer       = request.query_params.get('buyer', 'ALL')
        category    = request.query_params.get('category', 'ALL')
        criticality = request.query_params.get('criticality')

        if not month:
            return Response({'error': 'month is required'}, status=400)

        matrix     = ConsolidatedMatrixService.compute(
            month=month, scope_mode=scope_mode, selected_week_code=week_code,
            buyer_filter=buyer, category_filter=category,
            criticality_filter=criticality,
        )
        month_weeks = matrix['monthWeeks']

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = 'Consolidated_RM_Matrix'

        # Dynamic headers: fixed columns + one pair per week
        fixed_headers = [
            'Component Code', 'Description', 'Category', 'UOM',
            'Is Common Item', 'Buyer', 'Vendor', 'Vendor Code',
            'MB52 Physical Stock', 'Frozen Reserved', 'Available Stock'
        ]
        week_headers = []
        for w in month_weeks:
            week_headers += [
                f"{w['weekLabel']} Gross Req",
                f"{w['weekLabel']} Inward Inbound",
            ]
        tail_headers = [
            'Total Month Gross Demand', 'Total Month Inward Scheduled',
            'Ending Balance', 'Current Status'
        ]
        ws.append(fixed_headers + week_headers + tail_headers)

        red_fill    = PatternFill('solid', fgColor='FFCDD2')
        green_fill  = PatternFill('solid', fgColor='C8E6C9')

        for row_data in matrix['rows']:
            row = [
                row_data['componentCode'],
                row_data['componentDescription'],
                row_data['category'],
                row_data['uom'],
                f"Shared in {row_data['sharedInFGsCount']} FGs" if row_data['isCommonPart'] else 'Single FG',
                row_data['buyerName'],
                row_data['vendorName'],
                row_data['vendorCode'],
                row_data['totalPhysicalStock'],
                row_data['reservedStock'],
                row_data['availableStock'],
            ]
            for w in month_weeks:
                row.append(row_data['weeklyGrossReq'].get(w['weekCode'], 0))
                row.append(row_data['weeklyInwardDeliveries'].get(w['weekCode'], 0))
            row += [
                row_data['monthTotalGrossReq'],
                row_data['monthTotalInward'],
                row_data['monthEndingBalance'],
                'SHORTAGE_DEFICIT' if row_data['hasShortage'] else 'ADEQUATE',
            ]
            excel_row = ws.append(row)
            # Colour the last cell (status) based on shortage
            status_cell = ws.cell(
                row=ws.max_row, column=len(fixed_headers + week_headers + tail_headers)
            )
            status_cell.fill = red_fill if row_data['hasShortage'] else green_fill

        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        filename = f'Consolidated_RM_Schedule_Matrix_{month}.xlsx'
        response = StreamingHttpResponse(
            buffer,
            content_type=(
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            )
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response
```

---

## Part 8 — URL Registration

```python
# core/urls.py  — add all nine patterns

from core.views.vendor_schedule_views import (
    ConsolidatedMatrixView,
    VendorScheduleListCreateView,
    VendorScheduleDetailView,
    VendorScheduleBulkUploadView,
    AutoFillDeficitsView,
    DeliveryChangeLogListView,
    VendorScheduleBlankTemplateView,
    VendorSchedulePrefilledTemplateView,
    VendorScheduleMatrixExportView,
)

urlpatterns += [
    # Consolidated matrix computation
    path(
        'vendor-schedule/consolidated-matrix/',
        ConsolidatedMatrixView.as_view(),
        name='vendor-schedule-matrix'
    ),

    # CRUD endpoints
    path(
        'vendor-delivery-schedules/',
        VendorScheduleListCreateView.as_view(),
        name='vendor-delivery-schedules-list'
    ),
    path(
        'vendor-delivery-schedules/<int:pk>/',
        VendorScheduleDetailView.as_view(),
        name='vendor-delivery-schedules-detail'
    ),

    # Bulk upload
    path(
        'uploads/vendor-delivery-schedules/',
        VendorScheduleBulkUploadView.as_view(),
        name='vendor-schedule-bulk-upload'
    ),

    # Auto-fill deficits
    path(
        'vendor-delivery-schedules/auto-fill-deficits/',
        AutoFillDeficitsView.as_view(),
        name='vendor-schedule-auto-fill'
    ),

    # Change log / history drawer
    path(
        'vendor-delivery-schedules/change-logs/',
        DeliveryChangeLogListView.as_view(),
        name='vendor-delivery-change-logs'
    ),

    # Template downloads
    path(
        'exports/vendor-schedule-blank-template/',
        VendorScheduleBlankTemplateView.as_view(),
        name='vendor-schedule-blank-template'
    ),
    path(
        'exports/vendor-schedule-prefilled/',
        VendorSchedulePrefilledTemplateView.as_view(),
        name='vendor-schedule-prefilled'
    ),
    path(
        'exports/vendor-schedule-matrix/',
        VendorScheduleMatrixExportView.as_view(),
        name='vendor-schedule-matrix-export'
    ),
]
```

**IMPORTANT:** The auto-fill and change-logs paths must be registered BEFORE the
`<int:pk>/` path. Django matches routes in order — if `<int:pk>/` comes first,
`auto-fill-deficits/` will never be reached.

---

## Part 9 — Build Order

Work through these in exact order. Each step's output is required by the next.

| Step | What to Build | Verify With |
|---|---|---|
| 1 | Confirm all 4 DB tables exist (from Monday Cockpit plan) | `\dt vendor_delivery_schedule` in psql |
| 2 | Write `AuditLogService` (5 static methods) | Unit test: call `log_create` with a dummy schedule, check DB has 1 row |
| 3 | Write `VendorScheduleWeekResolver` (2 static methods) | Unit test: date 2026-08-10 → resolves to `w-2026-08-02` |
| 4 | Write `ConsolidatedMatrixService.compute()` | Call with test month, check rows present, sums correct |
| 5 | Write `BulkScheduleUploadService` (parse + normalize + apply) | Test with a 3-row CSV, check 3 schedules in DB + 3 audit logs |
| 6 | Write `AutoFillDeficitService.auto_fill()` | Create shortage scenario, call service, check schedules created |
| 7 | Write all 9 serializers | Run `serializer.data` on a model instance, check camelCase keys |
| 8 | Write `ConsolidatedMatrixView` + register URL | `GET /api/v1/vendor-schedule/consolidated-matrix/?month=2026-08` returns rows |
| 9 | Write `VendorScheduleListCreateView` + URL | `GET` returns empty list, `POST` creates schedule + audit log |
| 10 | Write `VendorScheduleDetailView` + URL | `PATCH` changes date, re-resolves weekCode, writes log per changed field |
| 11 | Write `VendorScheduleBulkUploadView` + URL | Upload the blank template with 2 sample rows, check 2 schedules in DB |
| 12 | Write `AutoFillDeficitsView` + URL | Post with shortage month, check schedules created = number of shortage rows |
| 13 | Write `DeliveryChangeLogListView` + URL | After CRUD ops above, `GET` returns logs in reverse chronological order |
| 14 | Write 3 template/export views + URLs | Download blank template, check headers match 12-column spec |
| 15 | Register all URLs in correct order (auto-fill before pk) | `python manage.py show_urls` — verify all 9 paths exist |
| 16 | Run full integration test sequence (Part 10) | All 9 checks pass |

---

## Part 10 — Integration Verification

Run all checks after completing every build step. A check that passes now must not
regress later.

```bash
BASE="http://localhost:8000/api/v1"

# 1. Matrix endpoint returns rows
curl -s "$BASE/vendor-schedule/consolidated-matrix/?month=2026-08&scope_mode=WEEK&week_code=w-2026-08-02" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
rows = data.get('rows', [])
print(f'rows: {len(rows)}')
print(f'summary: {data.get(\"summary\")}')
req_keys = ['componentCode','category','weeklyGrossReq','weeklyInwardDeliveries',
            'hasShortage','selectedScopeDeficit','buyerName','vendorName']
if rows:
    missing = [k for k in req_keys if k not in rows[0]]
    print(f'missing keys: {missing}')
"

# 2. Create a delivery schedule (requires reason >= 10 chars)
curl -s -X POST "$BASE/vendor-delivery-schedules/" \
  -H "Content-Type: application/json" \
  -d '{
    "po_number": "PO-TEST-001",
    "component_code": "100201",
    "vendor_code": "V-1020",
    "vendor_name": "CastAlu Technologies",
    "buyer_name": "Rajesh Kumar",
    "expected_delivery_date": "2026-08-10",
    "month": "2026-08",
    "promised_qty": 2000,
    "delivery_status": "CONFIRMED_ON_TRACK",
    "changed_by": "Test Planner",
    "reason_for_change": "New vendor commitment for week 2 shortfall"
  }' | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('created id:', d.get('id'))
print('weekId resolved:', d.get('weekId'))
"

# 3. Verify reason_for_change < 10 chars is rejected
curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$BASE/vendor-delivery-schedules/" \
  -H "Content-Type: application/json" \
  -d '{"component_code":"100201","promised_qty":500,"expected_delivery_date":"2026-08-10",
       "changed_by":"Planner","reason_for_change":"short"}'
# Expected: 400

# 4. Edit the schedule and verify per-field audit logs
SCHED_ID=$(curl -s "$BASE/vendor-delivery-schedules/?component_code=100201" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")

curl -s -X PATCH "$BASE/vendor-delivery-schedules/$SCHED_ID/" \
  -H "Content-Type: application/json" \
  -d "{
    \"promised_qty\": 3500,
    \"expected_delivery_date\": \"2026-08-12\",
    \"changed_by\": \"Test Planner\",
    \"reason_for_change\": \"Vendor confirmed revised quantity and arrival date\"
  }" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('updated promisedQty:', d.get('promisedQty'))
print('updated weekId:', d.get('weekId'))
"

# 5. Verify change logs were written
curl -s "$BASE/vendor-delivery-schedules/change-logs/?component_code=100201" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
logs = d.get('results', [])
print(f'audit logs for 100201: {len(logs)}')
for log in logs[:3]:
    print(f'  {log[\"fieldChanged\"]} | {log[\"oldValue\"]} → {log[\"newValue\"]}')
"
# Expected: at least 3 logs (create + qty change + date change + summary)

# 6. Delete the schedule
curl -s -X DELETE "$BASE/vendor-delivery-schedules/$SCHED_ID/" \
  -H "Content-Type: application/json" \
  -d '{"changed_by":"Test Planner","reason_for_change":"Testing deletion audit trail"}'
# Expected: {"deleted": true}

# Verify log was written for deletion
curl -s "$BASE/vendor-delivery-schedules/change-logs/?component_code=100201" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
logs = d.get('results', [])
deleted_log = next((l for l in logs if 'Deleted' in l.get('fieldChanged','')), None)
print('delete log found:', deleted_log is not None)
"

# 7. Bulk upload test
curl -s -X POST "$BASE/uploads/vendor-delivery-schedules/" \
  -F "file=@/tmp/test_schedule.csv" \
  -F "month=2026-08" \
  -F "changed_by=Test Planner" \
  -F "import_mode=APPEND" \
  -F "upload_scope=SELECTED_WEEK" \
  -F "week_code=w-2026-08-02"
# Expected: {"batch_id":...,"imported_rows":N,"error_rows":0}

# 8. Auto-fill deficits
curl -s -X POST "$BASE/vendor-delivery-schedules/auto-fill-deficits/" \
  -H "Content-Type: application/json" \
  -d '{"month":"2026-08","scope_mode":"WEEK","week_code":"w-2026-08-02","changed_by":"Test Planner"}'
# Expected: {"generated":N,"total_units_committed":M}

# 9. Template downloads
curl -s -o /tmp/blank_template.xlsx \
  "$BASE/exports/vendor-schedule-blank-template/?month=2026-08&week_no=2&week_start=2026-08-08"
ls -lh /tmp/blank_template.xlsx
# Expected: file > 5KB

curl -s -o /tmp/prefilled_template.xlsx \
  "$BASE/exports/vendor-schedule-prefilled/?month=2026-08&scope_mode=WEEK&week_code=w-2026-08-02"
ls -lh /tmp/prefilled_template.xlsx
# Expected: file > 5KB with shortage rows

curl -s -o /tmp/matrix_report.xlsx \
  "$BASE/exports/vendor-schedule-matrix/?month=2026-08"
ls -lh /tmp/matrix_report.xlsx
# Expected: file > 5KB with weekly breakdown columns
```

---

## Part 11 — Business Rules Summary

These are enforced at the service layer in every mutation. Never relax them.

- `reason_for_change` is mandatory on every schedule create, edit, and delete.
  Minimum 10 characters. Return `400` if absent or shorter.
- `changed_by` is mandatory on every mutation. Return `400` if absent.
- `promised_qty` must be > 0. Return `400` for zero or negative values.
- `expected_delivery_date` must be a valid `YYYY-MM-DD` date. Return `400` otherwise.
- `delivery_status` must be one of the 6 valid enum values. Return `400` otherwise.
- `week_code` is ALWAYS resolved server-side from `expected_delivery_date` against
  the `week_definition` date ranges. The client may send `week_code` as a hint but
  the server always recalculates it. Never trust the client's `week_code`.
- Audit log is written BEFORE the schedule is deleted so the FK still resolves.
- OVERWRITE mode cancels existing schedules (sets `delivery_status='CANCELLED'`)
  rather than hard-deleting them — this preserves the audit trail.
- Auto-fill generates POs with prefix `PO-AUTO-` so they are distinguishable from
  manually entered POs in the history drawer.
- Common-part reserved stock is computed from FROZEN plans only
  (`fg_plan_freeze.status = 'FROZEN'`). DRAFT and REVIEWED plans do not
  reserve stock.
- The consolidated matrix sort order is fixed: shortages first, then common parts,
  then alphabetical by component code. Do not change this without frontend
  coordination.
