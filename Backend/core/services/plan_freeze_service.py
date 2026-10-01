"""
C5 — PlanFreezeService

Manages the freeze/unfreeze lifecycle of FG weekly production plans.
Validates state machine transitions, role-based access, and sets frozen_at timestamps.
"""
import logging
from django.utils import timezone

logger = logging.getLogger(__name__)


class PlanFreezeService:
    """
    Upserts FGPlanFreeze records with state machine validation.

    State machine:
        DRAFT → REVIEWED → FROZEN  (forward only)
        FROZEN → DRAFT              (unfreeze for replanning)

    Invalid transitions (e.g., FROZEN → REVIEWED) are rejected with 400.
    """

    VALID_TRANSITIONS = {
        None: ['DRAFT', 'REVIEWED', 'FROZEN'],
        'DRAFT': ['REVIEWED', 'FROZEN'],
        'REVIEWED': ['FROZEN'],
        'FROZEN': ['DRAFT'],
    }

    ALLOWED_ROLES = ['supply_planner', 'management']

    @classmethod
    def upsert(cls, fg_code, month, week_code, new_status, frozen_by='', freeze_notes='', user_role=None):
        """
        Upsert a FGPlanFreeze record.

        :param fg_code: FG code (must exist in BOMFGHeader)
        :param month: Month in YYYY-MM format
        :param week_code: Week code (must exist in WeekDefinition)
        :param new_status: Target status (DRAFT, REVIEWED, FROZEN)
        :param frozen_by: Name/role of the person performing the action
        :param freeze_notes: Optional notes
        :param user_role: Role of the user (for access control)
        :return: (FGPlanFreeze instance, created: bool)
        :raises ValueError: On invalid transitions or missing prerequisites
        :raises PermissionError: On unauthorized role
        """
        from core.models import FGPlanFreeze, MonthlyPlan, BOMFGHeader, WeekDefinition

        # Role validation
        if user_role and user_role not in cls.ALLOWED_ROLES:
            raise PermissionError(
                f"Role '{user_role}' is not authorized to freeze/unfreeze plans. "
                f"Allowed roles: {', '.join(cls.ALLOWED_ROLES)}"
            )

        # Validate FG exists
        if not BOMFGHeader.objects.filter(fg_code=fg_code).exists():
            raise ValueError(f"FG code '{fg_code}' not found in BOM FG Headers.")

        # Validate week exists
        if not WeekDefinition.objects.filter(week_code=week_code).exists():
            raise ValueError(f"Week code '{week_code}' not found in Week Definitions.")

        # Validate monthly plan exists
        if not MonthlyPlan.objects.filter(fg_id=fg_code, month=month).exists():
            raise ValueError(
                f"No monthly plan exists for FG '{fg_code}' in month '{month}'. "
                f"Cannot freeze a nonexistent plan."
            )

        # Check for existing record
        existing = FGPlanFreeze.objects.filter(
            fg_id=fg_code,
            month=month,
            week_id=week_code
        ).first()

        if existing:
            # Validate state machine transition
            current_status = existing.status
            allowed = cls.VALID_TRANSITIONS.get(current_status, [])
            if new_status not in allowed and new_status != current_status:
                raise ValueError(
                    f"Plan freeze status cannot transition from '{current_status}' to '{new_status}'. "
                    f"Allowed transitions from '{current_status}': {', '.join(allowed)}"
                )

            # Update existing record
            existing.status = new_status
            existing.frozen_by = frozen_by or existing.frozen_by
            existing.freeze_notes = freeze_notes or existing.freeze_notes

            if new_status == 'FROZEN' and current_status != 'FROZEN':
                existing.frozen_at = timezone.now()
            elif new_status != 'FROZEN':
                existing.frozen_at = None

            existing.save()
            logger.info(
                f"PlanFreeze updated: {fg_code} | {month} | {week_code} → {new_status} by {frozen_by}"
            )
            return existing, False

        else:
            # Create new record
            freeze_record = FGPlanFreeze(
                fg_id=fg_code,
                month=month,
                week_id=week_code,
                status=new_status,
                frozen_by=frozen_by,
                freeze_notes=freeze_notes,
            )
            if new_status == 'FROZEN':
                freeze_record.frozen_at = timezone.now()

            freeze_record.save()
            logger.info(
                f"PlanFreeze created: {fg_code} | {month} | {week_code} → {new_status} by {frozen_by}"
            )
            return freeze_record, True

    @classmethod
    def bulk_freeze(cls, fg_codes, month, week_code, frozen_by='', user_role=None):
        """
        Freeze multiple FG plans in a single batch.

        :param fg_codes: List of FG codes to freeze
        :param month: Month in YYYY-MM format
        :param week_code: Week code
        :param frozen_by: Name/role of the person
        :param user_role: Role for access control
        :return: Dict with frozen_count and items list
        """
        results = []
        errors = []
        for fg_code in fg_codes:
            try:
                record, created = cls.upsert(
                    fg_code=fg_code,
                    month=month,
                    week_code=week_code,
                    new_status='FROZEN',
                    frozen_by=frozen_by,
                    freeze_notes=f'Bulk freeze by {frozen_by}',
                    user_role=user_role,
                )
                results.append(record)
            except (ValueError, PermissionError) as e:
                errors.append({'fg_code': fg_code, 'error': str(e)})
                logger.warning(f"Bulk freeze skipped for {fg_code}: {e}")

        return {
            'frozen_count': len(results),
            'items': results,
            'errors': errors,
        }
