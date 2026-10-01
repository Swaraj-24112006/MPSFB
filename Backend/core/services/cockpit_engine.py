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
        :return: Dict with cockpit_items, summary counters, and week metadata
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

            # Per-component analysis
            min_stock_buildable = float('inf')
            min_projected_buildable = float('inf')
            bottleneck_component = None
            fg_inadequate_schedules = 0
            fg_critical_shortages = 0
            exploded_components = []

            for line in lines:
                comp_code = line.component_id
                comp_master = component_master.get(comp_code)

                # Stock
                stock_row = stock_by_part.get(comp_code, {})
                total_physical_stock = stock_row.get('unrestricted_stock', 0)
                safety_stock = stock_row.get('safety_stock', 500)

                # Common part detection
                shared_fgs = component_usage_map.get(comp_code, [])
                is_common = len(shared_fgs) > 1

                # Reservations from OTHER frozen FGs
                all_reservations = component_reservation_map.get(comp_code, [])
                other_reserved = sum(
                    r['reserved_qty'] for r in all_reservations if r['fg_code'] != fg_code
                )
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

                # Vendor lookup
                vendors = vendor_by_component.get(comp_code, [])
                primary_vendor = vendors[0] if vendors else None

                # ── 4-week forward horizon ───────────────────────────
                rolling_stock = total_physical_stock
                week_details = []
                has_next_week_risk = False
                has_forward_risk = False

                for w in month_weeks:
                    is_prior = w.week_no < selected_week.week_no
                    is_current = w.week_no == selected_week.week_no
                    is_future = w.week_no > selected_week.week_no

                    wk_plan = int((plan.weekly_breakdown or {}).get(w.week_code, 0))
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
                        if deficit < 0 or wk_status in ('INADEQUATE', 'CRITICAL_NO_DELIVERY'):
                            has_next_week_risk = True
                    if is_future and deficit < 0:
                        has_forward_risk = True

                # Build component summary
                comp_summary = {
                    'componentCode': comp_code,
                    'componentDescription': comp_master.component_description if comp_master else '',
                    'category': comp_master.category if comp_master else 'RM',
                    'bomQtyPerUnit': bom_qty,
                    'uom': line.uom,
                    'totalPhysicalStock': total_physical_stock,
                    'safetyStock': safety_stock,
                    'isCommonPart': is_common,
                    'sharedInFgs': shared_fgs,
                    'otherReservedQty': other_reserved,
                    'unreservedAvailableStock': unreserved_stock,
                    'totalRequired': total_required,
                    'stockDeficit': stock_deficit,
                    'isCriticalShortage': is_critical_shortage,
                    'stockCoversFGUnits': stock_covers_units,
                    'totalScheduledInward': total_scheduled_inward,
                    'projectedStockWithDeliveries': projected_stock,
                    'projectedDeficit': projected_deficit,
                    'projectedCoverageFGUnits': projected_coverage_units,
                    'scheduleHealth': schedule_health,
                    'deliverySchedules': [{
                        'id': s.id,
                        'poNumber': s.po_number,
                        'vendorName': s.vendor_name,
                        'buyerName': s.buyer_name,
                        'expectedDeliveryDate': str(s.expected_delivery_date),
                        'promisedQty': float(s.promised_qty),
                        'deliveryStatus': s.delivery_status,
                    } for s in deliveries],
                    'vendorInfo': {
                        'vendorCode': primary_vendor.vendor_code if primary_vendor else '',
                        'vendorName': primary_vendor.vendor_name if primary_vendor else '',
                        'buyerName': primary_vendor.buyer_name if primary_vendor else '',
                        'leadTimeDays': primary_vendor.lead_time_days if primary_vendor else 0,
                    } if primary_vendor else None,
                    'weekDetails': week_details,
                    'hasNextWeekRisk': has_next_week_risk,
                    'hasForwardRisk': has_forward_risk,
                }
                exploded_components.append(comp_summary)

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
            fg_has_next_week_risk = any(c.get('hasNextWeekRisk') for c in exploded_components)
            if fg_has_next_week_risk:
                next_week_critical_count += 1

            cockpit_item = {
                'fgCode': fg_code,
                'fgDescription': plan.fg.fg_description if plan.fg else fg_code,
                'miniFactory': fg_header.mini_factory if fg_header else '',
                'line': fg_header.line if fg_header else '',
                'monthlyTarget': plan.monthly_target,
                'currentWeekPlanTarget': current_plan,
                'priorBacklog': prior_backlog,
                'priorWeeksBreakdown': prior_breakdown_map.get(fg_code, []),
                'totalWeekGrossTarget': gross_target,
                'currentWeekActualProd': current_actual,
                'currentWeekRemaining': current_remaining,
                'freezeStatus': freeze_status,
                'frozenAt': freeze_record.frozen_at.isoformat() if freeze_record and freeze_record.frozen_at else None,
                'frozenBy': freeze_record.frozen_by if freeze_record else '',
                'healthStatus': fg_health_status,
                'maxBuildableWithStock': min_stock_buildable,
                'maxBuildableWithDeliveries': min_projected_buildable,
                'bottleneckComponentCode': bottleneck_component or '',
                'totalBOMComponents': len(lines),
                'criticalShortageCount': fg_critical_shortages,
                'inadequateScheduleCount': fg_inadequate_schedules,
                'explodedComponents': exploded_components,
                'actions': [{
                    'id': a.id,
                    'issueType': a.issue_type,
                    'description': a.description,
                    'status': a.status,
                    'assignedOwner': a.assigned_owner,
                    'escalatedTo': a.escalated_to,
                    'componentCode': a.component_code or '',
                    'targetResolutionDate': str(a.target_resolution_date) if a.target_resolution_date else None,
                } for a in fg_actions],
                'escalationCount': fg_escalation_count,
                'hasNextWeekRisk': fg_has_next_week_risk,
            }
            cockpit_items.append(cockpit_item)

        # Sort: INADEQUATE first, then SCHEDULE_ON_TRACK, then CLEAR
        health_order = {
            'INADEQUATE_SCHEDULE': 0,
            'SCHEDULE_ON_TRACK': 1,
            'CLEAR_SEAMLESS': 2,
        }
        cockpit_items.sort(key=lambda x: health_order.get(x['healthStatus'], 99))

        result = {
            'cockpit_items': cockpit_items,
            'selected_week': {
                'weekCode': selected_week.week_code,
                'weekNo': selected_week.week_no,
                'weekLabel': selected_week.week_label,
                'startDate': str(selected_week.start_date),
                'endDate': str(selected_week.end_date),
                'workingDays': selected_week.working_days,
            },
            'month_weeks': [{
                'weekCode': w.week_code,
                'weekNo': w.week_no,
                'weekLabel': w.week_label,
                'startDate': str(w.start_date),
                'endDate': str(w.end_date),
                'workingDays': w.working_days,
            } for w in month_weeks],
            'overall_backlog_units': overall_backlog,
            'total_week_target_units': total_week_target,
            'critical_fgs_count': critical_fgs_count,
            'inadequate_delivery_count': inadequate_delivery_count,
            'next_week_critical_fgs_count': next_week_critical_count,
            'active_escalations_count': active_escalations_count,
            'frozen_fgs_count': frozen_fgs_count,
            'total_fgs_count': len(cockpit_items),
        }

        logger.info(
            f"CockpitEngine: Computed {len(cockpit_items)} FGs | "
            f"Critical: {critical_fgs_count} | Frozen: {frozen_fgs_count} | "
            f"Backlog: {overall_backlog}"
        )

        return result
