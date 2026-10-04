"""
Service 4: BulkScheduleUploadService

Parses Excel/CSV files and applies bulk schedule imports.
Handles Excel serial date conversion, flexible column name matching,
auto-resolution of vendor info from master data, and validation.

Adaptation note:
  - VendorDeliverySchedule uses FK fields:
    component (→ component_code via component_id),
    week (→ week_code via week_id)
  - Creates use component_id= and week_id= instead of
    component_code= and week_code=
"""
import csv
import io
import time
from datetime import datetime, date, timedelta

from django.db import transaction

from core.models import (
    VendorDeliverySchedule, BOMMaster,
    VendorBuyerMaster, VendorSuppliedComponent, UploadBatch,
    WeekDefinition,
)
from core.services.audit_log_service import AuditLogService
from core.services.vendor_schedule_week_resolver import VendorScheduleWeekResolver


VALID_STATUSES = {
    'CONFIRMED_ON_TRACK', 'IN_TRANSIT', 'PARTIAL_PROMISE',
    'DELAYED_AT_RISK', 'CANCELLED', 'CRITICAL_NO_PO'
}


class BulkScheduleUploadService:

    @staticmethod
    def parse_file(file_obj) -> list[dict]:
        """
        Parses .xlsx / .xls using openpyxl.
        Returns list of raw row dicts with normalized (lowercase-no-spaces) keys.
        """
        import openpyxl
        wb = openpyxl.load_workbook(file_obj, data_only=True)
        ws = wb.active
        headers = [
            str(cell.value or '').strip().lower().replace(' ', '').replace('_', '')
            for cell in next(ws.iter_rows(min_row=1, max_row=1))
        ]
        rows = []
        for row in ws.iter_rows(min_row=2, values_only=True):
            if all(v is None for v in row):
                continue
            rows.append(dict(zip(headers, row)))
        return rows

    @staticmethod
    def parse_csv_text(text: str) -> list[dict]:
        """
        Parses CSV text or tab-delimited text (from paste).
        Auto-detects delimiter. Normalizes header keys.
        """
        text = text.strip()
        dialect = csv.Sniffer().sniff(text[:2048])
        reader = csv.DictReader(io.StringIO(text), dialect=dialect)
        rows = []
        for row in reader:
            normalized = {
                k.strip().lower().replace(' ', '').replace('_', ''): v
                for k, v in row.items()
            }
            rows.append(normalized)
        return rows

    @staticmethod
    def normalize_row(raw: dict, month: str,
                      bom_component_codes: set,
                      vendor_by_component: dict,
                      first_week_code: str) -> dict:
        """
        Extracts and normalizes one raw row into a clean schedule payload dict.
        Returns {'data': {...}, 'is_valid': bool, 'validation_status': str,
                 'validation_message': str}
        """

        def get(keys, default=''):
            for k in keys:
                val = raw.get(k)
                if val is not None and str(val).strip():
                    return str(val).strip()
            return default

        comp_code = get([
            'componentcode', 'component', 'partnumber',
            'material', 'itemcode'
        ])
        po_number = get([
            'ponumber', 'po', 'scheduleref', 'schedulerefid'
        ])
        if not po_number:
            po_number = f"PO-BULK-{int(time.time())}"

        qty_raw = get([
            'promisedquantity', 'promisedqty', 'quantity', 'qty', 'inwardqty'
        ], '0')
        try:
            promised_qty = float(str(qty_raw).replace(',', ''))
        except ValueError:
            promised_qty = 0.0

        date_raw = get([
            'expecteddeliverydate', 'deliverydate', 'date', 'arrivaldate'
        ])
        # Handle Excel serial date numbers
        if date_raw and date_raw.replace('.', '').isdigit():
            serial = float(date_raw)
            if serial > 40000:
                delivery_date = (
                    datetime(1899, 12, 30) + timedelta(days=serial)
                ).date()
                date_raw = delivery_date.isoformat()

        # Parse date
        delivery_date = None
        for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y'):
            try:
                delivery_date = datetime.strptime(date_raw, fmt).date()
                break
            except (ValueError, TypeError):
                continue

        # Resolve week_code from date first, then Week_No fallback
        week_code = None
        if delivery_date:
            week_code = VendorScheduleWeekResolver.resolve(delivery_date, month)
        if not week_code:
            week_no_raw = get(['weekno', 'week'], '0')
            try:
                week_no = int(float(week_no_raw))
                week_code = VendorScheduleWeekResolver.resolve_from_week_no(
                    week_no, month
                )
            except (ValueError, TypeError):
                pass
        if not week_code:
            week_code = first_week_code

        # Auto-resolve vendor info from VendorBuyerMaster if not in file
        vb = vendor_by_component.get(comp_code)
        vendor_code = get(
            ['vendorcode'], vb.vendor_code if vb else 'V-NONE'
        )
        vendor_name = get(
            ['vendorname'], vb.vendor_name if vb else 'Designated Supplier'
        )
        buyer_name = get(
            ['buyername'], vb.buyer_name if vb else 'Unassigned Buyer'
        )

        # Normalize delivery status
        raw_status = get(
            ['deliverystatus', 'status'], 'CONFIRMED_ON_TRACK'
        ).upper().replace(' ', '_')
        if 'TRANSIT' in raw_status:
            delivery_status = 'IN_TRANSIT'
        elif 'PARTIAL' in raw_status:
            delivery_status = 'PARTIAL_PROMISE'
        elif 'DELAY' in raw_status or 'RISK' in raw_status:
            delivery_status = 'DELAYED_AT_RISK'
        elif 'CANCEL' in raw_status:
            delivery_status = 'CANCELLED'
        elif 'NO_PO' in raw_status or 'NOPO' in raw_status:
            delivery_status = 'CRITICAL_NO_PO'
        else:
            delivery_status = 'CONFIRMED_ON_TRACK'

        carrier = get(
            ['carrierortracking', 'carrier', 'tracking'],
            'Direct Road Logistics'
        )
        notes = get(
            ['notes', 'remark'],
            'Uploaded via Excel bulk schedule updater'
        )
        comp_desc = get(
            ['componentdescription', 'description'],
            'Direct Component'
        )

        # Validation
        is_valid = True
        validation_status = 'VALID'
        validation_message = 'Valid & verified against Master Data'

        if not comp_code:
            is_valid, validation_status = False, 'ERROR'
            validation_message = 'Missing Component Code'
        elif comp_code not in bom_component_codes:
            validation_status = 'WARNING'
            validation_message = (
                'Component not found in BOM master '
                '(registered as standalone)'
            )
        if promised_qty <= 0:
            is_valid, validation_status = False, 'ERROR'
            validation_message = 'Promised quantity must be greater than 0'

        return {
            'data': {
                'po_number': po_number,
                'component_code': comp_code,
                'component_description': comp_desc,
                'vendor_code': vendor_code,
                'vendor_name': vendor_name,
                'buyer_name': buyer_name,
                'expected_delivery_date': delivery_date,
                'week_code': week_code,
                'promised_qty': promised_qty,
                'carrier_or_tracking': carrier,
                'delivery_status': delivery_status,
                'notes': notes,
            },
            'is_valid': is_valid,
            'validation_status': validation_status,
            'validation_message': validation_message,
        }

    @staticmethod
    @transaction.atomic
    def apply(month: str, parsed_rows: list[dict], import_mode: str,
              upload_scope: str, selected_week_code: str,
              changed_by: str, upload_file_name: str,
              batch: 'UploadBatch') -> dict:
        """
        Applies valid parsed rows to the database.
        import_mode:  'APPEND' | 'OVERWRITE'
        upload_scope: 'SELECTED_WEEK' | 'FULL_MONTH'

        If OVERWRITE:
          - SELECTED_WEEK: cancel all non-cancelled schedules for selected week
          - FULL_MONTH: cancel all non-cancelled schedules for the entire month

        Creates audit log entries for every new schedule.
        Updates the UploadBatch with final counts.

        Returns {'imported': N, 'skipped': M, 'errors': [...]}
        """
        valid_rows = [r for r in parsed_rows if r['is_valid']]
        error_rows = [r for r in parsed_rows if not r['is_valid']]

        if import_mode == 'OVERWRITE':
            month_week_codes = list(
                WeekDefinition.objects.filter(month=month)
                .values_list('week_code', flat=True)
            )
            qs_to_cancel = VendorDeliverySchedule.objects.exclude(
                delivery_status='CANCELLED'
            )
            if upload_scope == 'SELECTED_WEEK' and selected_week_code:
                qs_to_cancel = qs_to_cancel.filter(
                    week_id=selected_week_code
                )
            else:
                qs_to_cancel = qs_to_cancel.filter(
                    week_id__in=month_week_codes
                )

            # Audit-log the cancellations
            for s in qs_to_cancel:
                AuditLogService.log_delete(
                    s, changed_by,
                    f'Overwrite import mode: cancelled before bulk import '
                    f'of {upload_file_name}'
                )
            qs_to_cancel.update(delivery_status='CANCELLED')

        new_schedules = []
        for row in valid_rows:
            data = row['data']
            sched = VendorDeliverySchedule.objects.create(
                po_number=data['po_number'],
                component_id=data['component_code'],   # FK to_field
                vendor_code=data['vendor_code'],
                vendor_name=data['vendor_name'],
                buyer_name=data['buyer_name'],
                expected_delivery_date=data['expected_delivery_date'],
                week_id=data['week_code'],               # FK to_field
                promised_qty=data['promised_qty'],
                carrier_or_tracking=data['carrier_or_tracking'],
                delivery_status=data['delivery_status'],
                notes=data['notes'],
                upload_batch=batch,
            )
            scope_label = (
                f"Week {selected_week_code}"
                if upload_scope == 'SELECTED_WEEK'
                else month
            )
            AuditLogService.log_bulk_upload(
                sched, changed_by, upload_file_name,
                scope_label=scope_label,
                component_description=data.get('component_description', ''),
            )
            new_schedules.append(sched)

        # Update batch record
        batch.imported_rows = len(new_schedules)
        batch.error_rows = len(error_rows)
        batch.status = 'COMPLETED' if not error_rows else 'PARTIAL'
        batch.error_detail = [
            {'row': i + 1, 'error': r['validation_message']}
            for i, r in enumerate(error_rows)
        ]
        batch.save()

        return {
            'imported': len(new_schedules),
            'skipped': len(error_rows),
            'errors': batch.error_detail,
        }
