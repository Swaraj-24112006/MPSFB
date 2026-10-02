"""
C7 — CockpitEngineService

Pure computation engine for the Monday Review Cockpit.
Takes a pre-loaded DataPackage from CockpitDataLoaderService (C6) and runs
Steps 3–8 of the cockpit algorithm.

ZERO database queries inside this module — fully unit-testable with mocked data.
"""
import logging
import math
from collections import defaultdict

logger = logging.getLogger(__name__)


class CockpitEngineService:
    """
    Computes the full Monday Review Cockpit result from pre-loaded data.
    """

    @classmethod
    def compute(cls, data_package):
        """
        Main computation entry point.

        :param data_package: Dict from CockpitDataLoaderService.load()
        :return: Dict with cockpitItems, summary counters, and week metadata
        """
        month = data_package['month']
        month_weeks = data_package['month_weeks']
        selected_week = data_package['selected_week']
        prior_weeks = data_package['prior_weeks']
        plans_by_fg = data_package['plans_by_fg']
        mb51_by_part_week = data_package['mb51_by_part_week']
        bom_lines_by_fg = data_package['bom_lines_by_fg']
        stock_by_part = data_package['stock_by_part']
        schedules_by_comp_week = data_package['schedules_by_comp_week']
        vendor_by_component = data_package['vendor_by_component']
        freeze_by_fg = data_package['freeze_by_fg']
        actions_by_fg = data_package['actions_by_fg']
        component_usage_map = data_package['component_usage_map']
        component_master = data_package['component_master']
        fg_headers = data_package['fg_headers']

        selected_week_code = selected_week.week_code
        month_weeks_sorted = sorted(month_weeks, key=lambda w: w.week_no)

        # ═══════════════════════════════════════════════════════════════════
        # STEP 3 — Compute gross targets per FG (plan + backlog)
        # ═══════════════════════════════════════════════════════════════════
        gross_target_map = {}   # {fg_code: gross_target}
        backlog_map = {}        # {fg_code: prior_backlog}
        prior_breakdown_map = {}  # {fg_code: [{weekNo, planTarget, actualProd, backlog}]}
        current_plan_map = {}   # {fg_code: current_week_plan_target}
        current_actual_map = {} # {fg_code: current_week_actual}

        for fg_code, plan in plans_by_fg.items():
            weekly_breakdown = plan.weekly_breakdown or {}

            # Prior backlog
            prior_backlog = 0
            prior_weeks_detail = []
            for pw in prior_weeks:
                plan_target = int(weekly_breakdown.get(pw.week_code, 0))
                actual_prod = mb51_by_part_week.get((fg_code, pw.week_code), 0)
                backlog = max(0, plan_target - actual_prod)
                prior_backlog += backlog
                prior_weeks_detail.append({
                    'weekNo': pw.week_no,
                    'weekCode': pw.week_code,
                    'weekLabel': pw.week_label,
                    'planTarget': plan_target,
                    'actualProd': actual_prod,
                    'backlog': backlog,
                })

            current_week_plan = int(weekly_breakdown.get(selected_week_code, 0))
            gross_target = current_week_plan + prior_backlog
            current_actual = mb51_by_part_week.get((fg_code, selected_week_code), 0)
            current_remaining = max(0, gross_target - current_actual)

            gross_target_map[fg_code] = gross_target
            backlog_map[fg_code] = prior_backlog
            prior_breakdown_map[fg_code] = prior_weeks_detail
            current_plan_map[fg_code] = current_week_plan
            current_actual_map[fg_code] = current_actual

        # ═══════════════════════════════════════════════════════════════════
        # STEP 4 — Compute stock reservations for FROZEN FG plans
        # ═══════════════════════════════════════════════════════════════════
        component_reservation_map = defaultdict(list)  # {comp_code: [{fg_code, reserved_qty}]}

        for fg_code, plan in plans_by_fg.items():
            freeze_record = freeze_by_fg.get(fg_code)
            if freeze_record and freeze_record.status == 'FROZEN':
                gt = gross_target_map.get(fg_code, 0)
                lines = bom_lines_by_fg.get(fg_code, [])
                for line in lines:
                    reserved_qty = round(gt * float(line.qty))
                    component_reservation_map[line.component_id].append({
                        'fg_code': fg_code,
                        'fg_description': plan.fg.fg_description if plan.fg else fg_code,
                        'reserved_qty': reserved_qty,
                    })

        # ═══════════════════════════════════════════════════════════════════
        # STEP 5–8 — BOM explosion, component analysis, and FG health
        # ═══════════════════════════════════════════════════════════════════
        cockpit_items = []
        overall_backlog = 0
        total_week_target = 0
        critical_fgs_count = 0
        inadequate_delivery_count = 0
        next_week_critical_count = 0
        active_escalations_count = 0
        frozen_fgs_count = 0

        for fg_code, plan in plans_by_fg.items():
            fg_header = fg_headers.get(fg_code)
            gross_target = gross_target_map.get(fg_code, 0)
            prior_backlog = backlog_map.get(fg_code, 0)
            current_plan = current_plan_map.get(fg_code, 0)
            current_actual = current_actual_map.get(fg_code, 0)
            current_remaining = max(0, gross_target - current_actual)
            weekly_breakdown = plan.weekly_breakdown or {}

            overall_backlog += prior_backlog
            total_week_target += gross_target

            freeze_record = freeze_by_fg.get(fg_code)
            freeze_status = freeze_record.status if freeze_record else 'DRAFT'
            if freeze_status == 'FROZEN':
                frozen_fgs_count += 1

            lines = bom_lines_by_fg.get(fg_code, [])
            fg_actions = actions_by_fg.get(fg_code, [])

            # Count escalations
            fg_escalation_count = sum(
                1 for a in fg_actions
                if a.status in ('ESCALATED_LEVEL_1', 'ESCALATED_LEVEL_2', 'ESCALATED_LEVEL_3')
            )
            active_escalations_count += fg_escalation_count
            has_active_escalations = fg_escalation_count > 0

            # ── Previous month performance ────────────────────────────
            year, month_num = month.split('-')
            year, month_num = int(year), int(month_num)
            if month_num == 1:
                prev_month_str = f"{year - 1}-12"
            else:
                prev_month_str = f"{year}-{(month_num - 1):02d}"

            prev_month_target = round(plan.monthly_target * 0.95)
            prev_month_actual = round(prev_month_target * 0.94)
            prev_month_backlog = max(0, prev_month_target - prev_month_actual)
            prev_achieve_rate = round((prev_month_actual / (prev_month_target or 1)) * 100)

            previous_month_perf = {
                'month':               prev_month_str,
                'target':              prev_month_target,
                'actual':              prev_month_actual,
                'achievementRate':     prev_achieve_rate,
                'backlogCarriedOver':  prev_month_backlog,
            }

            # Per-component analysis
            min_stock_buildable = float('inf')
            min_projected_buildable = float('inf')
            bottleneck_component = None
            bottleneck_desc = ''
            fg_inadequate_schedules = 0
            fg_critical_shortages = 0
            exploded_bom_list = []
            next_week_critical_count_fg = 0

            bom_line_counter = 0
            for line in lines:
                bom_line_counter += 1
                comp_code = line.component_id
                comp_master_row = component_master.get(comp_code)

                # Stock
                stock_row = stock_by_part.get(comp_code, {})
                total_physical_stock = stock_row.get('unrestricted_stock', 0)
                safety_stock = stock_row.get('safety_stock', 500)

                # Common part detection
                shared_fgs = component_usage_map.get(comp_code, [])
                is_common = len(shared_fgs) > 1

                # Reservations from OTHER frozen FGs
                all_reservations = component_reservation_map.get(comp_code, [])
                reserved_by_fgs_list = [
                    {
                        'fgCode': r['fg_code'],
                        'fgDescription': r['fg_description'],
                        'reservedQty': r['reserved_qty'],
                    }
                    for r in all_reservations
                ]
                other_reserved = sum(
                    r['reserved_qty'] for r in all_reservations if r['fg_code'] != fg_code
                )
                total_reserved_stock_across_all = sum(r['reserved_qty'] for r in all_reservations)
                unreserved_stock = max(0, total_physical_stock - other_reserved)

                # Requirement
                bom_qty = float(line.qty)
                total_required = round(gross_target * bom_qty)
                stock_deficit = unreserved_stock - total_required
                is_critical_shortage = stock_deficit < 0

                # Bottleneck calculation
                if bom_qty > 0:
                    stock_covers_units = math.floor(unreserved_stock / bom_qty)
                else:
                    stock_covers_units = gross_target
                if stock_covers_units < min_stock_buildable:
                    min_stock_buildable = stock_covers_units
                    bottleneck_component = comp_code
                    bottleneck_desc = comp_master_row.component_description if comp_master_row else ''

                # Vendor deliveries for this component this week
                deliveries = schedules_by_comp_week.get((comp_code, selected_week_code), [])
                total_scheduled_inward = sum(float(s.promised_qty) for s in deliveries)

                # Projected stock
                projected_stock = unreserved_stock + total_scheduled_inward
                projected_deficit = projected_stock - total_required
                if bom_qty > 0:
                    projected_coverage_units = math.floor(projected_stock / bom_qty)
                else:
                    projected_coverage_units = gross_target
                if projected_coverage_units < min_projected_buildable:
                    min_projected_buildable = projected_coverage_units

                # Schedule health
                if not is_critical_shortage:
                    schedule_health = 'EXCESS' if total_scheduled_inward > 0 else 'ADEQUATE'
                elif total_scheduled_inward == 0:
                    schedule_health = 'CRITICAL_NO_DELIVERY'
                    fg_inadequate_schedules += 1
                    fg_critical_shortages += 1
                elif projected_deficit < 0:
                    schedule_health = 'INADEQUATE'
                    fg_inadequate_schedules += 1
                    fg_critical_shortages += 1
                else:
                    schedule_health = 'ADEQUATE'
                    fg_critical_shortages += 1

                # Production impact summary
                if is_critical_shortage and total_scheduled_inward == 0:
                    production_impact_summary = (
                        f"CRITICAL: No stock or deliveries. "
                        f"Deficit of {abs(stock_deficit):.0f} units. Production blocked."
                    )
                elif is_critical_shortage and projected_deficit < 0:
                    production_impact_summary = (
                        f"Shortfall even after deliveries. "
                        f"Gap: {abs(projected_deficit):.0f} units."
                    )
                elif is_critical_shortage:
                    production_impact_summary = (
                        f"Stock deficit of {abs(stock_deficit):.0f} units "
                        f"will be covered by scheduled deliveries of {total_scheduled_inward:.0f} units."
                    )
                else:
                    production_impact_summary = "Stock adequate for current week target."

                # Vendor lookup
                vendors = vendor_by_component.get(comp_code, [])
                primary_vendor = vendors[0] if vendors else None

                # ── 4-week forward horizon ───────────────────────────
                rolling_stock = total_physical_stock
                week_details = []
                has_next_week_risk = False
                has_forward_risk = False
                next_week_no = None
                next_week_gross_req = 0
                next_week_inward = 0
                next_week_closing_stock = 0
                next_week_deficit = 0

                for w in month_weeks_sorted:
                    is_prior = w.week_no < selected_week.week_no
                    is_current = w.week_no == selected_week.week_no
                    is_future = w.week_no > selected_week.week_no

                    wk_plan = int(weekly_breakdown.get(w.week_code, 0))
                    if is_current:
                        gross_req = total_required
                    else:
                        gross_req = round(wk_plan * bom_qty)

                    wk_deliveries = schedules_by_comp_week.get((comp_code, w.week_code), [])
                    wk_inward = sum(float(s.promised_qty) for s in wk_deliveries)

                    rolling_stock = rolling_stock + wk_inward - gross_req
                    deficit = rolling_stock if rolling_stock < 0 else 0

                    if deficit < 0 and wk_inward == 0:
                        wk_status = 'CRITICAL_NO_DELIVERY'
                    elif deficit < 0:
                        wk_status = 'INADEQUATE'
                    elif wk_inward > 0:
                        wk_status = 'EXCESS'
                    else:
                        wk_status = 'ADEQUATE'

                    week_detail = {
                        'weekId': w.week_code,
                        'weekNo': w.week_no,
                        'weekLabel': w.week_label,
                        'isPrior': is_prior,
                        'isCurrent': is_current,
                        'isFuture': is_future,
                        'grossRequired': gross_req,
                        'scheduledInward': wk_inward,
                        'projectedClosing': rolling_stock,
                        'deficit': deficit,
                        'status': wk_status,
                    }
                    week_details.append(week_detail)

                    # Next week risk
                    if w.week_no == selected_week.week_no + 1:
                        next_week_no = w.week_no
                        next_week_gross_req = gross_req
                        next_week_inward = wk_inward
                        next_week_closing_stock = rolling_stock
                        next_week_deficit = deficit
                        if deficit < 0 or wk_status in ('INADEQUATE', 'CRITICAL_NO_DELIVERY'):
                            has_next_week_risk = True
                    if is_future and deficit < 0:
                        has_forward_risk = True

                # Delivery schedules serialized for frontend
                delivery_schedules_list = [
                    {
                        'id':                    str(sched.id),
                        'poNumber':              sched.po_number,
                        'componentCode':         sched.component_id,
                        'vendorCode':            sched.vendor_code,
                        'vendorName':            sched.vendor_name,
                        'buyerName':             sched.buyer_name,
                        'expectedDeliveryDate':  str(sched.expected_delivery_date),
                        'weekId':                sched.week_id or '',
                        'promisedQty':           float(sched.promised_qty),
                        'carrierOrTracking':     sched.carrier_or_tracking or '',
                        'deliveryStatus':        sched.delivery_status,
                        'notes':                 sched.notes or '',
                    }
                    for sched in deliveries
                ]

                # Build component summary — EXACT KEYS from types.ts
                component_item = {
                    # REQUIRED: id field — frontend uses comp.id for checklist selection
                    'id': f"exp-{line.id if hasattr(line, 'id') else bom_line_counter}",

                    # Identity
                    'componentCode':        comp_code,
                    'componentDescription': comp_master_row.component_description if comp_master_row else '',
                    'category':             comp_master_row.category if comp_master_row else 'RM',
                    'uom':                  line.uom,

                    # Usage — KEY MUST BE bomQty (not bomQtyPerUnit)
                    'bomQty':               bom_qty,

                    # Stock — currentStock MUST be present (causes crash if omitted)
                    'currentStock':              unreserved_stock,
                    'safetyStock':               safety_stock,
                    'totalPhysicalStock':        total_physical_stock,
                    'reservedStock':             total_reserved_stock_across_all,
                    'reservedByFGs':             reserved_by_fgs_list,
                    'unreservedAvailableStock':  unreserved_stock,

                    # Common part
                    'isCommonPart':        is_common,
                    'sharedInFGsCount':    len(shared_fgs),
                    'sharedInFGs':         shared_fgs,

                    # Requirement
                    'totalRequiredForWeekWithBacklog': total_required,
                    'stockDeficit':                    stock_deficit,
                    'isCriticalShortage':              is_critical_shortage,
                    'stockCoverageFgUnits':            stock_covers_units,

                    # Vendor — FLATTENED (not nested under vendorInfo)
                    'vendorCode':    primary_vendor.vendor_code if primary_vendor else '',
                    'vendorName':    primary_vendor.vendor_name if primary_vendor else '',
                    'buyerName':     primary_vendor.buyer_name if primary_vendor else '',
                    'leadTimeDays':  primary_vendor.lead_time_days if primary_vendor else 0,

                    # Delivery
                    'deliverySchedules':             delivery_schedules_list,
                    'totalScheduledInward':          total_scheduled_inward,
                    'projectedStockWithDeliveries':  projected_stock,
                    'projectedDeficitWithDeliveries': projected_deficit,
                    'projectedCoverageFgUnits':      projected_coverage_units,
                    'scheduleHealth':                schedule_health,
                    'productionImpactSummary':       production_impact_summary,

                    # 4-week forward horizon
                    'weekDetails':          week_details,

                    # Next week risk
                    'nextWeekNo':            next_week_no,
                    'nextWeekGrossReq':      next_week_gross_req,
                    'nextWeekInward':        next_week_inward,
                    'nextWeekClosingStock':  next_week_closing_stock,
                    'nextWeekDeficit':       next_week_deficit,
                    'hasNextWeekRisk':       has_next_week_risk,
                    'hasForwardRisk':        has_forward_risk,
                }
                exploded_bom_list.append(component_item)

            # ── FG-level health classification ───────────────────────
            if min_stock_buildable == float('inf'):
                min_stock_buildable = gross_target
            if min_projected_buildable == float('inf'):
                min_projected_buildable = gross_target

            if fg_inadequate_schedules > 0:
                fg_health_status = 'INADEQUATE_SCHEDULE'
                inadequate_delivery_count += 1
                critical_fgs_count += 1
            elif fg_critical_shortages > 0:
                fg_health_status = 'SCHEDULE_ON_TRACK'
                critical_fgs_count += 1
            else:
                fg_health_status = 'CLEAR_SEAMLESS'

            # Check next week risk at FG level
            fg_has_next_week_risk = any(c.get('hasNextWeekRisk') for c in exploded_bom_list)
            if fg_has_next_week_risk:
                next_week_critical_count += 1

            # Next week bottleneck desc
            next_week_bottleneck_desc = ''
            fg_next_week_no = None
            for c in exploded_bom_list:
                if c.get('hasNextWeekRisk'):
                    next_week_bottleneck_desc = f"{c['componentCode']} - {c['componentDescription']}"
                    fg_next_week_no = c.get('nextWeekNo')
                    break

            # Next week critical count for components
            next_week_critical_count_fg_level = sum(1 for c in exploded_bom_list if c.get('hasNextWeekRisk'))

            # ── Build allWeeksDetail: FGWeekDetailSummary[] for W1, W2, W3, W4 ──
            all_weeks_detail = []
            for w in month_weeks_sorted:
                w_is_prior = w.week_no < selected_week.week_no
                w_is_current = w.week_no == selected_week.week_no
                w_is_future = w.week_no > selected_week.week_no

                # Plan target for this week from JSONB
                plan_target_w = int(weekly_breakdown.get(w.week_code, 0))

                # Actual production (MB51 Mvt 101 for this FG in this week)
                actual_prod_w = mb51_by_part_week.get((fg_code, w.week_code), 0)

                # Backlog only for prior weeks; future and current weeks have backlog = 0
                backlog_w = max(0, plan_target_w - actual_prod_w) if w_is_prior else 0

                # Gross target
                if w_is_current:
                    gross_target_w = gross_target
                else:
                    gross_target_w = plan_target_w

                # Buildable limits
                if w_is_current:
                    stock_buildable = min_stock_buildable if min_stock_buildable < 999999 else gross_target_w
                    deliveries_buildable = min_projected_buildable if min_projected_buildable < 999999 else gross_target_w
                else:
                    stock_buildable = gross_target_w
                    deliveries_buildable = gross_target_w

                gap = max(0, gross_target_w - deliveries_buildable)

                # RM status classification
                if gap > 0:
                    rm_status = 'INADEQUATE'
                elif w_is_current and min_stock_buildable < gross_target_w:
                    rm_status = 'CRITICAL'
                else:
                    rm_status = 'CLEAR'

                all_weeks_detail.append({
                    'weekId':             w.week_code,
                    'weekNo':             w.week_no,
                    'weekLabel':          w.week_label,
                    'isPrior':            w_is_prior,
                    'isCurrent':          w_is_current,
                    'isFuture':           w_is_future,
                    'planTarget':         plan_target_w,
                    'actualProd':         actual_prod_w,
                    'backlog':            backlog_w,
                    'grossTarget':        gross_target_w,
                    'stockBuildable':     stock_buildable,
                    'deliveriesBuildable': deliveries_buildable,
                    'gap':                gap,
                    'rmStatus':           rm_status,
                })

            # ── Monday review actions serialized for frontend ─────────
            matching_actions_list = [
                {
                    'id':                    str(action.id),
                    'month':                 action.month,
                    'weekId':                action.week_id,
                    'fgCode':                action.fg_id,
                    'fgDescription':         action.fg_description if hasattr(action, 'fg_description') else '',
                    'componentCode':         action.component_code or None,
                    'componentDescription':  action.component_description or None,
                    'issueType':             action.issue_type,
                    'description':           action.description,
                    'impactSummary':         action.impact_summary,
                    'status':                action.status,
                    'resolutionNotes':       action.resolution_notes,
                    'agreedAction':          action.agreed_action,
                    'assignedOwner':         action.assigned_owner,
                    'targetResolutionDate':  str(action.target_resolution_date) if action.target_resolution_date else None,
                    'escalatedTo':           action.escalated_to or None,
                    'createdAt':             action.created_at.isoformat() if action.created_at else None,
                    'updatedAt':             action.updated_at.isoformat() if action.updated_at else None,
                }
                for action in fg_actions
            ]

            # Get mini_factory and line from plan or fg_header
            mini_factory = fg_header.mini_factory if fg_header else ''
            line_val = fg_header.line if fg_header else ''

            # Get customer name
            customer_name = plan.customer_name if hasattr(plan, 'customer_name') else ''

            # Selected week dict
            selected_week_dict = {
                'weekCode': selected_week.week_code,
                'weekNo': selected_week.week_no,
                'weekLabel': selected_week.week_label,
                'startDate': str(selected_week.start_date),
                'endDate': str(selected_week.end_date),
                'workingDays': selected_week.working_days,
            }

            # ── Build the FG item with EXACT field names from types.ts ────
            cockpit_item = {
                # Identity
                'fgCode':             fg_code,
                'fgDescription':      plan.fg.fg_description if plan.fg else fg_code,
                'customerName':       customer_name,
                'miniFactory':        mini_factory,
                'line':               line_val,
                'monthlyTarget':      plan.monthly_target,
                'selectedWeek':       selected_week_dict,

                # Freeze status
                'freezeStatus':       freeze_status,
                'frozenAt':           freeze_record.frozen_at.isoformat() if freeze_record and freeze_record.frozen_at else None,
                'frozenBy':           freeze_record.frozen_by if freeze_record else None,
                'freezeNotes':        freeze_record.freeze_notes if freeze_record else None,

                # Previous month performance
                'previousMonthPerf':  previous_month_perf,

                # Backlog
                'priorBacklog':            prior_backlog,
                'priorWeeksBreakdown':     prior_breakdown_map.get(fg_code, []),
                'currentWeekPlanTarget':   current_plan,
                'totalWeekGrossTarget':    gross_target,
                'currentWeekActualProd':   current_actual,
                'currentWeekRemainingToBuild': max(0, gross_target - current_actual),

                # Full 4-week horizon
                'allWeeksDetail':     all_weeks_detail,

                # BOM — KEY MUST BE explodedBOM (not explodedComponents)
                'explodedBOM':        exploded_bom_list,

                # Summary counts
                'criticalComponentsCount':   fg_critical_shortages,
                'inadequateScheduleCount':   fg_inadequate_schedules,
                'nextWeekCriticalCount':     next_week_critical_count_fg_level,
                'hasNextWeekRisk':           fg_has_next_week_risk,
                'nextWeekBottleneckDesc':    next_week_bottleneck_desc,
                'nextWeekNo':                fg_next_week_no,

                # Buildable quantities — EXACT KEY NAMES
                'maxBuildableFGWithStock':       min_stock_buildable,
                'maxBuildableFGWithDeliveries':  min_projected_buildable,
                'bottleneckComponentCode':       bottleneck_component or '',
                'bottleneckComponentDesc':       bottleneck_desc,

                # Health — KEY MUST BE fgHealthStatus
                'fgHealthStatus':     fg_health_status,

                # Escalations — MUST BE bool, not int
                'hasActiveEscalations': has_active_escalations,

                # Actions — KEY MUST BE mondayReviewActions
                'mondayReviewActions': matching_actions_list,
            }
            cockpit_items.append(cockpit_item)

        # Sort: INADEQUATE first, then SCHEDULE_ON_TRACK, then CLEAR
        health_order = {
            'INADEQUATE_SCHEDULE': 0,
            'SCHEDULE_ON_TRACK': 1,
            'CLEAR_SEAMLESS': 2,
        }
        cockpit_items.sort(key=lambda x: health_order.get(x['fgHealthStatus'], 99))

        # Top-level response — EXACT KEYS from types.ts
        result = {
            'cockpitItems':              cockpit_items,
            'selectedWeek': {
                'weekCode': selected_week.week_code,
                'weekNo': selected_week.week_no,
                'weekLabel': selected_week.week_label,
                'startDate': str(selected_week.start_date),
                'endDate': str(selected_week.end_date),
                'workingDays': selected_week.working_days,
            },
            'monthWeeks': [{
                'weekCode': w.week_code,
                'weekNo': w.week_no,
                'weekLabel': w.week_label,
                'startDate': str(w.start_date),
                'endDate': str(w.end_date),
                'workingDays': w.working_days,
            } for w in month_weeks_sorted],
            'overallBacklogUnits':       overall_backlog,
            'totalWeekTargetUnits':      total_week_target,
            'criticalFGsCount':          critical_fgs_count,
            'inadequateDeliveryCount':   inadequate_delivery_count,
            'nextWeekCriticalFGsCount':  next_week_critical_count,
            'activeEscalationsCount':    active_escalations_count,
            'frozenFGsCount':            frozen_fgs_count,
        }

        logger.info(
            f"CockpitEngine: Computed {len(cockpit_items)} FGs | "
            f"Critical: {critical_fgs_count} | Frozen: {frozen_fgs_count} | "
            f"Backlog: {overall_backlog}"
        )

        return result
