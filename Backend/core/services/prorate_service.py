import logging
from typing import List, Dict, Any, Union
from django.db import transaction

logger = logging.getLogger(__name__)


class ProrateService:
    @staticmethod
    def prorate(monthly_target: int, weeks: list) -> Dict[str, int]:
        """
        The core proration formula (Working-Day Proportional Proration):
        - Sum total working days across all weeks.
        - For each week except the last:
            qty = round(monthly_target * (week.working_days / total_working_days))
        - Last week gets the exact remainder to prevent rounding drift:
            remainder = max(0, monthly_target - accumulated)
        - Returns {week_code: integer_qty} dict where sum equals monthly_target exactly.
        """
        if not weeks or monthly_target <= 0:
            return {}

        # Sort weeks by week_no ascending
        sorted_weeks = sorted(
            weeks,
            key=lambda w: getattr(w, 'week_no', 0) if hasattr(w, 'week_no') else (w.get('week_no', 0) if isinstance(w, dict) else 0)
        )

        def get_week_code(w):
            return getattr(w, 'week_code', None) or (w.get('week_code') or w.get('id') if isinstance(w, dict) else str(w))

        def get_working_days(w):
            if hasattr(w, 'working_days'):
                return int(w.working_days)
            if isinstance(w, dict):
                return int(w.get('working_days', w.get('workingDays', w.get('days_count', w.get('daysCount', 0)))))
            return 0

        total_working_days = sum(get_working_days(w) for w in sorted_weeks)
        if total_working_days <= 0 or len(sorted_weeks) == 0:
            return {}

        breakdown: Dict[str, int] = {}
        accumulated = 0

        for idx, week in enumerate(sorted_weeks):
            code = get_week_code(week)
            if idx == len(sorted_weeks) - 1:
                # Last week gets exact remainder — prevents rounding drift
                breakdown[code] = max(0, int(monthly_target - accumulated))
            else:
                w_days = get_working_days(week)
                qty = int(round(monthly_target * (w_days / total_working_days)))
                breakdown[code] = qty
                accumulated += qty

        return breakdown

    @staticmethod
    def cascade_reprorate(month: str) -> int:
        """
        Called whenever week definitions change for a month.
        Fetches all monthly_plan rows where month=month.
        Re-runs prorate() for each.
        If no weeks remain, sets weekly_breakdown to {}.
        Bulk-updates weekly_breakdown for all plans inside transaction.atomic().
        Returns count of plans updated.
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
                    # If all weeks deleted, un-prorate plans
                    plan.weekly_breakdown = {}
                else:
                    plan.weekly_breakdown = ProrateService.prorate(plan.monthly_target, weeks)
                plan.save(update_fields=['weekly_breakdown', 'updated_at'])
                updated_count += 1

        logger.info(f"Cascade reprorated {updated_count} plan(s) for month {clean_month}.")
        return updated_count

    @staticmethod
    def prorate_plan_instance(plan, weeks) -> None:
        """
        Helper method to recalculate weekly_breakdown for a single plan instance and save.
        """
        plan.weekly_breakdown = ProrateService.prorate(plan.monthly_target, weeks)
        plan.save(update_fields=['weekly_breakdown', 'updated_at'])

