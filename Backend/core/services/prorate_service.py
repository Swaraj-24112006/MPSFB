from typing import Dict
from core.services.monthly_plan_distribution_service import MonthlyPlanDistributionService


class ProrateService:
    """
    Backwards-compatible adapter for MonthlyPlanDistributionService.
    """
    @staticmethod
    def prorate(monthly_target: int, weeks: list) -> Dict[str, int]:
        return MonthlyPlanDistributionService.distribute_monthly_target(monthly_target, weeks)

    @staticmethod
    def cascade_reprorate(month: str) -> int:
        return MonthlyPlanDistributionService.recalculate_for_month(month)

    @staticmethod
    def prorate_plan_instance(plan, weeks) -> None:
        MonthlyPlanDistributionService.recalculate_monthly_plan(plan, weeks)

