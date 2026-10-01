"""
C4 — AuditLogService

Writes audit rows to DeliveryScheduleChangeLog for every mutation
to a VendorDeliverySchedule (create, update, cancel).
"""
import logging

logger = logging.getLogger(__name__)


class AuditLogService:
    """
    Responsible for creating append-only audit trail entries
    whenever a VendorDeliverySchedule is created, edited, or cancelled.
    """

    @classmethod
    def create_log(cls, schedule, changed_by, reason, field_changed, old_value='', new_value=''):
        """
        Create a single audit log entry for a schedule mutation.

        :param schedule: VendorDeliverySchedule instance
        :param changed_by: Name of the person making the change
        :param reason: Reason for the change (min 10 chars enforced by caller)
        :param field_changed: Description of which field(s) changed
        :param old_value: Previous value
        :param new_value: New value
        :return: DeliveryScheduleChangeLog instance
        """
        from core.models import DeliveryScheduleChangeLog

        log = DeliveryScheduleChangeLog.objects.create(
            schedule=schedule,
            po_number=schedule.po_number,
            component_code=schedule.component_id,
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

    @classmethod
    def log_creation(cls, schedule, changed_by, reason):
        """Log the creation of a new delivery schedule."""
        new_value = f"{schedule.promised_qty} pcs on {schedule.expected_delivery_date} [{schedule.delivery_status}]"
        return cls.create_log(
            schedule=schedule,
            changed_by=changed_by,
            reason=reason,
            field_changed='New Delivery Commitment Created',
            old_value='None',
            new_value=new_value,
        )

    @classmethod
    def log_update(cls, schedule, old_data, changed_by, reason):
        """
        Compare old vs new values and create audit log entries for changed fields.

        :param schedule: Updated VendorDeliverySchedule instance (already saved)
        :param old_data: Dict of {field_name: old_value} captured before the update
        :param changed_by: Name of the person making the change
        :param reason: Reason for the change
        :return: List of DeliveryScheduleChangeLog instances
        """
        field_changes = []

        check_fields = {
            'expected_delivery_date': 'Arrival Date',
            'promised_qty': 'Promised Qty',
            'delivery_status': 'Status',
            'vendor_name': 'Vendor',
            'buyer_name': 'Buyer',
        }

        for field, label in check_fields.items():
            old_val = old_data.get(field)
            new_val = getattr(schedule, field)
            if str(old_val) != str(new_val):
                field_changes.append(f"{label} ({old_val} → {new_val})")

        if not field_changes:
            return []

        old_summary = (
            f"{old_data.get('promised_qty', '?')} pcs on "
            f"{old_data.get('expected_delivery_date', '?')} "
            f"[{old_data.get('delivery_status', '?')}]"
        )
        new_summary = (
            f"{schedule.promised_qty} pcs on "
            f"{schedule.expected_delivery_date} "
            f"[{schedule.delivery_status}]"
        )

        log = cls.create_log(
            schedule=schedule,
            changed_by=changed_by,
            reason=reason,
            field_changed='; '.join(field_changes),
            old_value=old_summary,
            new_value=new_summary,
        )
        return [log]

    @classmethod
    def log_cancellation(cls, schedule, changed_by, reason, old_qty, old_status):
        """Log the cancellation of a delivery schedule."""
        old_value = f"{old_qty} pcs on {schedule.expected_delivery_date} [{old_status}]"
        return cls.create_log(
            schedule=schedule,
            changed_by=changed_by,
            reason=reason,
            field_changed=f'Delivery Commitment Cancelled (0 pcs)',
            old_value=old_value,
            new_value='CANCELLED (0 pcs)',
        )
