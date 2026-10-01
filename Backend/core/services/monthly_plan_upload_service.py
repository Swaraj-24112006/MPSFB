import io
import logging
from typing import Union, BinaryIO, Dict, Any, List, Optional
from django.db import transaction

from core.models import MonthlyPlan, WeekDefinition, BOMFGHeader, UploadBatch
from core.services.upload_batch_service import UploadBatchService
from core.services.storage_service import StorageService
from core.services.prorate_service import ProrateService
from core.services.monthly_plan_parser import MonthlyPlanParser

logger = logging.getLogger(__name__)


class MonthlyPlanUploadService:
    @staticmethod
    def upload(
        month: str,
        file_or_text: Any,
        uploaded_by: str = 'system',
        file_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Orchestrates Monthly Plan bulk upload from CSV/Excel file or pasted text.
        Returns a dict matching MonthlyPlanUploadResponse schema:
        {
            "message": str,
            "batch_id": int,
            "month": str,
            "total_rows": int,
            "imported_rows": int,
            "error_rows": int,
            "errors": list,
            "results": list
        }
        """
        clean_month = month.strip()

        # Determine file_name if not provided
        if not file_name:
            if hasattr(file_or_text, 'name'):
                file_name = file_or_text.name
            else:
                file_name = f"monthly_plan_{clean_month}.csv"

        # 1. Initialize upload_batch record with status='PENDING'
        batch = UploadBatchService.create_batch(
            upload_type='MONTHLY_PLAN',
            user=uploaded_by,
            file_name=file_name,
            minio_path='',
            total_rows=0
        )

        # 2. Upload file to MinIO / Local storage
        try:
            minio_path = StorageService.upload_file(
                file_or_text,
                f"monthly_plan_uploads/{clean_month}/{file_name}"
            )
            batch.minio_path = minio_path
            batch.save(update_fields=['minio_path'])
        except Exception as e:
            logger.warning(f"StorageService upload fallback: {e}")
            minio_path = f"fallback/{file_name}"
            batch.minio_path = minio_path
            batch.save(update_fields=['minio_path'])

        # 3. Fetch week_definition rows for month -> if empty, fail entire batch immediately
        weeks = list(WeekDefinition.objects.filter(month=clean_month).order_by('week_no'))
        if not weeks:
            err_msg = f"No week definitions found for {clean_month}. Define weeks first."
            UploadBatchService.fail(batch, err_msg)
            return {
                "message": err_msg,
                "batch_id": batch.id,
                "month": clean_month,
                "total_rows": 0,
                "imported_rows": 0,
                "error_rows": 0,
                "errors": [{"row_index": 0, "fg_code": "", "reason": err_msg}],
                "results": []
            }

        # 4. Parse file or text
        try:
            parse_result = MonthlyPlanParser.parse(file_or_text, clean_month)
        except Exception as parse_ex:
            err_msg = f"Parsing error: {str(parse_ex)}"
            UploadBatchService.fail(batch, err_msg)
            return {
                "message": err_msg,
                "batch_id": batch.id,
                "month": clean_month,
                "total_rows": 0,
                "imported_rows": 0,
                "error_rows": 1,
                "errors": [{"row_index": 0, "fg_code": "", "reason": err_msg}],
                "results": []
            }

        valid_rows = parse_result.get('valid_rows', [])
        error_rows = parse_result.get('error_rows', [])
        total_rows = parse_result.get('total_rows', len(valid_rows) + len(error_rows))

        batch.total_rows = total_rows
        batch.save(update_fields=['total_rows'])

        imported_plans: List[MonthlyPlan] = []

        # 5. Process valid rows and upsert MonthlyPlan
        try:
            with transaction.atomic():
                for row in valid_rows:
                    fg_code = row['fg_code']
                    monthly_target = row['monthly_target']
                    fg_description = row.get('fg_description') or ''
                    customer_name = row.get('customer_name') or ''
                    uom = row.get('uom') or 'PC'
                    custom_notes = row.get('custom_notes') or ''

                    # Resolve or auto-create BOMFGHeader
                    fg_header, _ = BOMFGHeader.objects.get_or_create(
                        fg_code=fg_code,
                        defaults={
                            'fg_description': fg_description or f"Product {fg_code}",
                            'customer_segment': customer_name,
                            'uom': uom,
                            'active_bom_version': 'v1',
                            'is_active': True,
                        }
                    )
                    if fg_description and (not fg_header.fg_description or fg_header.fg_description.startswith('Product ')):
                        fg_header.fg_description = fg_description
                        fg_header.save(update_fields=['fg_description'])

                    # Run proration
                    weekly_breakdown = ProrateService.prorate(monthly_target, weeks)

                    # Upsert MonthlyPlan on (fg, month)
                    plan, _ = MonthlyPlan.objects.update_or_create(
                        fg=fg_header,
                        month=clean_month,
                        defaults={
                            'monthly_target': monthly_target,
                            'customer_name': customer_name or fg_header.customer_segment or '',
                            'custom_notes': custom_notes,
                            'uom': uom or fg_header.uom or 'PC',
                            'weekly_breakdown': weekly_breakdown,
                            'upload_batch': batch,
                        }
                    )
                    imported_plans.append(plan)

            # 6. Update upload_batch status
            from core.serializers import MonthlyPlanSerializer
            from rest_framework.renderers import JSONRenderer

            imported_count = len(imported_plans)
            error_count = len(error_rows)

            if error_count == 0 and imported_count > 0:
                UploadBatchService.complete(batch, imported_count, 0, {})
            elif imported_count > 0:
                UploadBatchService.complete(batch, imported_count, error_count, {"errors": error_rows[:50]})
            else:
                UploadBatchService.fail(batch, f"All {error_count} rows failed validation.")

            serialized_plans = MonthlyPlanSerializer(imported_plans, many=True).data

            return {
                "message": f"Monthly Plan upload complete for {clean_month}.",
                "batch_id": batch.id,
                "month": clean_month,
                "total_rows": total_rows,
                "imported_rows": imported_count,
                "error_rows": error_count,
                "errors": error_rows,
                "results": serialized_plans
            }

        except Exception as ex:
            UploadBatchService.fail(batch, f"Database persistence error: {str(ex)}")
            return {
                "message": f"Failed to persist monthly plan records: {str(ex)}",
                "batch_id": batch.id,
                "month": clean_month,
                "total_rows": total_rows,
                "imported_rows": len(imported_plans),
                "error_rows": len(error_rows) + 1,
                "errors": error_rows + [{"row_index": 0, "fg_code": "", "reason": str(ex)}],
                "results": []
            }
