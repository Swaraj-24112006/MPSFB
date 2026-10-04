"""
Service 5: AutoFillDeficitService

For every component with hasShortage=True in the consolidated matrix,
creates one new VendorDeliverySchedule covering the deficit.

Adaptation note:
  - Creates use component_id= and week_id= instead of plain CharField fields
"""
from django.db import transaction

from core.models import VendorDeliverySchedule, WeekDefinition
from core.services.audit_log_service import AuditLogService
from core.services.consolidated_matrix_service import ConsolidatedMatrixService


class AutoFillDeficitService:

    @staticmethod
    @transaction.atomic
    def auto_fill(month: str, scope_mode: str, selected_week_code: str,
                  changed_by: str) -> dict:
        """
        For every component with hasShortage=True in the consolidated matrix,
        creates one new VendorDeliverySchedule with:
            promisedQty = selectedScopeDeficit
            expectedDeliveryDate = selected week's start_date
            deliveryStatus = CONFIRMED_ON_TRACK
            poNumber = auto-generated PO-AUTO-{YYYYMM}-{index}
            notes = 'Auto-generated commitment matching deficit of {qty} {uom}'

        Returns: {'generated': N, 'total_units_committed': M}
        """
        selected_week = WeekDefinition.objects.filter(
            week_code=selected_week_code
        ).first()

        if selected_week:
            default_date = selected_week.start_date
        else:
            # Fallback: 10th of the month
            from datetime import date
            try:
                default_date = date.fromisoformat(f"{month}-10")
            except (ValueError, TypeError):
                default_date = date.today()

        # Compute matrix to find shortage items
        matrix = ConsolidatedMatrixService.compute(
            month=month,
            scope_mode=scope_mode,
            selected_week_code=selected_week_code,
        )
        deficit_rows = [r for r in matrix['rows'] if r['hasShortage']]

        if not deficit_rows:
            return {'generated': 0, 'total_units_committed': 0}

        generated_count = 0
        total_units = 0

        for idx, row in enumerate(deficit_rows):
            po_number = f"PO-AUTO-{month.replace('-', '')}-{8000 + idx}"
            sched = VendorDeliverySchedule.objects.create(
                po_number=po_number,
                component_id=row['componentCode'],    # FK to_field
                vendor_code=row['vendorCode'],
                vendor_name=row['vendorName'],
                buyer_name=row['buyerName'],
                expected_delivery_date=default_date,
                week_id=selected_week_code,            # FK to_field
                promised_qty=row['selectedScopeDeficit'],
                carrier_or_tracking='Expedited Express Freight',
                delivery_status='CONFIRMED_ON_TRACK',
                notes=(
                    f"Auto-generated commitment matching deficit of "
                    f"{row['selectedScopeDeficit']:,} {row['uom']}"
                ),
            )
            AuditLogService.log_auto_fill(
                sched, changed_by, row['selectedScopeDeficit'],
                component_description=row.get('componentDescription', ''),
            )
            generated_count += 1
            total_units += row['selectedScopeDeficit']

        return {
            'generated': generated_count,
            'total_units_committed': total_units,
        }
