import calendar
from datetime import date, datetime
from typing import List, Tuple, Dict, Any, Optional, Union
from django.core.exceptions import ValidationError


class WeekService:
    @staticmethod
    def _parse_date(d: Union[str, date, datetime]) -> date:
        if isinstance(d, datetime):
            return d.date()
        if isinstance(d, date):
            return d
        if isinstance(d, str):
            return datetime.strptime(d.strip(), "%Y-%m-%d").date()
        raise ValueError(f"Invalid date value: {d}")

    @staticmethod
    def compute_days_count(start_date: Union[str, date, datetime], end_date: Union[str, date, datetime]) -> int:
        """
        Returns inclusive day count.
        Example: 2026-08-01 to 2026-08-07 = 7 days.
        Validates end_date >= start_date.
        """
        s_date = WeekService._parse_date(start_date)
        e_date = WeekService._parse_date(end_date)
        if e_date < s_date:
            raise ValueError(f"End date ({e_date}) cannot be before start date ({s_date})")
        delta = e_date - s_date
        return delta.days + 1

    @staticmethod
    def compute_working_days(days_count: int, holiday_days: int = 0) -> int:
        """
        Returns max(1, days_count - holiday_days).
        Clamped to minimum 1 to prevent zero-division in proration.
        """
        h_days = max(0, int(holiday_days or 0))
        return max(1, int(days_count) - h_days)

    @staticmethod
    def compute_days(start_date: Any, end_date: Any, holiday_days: int = 0) -> Tuple[int, int]:
        """
        Compute (days_count, working_days) server-side.
        Backward-compatible helper returning tuple.
        """
        days_count = WeekService.compute_days_count(start_date, end_date)
        working_days = WeekService.compute_working_days(days_count, holiday_days)
        return days_count, working_days

    @staticmethod
    def generate_week_code(month: str, week_no: int) -> str:
        """
        Returns 'w-{YYYY-MM}-{0N}'.
        Example: month='2026-08', week_no=2 -> 'w-2026-08-02'
        """
        clean_month = month.strip()
        return f"w-{clean_month}-{int(week_no):02d}"

    @staticmethod
    def validate_dates_within_month(month: str, start_date: Union[str, date, datetime], end_date: Union[str, date, datetime]) -> None:
        """
        Ensures start_date and end_date fall within the calendar month.
        Example: for month='2026-08', valid range is 2026-08-01 to 2026-08-31.
        Raises ValidationError if either date is outside.
        """
        parts = month.strip().split('-')
        if len(parts) != 2:
            raise ValidationError(f"Invalid month format '{month}'. Expected YYYY-MM.")
        year, month_num = int(parts[0]), int(parts[1])
        days_in_month = calendar.monthrange(year, month_num)[1]

        first_day = date(year, month_num, 1)
        last_day = date(year, month_num, days_in_month)

        s_date = WeekService._parse_date(start_date)
        e_date = WeekService._parse_date(end_date)

        if s_date < first_day or s_date > last_day:
            raise ValidationError(
                f"Start date {s_date} falls outside the calendar boundaries of {month} "
                f"({first_day} to {last_day})."
            )
        if e_date < first_day or e_date > last_day:
            raise ValidationError(
                f"End date {e_date} falls outside the calendar boundaries of {month} "
                f"({first_day} to {last_day})."
            )

    @staticmethod
    def validate_no_overlap(month: str, start_date: Union[str, date, datetime], end_date: Union[str, date, datetime], exclude_id: Optional[Any] = None) -> None:
        """
        Queries week_definition for the month.
        Raises ValidationError if any existing week's date range
        intersects with [start_date, end_date].
        Excludes the row being updated (exclude_id) from the check.
        """
        from core.models import WeekDefinition

        s_date = WeekService._parse_date(start_date)
        e_date = WeekService._parse_date(end_date)

        qs = WeekDefinition.objects.filter(month=month.strip())
        if exclude_id is not None:
            if str(exclude_id).isdigit():
                qs = qs.exclude(id=int(exclude_id))
            else:
                qs = qs.exclude(week_code=str(exclude_id))

        for existing_week in qs:
            if s_date <= existing_week.end_date and e_date >= existing_week.start_date:
                raise ValidationError(
                    f"Date range [{s_date} to {e_date}] overlaps with existing week "
                    f"'{existing_week.week_label}' ({existing_week.week_code}: {existing_week.start_date} to {existing_week.end_date})."
                )

    @staticmethod
    def generate_standard_4_week_split(month: str) -> List[Dict[str, Any]]:
        """
        Returns 4 week definition dicts for standard pattern:
          W1: 01–07  (7 days, 1 holiday -> 6 working)
          W2: 08–14  (7 days, 1 holiday -> 6 working)
          W3: 15–21  (7 days, 1 holiday -> 6 working)
          W4: 22–EOM (days_in_month - 21 days, 2 holidays -> remainder working days)

        Uses Python calendar.monthrange(year, month) to get last day of month.
        """
        parts = month.strip().split('-')
        if len(parts) != 2:
            raise ValueError(f"Invalid month format '{month}'. Expected YYYY-MM.")

        year = int(parts[0])
        month_num = int(parts[1])
        if not (1 <= month_num <= 12):
            raise ValueError(f"Invalid month number {month_num}. Must be 1-12.")

        days_in_month = calendar.monthrange(year, month_num)[1]
        month_short = calendar.month_abbr[month_num]

        w1_start = date(year, month_num, 1)
        w1_end = date(year, month_num, 7)
        w1_days = WeekService.compute_days_count(w1_start, w1_end)
        w1_working = WeekService.compute_working_days(w1_days, 1)

        w2_start = date(year, month_num, 8)
        w2_end = date(year, month_num, 14)
        w2_days = WeekService.compute_days_count(w2_start, w2_end)
        w2_working = WeekService.compute_working_days(w2_days, 1)

        w3_start = date(year, month_num, 15)
        w3_end = date(year, month_num, 21)
        w3_days = WeekService.compute_days_count(w3_start, w3_end)
        w3_working = WeekService.compute_working_days(w3_days, 1)

        w4_start = date(year, month_num, 22)
        w4_end = date(year, month_num, days_in_month)
        w4_days = WeekService.compute_days_count(w4_start, w4_end)
        w4_working = WeekService.compute_working_days(w4_days, 2)

        total_working_days = w1_working + w2_working + w3_working + w4_working
        w1_weight = round((w1_working / total_working_days) * 100, 2) if total_working_days > 0 else 0.00
        w2_weight = round((w2_working / total_working_days) * 100, 2) if total_working_days > 0 else 0.00
        w3_weight = round((w3_working / total_working_days) * 100, 2) if total_working_days > 0 else 0.00
        w4_weight = round((w4_working / total_working_days) * 100, 2) if total_working_days > 0 else 0.00

        return [
            {
                "month": month,
                "week_no": 1,
                "week_code": WeekService.generate_week_code(month, 1),
                "week_label": f"Week 1 (01-07 {month_short})",
                "start_date": w1_start,
                "end_date": w1_end,
                "days_count": w1_days,
                "holiday_days": 1,
                "working_days": w1_working,
                "month_weight": w1_weight,
            },
            {
                "month": month,
                "week_no": 2,
                "week_code": WeekService.generate_week_code(month, 2),
                "week_label": f"Week 2 (08-14 {month_short})",
                "start_date": w2_start,
                "end_date": w2_end,
                "days_count": w2_days,
                "holiday_days": 1,
                "working_days": w2_working,
                "month_weight": w2_weight,
            },
            {
                "month": month,
                "week_no": 3,
                "week_code": WeekService.generate_week_code(month, 3),
                "week_label": f"Week 3 (15-21 {month_short})",
                "start_date": w3_start,
                "end_date": w3_end,
                "days_count": w3_days,
                "holiday_days": 1,
                "working_days": w3_working,
                "month_weight": w3_weight,
            },
            {
                "month": month,
                "week_no": 4,
                "week_code": WeekService.generate_week_code(month, 4),
                "week_label": f"Week 4 (22-{days_in_month:02d} {month_short})",
                "start_date": w4_start,
                "end_date": w4_end,
                "days_count": w4_days,
                "holiday_days": 2,
                "working_days": w4_working,
                "month_weight": w4_weight,
            },
        ]

    @staticmethod
    def calculate_month_weights(weeks: list) -> Dict[str, float]:
        """
        Backend logic for Month Weight percentage:
        1. Get all weeks for the selected month.
        2. Read Working Days for each week.
        3. Calculate:
              total_working_days = sum(all week working days)
        4. For each week:
              month_weight = (week_working_days / total_working_days) * 100
        5. Store/display the calculated percentage.

        example :
        Week 1 = 1000 × 20% = 200
        Week 2 = 1000 × 24% = 240
        Week 3 = 1000 × 24% = 240
        Week 4 = 1000 × 32% = 320
        """
        from core.services.monthly_plan_distribution_service import MonthlyPlanDistributionService
        return MonthlyPlanDistributionService.calculate_month_weights(weeks)

    @staticmethod
    def calculate_and_store_month_weights(month: str) -> List[Any]:
        """
        Calculates and stores month_weight for all weeks of the specified month in DB:
        1. Get all weeks for the selected month.
        2. Read Working Days for each week.
        3. Calculate:
              total_working_days = sum(all week working days)
        4. For each week:
              month_weight = (week_working_days / total_working_days) * 100
        5. Store the calculated percentage on each week record.
        """
        clean_month = month.strip()
        from core.models import WeekDefinition

        weeks = list(WeekDefinition.objects.filter(month=clean_month).order_by('week_no'))
        if not weeks:
            return []

        total_working_days = sum(w.working_days for w in weeks)
        for w in weeks:
            if total_working_days > 0:
                w.month_weight = round((w.working_days / total_working_days) * 100, 2)
            else:
                w.month_weight = 0.00
            w.save(update_fields=['month_weight', 'updated_at'])

        return weeks

    @staticmethod
    def get_standard_week_data_for_month(month: str) -> List[Dict[str, Any]]:
        """
        Alias for generate_standard_4_week_split for backward compatibility.
        """
        return WeekService.generate_standard_4_week_split(month)

    @staticmethod
    def generate_full_year(year: Union[str, int]) -> List[Dict[str, Any]]:
        """
        Calls generate_standard_4_week_split for each of 12 months in year.
        Returns 48 week definition dicts (12 months × 4 weeks).
        """
        year_int = int(year)
        results: List[Dict[str, Any]] = []
        for m in range(1, 13):
            month_str = f"{year_int:04d}-{m:02d}"
            results.extend(WeekService.generate_standard_4_week_split(month_str))
        return results
