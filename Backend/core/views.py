import csv
import io
import math
from collections import Counter
from django.conf import settings
from django.db import connection, transaction
from django.db.models import Q
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import (
    BOMFGHeader,
    RMPMComponentMaster,
    BOMMaster,
    VendorSuppliedComponent,
    VendorBuyerMaster,
    UploadBatch,
    WeekDefinition,
    MonthlyPlan,
    MB51Transaction,
    StockReport,
    VendorDeliverySchedule,
    DeliveryScheduleChangeLog,
    FGPlanFreeze,
    MondayReviewAction,
)
from .serializers import (
    BOMFGHeaderSerializer,
    RMPMComponentSerializer,
    BOMMasterSerializer,
    VendorBuyerSerializer,
    WeekDefinitionSerializer,
    MonthlyPlanSerializer,
    MB51TransactionSerializer,
    StockReportSerializer,
    VendorDeliveryScheduleSerializer,
    DeliveryScheduleChangeLogSerializer,
    FGPlanFreezeSerializer,
    MondayReviewActionSerializer,
    UploadBatchSerializer,
)
import logging

logger = logging.getLogger(__name__)

from .pagination import StandardResultsSetPagination
from .services import (
    StorageService,
    UploadBatchService,
    BOMService,
    MaterialTypeService,
    WeekService,
    ProrateService,
    MonthlyPlanParser,
    MonthlyPlanUploadService,
    MB51ClassificationService,
    WeekMappingService,
    MB51Parser,
    StockParser,
    AuditLogService,
    PlanFreezeService,
    CockpitDataLoaderService,
    CockpitEngineService,
)



@api_view(['GET'])
@permission_classes([AllowAny])
def health_check(request):
    """
    Health check probe for gateway and container readiness.
    """
    return Response({
        "status": "healthy",
        "service": "mps_backend",
        "version": "1.0.0"
    })


class BOMFGHeaderListCreateView(generics.ListCreateAPIView):
    """
    GET /api/bom/fg-headers/
    Lists finished good headers with optional filtering:
    - ?is_active=true|false
    - ?mini_factory=MF1
    - ?line=Line 1
    - ?search=7001001 (matches fg_code, fg_description, customer_segment)
    - ?paginate=false (returns full unpaginated list)

    POST /api/bom/fg-headers/
    Creates a new finished good header.
    Validates fg_code starts with '7' and defaults active_bom_version to 'v1'.
    """
    serializer_class = BOMFGHeaderSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get_queryset(self):
        qs = BOMFGHeader.objects.all().order_by('fg_code')

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            if is_active.lower() in ('true', '1'):
                qs = qs.filter(is_active=True)
            elif is_active.lower() in ('false', '0'):
                qs = qs.filter(is_active=False)

        mini_factory = self.request.query_params.get('mini_factory')
        if mini_factory:
            qs = qs.filter(mini_factory__iexact=mini_factory.strip())

        line = self.request.query_params.get('line')
        if line:
            qs = qs.filter(line__iexact=line.strip())

        search = self.request.query_params.get('search')
        if search:
            query = search.strip()
            qs = qs.filter(
                Q(fg_code__icontains=query) |
                Q(fg_description__icontains=query) |
                Q(customer_segment__icontains=query)
            )

        return qs

    def perform_create(self, serializer):
        # Default active_bom_version = 'v1' if omitted
        if not serializer.validated_data.get('active_bom_version'):
            serializer.validated_data['active_bom_version'] = 'v1'
        serializer.save()


class BOMFGHeaderDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET /api/bom/fg-headers/{fg_code}/
    Retrieves a single finished good header by fg_code.

    PATCH /api/bom/fg-headers/{fg_code}/
    Updates fields on the header.
    If active_bom_version changes, emits a warning in the response.

    DELETE /api/bom/fg-headers/{fg_code}/
    Deletes the finished good header.
    Blocks with HTTP 409 Conflict if active monthly_plan rows reference this fg_code.
    """
    queryset = BOMFGHeader.objects.all()
    serializer_class = BOMFGHeaderSerializer
    lookup_field = 'fg_code'
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        old_version = instance.active_bom_version

        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        data = serializer.data
        new_version = serializer.instance.active_bom_version
        if old_version and new_version and old_version != new_version:
            data['warning'] = (
                f"Active BOM version changed from '{old_version}' to '{new_version}'. "
                f"MRP computation and component requirements will reflect the new BOM tree."
            )

        return Response(data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()

        # Block if active monthly_plan rows exist for this fg_code
        has_monthly_plan = False
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT 1 FROM information_schema.tables WHERE table_name = 'monthly_plan'"
                )
                if cursor.fetchone():
                    cursor.execute(
                        "SELECT 1 FROM monthly_plan WHERE fg_code = %s LIMIT 1",
                        [instance.fg_code]
                    )
                    has_monthly_plan = cursor.fetchone() is not None
        except Exception:
            pass

        if has_monthly_plan:
            return Response(
                {
                    "error": (
                        f"Cannot delete Finished Good '{instance.fg_code}' because active "
                        f"monthly plans reference it. Delete or reassign monthly plans first."
                    )
                },
                status=status.HTTP_409_CONFLICT
            )

        fg_code = instance.fg_code
        self.perform_destroy(instance)
        return Response(
            {"message": f"Finished Good '{fg_code}' deleted successfully."},
            status=status.HTTP_200_OK
        )


class ComponentListCreateView(generics.ListCreateAPIView):
    """
    GET /api/components/
    Lists RM/PM components with filters:
    - ?category=RM|PM
    - ?is_common_part=true|false
    - ?is_active=true|false
    - ?search=CASTING (matches component_code, component_description, default_storage_location)
    - ?paginate=false (unpaginated list)

    POST /api/components/
    Creates a new RM/PM component.
    Validates component_code does NOT start with '7' and safety_stock >= 0.
    """
    serializer_class = RMPMComponentSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get_queryset(self):
        qs = RMPMComponentMaster.objects.all().order_by('component_code')

        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category.strip().upper())

        is_common_part = self.request.query_params.get('is_common_part')
        if is_common_part is not None:
            if is_common_part.lower() in ('true', '1'):
                qs = qs.filter(is_common_part=True)
            elif is_common_part.lower() in ('false', '0'):
                qs = qs.filter(is_common_part=False)

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            if is_active.lower() in ('true', '1'):
                qs = qs.filter(is_active=True)
            elif is_active.lower() in ('false', '0'):
                qs = qs.filter(is_active=False)

        search = self.request.query_params.get('search')
        if search:
            query = search.strip()
            qs = qs.filter(
                Q(component_code__icontains=query) |
                Q(component_description__icontains=query) |
                Q(default_storage_location__icontains=query)
            )

        return qs


class ComponentDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET /api/components/{component_code}/
    Retrieves a single component by component_code.

    PATCH /api/components/{component_code}/
    Updates fields on the component. component_code is read-only after create.

    DELETE /api/components/{component_code}/
    Deletes the component.
    Blocks with HTTP 409 Conflict if any bom_master rows reference this component_code.
    """
    queryset = RMPMComponentMaster.objects.all()
    serializer_class = RMPMComponentSerializer
    lookup_field = 'component_code'
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()

        # Block with 409 if any bom_master rows reference this component_code
        bom_count = instance.bom_usages.count()
        if bom_count > 0:
            referencing_fgs = list(
                instance.bom_usages.values_list('fg_id', flat=True).distinct()
            )
            return Response(
                {
                    "error": (
                        f"Cannot delete Component '{instance.component_code}' because it is referenced "
                        f"in {bom_count} BOM line(s) for Finished Good(s): {', '.join(referencing_fgs)}. "
                        f"Remove this component from those BOMs before deleting."
                    )
                },
                status=status.HTTP_409_CONFLICT
            )

        code = instance.component_code
        self.perform_destroy(instance)
        return Response(
            {"message": f"Component '{code}' deleted successfully."},
            status=status.HTTP_200_OK
        )


class BOMMasterListCreateView(generics.ListCreateAPIView):
    """
    GET /api/bom/
    Lists BOM lines with filtering:
    - ?fg_code=7001001
    - ?component_code=RM-CASTING-01
    - ?category=RM|PM
    - ?is_active=true|false
    - ?search=... (searches fg_code, fg_description, component_code, component_description)
    - ?paginate=false

    POST /api/bom/
    Creates a BOM line. Validates both FK exist, qty > 0, and updates common part flags.
    """
    serializer_class = BOMMasterSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get_queryset(self):
        qs = BOMMaster.objects.select_related('fg', 'component').all().order_by('fg_id', 'component_id')

        fg_code = self.request.query_params.get('fg_code')
        if fg_code:
            qs = qs.filter(fg_id=fg_code.strip())

        component_code = self.request.query_params.get('component_code')
        if component_code:
            qs = qs.filter(component_id=component_code.strip().upper())

        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(component__category=category.strip().upper())

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            if is_active.lower() in ('true', '1'):
                qs = qs.filter(is_active=True)
            elif is_active.lower() in ('false', '0'):
                qs = qs.filter(is_active=False)

        search = self.request.query_params.get('search')
        if search:
            query = search.strip()
            qs = qs.filter(
                Q(fg_id__icontains=query) |
                Q(fg__fg_description__icontains=query) |
                Q(component_id__icontains=query) |
                Q(component__component_description__icontains=query)
            )

        return qs

    def perform_create(self, serializer):
        instance = serializer.save()
        from core.services.bom_service import BOMService
        BOMService.update_common_part_flags(instance.component_id)


class BOMMasterDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET /api/bom/{id}/
    Retrieves a single BOM item.

    PATCH /api/bom/{id}/
    Updates fields on a BOM item. Re-runs common part flags if component or qty changes.

    DELETE /api/bom/{id}/
    Hard deletes the BOM line and triggers update_common_part_flags.
    """
    queryset = BOMMaster.objects.select_related('fg', 'component').all()
    serializer_class = BOMMasterSerializer
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def perform_update(self, serializer):
        old_component_id = serializer.instance.component_id
        instance = serializer.save()
        from core.services.bom_service import BOMService
        BOMService.update_common_part_flags(instance.component_id)
        if old_component_id and old_component_id != instance.component_id:
            BOMService.update_common_part_flags(old_component_id)

    def perform_destroy(self, instance):
        component_id = instance.component_id
        instance.delete()
        from core.services.bom_service import BOMService
        BOMService.update_common_part_flags(component_id)


class ExplodedBOMView(APIView):
    """
    GET /api/bom/exploded/{fg_code}/
    Joins bom_master -> rm_pm_component_master -> vendor_supplied_components -> vendor_buyer_master -> stock_report.
    Returns full component tree with:
    - current_stock
    - stock_covers_units (floor(current_stock / bom_qty))
    - vendor_name, buyer_name, lead_time_days
    - is_common_part, shared_in_fgs_count
    """
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get(self, request, fg_code):
        clean_code = fg_code.strip()
        fg = BOMFGHeader.objects.filter(fg_code=clean_code).first()
        if not fg:
            return Response(
                {"error": f"Finished Good '{clean_code}' not found."},
                status=status.HTTP_404_NOT_FOUND
            )

        # Query all active BOM lines for the active BOM version
        version = request.query_params.get('bom_version') or fg.active_bom_version
        bom_lines = BOMMaster.objects.filter(
            fg=fg,
            bom_version=version,
            is_active=True
        ).select_related('component').order_by('component__category', 'component_id')

        # Query current stock from StockReport model (aggregating across storage locations)
        stock_map = {}
        try:
            comp_codes = [b.component_id for b in bom_lines]
            if comp_codes:
                from django.db.models import Sum
                stocks = (
                    StockReport.objects.filter(part_number__in=comp_codes)
                    .values('part_number')
                    .annotate(total=Sum('unrestricted_stock'))
                )
                for s in stocks:
                    stock_map[s['part_number']] = float(s['total'] or 0)
        except Exception as e:
            logger.warning(f"Error querying stock for ExplodedBOMView: {e}")

        # Query vendor and buyer mappings for components (handles multiple vendors per component)
        comp_codes = [b.component_id for b in bom_lines]
        vendor_rels = VendorSuppliedComponent.objects.filter(
            component_id__in=comp_codes
        ).select_related('vendor_buyer')

        vendor_map = {}
        for rel in vendor_rels:
            vb = rel.vendor_buyer
            if rel.component_id not in vendor_map:
                vendor_map[rel.component_id] = []
            vendor_map[rel.component_id].append({
                'vendor_code': vb.vendor_code,
                'vendor_name': vb.vendor_name,
                'buyer_name': vb.buyer_name,
                'lead_time_days': vb.lead_time_days,
            })

        exploded_components = []
        for line in bom_lines:
            comp = line.component
            current_stock = stock_map.get(comp.component_code, 0.0)
            qty = float(line.qty)
            stock_covers = math.floor(current_stock / qty) if qty > 0 else 0

            suppliers = vendor_map.get(comp.component_code, [])
            if suppliers:
                v_codes = [s['vendor_code'] for s in suppliers]
                v_names = [s['vendor_name'] for s in suppliers]
                b_names = list(dict.fromkeys([s['buyer_name'] for s in suppliers if s['buyer_name']]))
                lt_days = [s['lead_time_days'] for s in suppliers if s.get('lead_time_days') is not None]

                v_info = {
                    'vendor_code': ', '.join(v_codes),
                    'vendor_name': ' / '.join(v_names),
                    'buyer_name': ' / '.join(b_names) if b_names else 'Unassigned',
                    'lead_time_days': min(lt_days) if lt_days else 7,
                    'suppliers': suppliers,
                    'is_multi_vendor': len(suppliers) > 1,
                }
            else:
                v_info = {
                    'vendor_code': None,
                    'vendor_name': 'No Vendor Assigned',
                    'buyer_name': 'Unassigned',
                    'lead_time_days': line.lead_time_days_override or 7,
                    'suppliers': [],
                    'is_multi_vendor': False,
                }

            exploded_components.append({
                'id': line.id,
                'fg_code': fg.fg_code,
                'fg_description': fg.fg_description,
                'component_code': comp.component_code,
                'component_description': comp.component_description,
                'category': comp.category,
                'uom': line.uom or comp.uom,
                'qty': qty,
                'component_role': line.component_role,
                'bom_version': line.bom_version,
                'is_active': line.is_active,
                'is_common_part': comp.is_common_part,
                'shared_in_fgs_count': comp.shared_in_fgs_count,
                'current_stock': current_stock,
                'stock_covers_units': stock_covers,
                'vendor_code': v_info['vendor_code'],
                'vendor_name': v_info['vendor_name'],
                'buyer_name': v_info['buyer_name'],
                'lead_time_days': line.lead_time_days_override or v_info['lead_time_days'],
                'suppliers': v_info['suppliers'],
                'is_multi_vendor': v_info['is_multi_vendor'],
            })

        return Response({
            'fg_code': fg.fg_code,
            'fg_description': fg.fg_description,
            'active_bom_version': version,
            'components_count': len(exploded_components),
            'components': exploded_components
        })


class CommonComponentsView(APIView):
    """
    GET /api/bom/common-components/
    Queries rm_pm_component_master WHERE is_common_part = TRUE.
    Annotates with list of active consuming Finished Goods.
    """
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get(self, request):
        qs = RMPMComponentMaster.objects.filter(
            is_common_part=True,
            is_active=True
        ).prefetch_related('bom_usages__fg').order_by('component_code')

        results = []
        for comp in qs:
            consuming_fgs = []
            seen_fgs = set()
            for usage in comp.bom_usages.filter(is_active=True):
                if usage.fg_id not in seen_fgs:
                    seen_fgs.add(usage.fg_id)
                    consuming_fgs.append({
                        'fg_code': usage.fg_id,
                        'fg_description': usage.fg.fg_description if usage.fg else '',
                        'qty': float(usage.qty),
                        'uom': usage.uom,
                        'bom_version': usage.bom_version,
                    })

            results.append({
                'component_code': comp.component_code,
                'component_description': comp.component_description,
                'category': comp.category,
                'uom': comp.uom,
                'safety_stock': float(comp.safety_stock),
                'shared_in_fgs_count': comp.shared_in_fgs_count,
                'consuming_fgs_count': len(consuming_fgs),
                'consuming_fgs': consuming_fgs,
            })

        return Response({
            'count': len(results),
            'results': results
        })


class VendorBuyerListCreateView(generics.ListCreateAPIView):
    """
    GET /api/vendor-buyers/
    Lists vendor and buyer relationships with optional filters:
    - ?buyer_name=Rajesh
    - ?category=RM|PM
    - ?vendor_code=V-1001
    - ?search=... (searches vendor_code, vendor_name, buyer_name, city, gst_no)
    - ?paginate=false (unpaginated list)

    POST /api/vendor-buyers/
    Inserts vendor_buyer_master and bulk inserts vendor_supplied_components rows
    from the supplied_components array.
    """
    serializer_class = VendorBuyerSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get_queryset(self):
        qs = VendorBuyerMaster.objects.prefetch_related('supplied_components_rel').all().order_by('vendor_code')

        buyer_name = self.request.query_params.get('buyer_name')
        if buyer_name:
            qs = qs.filter(buyer_name__icontains=buyer_name.strip())

        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category=category.strip().upper())

        vendor_code = self.request.query_params.get('vendor_code')
        if vendor_code:
            qs = qs.filter(vendor_code__iexact=vendor_code.strip())

        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            if is_active.lower() in ('true', '1'):
                qs = qs.filter(is_active=True)
            elif is_active.lower() in ('false', '0'):
                qs = qs.filter(is_active=False)

        search = self.request.query_params.get('search')
        if search:
            query = search.strip()
            qs = qs.filter(
                Q(vendor_code__icontains=query) |
                Q(vendor_name__icontains=query) |
                Q(buyer_name__icontains=query) |
                Q(city__icontains=query) |
                Q(gst_no__icontains=query)
            )

        return qs


class VendorBuyerDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET /api/vendor-buyers/{id}/
    Retrieves a single vendor-buyer master entry with supplied_components.

    PATCH /api/vendor-buyers/{id}/
    Updates fields on the vendor. If supplied_components is provided,
    deletes all existing junction rows for this vendor and inserts the fresh list.

    DELETE /api/vendor-buyers/{id}/
    Deletes the vendor. Blocks with HTTP 409 Conflict if active vendor_delivery_schedule rows reference this vendor_code.
    """
    queryset = VendorBuyerMaster.objects.prefetch_related('supplied_components_rel').all()
    serializer_class = VendorBuyerSerializer
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()

        # Block with 409 if active vendor_delivery_schedule rows reference vendor_code
        has_active_schedules = False
        try:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT 1 FROM information_schema.tables WHERE table_name = 'vendor_delivery_schedule'"
                )
                if cursor.fetchone():
                    cursor.execute(
                        "SELECT 1 FROM vendor_delivery_schedule WHERE vendor_code = %s AND delivery_status != 'CANCELLED' LIMIT 1",
                        [instance.vendor_code]
                    )
                    has_active_schedules = cursor.fetchone() is not None
        except Exception:
            pass

        if has_active_schedules:
            return Response(
                {
                    "error": (
                        f"Cannot delete Vendor '{instance.vendor_code}' because active "
                        f"delivery schedule commitments reference it. Cancel or reassign those schedules first."
                    )
                },
                status=status.HTTP_409_CONFLICT
            )

        code = instance.vendor_code
        self.perform_destroy(instance)
        return Response(
            {"message": f"Vendor '{code}' deleted successfully."},
            status=status.HTTP_200_OK
        )


class BOMCSVUploadView(APIView):
    """
    POST /api/bom/upload-csv/
    Accepts CSV file upload for BOM Master.
    Expected CSV columns:
    FG Code | FG Description | Component Code | Component Description | Quantity Per Unit | UOM | Category

    Automatically creates/updates:
    1. bom_fg_header (from FG Code and Description)
    2. rm_pm_component_master (from Component Code, Description, Category, UOM)
    3. bom_master line linking them
    4. Triggers BOMService.update_common_part_flags to recalculate shared component metrics.
    """
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def post(self, request):
        file_obj = request.FILES.get('file')
        if not file_obj:
            csv_content = request.data.get('csv_content')
            if csv_content:
                file_obj = io.BytesIO(csv_content.encode('utf-8'))
                file_name = "direct_bom_upload.csv"
            else:
                return Response(
                    {"error": "No file uploaded. Please provide a CSV file in 'file' multipart field."},
                    status=status.HTTP_400_BAD_REQUEST
                )
        else:
            file_name = file_obj.name

        if not file_name.lower().endswith('.csv'):
            return Response(
                {"error": "Invalid file format. Only .csv files are supported."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Safely read raw file bytes into memory upfront
        if hasattr(file_obj, 'seek'):
            try:
                file_obj.seek(0)
            except Exception:
                pass
        raw_bytes = file_obj.read() if hasattr(file_obj, 'read') else file_obj
        raw_text = raw_bytes.decode('utf-8-sig', errors='replace') if isinstance(raw_bytes, bytes) else str(raw_bytes)

        # Upload file to MinIO / Local storage
        try:
            minio_path = StorageService.upload_file(raw_bytes, f"bom_uploads/{file_name}")
        except Exception:
            minio_path = f"fallback/{file_name}"

        # Initialize upload batch audit record
        username = request.user.username if request.user and request.user.is_authenticated else 'system'
        batch = UploadBatchService.create_batch(
            upload_type='BOM_UPLOAD',
            user=username,
            file_name=file_name,
            minio_path=minio_path,
            total_rows=0
        )

        try:
            # Parse CSV from memory
            reader = csv.reader(io.StringIO(raw_text))

            rows = [r for r in reader if any(cell.strip() for cell in r)]
            if not rows:
                UploadBatchService.fail(batch, "CSV file is empty.")
                return Response({"error": "CSV file contains no data."}, status=status.HTTP_400_BAD_REQUEST)

            # Map headers
            raw_headers = rows[0]
            header_map = {}
            for idx, h in enumerate(raw_headers):
                clean = h.strip().lower().replace(' ', '_').replace('-', '_').replace('*', '').replace('(', '').replace(')', '')
                if clean in ('fg_code', 'fgcode', 'finished_good_code', 'finished_good', 'fg'):
                    header_map['fg_code'] = idx
                elif clean in ('fg_description', 'fgdescription', 'finished_good_description', 'fg_desc'):
                    header_map['fg_description'] = idx
                elif clean in ('component_code', 'componentcode', 'part_number', 'part_no', 'component'):
                    header_map['component_code'] = idx
                elif clean in ('component_description', 'componentdescription', 'part_description', 'comp_desc'):
                    header_map['component_description'] = idx
                elif clean in ('quantity_per_unit', 'quantity', 'qty', 'qty_per_unit', 'usage'):
                    header_map['qty'] = idx
                elif clean in ('uom', 'unit', 'unit_of_measure'):
                    header_map['uom'] = idx
                elif clean in ('category', 'material_type', 'type'):
                    header_map['category'] = idx

            # Ensure minimal required columns exist
            if 'fg_code' not in header_map or 'component_code' not in header_map or 'qty' not in header_map:
                msg = (
                    "Missing required columns in CSV header. Must contain at least: "
                    "'FG Code', 'Component Code', and 'Quantity Per Unit' (or 'Qty')."
                )
                UploadBatchService.fail(batch, msg)
                return Response({"error": msg}, status=status.HTTP_400_BAD_REQUEST)

            data_rows = rows[1:]
            batch.total_rows = len(data_rows)
            batch.save(update_fields=['total_rows'])

            imported_count = 0
            errors = []
            touched_components = set()
            fgs_seen = set()
            comps_seen = set()

            for row_idx, row in enumerate(data_rows, start=2):
                def get_val(key, default=''):
                    idx = header_map.get(key)
                    if idx is not None and idx < len(row):
                        return row[idx].strip()
                    return default

                raw_fg = get_val('fg_code')
                raw_comp = get_val('component_code')
                raw_qty = get_val('qty')

                if not raw_fg or not raw_comp or not raw_qty:
                    errors.append(f"Row {row_idx}: Missing FG Code, Component Code, or Quantity.")
                    continue

                fg_code = raw_fg.upper()
                comp_code = raw_comp.upper()

                # Validate FG starts with '7'
                if not fg_code.startswith('7'):
                    errors.append(f"Row {row_idx}: FG Code '{fg_code}' must start with '7'.")
                    continue

                # Validate Component does NOT start with '7'
                if comp_code.startswith('7'):
                    errors.append(f"Row {row_idx}: Component Code '{comp_code}' cannot start with '7'.")
                    continue

                # Parse Quantity
                try:
                    qty = float(raw_qty)
                    if qty <= 0:
                        errors.append(f"Row {row_idx}: Quantity must be greater than 0.")
                        continue
                except ValueError:
                    errors.append(f"Row {row_idx}: Invalid quantity value '{raw_qty}'.")
                    continue

                fg_desc = get_val('fg_description', f"Finished Good {fg_code}")
                comp_desc = get_val('component_description', f"Component {comp_code}")
                uom = get_val('uom', 'PC').upper() or 'PC'

                raw_cat = get_val('category', '').upper()
                if raw_cat in ('RM', 'PM'):
                    category = raw_cat
                else:
                    category = MaterialTypeService.derive(comp_code)
                    if category not in ('RM', 'PM'):
                        category = 'RM'

                try:
                    with transaction.atomic():
                        # 1. Upsert FG Header
                        fg_obj, _ = BOMFGHeader.objects.update_or_create(
                            fg_code=fg_code,
                            defaults={
                                'fg_description': fg_desc,
                                'uom': uom,
                                'is_active': True,
                            }
                        )
                        fgs_seen.add(fg_code)

                        # 2. Upsert RM/PM Component Master
                        comp_obj, _ = RMPMComponentMaster.objects.update_or_create(
                            component_code=comp_code,
                            defaults={
                                'component_description': comp_desc,
                                'category': category,
                                'uom': uom,
                                'is_active': True,
                            }
                        )
                        comps_seen.add(comp_code)

                        # 3. Upsert BOM Master Line
                        BOMMaster.objects.update_or_create(
                            fg=fg_obj,
                            component=comp_obj,
                            bom_version='v1',
                            defaults={
                                'qty': qty,
                                'uom': uom,
                                'is_active': True,
                            }
                        )
                        touched_components.add(comp_code)
                        imported_count += 1

                except Exception as ex:
                    errors.append(f"Row {row_idx}: Database error: {str(ex)}")

            # Recalculate common part flags for all touched components
            for code in touched_components:
                try:
                    BOMService.update_common_part_flags(code)
                except Exception:
                    pass

            # Mark batch status
            error_count = len(errors)
            if error_count == 0:
                UploadBatchService.complete(batch, imported_count, 0, {})
            elif imported_count > 0:
                UploadBatchService.complete(batch, imported_count, error_count, {"errors": errors[:50]})
            else:
                UploadBatchService.fail(batch, f"All {error_count} rows failed validation.")

            return Response({
                "batch_id": batch.id,
                "total_rows": len(data_rows),
                "imported_rows": imported_count,
                "error_rows": error_count,
                "errors": errors[:50],
                "created_fgs_count": len(fgs_seen),
                "created_components_count": len(comps_seen),
                "message": (
                    f"Successfully imported {imported_count} BOM line(s). "
                    f"Updated {len(fgs_seen)} Finished Goods and {len(comps_seen)} Components."
                )
            }, status=status.HTTP_200_OK)

        except Exception as ex:
            UploadBatchService.fail(batch, str(ex))
            return Response(
                {"error": f"Failed to process CSV file: {str(ex)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class VendorBuyerCSVUploadView(APIView):
    """
    POST /api/vendor-buyers/upload-csv/
    Accepts CSV file upload for Vendor & Buyer Master.
    Expected CSV columns:
    Vendor Code | Vendor Name | Buyer Name | Buyer Email | Buyer Phone | Category | Lead Time (Days) | City | GST No | Supplied Component Codes
    """
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def post(self, request):
        file_obj = request.FILES.get('file')
        if not file_obj:
            csv_content = request.data.get('csv_content')
            if csv_content:
                file_obj = io.BytesIO(csv_content.encode('utf-8'))
                file_name = "direct_vendor_upload.csv"
            else:
                return Response(
                    {"error": "No file uploaded. Please provide a CSV file in 'file' multipart field."},
                    status=status.HTTP_400_BAD_REQUEST
                )
        else:
            file_name = file_obj.name

        if not file_name.lower().endswith('.csv'):
            return Response(
                {"error": "Invalid file format. Only .csv files are supported."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Safely read raw file bytes into memory upfront
        if hasattr(file_obj, 'seek'):
            try:
                file_obj.seek(0)
            except Exception:
                pass
        raw_bytes = file_obj.read() if hasattr(file_obj, 'read') else file_obj
        raw_text = raw_bytes.decode('utf-8-sig', errors='replace') if isinstance(raw_bytes, bytes) else str(raw_bytes)

        try:
            minio_path = StorageService.upload_file(raw_bytes, f"vendor_uploads/{file_name}")
        except Exception:
            minio_path = f"fallback/{file_name}"

        username = request.user.username if request.user and request.user.is_authenticated else 'system'
        batch = UploadBatchService.create_batch(
            upload_type='OTHER',
            user=username,
            file_name=file_name,
            minio_path=minio_path,
            total_rows=0
        )

        try:
            reader = csv.reader(io.StringIO(raw_text))

            rows = [r for r in reader if any(cell.strip() for cell in r)]
            if not rows:
                UploadBatchService.fail(batch, "CSV file is empty.")
                return Response({"error": "CSV file contains no data."}, status=status.HTTP_400_BAD_REQUEST)

            raw_headers = rows[0]
            header_map = {}
            for idx, h in enumerate(raw_headers):
                clean = h.strip().lower().replace(' ', '_').replace('-', '_').replace('*', '').replace('(', '').replace(')', '')
                if clean in ('vendor_code', 'vendorcode', 'vendor_id', 'supplier_code'):
                    header_map['vendor_code'] = idx
                elif clean in ('vendor_name', 'vendorname', 'supplier_name', 'supplier'):
                    header_map['vendor_name'] = idx
                elif clean in ('buyer_name', 'buyername', 'buyer', 'planner'):
                    header_map['buyer_name'] = idx
                elif clean in ('buyer_email', 'buyeremail', 'email'):
                    header_map['buyer_email'] = idx
                elif clean in ('buyer_phone', 'buyerphone', 'phone', 'mobile'):
                    header_map['buyer_phone'] = idx
                elif clean in ('category', 'material_type', 'type'):
                    header_map['category'] = idx
                elif clean in ('lead_time_days', 'lead_time', 'leadtimedays', 'days'):
                    header_map['lead_time_days'] = idx
                elif clean in ('city', 'location', 'plant_location'):
                    header_map['city'] = idx
                elif clean in ('gst_no', 'gst', 'gstin'):
                    header_map['gst_no'] = idx
                elif clean in ('supplied_components', 'supplied_component_codes', 'components', 'part_codes', 'parts'):
                    header_map['supplied_components'] = idx

            if 'vendor_code' not in header_map or 'vendor_name' not in header_map or 'buyer_name' not in header_map:
                msg = (
                    "Missing required columns in CSV header. Must contain at least: "
                    "'Vendor Code', 'Vendor Name', and 'Buyer Name'."
                )
                UploadBatchService.fail(batch, msg)
                return Response({"error": msg}, status=status.HTTP_400_BAD_REQUEST)

            data_rows = rows[1:]
            batch.total_rows = len(data_rows)
            batch.save(update_fields=['total_rows'])

            imported_count = 0
            errors = []

            for row_idx, row in enumerate(data_rows, start=2):
                def get_val(key, default=''):
                    idx = header_map.get(key)
                    if idx is not None and idx < len(row):
                        return row[idx].strip()
                    return default

                v_code = get_val('vendor_code').upper()
                v_name = get_val('vendor_name')
                b_name = get_val('buyer_name')

                if not v_code or not v_name or not b_name:
                    errors.append(f"Row {row_idx}: Vendor Code, Vendor Name, and Buyer Name are required.")
                    continue

                b_email = get_val('buyer_email')
                b_phone = get_val('buyer_phone')
                city = get_val('city')
                gst_no = get_val('gst_no')
                cat = get_val('category', 'RM').upper()
                category = cat if cat in ('RM', 'PM') else 'RM'

                raw_lt = get_val('lead_time_days', '7')
                try:
                    lead_time = max(1, int(raw_lt))
                except ValueError:
                    lead_time = 7

                # Parse supplied component codes
                raw_parts = get_val('supplied_components', '')
                codes = []
                if raw_parts:
                    for part in raw_parts.replace(';', ',').split(','):
                        clean_part = part.strip().upper()
                        if clean_part and clean_part not in codes:
                            codes.append(clean_part)

                try:
                    with transaction.atomic():
                        vb_obj, _ = VendorBuyerMaster.objects.update_or_create(
                            vendor_code=v_code,
                            defaults={
                                'vendor_name': v_name,
                                'buyer_name': b_name,
                                'buyer_email': b_email,
                                'buyer_phone': b_phone,
                                'category': category,
                                'lead_time_days': lead_time,
                                'city': city,
                                'gst_no': gst_no,
                                'is_active': True,
                            }
                        )

                        # Re-sync junction components
                        if codes:
                            vb_obj.supplied_components_rel.all().delete()
                            junction_objs = []
                            for c in codes:
                                # Ensure component exists in RMPMComponentMaster
                                comp_obj, _ = RMPMComponentMaster.objects.get_or_create(
                                    component_code=c,
                                    defaults={
                                        'component_description': f"Part {c}",
                                        'category': category,
                                        'uom': 'PC',
                                        'is_active': True,
                                    }
                                )
                                junction_objs.append(
                                    VendorSuppliedComponent(vendor_buyer=vb_obj, component=comp_obj)
                                )
                            VendorSuppliedComponent.objects.bulk_create(junction_objs)

                        imported_count += 1

                except Exception as ex:
                    errors.append(f"Row {row_idx}: Database error: {str(ex)}")

            error_count = len(errors)
            if error_count == 0:
                UploadBatchService.complete(batch, imported_count, 0, {})
            elif imported_count > 0:
                UploadBatchService.complete(batch, imported_count, error_count, {"errors": errors[:50]})
            else:
                UploadBatchService.fail(batch, f"All {error_count} rows failed validation.")

            return Response({
                "batch_id": batch.id,
                "total_rows": len(data_rows),
                "imported_rows": imported_count,
                "error_rows": error_count,
                "errors": errors[:50],
                "message": f"Successfully imported {imported_count} Vendor & Buyer relationship(s)."
            }, status=status.HTTP_200_OK)

        except Exception as ex:
            UploadBatchService.fail(batch, str(ex))
            return Response(
                {"error": f"Failed to process Vendor CSV file: {str(ex)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class WeekListCreateView(generics.ListCreateAPIView):
    """
    GET /api/weeks/?month=YYYY-MM
    Lists week definitions, optionally filtered by month or search term.
    Accepts ?paginate=false to return full unpaginated list.

    POST /api/weeks/
    Creates a single week definition.
    Server-side computes days_count, working_days, and week_code.
    """
    serializer_class = WeekDefinitionSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get_queryset(self):
        qs = WeekDefinition.objects.all().order_by('month', 'week_no')
        month = self.request.query_params.get('month')
        if month:
            qs = qs.filter(month=month.strip())

        search = self.request.query_params.get('search')
        if search:
            query = search.strip()
            qs = qs.filter(
                Q(week_code__icontains=query) |
                Q(week_label__icontains=query) |
                Q(month__icontains=query)
            )
        return qs

    def paginate_queryset(self, queryset):
        if self.request.query_params.get('paginate', '').lower() in ('false', '0', 'no'):
            return None
        return super().paginate_queryset(queryset)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            instance = serializer.save()
            WeekService.calculate_and_store_month_weights(instance.month)
            instance.refresh_from_db()
            ProrateService.cascade_reprorate(instance.month)
        output_serializer = self.get_serializer(instance)
        headers = self.get_success_headers(output_serializer.data)
        return Response(output_serializer.data, status=status.HTTP_201_CREATED, headers=headers)


class WeekDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET /api/weeks/{id}/
    Retrieves a single week definition by ID or week_code.

    PATCH /api/weeks/{id}/
    Updates fields (start_date, end_date, holiday_days, week_label).
    Recalculates days_count and working_days.
    Cascades reproration across all monthly_plan rows for the affected month.

    DELETE /api/weeks/{id}/
    Deletes the week definition and cascades reproration. Blocks if referenced by plan freeze or review actions.
    """
    queryset = WeekDefinition.objects.all()
    serializer_class = WeekDefinitionSerializer
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get_object(self):
        lookup = self.kwargs.get('pk')
        if lookup and not str(lookup).isdigit():
            try:
                return WeekDefinition.objects.get(week_code=lookup)
            except WeekDefinition.DoesNotExist:
                pass
        return super().get_object()

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            self.perform_update(serializer)
            WeekService.calculate_and_store_month_weights(instance.month)
            instance.refresh_from_db()
            cascade_count = ProrateService.cascade_reprorate(instance.month)
        output_serializer = self.get_serializer(instance)
        data = output_serializer.data
        data['cascade_plans_updated'] = cascade_count
        return Response(data, status=status.HTTP_200_OK)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        # Check foreign references
        try:
            if FGPlanFreeze.objects.filter(week_id=instance.week_code).exists():
                return Response(
                    {"error": f"Cannot delete week '{instance.week_code}': referenced by plan freeze records."},
                    status=status.HTTP_409_CONFLICT
                )
            if MondayReviewAction.objects.filter(week_id=instance.week_code).exists():
                return Response(
                    {"error": f"Cannot delete week '{instance.week_code}': referenced by Monday Review action items."},
                    status=status.HTTP_409_CONFLICT
                )
        except Exception as e:
            logger.warning(f"Error checking freeze/review references on week delete: {e}")
        with transaction.atomic():
            month = instance.month
            instance.delete()
            WeekService.calculate_and_store_month_weights(month)
            cascade_count = ProrateService.cascade_reprorate(month)
        return Response({
            "deleted": True,
            "cascade_plans_updated": cascade_count
        }, status=status.HTTP_200_OK)


class WeekAutoGenerateView(APIView):
    """
    POST /api/weeks/auto-generate/
    Auto-generates standard 4-week split for a given month or entire year.
    Payload:
    {
        "month": "2026-08",          // Target month (YYYY-MM)
        "year": "2026",               // Or target year (YYYY) for all 12 months
        "overwrite": true             // Replace existing definitions (default true)
    }
    """
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def post(self, request):
        month = request.data.get('month')
        year = request.data.get('year')
        overwrite = request.data.get('overwrite', True)
        if isinstance(overwrite, str):
            overwrite = overwrite.lower() in ('true', '1', 'yes')

        if month and year:
            return Response(
                {"error": "Provide either 'month' or 'year', not both."},
                status=status.HTTP_400_BAD_REQUEST
            )

        if month:
            clean_month = month.strip()
            parts = clean_month.split('-')
            if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
                return Response(
                    {"error": f"Invalid month format '{clean_month}'. Expected YYYY-MM."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Check cascade blocks if overwrite
            if overwrite:
                existing_codes = list(WeekDefinition.objects.filter(month=clean_month).values_list('week_code', flat=True))
                if existing_codes:
                    if FGPlanFreeze.objects.filter(week_id__in=existing_codes).exists() or \
                       MondayReviewAction.objects.filter(week_id__in=existing_codes).exists():
                        return Response(
                            {"error": f"Cannot overwrite weeks for month {clean_month} because existing weeks are referenced by plan freeze or Monday Review actions."},
                            status=status.HTTP_409_CONFLICT
                        )

            try:
                week_data_list = WeekService.generate_standard_4_week_split(clean_month)
                created_objs = []
                with transaction.atomic():
                    if overwrite:
                        WeekDefinition.objects.filter(month=clean_month).delete()

                    for w_data in week_data_list:
                        week_obj, _ = WeekDefinition.objects.update_or_create(
                            month=w_data['month'],
                            week_no=w_data['week_no'],
                            defaults={
                                'week_code': w_data['week_code'],
                                'week_label': w_data['week_label'],
                                'start_date': w_data['start_date'],
                                'end_date': w_data['end_date'],
                                'days_count': w_data['days_count'],
                                'holiday_days': w_data['holiday_days'],
                                'working_days': w_data['working_days'],
                                'month_weight': w_data.get('month_weight', 0.00),
                            }
                        )
                        created_objs.append(week_obj)

                    WeekService.calculate_and_store_month_weights(clean_month)
                    ProrateService.cascade_reprorate(clean_month)
                    created_objs = list(WeekDefinition.objects.filter(month=clean_month).order_by('week_no'))

                serializer = WeekDefinitionSerializer(created_objs, many=True)
                return Response({
                    "message": f"Successfully generated 4 week definition(s) for {clean_month}.",
                    "count": len(created_objs),
                    "results": serializer.data
                }, status=status.HTTP_200_OK)
            except Exception as ex:
                return Response({"error": f"Failed to auto-generate weeks: {str(ex)}"}, status=status.HTTP_400_BAD_REQUEST)

        elif year:
            try:
                year_int = int(year)
            except (ValueError, TypeError):
                return Response({"error": f"Invalid year '{year}'."}, status=status.HTTP_400_BAD_REQUEST)

            if overwrite:
                year_codes = list(WeekDefinition.objects.filter(month__startswith=f"{year_int:04d}-").values_list('week_code', flat=True))
                if year_codes:
                    if FGPlanFreeze.objects.filter(week_id__in=year_codes).exists() or \
                       MondayReviewAction.objects.filter(week_id__in=year_codes).exists():
                        return Response(
                            {"error": f"Cannot overwrite weeks for year {year_int} because existing weeks are referenced by plan freeze or Monday Review actions."},
                            status=status.HTTP_409_CONFLICT
                        )

            try:
                full_year_data = WeekService.generate_full_year(year_int)
                created_objs = []
                with transaction.atomic():
                    if overwrite:
                        WeekDefinition.objects.filter(month__startswith=f"{year_int:04d}-").delete()

                    for w_data in full_year_data:
                        week_obj, _ = WeekDefinition.objects.update_or_create(
                            month=w_data['month'],
                            week_no=w_data['week_no'],
                            defaults={
                                'week_code': w_data['week_code'],
                                'week_label': w_data['week_label'],
                                'start_date': w_data['start_date'],
                                'end_date': w_data['end_date'],
                                'days_count': w_data['days_count'],
                                'holiday_days': w_data['holiday_days'],
                                'working_days': w_data['working_days'],
                                'month_weight': w_data.get('month_weight', 0.00),
                            }
                        )
                        created_objs.append(week_obj)

                    for m in range(1, 13):
                        month_str = f"{year_int:04d}-{m:02d}"
                        WeekService.calculate_and_store_month_weights(month_str)
                        ProrateService.cascade_reprorate(month_str)
                    created_objs = list(WeekDefinition.objects.filter(month__startswith=f"{year_int:04d}-").order_by('month', 'week_no'))

                serializer = WeekDefinitionSerializer(created_objs, many=True)
                return Response({
                    "message": f"Successfully generated {len(created_objs)} week definition(s) for year {year_int}.",
                    "count": len(created_objs),
                    "results": serializer.data
                }, status=status.HTTP_200_OK)
            except Exception as ex:
                return Response({"error": f"Failed to auto-generate full year: {str(ex)}"}, status=status.HTTP_400_BAD_REQUEST)

        else:
            return Response(
                {"error": "Please provide either 'month' (YYYY-MM) or 'year' (YYYY)."},
                status=status.HTTP_400_BAD_REQUEST
            )


class WeekCSVExportView(APIView):
    """
    GET /api/exports/weeks-csv/?month=YYYY-MM
    Returns week definitions as a downloadable CSV.
    """
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get(self, request):
        month = request.query_params.get('month')
        qs = WeekDefinition.objects.all().order_by('month', 'week_no')
        if month:
            qs = qs.filter(month=month.strip())

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['Month', 'Week No', 'Week Code', 'Week Label', 'Start Date', 'End Date', 'Days Count', 'Holiday Days', 'Working Days', 'Month Weight %'])
        for w in qs:
            writer.writerow([
                w.month,
                w.week_no,
                w.week_code,
                w.week_label,
                w.start_date,
                w.end_date,
                w.days_count,
                w.holiday_days,
                w.working_days,
                float(w.month_weight)
            ])

        output.seek(0)
        filename = f"Weeks_{month.strip()}.csv" if month else "Weeks_All.csv"
        response = StreamingHttpResponse(iter([output.getvalue()]), content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


class MonthlyPlanListCreateView(generics.ListCreateAPIView):
    """
    GET /api/monthly-plans/?month=YYYY-MM&search=...
    List monthly plans with optional month filter, search filter, and pagination.

    POST /api/monthly-plans/
    Create a new monthly plan. Validates fg_code starts with '7' and uniqueness on (fg, month).
    Auto-computes weekly_breakdown via ProrateService.prorate() based on working days.
    """
    queryset = MonthlyPlan.objects.select_related('fg').all()
    serializer_class = MonthlyPlanSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get_queryset(self):
        qs = MonthlyPlan.objects.select_related('fg').all()
        month = self.request.query_params.get('month')
        if month:
            qs = qs.filter(month=month.strip())

        search = self.request.query_params.get('search')
        if search:
            s = search.strip()
            qs = qs.filter(
                Q(fg__fg_code__icontains=s) |
                Q(fg__fg_description__icontains=s) |
                Q(customer_name__icontains=s)
            )

        return qs.order_by('fg__fg_code')

    def paginate_queryset(self, queryset):
        if self.request.query_params.get('paginate', '').lower() in ('false', '0', 'no'):
            return None
        return super().paginate_queryset(queryset)

    def create(self, request, *args, **kwargs):
        fg_code = str(request.data.get('fg_code', '')).strip()
        month = str(request.data.get('month', '')).strip()

        # Check uniqueness constraint: 409 Conflict if duplicate
        if fg_code and month and MonthlyPlan.objects.filter(fg__fg_code=fg_code, month=month).exists():
            return Response(
                {"error": f"A monthly plan for Finished Good '{fg_code}' in month '{month}' already exists."},
                status=status.HTTP_409_CONFLICT
            )

        return super().create(request, *args, **kwargs)


class MonthlyPlanDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET /api/monthly-plans/{id}/
    Retrieve individual monthly plan.

    PATCH /api/monthly-plans/{id}/
    Update monthly plan target, customer, or notes. Recalculates weekly_breakdown if target changes.

    DELETE /api/monthly-plans/{id}/
    Hard delete of monthly plan. Blocked if frozen.
    """
    queryset = MonthlyPlan.objects.select_related('fg').all()
    serializer_class = MonthlyPlanSerializer
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def update(self, request, *args, **kwargs):
        # Ignore client-submitted weekly_breakdown (always computed server-side)
        if 'weekly_breakdown' in request.data:
            request.data.pop('weekly_breakdown', None)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        fg_code = instance.fg_id
        month = instance.month

        try:
            # Check if fg_plan_freeze rows exist for (fg_code, month)
            freeze_rows = FGPlanFreeze.objects.filter(fg_id=fg_code, month=month)
            if freeze_rows.filter(status='FROZEN').exists():
                return Response(
                    {"error": "Cannot delete a frozen plan."},
                    status=status.HTTP_409_CONFLICT
                )

            with transaction.atomic():
                # If DRAFT or REVIEWED, delete freeze records first
                freeze_rows.delete()
                instance.delete()
        except Exception as e:
            if hasattr(e, 'status_code') and e.status_code == 409:
                raise
            logger.warning(f"Error during freeze check or cascade on monthly plan delete: {e}")
            instance.delete()

        return Response({
            "deleted": True,
            "message": f"Monthly Plan for {fg_code} ({month}) deleted successfully."
        }, status=status.HTTP_200_OK)


class MonthlyPlanRecalculateView(APIView):
    """
    POST /api/monthly-plans/recalculate/
    Recalculates weekly breakdown proration for all monthly plans of a given month.
    Triggered by 'Recalculate Weeks' button.
    """
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def post(self, request):
        month = request.data.get('month') or request.query_params.get('month')
        if not month:
            return Response({"error": "Month parameter is required."}, status=status.HTTP_400_BAD_REQUEST)

        clean_month = month.strip()
        count = ProrateService.cascade_reprorate(clean_month)
        plans = MonthlyPlan.objects.filter(month=clean_month).select_related('fg').order_by('fg__fg_code')
        serializer = MonthlyPlanSerializer(plans, many=True)
        return Response({
            "message": f"Successfully recalculated proration for {count} plan(s) in {clean_month}.",
            "month": clean_month,
            "cascade_plans_updated": count,
            "results": serializer.data
        }, status=status.HTTP_200_OK)


class MonthlyPlanCSVExportView(APIView):
    """
    GET /api/exports/monthly-plan-csv/?month=YYYY-MM
    Returns all monthly plans for the month as a downloadable CSV.
    Columns: FG Code, FG Description, Customer Name, Month, Monthly Target, W1 (...), W2 (...), ..., UOM
    """
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get(self, request):
        month = request.query_params.get('month')
        if not month:
            return Response({"error": "Query param 'month' (YYYY-MM) is required."}, status=status.HTTP_400_BAD_REQUEST)

        clean_month = month.strip()
        plans = list(MonthlyPlan.objects.filter(month=clean_month).select_related('fg').order_by('fg__fg_code'))
        weeks = list(WeekDefinition.objects.filter(month=clean_month).order_by('week_no'))

        output = io.StringIO()
        writer = csv.writer(output)

        headers = ['FG Code', 'FG Description', 'Customer Name', 'Month', 'Monthly Target']
        for w in weeks:
            headers.append(f"{w.week_label} (Target)")
        headers.append('UOM')
        headers.append('Notes')
        writer.writerow(headers)

        for p in plans:
            breakdown = p.weekly_breakdown or {}
            row = [
                p.fg_id,
                p.fg.fg_description if p.fg else '',
                p.customer_name or '',
                p.month,
                p.monthly_target,
            ]
            for w in weeks:
                row.append(breakdown.get(w.week_code, 0))
            row.append(p.uom)
            row.append(p.custom_notes or '')
            writer.writerow(row)

        output.seek(0)
        response = StreamingHttpResponse(iter([output.getvalue()]), content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="Monthly_Plan_{clean_month}.csv"'
        return response


class UploadBatchDetailView(generics.RetrieveAPIView):
    """
    GET /api/uploads/batches/{id}/
    Returns batch status, row counts, and per-row error details.
    """
    queryset = UploadBatch.objects.all()
    serializer_class = UploadBatchSerializer
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]


class MonthlyPlanBulkUploadView(APIView):
    """
    POST /api/uploads/monthly-plan/
    Bulk uploads monthly plan via CSV, Excel (.xlsx), or pasted text.
    Payload:
    - Multipart file: 'file'
    - Or JSON / Form field: 'csv_content' / 'pasted_text'
    - Target month: 'month' (e.g. '2026-08' - required in form data or query param)
    """
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def post(self, request):
        month = request.data.get('month') or request.query_params.get('month')
        if not month:
            return Response(
                {"error": "Target 'month' parameter (format: YYYY-MM) is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        clean_month = str(month).strip()
        parts = clean_month.split('-')
        if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
            return Response(
                {"error": f"Invalid month format '{clean_month}'. Expected YYYY-MM (e.g. '2026-08')."},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if week definitions exist for this month
        weeks = list(WeekDefinition.objects.filter(month=clean_month).order_by('week_no'))
        if not weeks:
            return Response(
                {
                    "error": f"No week definitions found for {clean_month}. Define weeks first."
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        file_obj = request.FILES.get('file')
        if not file_obj:
            raw_content = request.data.get('csv_content') or request.data.get('pasted_text')
            if raw_content:
                file_obj = raw_content
                file_name = f"monthly_plan_{clean_month}.csv"
            else:
                return Response(
                    {"error": "No file or text uploaded. Provide a file in 'file' field or text in 'csv_content' / 'pasted_text'."},
                    status=status.HTTP_400_BAD_REQUEST
                )
        else:
            file_name = file_obj.name

        username = request.user.username if request.user and request.user.is_authenticated else 'system'
        result = MonthlyPlanUploadService.upload(
            month=clean_month,
            file_or_text=file_obj,
            uploaded_by=username,
            file_name=file_name
        )

        status_code = status.HTTP_200_OK if result.get('imported_rows', 0) > 0 or result.get('error_rows', 0) == 0 else status.HTTP_400_BAD_REQUEST
        return Response(result, status=status_code)


# ============================================================================
# Step 17 — API: MB51 CRUD + Bulk Upload + CSV Export
# ============================================================================

class MB51ListCreateView(generics.ListCreateAPIView):
    """
    GET /api/mb51/
    Filters:
    - ?month=YYYY-MM
    - ?week_code=w-YYYY-MM-0N
    - ?movement_type=101|601
    - ?part_number=...
    - ?classification=FG_PRODUCTION_RECEIPT|RMPM_RECEIPT|FG_DISPATCH|OTHER
    - ?date_from=YYYY-MM-DD
    - ?date_to=YYYY-MM-DD
    - ?search=...
    - ?paginate=false

    POST /api/mb51/
    Single create endpoint.
    Validates:
    - quantity > 0
    - movement_type IN ('101', '601')
    - Auto-calls classify + map_to_week
    """
    serializer_class = MB51TransactionSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get_queryset(self):
        qs = MB51Transaction.objects.all().select_related('week', 'upload_batch').order_by('-posting_date', '-id')

        month = self.request.query_params.get('month')
        if month:
            clean_month = month.strip()
            qs = qs.filter(Q(posting_date__startswith=clean_month) | Q(week__month=clean_month))

        week_code = self.request.query_params.get('week_code')
        if week_code:
            qs = qs.filter(week_id=week_code.strip())

        movement_type = self.request.query_params.get('movement_type')
        if movement_type:
            qs = qs.filter(movement_type=movement_type.strip())

        part_number = self.request.query_params.get('part_number')
        if part_number:
            qs = qs.filter(part_number__icontains=part_number.strip())

        classification = self.request.query_params.get('classification')
        if classification:
            qs = qs.filter(classification=classification.strip().upper())

        date_from = self.request.query_params.get('date_from')
        if date_from:
            qs = qs.filter(posting_date__gte=date_from.strip())

        date_to = self.request.query_params.get('date_to')
        if date_to:
            qs = qs.filter(posting_date__lte=date_to.strip())

        search = self.request.query_params.get('search')
        if search:
            query = search.strip()
            qs = qs.filter(
                Q(material_document__icontains=query) |
                Q(part_number__icontains=query) |
                Q(material_description__icontains=query) |
                Q(vendor_customer__icontains=query) |
                Q(po_order_number__icontains=query)
            )

        return qs

    def list(self, request, *args, **kwargs):
        paginate = request.query_params.get('paginate', 'true').lower()
        if paginate in ('false', '0', 'no'):
            queryset = self.filter_queryset(self.get_queryset())
            serializer = self.get_serializer(queryset, many=True)
            return Response(serializer.data)
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        mvt = str(request.data.get('movement_type') or request.data.get('movementType') or '').strip()
        if mvt not in ('101', '601'):
            return Response(
                {"movement_type": ["Single MB51 transaction creation only supports movement types '101' and '601'."]},
                status=status.HTTP_400_BAD_REQUEST
            )
        return super().create(request, *args, **kwargs)


class MB51DetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET /api/mb51/{id}/
    PATCH /api/mb51/{id}/
    DELETE /api/mb51/{id}/ — hard delete
    """
    queryset = MB51Transaction.objects.all()
    serializer_class = MB51TransactionSerializer
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        doc_id = instance.material_document
        self.perform_destroy(instance)
        return Response(
            {"message": f"MB51 material document '{doc_id}' deleted successfully."},
            status=status.HTTP_200_OK
        )


class MB51BulkUploadView(APIView):
    """
    POST /api/uploads/mb51/
    Accepts CSV / Excel / pasted text for MB51 material movement report:
    1. Uploads file to MinIO storage (with local fallback)
    2. Parses content with MB51Parser
    3. Auto-computes classification and week mapping per row
    4. Flags duplicate material_document values (warns, does not block)
    5. Bulk inserts transactions
    6. Completes UploadBatch audit log
    """
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        file_obj = request.FILES.get('file')
        csv_text = request.data.get('csv_text') or request.data.get('content')
        month = request.query_params.get('month') or request.data.get('month')

        if not file_obj and not csv_text:
            return Response(
                {"error": "Please provide a file (.xlsx, .csv) or pasted text in 'csv_text'."},
                status=status.HTTP_400_BAD_REQUEST
            )

        file_name = file_obj.name if file_obj else f"mb51_pasted_{timezone.now().strftime('%Y%m%d_%H%M%S')}.csv"
        user_name = request.user.username if (request.user and request.user.is_authenticated) else 'system'

        # Safely read raw file bytes into memory upfront to prevent stream exhaustion/closure
        raw_bytes = None
        if file_obj:
            if hasattr(file_obj, 'seek'):
                try:
                    file_obj.seek(0)
                except Exception:
                    pass
            raw_bytes = file_obj.read() if hasattr(file_obj, 'read') else file_obj

        # 1. Create upload batch
        batch = UploadBatchService.create_batch(
            upload_type='MB51_REPORT',
            user=user_name,
            file_name=file_name
        )

        # 2. Store file in MinIO / fallback
        try:
            storage_path = f"mb51_reports/{file_name}"
            if raw_bytes is not None:
                minio_url = StorageService.upload_file(raw_bytes, path=storage_path)
            else:
                text_bytes = csv_text.encode('utf-8')
                minio_url = StorageService.upload_file(text_bytes, path=storage_path)
            batch.minio_path = minio_url
            batch.save(update_fields=['minio_path'])
        except Exception as e:
            logger.warning(f"Storage upload failed for batch #{batch.id}, continuing: {e}")

        # 3. Fetch weeks
        if month:
            clean_month = month.strip()
            weeks = list(WeekDefinition.objects.filter(month=clean_month).order_by('week_no'))
        else:
            weeks = list(WeekDefinition.objects.all().order_by('start_date'))

        # 4. Parse content
        content_to_parse = raw_bytes if raw_bytes is not None else csv_text
        parse_result = MB51Parser.parse(content_to_parse, weeks=weeks)

        valid_rows = parse_result.get('valid_rows', [])
        error_rows = parse_result.get('error_rows', [])
        total_rows = parse_result.get('total_rows', len(valid_rows) + len(error_rows))

        batch.total_rows = total_rows
        batch.save(update_fields=['total_rows'])

        if not valid_rows:
            UploadBatchService.fail(
                batch,
                error=f"No valid MB51 rows found. {len(error_rows)} rows had errors."
            )
            return Response(
                {
                    "error": "No valid MB51 transaction rows could be parsed.",
                    "batch_id": batch.id,
                    "error_rows": error_rows,
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        # 5. Check duplicate material_document values (warn, do not block)
        doc_counts = Counter(r['material_document'] for r in valid_rows)
        duplicate_docs = [doc for doc, count in doc_counts.items() if count > 1]

        existing_docs = set(
            MB51Transaction.objects.filter(
                material_document__in=list(doc_counts.keys())
            ).values_list('material_document', flat=True)
        )

        warnings = []
        for doc in duplicate_docs:
            warnings.append(f"Material document '{doc}' appears {doc_counts[doc]} times in uploaded content (imported).")
        for doc in existing_docs:
            if doc not in duplicate_docs:
                warnings.append(f"Material document '{doc}' already exists in database (imported).")

        # 6. Bulk create transactions
        instances = []
        for row in valid_rows:
            cls_code = MB51ClassificationService.classify(row['movement_type'], row['part_number'])
            mapped_week = WeekMappingService.map_to_week(row['posting_date'], weeks)
            instances.append(
                MB51Transaction(
                    material_document=row['material_document'],
                    posting_date=row['posting_date'],
                    movement_type=row['movement_type'],
                    part_number=row['part_number'],
                    material_description=row['material_description'],
                    quantity=row['quantity'],
                    uom=row['uom'],
                    storage_location=row['storage_location'],
                    plant=row['plant'],
                    vendor_customer=row['vendor_customer'],
                    po_order_number=row['po_order_number'],
                    classification=cls_code,
                    week_id=mapped_week,
                    upload_batch=batch,
                )
            )

        try:
            with transaction.atomic():
                MB51Transaction.objects.bulk_create(instances, batch_size=500)

            UploadBatchService.complete(
                batch,
                imported_rows=len(instances),
                error_rows=len(error_rows),
                error_detail={
                    "warnings": warnings,
                    "skipped_rows": error_rows
                } if (warnings or error_rows) else {}
            )

            return Response(
                {
                    "message": f"Successfully processed {len(instances)} MB51 transaction records.",
                    "batch_id": batch.id,
                    "total_rows": total_rows,
                    "imported_rows": len(instances),
                    "error_rows": len(error_rows),
                    "warnings": warnings,
                    "skipped_rows": error_rows,
                },
                status=status.HTTP_201_CREATED
            )
        except Exception as exc:
            logger.error(f"Bulk insert failed for MB51 batch {batch.id}: {exc}")
            UploadBatchService.fail(batch, f"Database insert failed: {str(exc)}")
            return Response(
                {"error": f"Failed to save MB51 records: {str(exc)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class Echo:
    """An object that implements just the write method of the file-like interface."""
    def write(self, value):
        return value


class MB51ExportCSVView(APIView):
    """
    GET /api/exports/mb51-csv/?month=&week_code=&classification=
    Streams filtered MB51 transactions as CSV using Django StreamingHttpResponse.
    """
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        qs = MB51Transaction.objects.all().order_by('-posting_date', '-id')

        month = request.query_params.get('month')
        if month:
            clean_month = month.strip()
            qs = qs.filter(Q(posting_date__startswith=clean_month) | Q(week__month=clean_month))

        week_code = request.query_params.get('week_code')
        if week_code:
            qs = qs.filter(week_id=week_code.strip())

        classification = request.query_params.get('classification')
        if classification:
            qs = qs.filter(classification=classification.strip().upper())

        part_number = request.query_params.get('part_number')
        if part_number:
            qs = qs.filter(part_number__icontains=part_number.strip())

        movement_type = request.query_params.get('movement_type')
        if movement_type:
            qs = qs.filter(movement_type=movement_type.strip())

        pseudo_buffer = Echo()
        writer = csv.writer(pseudo_buffer)

        headers = [
            'Material Document',
            'Posting Date',
            'Movement Type',
            'Part Number',
            'Material Description',
            'Quantity',
            'UOM',
            'Storage Location',
            'Plant',
            'Vendor / Customer',
            'PO / Order Number',
            'Classification',
            'Week Code'
        ]

        def row_generator():
            yield writer.writerow(headers)
            for item in qs.iterator(chunk_size=1000):
                yield writer.writerow([
                    item.material_document,
                    item.posting_date.isoformat() if item.posting_date else '',
                    item.movement_type,
                    item.part_number,
                    item.material_description,
                    float(item.quantity),
                    item.uom,
                    item.storage_location,
                    item.plant,
                    item.vendor_customer,
                    item.po_order_number,
                    item.classification,
                    item.week_code or ''
                ])

        timestamp = timezone.now().strftime('%Y%m%d_%H%M%S')
        response = StreamingHttpResponse(row_generator(), content_type="text/csv")
        response['Content-Disposition'] = f'attachment; filename="mb51_transactions_{timestamp}.csv"'
        return response


# ============================================================================
# Step 19 — API: Stock Report CRUD + Bulk Upload + CSV Export
# ============================================================================

class StockListCreateView(generics.ListCreateAPIView):
    """
    GET /api/stock/
    Filters:
    - ?material_type=FG|RM|PM
    - ?part_number=...
    - ?storage_location=SL01
    - ?search=... (searches part_number, material_description, storage_location)
    - ?below_safety_stock=true (only records where unrestricted_stock < safety_stock)
    - ?paginate=false

    POST /api/stock/
    Single create endpoint.
    Validates:
    - part_number not blank
    - unrestricted_stock >= 0
    - Computes material_type via MaterialTypeService.derive(part_number)
    - Checks (part_number, storage_location) unique
    """
    serializer_class = StockReportSerializer
    pagination_class = StandardResultsSetPagination
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get_queryset(self):
        qs = StockReport.objects.all().order_by('part_number', 'storage_location')

        material_type = self.request.query_params.get('material_type')
        if material_type:
            qs = qs.filter(material_type=material_type.strip().upper())

        part_number = self.request.query_params.get('part_number')
        if part_number:
            qs = qs.filter(part_number__icontains=part_number.strip())

        storage_location = self.request.query_params.get('storage_location')
        if storage_location:
            qs = qs.filter(storage_location__iexact=storage_location.strip())

        below_safety = self.request.query_params.get('below_safety_stock')
        if below_safety and below_safety.lower() in ('true', '1', 'yes'):
            from django.db.models import F
            qs = qs.filter(unrestricted_stock__lt=F('safety_stock'))

        search = self.request.query_params.get('search')
        if search:
            query = search.strip()
            qs = qs.filter(
                Q(part_number__icontains=query) |
                Q(material_description__icontains=query) |
                Q(storage_location__icontains=query)
            )

        return qs

    def list(self, request, *args, **kwargs):
        paginate = request.query_params.get('paginate', 'true').lower()
        if paginate in ('false', '0', 'no'):
            queryset = self.filter_queryset(self.get_queryset())
            serializer = self.get_serializer(queryset, many=True)
            return Response(serializer.data)
        return super().list(request, *args, **kwargs)


class StockDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET /api/stock/{id}/
    PATCH /api/stock/{id}/ — re-derives material_type if part_number changes
    DELETE /api/stock/{id}/ — hard delete
    """
    queryset = StockReport.objects.all()
    serializer_class = StockReportSerializer
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        old_part_number = instance.part_number

        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        data = serializer.data
        new_part_number = serializer.instance.part_number
        if old_part_number != new_part_number:
            data['info'] = (
                f"Part number changed from '{old_part_number}' to '{new_part_number}'. "
                f"Material type re-derived as '{serializer.instance.material_type}'."
            )

        return Response(data)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        part = instance.part_number
        sloc = instance.storage_location
        self.perform_destroy(instance)
        return Response(
            {"message": f"Stock record for '{part}' in '{sloc}' deleted successfully."},
            status=status.HTTP_200_OK
        )


class StockBulkUploadView(APIView):
    """
    POST /api/uploads/stock-report/
    Accepts CSV / Excel / pasted text for SAP MB52 Stock Report:
    1. Uploads file to MinIO storage (with local fallback)
    2. Parses content with StockParser
    3. Derives material_type per row via MaterialTypeService
    4. Upserts on (part_number, storage_location) when mode=replace (default)
    5. INSERT when mode=append
    6. Completes UploadBatch audit log
    """
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        file_obj = request.FILES.get('file')
        csv_text = request.data.get('csv_text') or request.data.get('content')
        mode = (request.data.get('mode') or request.query_params.get('mode') or 'replace').strip().lower()

        if not file_obj and not csv_text:
            return Response(
                {"error": "Please provide a file (.xlsx, .csv) or pasted text in 'csv_text'."},
                status=status.HTTP_400_BAD_REQUEST
            )

        file_name = file_obj.name if file_obj else f"stock_pasted_{timezone.now().strftime('%Y%m%d_%H%M%S')}.csv"
        user_name = request.user.username if (request.user and request.user.is_authenticated) else 'system'

        # Safely read raw file bytes into memory upfront to prevent stream exhaustion/closure
        raw_bytes = None
        if file_obj:
            if hasattr(file_obj, 'seek'):
                try:
                    file_obj.seek(0)
                except Exception:
                    pass
            raw_bytes = file_obj.read() if hasattr(file_obj, 'read') else file_obj

        # 1. Create upload batch
        batch = UploadBatchService.create_batch(
            upload_type='STOCK_REPORT',
            user=user_name,
            file_name=file_name
        )

        # 2. Store file in MinIO / fallback
        try:
            storage_path = f"stock_reports/{file_name}"
            if raw_bytes is not None:
                minio_url = StorageService.upload_file(raw_bytes, path=storage_path)
            else:
                text_bytes = csv_text.encode('utf-8')
                minio_url = StorageService.upload_file(text_bytes, path=storage_path)
            batch.minio_path = minio_url
            batch.save(update_fields=['minio_path'])
        except Exception as e:
            logger.warning(f"Storage upload failed for stock batch #{batch.id}, continuing: {e}")

        # 3. Parse content
        content_to_parse = raw_bytes if raw_bytes is not None else csv_text
        parse_result = StockParser.parse(content_to_parse)

        valid_rows = parse_result.get('valid_rows', [])
        error_rows = parse_result.get('error_rows', [])
        total_rows = parse_result.get('total_rows', len(valid_rows) + len(error_rows))

        batch.total_rows = total_rows
        batch.save(update_fields=['total_rows'])

        if not valid_rows:
            UploadBatchService.fail(
                batch,
                error=f"No valid stock rows found. {len(error_rows)} rows had errors."
            )
            return Response(
                {
                    "error": "No valid stock report rows could be parsed.",
                    "batch_id": batch.id,
                    "error_rows": error_rows,
                },
                status=status.HTTP_400_BAD_REQUEST
            )

        # 4. Process rows — upsert or insert based on mode
        imported_count = 0
        warnings = []

        try:
            with transaction.atomic():
                for row in valid_rows:
                    mat_type = MaterialTypeService.derive(row['part_number'])

                    if mode == 'replace':
                        # Upsert on (part_number, storage_location)
                        StockReport.objects.update_or_create(
                            part_number=row['part_number'],
                            storage_location=row['storage_location'],
                            defaults={
                                'material_description': row['material_description'],
                                'material_type': mat_type,
                                'unrestricted_stock': row['unrestricted_stock'],
                                'in_quality_insp': row['in_quality_insp'],
                                'blocked': row['blocked'],
                                'safety_stock': row['safety_stock'],
                                'uom': row['uom'],
                                'plant': row['plant'],
                                'upload_batch': batch,
                            }
                        )
                    else:
                        # Append mode — always insert, check for duplicates
                        existing = StockReport.objects.filter(
                            part_number=row['part_number'],
                            storage_location=row['storage_location']
                        ).exists()
                        if existing:
                            warnings.append(
                                f"Part '{row['part_number']}' at '{row['storage_location']}' "
                                f"already exists (appended duplicate)."
                            )
                        StockReport.objects.create(
                            part_number=row['part_number'],
                            material_description=row['material_description'],
                            material_type=mat_type,
                            unrestricted_stock=row['unrestricted_stock'],
                            in_quality_insp=row['in_quality_insp'],
                            blocked=row['blocked'],
                            safety_stock=row['safety_stock'],
                            uom=row['uom'],
                            storage_location=row['storage_location'],
                            plant=row['plant'],
                            upload_batch=batch,
                        )

                    imported_count += 1

            UploadBatchService.complete(
                batch,
                imported_rows=imported_count,
                error_rows=len(error_rows),
                error_detail={
                    "warnings": warnings,
                    "skipped_rows": error_rows
                } if (warnings or error_rows) else {}
            )

            return Response(
                {
                    "message": f"Successfully processed {imported_count} stock report record(s) (mode: {mode}).",
                    "batch_id": batch.id,
                    "total_rows": total_rows,
                    "imported_rows": imported_count,
                    "error_rows": len(error_rows),
                    "mode": mode,
                    "warnings": warnings,
                    "skipped_rows": error_rows,
                },
                status=status.HTTP_201_CREATED
            )
        except Exception as exc:
            logger.error(f"Stock report bulk insert failed for batch {batch.id}: {exc}")
            UploadBatchService.fail(batch, f"Database insert failed: {str(exc)}")
            return Response(
                {"error": f"Failed to save stock records: {str(exc)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class StockExportCSVView(APIView):
    """
    GET /api/exports/stock-csv/?material_type=FG|RM|PM
    Streams filtered stock report as CSV using Django StreamingHttpResponse.
    """
    permission_classes = [AllowAny] if settings.DEBUG else [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        qs = StockReport.objects.all().order_by('part_number', 'storage_location')

        material_type = request.query_params.get('material_type')
        if material_type:
            qs = qs.filter(material_type=material_type.strip().upper())

        part_number = request.query_params.get('part_number')
        if part_number:
            qs = qs.filter(part_number__icontains=part_number.strip())

        storage_location = request.query_params.get('storage_location')
        if storage_location:
            qs = qs.filter(storage_location__iexact=storage_location.strip())

        below_safety = request.query_params.get('below_safety_stock')
        if below_safety and below_safety.lower() in ('true', '1', 'yes'):
            from django.db.models import F
            qs = qs.filter(unrestricted_stock__lt=F('safety_stock'))

        pseudo_buffer = Echo()
        writer = csv.writer(pseudo_buffer)

        headers = [
            'Part Number',
            'Material Description',
            'Material Type',
            'Unrestricted Stock',
            'In Quality Inspection',
            'Blocked',
            'Safety Stock',
            'UOM',
            'Storage Location',
            'Plant',
            'Total Stock',
            'Below Safety Stock'
        ]

        def row_generator():
            yield writer.writerow(headers)
            for item in qs.iterator(chunk_size=1000):
                yield writer.writerow([
                    item.part_number,
                    item.material_description,
                    item.material_type,
                    float(item.unrestricted_stock),
                    float(item.in_quality_insp),
                    float(item.blocked),
                    float(item.safety_stock),
                    item.uom,
                    item.storage_location,
                    item.plant,
                    float(item.total_stock),
                    'Yes' if item.is_below_safety_stock else 'No'
                ])

        timestamp = timezone.now().strftime('%Y%m%d_%H%M%S')
        response = StreamingHttpResponse(row_generator(), content_type="text/csv")
        response['Content-Disposition'] = f'attachment; filename="stock_report_{timestamp}.csv"'
        return response


# ═══════════════════════════════════════════════════════════════════════════════
# Stage D — Monday Review Cockpit Views
# ═══════════════════════════════════════════════════════════════════════════════


class MondayReviewCockpitView(APIView):
    """
    D1: GET /api/reports/monday-review-cockpit/
    Main cockpit computation endpoint.
    Calls CockpitDataLoaderService → CockpitEngineService and returns the full result.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        month = request.query_params.get('month')
        week_code = request.query_params.get('week_code')
        fg_code_filter = request.query_params.get('fg_code')
        status_filter = request.query_params.get('status')

        if not month:
            return Response(
                {'error': 'Query parameter "month" is required (YYYY-MM format).'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            data_package = CockpitDataLoaderService.load(month, week_code)
            result = CockpitEngineService.compute(data_package)

            # Apply optional filters
            items = result['cockpitItems']
            if fg_code_filter:
                items = [i for i in items if i['fgCode'] == fg_code_filter]
            if status_filter:
                items = [i for i in items if i['fgHealthStatus'] == status_filter]
            result['cockpitItems'] = items

            return Response(result, status=status.HTTP_200_OK)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.exception(f"Cockpit computation error: {e}")
            return Response(
                {'error': f'Internal error computing cockpit: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class PlanFreezeView(APIView):
    """
    GET  /api/v1/plan-freeze/?month=YYYY-MM  → list freeze records
    POST /api/v1/plan-freeze/                → upsert one freeze record
    """
    permission_classes = [AllowAny]

    def get(self, request):
        month = request.query_params.get('month')
        week_code = request.query_params.get('week_code')
        fg_code = request.query_params.get('fg_code')
        status_filter = request.query_params.get('status')

        if not month:
            return Response({'error': 'month is required'}, status=status.HTTP_400_BAD_REQUEST)

        qs = FGPlanFreeze.objects.filter(month=month)
        if fg_code:
            qs = qs.filter(fg_id=fg_code)
        if week_code:
            qs = qs.filter(week_id=week_code)
        if status_filter:
            qs = qs.filter(status=status_filter)

        serializer = FGPlanFreezeSerializer(qs, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):
        fg_code = request.data.get('fg_code')
        month = request.data.get('month')
        week_code = request.data.get('week_code')
        new_status = request.data.get('status')
        frozen_by = request.data.get('frozen_by', '')
        freeze_notes = request.data.get('freeze_notes', '')

        # Extract role from request payload
        user_role = request.data.get('user_role') or getattr(
            getattr(request, 'user', None), 'role', None
        )

        if not all([fg_code, month, week_code, new_status]):
            return Response(
                {'error': 'fg_code, month, week_code, and status are all required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            result = PlanFreezeService.upsert(
                fg_code=fg_code,
                month=month,
                week_code=week_code,
                new_status=new_status,
                user_role=user_role,
                frozen_by=frozen_by,
                freeze_notes=freeze_notes,
            )
            serializer = FGPlanFreezeSerializer(result)
            return Response(serializer.data, status=status.HTTP_200_OK)

        except PermissionError as e:
            return Response({'error': str(e)}, status=status.HTTP_403_FORBIDDEN)

        except FGPlanFreeze.DoesNotExist:
            return Response(
                {'error': f'No monthly plan found for FG {fg_code} in {month}. '
                          'Cannot freeze a plan that does not exist.'},
                status=status.HTTP_404_NOT_FOUND
            )

        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


# Keep PlanFreezeListView and PlanFreezeUpdateView as aliases for backward compat
PlanFreezeListView = PlanFreezeView
PlanFreezeUpdateView = PlanFreezeView


class PlanFreezeBulkView(APIView):
    """
    D4: POST /api/plan-freeze/bulk/
    Freeze multiple FG plans in one batch (auto-freeze all OK plans).
    """
    permission_classes = [AllowAny]

    def post(self, request):
        fg_codes = request.data.get('fg_codes', [])
        month = request.data.get('month')
        week_code = request.data.get('week_code')
        frozen_by = request.data.get('frozen_by', '')

        if not fg_codes or not month or not week_code:
            return Response(
                {'error': 'fg_codes (list), month, and week_code are required.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        result = PlanFreezeService.bulk_freeze(
            fg_codes=fg_codes,
            month=month,
            week_code=week_code,
            frozen_by=frozen_by,
        )

        response_data = {
            'frozen_count': result['frozen_count'],
            'items': FGPlanFreezeSerializer(result['items'], many=True).data,
            'errors': result['errors'],
        }
        return Response(response_data, status=status.HTTP_200_OK)


class MondayActionListCreateView(APIView):
    """
    D5: GET/POST /api/monday-review-actions/
    List actions (filtered by month/week/fg) or create a new action (upsert).
    """
    permission_classes = [AllowAny]

    def get(self, request):
        month = request.query_params.get('month')
        week_code = request.query_params.get('week_code')
        fg_code = request.query_params.get('fg_code')
        action_status = request.query_params.get('status')

        qs = MondayReviewAction.objects.select_related('fg', 'week').all()
        if month:
            qs = qs.filter(month=month)
        if week_code:
            qs = qs.filter(week_id=week_code)
        if fg_code:
            qs = qs.filter(fg_id=fg_code)
        if action_status:
            qs = qs.filter(status=action_status)

        serializer = MondayReviewActionSerializer(qs, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):
        """
        Upsert behavior: if action exists for (fg_code, week_code, component_code),
        DELETE existing then INSERT new.
        """
        fg_code = request.data.get('fg_code')
        week_code = request.data.get('week_code')
        component_code = request.data.get('component_code') or None
        # Normalize: treat empty string the same as null

        # Delete existing action for this FG + week + component combination (upsert)
        if fg_code and week_code:
            existing = MondayReviewAction.objects.filter(
                fg_id=fg_code,
                week_id=week_code,
            )
            if component_code:
                # Component specified: delete exact match
                existing = existing.filter(component_code=component_code)
            else:
                # No component: delete any row where component_code is null OR empty string
                existing = existing.filter(
                    Q(component_code__isnull=True) | Q(component_code='')
                )
            deleted_count = existing.delete()[0]
            if deleted_count:
                logger.info(f"Upsert: Deleted {deleted_count} existing action(s) for {fg_code}/{week_code}/{component_code}")

        serializer = MondayReviewActionSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class MondayActionDetailView(APIView):
    """
    D6: PATCH/DELETE /api/monday-review-actions/<id>/
    Update or delete a single action.
    """
    permission_classes = [AllowAny]

    def get_object(self, pk):
        try:
            return MondayReviewAction.objects.select_related('fg', 'week').get(pk=pk)
        except MondayReviewAction.DoesNotExist:
            return None

    def patch(self, request, pk):
        action = self.get_object(pk)
        if not action:
            return Response({'error': 'Action not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = MondayReviewActionSerializer(action, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def delete(self, request, pk):
        action = self.get_object(pk)
        if not action:
            return Response({'error': 'Action not found.'}, status=status.HTTP_404_NOT_FOUND)
        action.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

# ─────────────────────────────────────────────────────────────────────────────
# Vendor Delivery Schedule Views (imported from core.vendor_schedule_views)
# ─────────────────────────────────────────────────────────────────────────────
from core.vendor_schedule_views import (
    ConsolidatedMatrixView,
    VendorScheduleListCreateView,
    VendorScheduleDetailView,
    VendorScheduleBulkUploadView,
    AutoFillDeficitsView,
    DeliveryChangeLogListView,
    VendorScheduleBlankTemplateView,
    VendorSchedulePrefilledTemplateView,
    VendorScheduleMatrixExportView,
)



class Echo:
    """An object that implements just the write method of the file-like interface."""
    def write(self, value):
        return value


class MondayReviewCockpitExportCSVView(APIView):
    """
    GET /api/v1/reports/monday-review-cockpit/export-csv/

    Returns a CSV file with the cockpit summary for the selected month and week.
    Columns match what MondayReviewCockpit.tsx generates in handleExportCSV().
    """
    permission_classes = [AllowAny]

    def get(self, request):
        month = request.query_params.get('month')
        week_code = request.query_params.get('week_code')

        if not month:
            return Response({'error': 'month is required'}, status=status.HTTP_400_BAD_REQUEST)

        # Reuse the same data loader and engine as the main cockpit view
        data_package = CockpitDataLoaderService.load(month, week_code)
        result = CockpitEngineService.compute(data_package)

        cockpit_items = result['cockpitItems']

        headers = [
            'FG Code',
            'FG Description',
            'Mini Factory',
            'Line',
            'Prior Plan',
            'Prior Actual 101',
            'Prior Backlog',
            'Current Week Plan',
            'Gross Target',
            'Net Shortage Gap',
            'W3 Plan',
            'W4 Plan',
            'Health Status',
            'Freeze Status',
        ]

        def generate_rows():
            yield headers
            for item in cockpit_items:
                prior_breakdown = item.get('priorWeeksBreakdown', [])
                prior_plan = sum(pw['planTarget'] for pw in prior_breakdown)
                prior_actual = sum(pw['actualProd'] for pw in prior_breakdown)

                net_gap = max(
                    0,
                    item['totalWeekGrossTarget'] - item['maxBuildableFGWithDeliveries']
                )

                all_weeks = item.get('allWeeksDetail', [])
                w3 = next((w['planTarget'] for w in all_weeks if w['weekNo'] == 3), 0)
                w4 = next((w['planTarget'] for w in all_weeks if w['weekNo'] == 4), 0)

                yield [
                    item['fgCode'],
                    item['fgDescription'],
                    item['miniFactory'],
                    item['line'],
                    prior_plan,
                    prior_actual,
                    item['priorBacklog'],
                    item['currentWeekPlanTarget'],
                    item['totalWeekGrossTarget'],
                    net_gap,
                    w3,
                    w4,
                    item['fgHealthStatus'],
                    item['freezeStatus'],
                ]

        pseudo_buffer = Echo()
        writer = csv.writer(pseudo_buffer)

        response = StreamingHttpResponse(
            (writer.writerow(row) for row in generate_rows()),
            content_type='text/csv'
        )
        response['Content-Disposition'] = (
            f'attachment; filename="Monday_Review_Cockpit_{month}.csv"'
        )
        return response
