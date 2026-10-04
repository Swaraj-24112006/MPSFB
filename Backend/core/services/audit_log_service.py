"""
C4 — AuditLogService

Writes audit rows to DeliveryScheduleChangeLog for every mutation
to a VendorDeliverySchedule (create, update, cancel, bulk upload, auto-fill).
"""
import logging

from django.utils import timezone

logger = logging.getLogger(__name__)


class AuditLogService:
    """
    Responsible for creating append-only audit trail entries
    whenever a VendorDeliverySchedule is created, edited, cancelled,
    bulk-uploaded, or auto-fill generated.
    """

    # ──────────────────────────────────────────────────────────────────────
    # Low-level helper
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def create_log(cls, schedule, changed_by, reason, field_changed,
                   old_value='', new_value='', component_description=''):
        """
        Create a single audit log entry for a schedule mutation.

        :param schedule: VendorDeliverySchedule instance
        :param changed_by: Name of the person making the change
        :param reason: Reason for the change (min 10 chars enforced by caller)
        :param field_changed: Description of which field(s) changed
        :param old_value: Previous value
        :param new_value: New value
        :param component_description: Optional component description for richer logs
        :return: DeliveryScheduleChangeLog instance
        """
        from core.models import DeliveryScheduleChangeLog

        log = DeliveryScheduleChangeLog.objects.create(
            schedule=schedule,
            po_number=schedule.po_number,
            component_code=schedule.component_id,
            component_description=component_description,
            vendor_name=schedule.vendor_name,
            changed_by=changed_by,
            field_changed=field_changed,
            old_value=str(old_value),
            new_value=str(new_value),
            reason_for_change=reason,
        )
        logger.info(
            f"Audit log #{log.id}: PO {schedule.po_number} | "
            f"{field_changed} by {changed_by}"
        )
        return log

    # ──────────────────────────────────────────────────────────────────────
    # Method 1: log_create (new schedule created)
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def log_create(cls, schedule, changed_by, reason, component_description=''):
        """
        Writes one change log row when a new delivery schedule is created.
        field_changed = 'New Delivery Commitment Added'
        """
        return cls.create_log(
            schedule=schedule,
            changed_by=changed_by,
            reason=reason,
            field_changed='New Delivery Commitment Added',
            old_value='None (0 pcs)',
            new_value=(
                f"+{int(schedule.promised_qty)} pcs "
                f"on {schedule.expected_delivery_date} "
                f"({schedule.delivery_status})"
            ),
            component_description=component_description,
        )

    # Backward-compatible alias
    @classmethod
    def log_creation(cls, schedule, changed_by, reason):
        """Log the creation of a new delivery schedule (backward compat)."""
        return cls.log_create(schedule, changed_by, reason)

    # ──────────────────────────────────────────────────────────────────────
    # Method 2: log_update (per-field change tracking)
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def log_update(cls, schedule, old_data, changed_by, reason, component_description=''):
        """
        Compares old_data against the current schedule state.
        Writes one log row per changed field, plus a combined summary row.

        :param schedule: Updated VendorDeliverySchedule instance (already saved)
        :param old_data: Dict of {field_name: old_value} captured before the update
        :param changed_by: Name of the person making the change
        :param reason: Reason for the change
        :param component_description: Optional component description
        :return: List of DeliveryScheduleChangeLog instances
        """
        from core.models import DeliveryScheduleChangeLog

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
        logs = []
        changes_made = []

        for field_name, field_label in TRACKED_FIELDS.items():
            old_val = str(old_data.get(field_name, ''))
            new_val = str(getattr(schedule, field_name, ''))
            if old_val != new_val:
                changes_made.append(f"{field_label}: {old_val} → {new_val}")
                log = DeliveryScheduleChangeLog.objects.create(
                    schedule=schedule,
                    po_number=schedule.po_number,
                    component_code=schedule.component_id,
                    component_description=component_description,
                    vendor_name=schedule.vendor_name,
                    changed_by=changed_by,
                    changed_at=now,
                    field_changed=field_label,
                    old_value=old_val,
                    new_value=new_val,
                    reason_for_change=reason,
                )
                logs.append(log)

        # Also write the consolidated summary row
        if changes_made:
            old_summary = (
                f"{old_data.get('promised_qty', '?')} pcs "
                f"on {old_data.get('expected_delivery_date', '?')} "
                f"({old_data.get('delivery_status', '?')})"
            )
            new_summary = (
                f"{int(schedule.promised_qty)} pcs "
                f"on {schedule.expected_delivery_date} "
                f"({schedule.delivery_status})"
            )
            summary_log = DeliveryScheduleChangeLog.objects.create(
                schedule=schedule,
                po_number=schedule.po_number,
                component_code=schedule.component_id,
                component_description=component_description,
                vendor_name=schedule.vendor_name,
                changed_by=changed_by,
                changed_at=now,
                field_changed='Delivery Commitment Modified',
                old_value=old_summary,
                new_value=new_summary,
                reason_for_change=reason,
            )
            logs.append(summary_log)
            logger.info(
                f"Audit log update: PO {schedule.po_number} | "
                f"{len(changes_made)} fields changed by {changed_by}"
            )

        return logs

    # ──────────────────────────────────────────────────────────────────────
    # Method 3: log_delete (schedule deleted/cancelled)
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def log_delete(cls, schedule, changed_by, reason, component_description=''):
        """
        Writes one log row when a schedule is deleted/cancelled.
        The schedule FK is SET NULL after this log is written.
        So write the log BEFORE deleting the schedule object.
        """
        return cls.create_log(
            schedule=schedule,
            changed_by=changed_by,
            reason=reason,
            field_changed='Delivery Commitment Deleted/Cancelled',
            old_value=(
                f"{int(schedule.promised_qty)} pcs "
                f"on {schedule.expected_delivery_date} "
                f"({schedule.delivery_status})"
            ),
            new_value='REMOVED (0 pcs)',
            component_description=component_description,
        )

    # Backward-compatible alias
    @classmethod
    def log_cancellation(cls, schedule, changed_by, reason, old_qty, old_status):
        """Log the cancellation of a delivery schedule (backward compat)."""
        old_value = f"{old_qty} pcs on {schedule.expected_delivery_date} [{old_status}]"
        return cls.create_log(
            schedule=schedule,
            changed_by=changed_by,
            reason=reason,
            field_changed=f'Delivery Commitment Cancelled (0 pcs)',
            old_value=old_value,
            new_value='CANCELLED (0 pcs)',
        )

    # ──────────────────────────────────────────────────────────────────────
    # Method 4: log_bulk_upload (per-row import log)
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def log_bulk_upload(cls, schedule, changed_by, upload_file_name,
                        scope_label, component_description=''):
        """
        Writes one log row per row imported via bulk Excel/CSV upload.
        """
        return cls.create_log(
            schedule=schedule,
            changed_by=changed_by,
            reason=(
                f"Excel bulk schedule update ({upload_file_name}) "
                f"for {scope_label}."
            ),
            field_changed='Bulk Excel Schedule Import',
            old_value='Prior Schedule State',
            new_value=(
                f"+{int(schedule.promised_qty)} pcs "
                f"on {schedule.expected_delivery_date} "
                f"({schedule.delivery_status})"
            ),
            component_description=component_description,
        )

    # ──────────────────────────────────────────────────────────────────────
    # Method 5: log_auto_fill (auto-generated shortage coverage)
    # ──────────────────────────────────────────────────────────────────────

    @classmethod
    def log_auto_fill(cls, schedule, changed_by, deficit_qty,
                      component_description=''):
        """
        Writes one log row per auto-generated shortage coverage schedule.
        """
        return cls.create_log(
            schedule=schedule,
            changed_by=changed_by,
            reason='1-Click auto-fill coverage generated by Supply Planner.',
            field_changed='Auto-Fill Shortage Coverage',
            old_value='Deficit / Shortage Uncovered',
            new_value=(
                f"+{int(schedule.promised_qty)} units "
                f"on {schedule.expected_delivery_date}"
            ),
            component_description=component_description,
        )
