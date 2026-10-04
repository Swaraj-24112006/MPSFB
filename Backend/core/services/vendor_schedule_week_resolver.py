"""
Service 2: VendorScheduleWeekResolver

Resolves week_code from expected_delivery_date against WeekDefinition date ranges.
Used by every create/update to ensure server-side week resolution.
"""
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
