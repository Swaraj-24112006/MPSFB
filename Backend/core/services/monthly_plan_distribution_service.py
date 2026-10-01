import logging
from typing import List, Dict, Any, Union
from django.db import transaction

logger = logging.getLogger(__name__)


class MonthlyPlanDistributionService:
    """
    Monthly FG Plan — Week-wise Distribution Logic Service.

    Pure distribution calculation based strictly on:
    - monthly FG target
    - working days defined for each week in the selected month

    Workflow:
    1. Input: (month, fg_code, monthly_target)
    2. Load & sort weeks by week_no ASC
    3. Calculate total_working_days = SUM(working_days of all weeks)
    4. Calculate week_weight = working_days / total_working_days (system calculated)
    5. For each week except the final week:
         weekly_target = ROUND(monthly_target * week_weight)
    6. Allocate remaining quantity to final week:
         last_week_target = monthly_target - SUM(previous_week_targets)
       This guarantees: SUM(all weekly targets) == monthly_target
    7. Store / return weekly_breakdown: {week_code: weekly_target}
    """

    @staticmethod
    def distribute_monthly_target(monthly_target: int, weeks: list) -> Dict[str, int]:
        """
        Distribute monthly target using the Largest Remainder Method (Hare-Niemeyer).

        Guarantees:
          1. SUM(breakdown.values()) == monthly_target
          2. All values >= 0
          3. Fair distribution without biasing or wiping out the final week
        """
        # 1. Validate input
        if not weeks or monthly_target is None or monthly_target <= 0:
            return {}

        def get_week_code(w):
            return getattr(w, 'week_code', None) or (
                w.get('week_code') or w.get('id') if isinstance(w, dict) else str(w)
            )

        def get_working_days(w):
            if hasattr(w, 'working_days'):
                return int(w.working_days)
            if isinstance(w, dict):
                return int(w.get('working_days', w.get('workingDays', w.get('days_count', w.get('daysCount', 0)))))
            return 0

        # 2. Sort weeks chronologically
        sorted_weeks = sorted(
            weeks,
            key=lambda w: getattr(w, 'week_no', 0) if hasattr(w, 'week_no') else (w.get('week_no', 0) if isinstance(w, dict) else 0)
        )

        # 3. Calculate total working days
        total_working_days = sum(get_working_days(w) for w in sorted_weeks)
        if total_working_days <= 0:
            return {}

        # 4. Compute integer base (floor) and fractional remainders
        allocations = []
        for idx, week in enumerate(sorted_weeks):
            code = get_week_code(week)
            w_days = get_working_days(week)
            exact_val = monthly_target * (w_days / total_working_days)
            floor_val = int(exact_val)
            remainder = exact_val - floor_val

            allocations.append({
                'code': code,
                'target': floor_val,
                'remainder': remainder,
                'original_idx': idx,
            })

        # 5. Distribute leftover discrete units to largest fractional parts
        leftover = monthly_target - sum(item['target'] for item in allocations)

        if leftover > 0:
            # Sort by remainder DESC, using original_idx ASC as deterministic tie-breaker
            by_remainder = sorted(
                allocations,
                key=lambda x: (x['remainder'], -x['original_idx']),
                reverse=True
            )
            for i in range(leftover):
                by_remainder[i]['target'] += 1

        # 6. Map back in chronological order
        target_map = {item['code']: item['target'] for item in allocations}
        return {get_week_code(w): target_map[get_week_code(w)] for w in sorted_weeks}

    @staticmethod
    def calculate_week_weights(weeks: list) -> Dict[str, float]:
        """
        Calculates week weights:
        week_weight = working_days / total_working_days
        Returns {week_code: week_weight}.
        """
        if not weeks:
            return {}

        def get_week_code(w):
            return getattr(w, 'week_code', None) or (w.get('week_code') or w.get('id') if isinstance(w, dict) else str(w))

        def get_working_days(w):
            if hasattr(w, 'working_days'):
                return int(w.working_days)
            if isinstance(w, dict):
                return int(w.get('working_days', w.get('workingDays', w.get('days_count', w.get('daysCount', 0)))))
            return 0

        total_working_days = sum(get_working_days(w) for w in weeks)
        if total_working_days <= 0:
            return {}

        return {
            get_week_code(w): get_working_days(w) / total_working_days
            for w in weeks
        }

    @staticmethod
    def recalculate_monthly_plan(plan, weeks=None) -> Dict[str, int]:
        """
        Recalculates weekly_breakdown for a single MonthlyPlan instance and saves to DB.
        """
        from core.models import WeekDefinition
        if weeks is None:
            weeks = list(WeekDefinition.objects.filter(month=plan.month).order_by('week_no'))

        plan.weekly_breakdown = MonthlyPlanDistributionService.distribute_monthly_target(
            plan.monthly_target, weeks
        )
        plan.save(update_fields=['weekly_breakdown', 'updated_at'])
        return plan.weekly_breakdown

    @staticmethod
    def recalculate_for_month(month: str) -> int:
        """
        Recalculates distribution for all monthly plans in a month.
        Triggered when:
        - Week working days change
        - Week is added or removed
        - Explicit recalculation request
        """
        clean_month = month.strip()
        from core.models import MonthlyPlan, WeekDefinition

        weeks = list(WeekDefinition.objects.filter(month=clean_month).order_by('week_no'))
        plans = list(MonthlyPlan.objects.filter(month=clean_month))
        if not plans:
            return 0

        updated_count = 0
        with transaction.atomic():
            for plan in plans:
                if not weeks:
                    plan.weekly_breakdown = {}
                else:
                    plan.weekly_breakdown = MonthlyPlanDistributionService.distribute_monthly_target(
                        plan.monthly_target, weeks
                    )
                plan.save(update_fields=['weekly_breakdown', 'updated_at'])
                updated_count += 1

        logger.info(f"Recalculated monthly plan distribution for {updated_count} plan(s) in month {clean_month}.")
        return updated_count
