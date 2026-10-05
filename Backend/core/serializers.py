from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from .models import (
    RMPMComponentMaster,
    BOMFGHeader,
    BOMMaster,
    VendorBuyerMaster,
    VendorSuppliedComponent,
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
from core.services.week_service import WeekService
from core.services.prorate_service import ProrateService
from core.services.mb51_classification_service import MB51ClassificationService
from core.services.week_mapping_service import WeekMappingService
from core.services.material_type_service import MaterialTypeService


class RMPMComponentSerializer(serializers.ModelSerializer):
    """
    Serializer for RM/PM Component Master.
    Enforces that component_code is required on creation, unique,
    cannot start with '7' (which is reserved for Finished Goods),
    and becomes read-only once created.
    """

    class Meta:
        model = RMPMComponentMaster
        fields = [
            'id',
            'component_code',
            'component_description',
            'category',
            'uom',
            'default_storage_location',
            'safety_stock',
            'is_critical',
            'is_common_part',
            'shared_in_fgs_count',
            'is_active',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'is_common_part', 'shared_in_fgs_count', 'created_at', 'updated_at']

    def get_fields(self):
        fields = super().get_fields()
        # When updating an existing component, component_code cannot be modified
        if self.instance is not None:
            fields['component_code'].read_only = True
        return fields

    def validate_component_code(self, value):
        code = value.strip().upper()
        if code.startswith('7'):
            raise serializers.ValidationError(
                "Component code cannot start with '7' (prefix '7' is strictly reserved for Finished Goods FG)."
            )
        return code

    def validate_safety_stock(self, value):
        if value < 0:
            raise serializers.ValidationError("Safety stock cannot be negative.")
        return value


class BOMFGHeaderSerializer(serializers.ModelSerializer):
    """
    Serializer for Finished Good (FG) Header Master.
    Enforces that fg_code must start with '7' and becomes read-only once created.
    """

    class Meta:
        model = BOMFGHeader
        fields = [
            'id',
            'fg_code',
            'fg_description',
            'mini_factory',
            'line',
            'customer_segment',
            'unit_price_inr',
            'active_bom_version',
            'uom',
            'is_active',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_fields(self):
        fields = super().get_fields()
        # When updating an existing FG Header, fg_code cannot be modified
        if self.instance is not None:
            fields['fg_code'].read_only = True
        return fields

    def validate_fg_code(self, value):
        code = value.strip()
        if not code.startswith('7'):
            raise serializers.ValidationError(
                "Finished Good code (fg_code) must start with '7'."
            )
        return code

    def validate_unit_price_inr(self, value):
        if value < 0:
            raise serializers.ValidationError("Unit price cannot be negative.")
        return value


class BOMMasterSerializer(serializers.ModelSerializer):
    """
    Serializer for BOM Master lines mapping FG headers to components.
    Includes nested component details and validates usage multiplier and part prefixes.
    """
    fg_code = serializers.SlugRelatedField(
        slug_field='fg_code',
        queryset=BOMFGHeader.objects.all(),
        source='fg'
    )
    component_code = serializers.SlugRelatedField(
        slug_field='component_code',
        queryset=RMPMComponentMaster.objects.all(),
        source='component'
    )
    fg_description = serializers.CharField(source='fg.fg_description', read_only=True)
    component_description = serializers.SerializerMethodField()
    category = serializers.SerializerMethodField()

    class Meta:
        model = BOMMaster
        fields = [
            'id',
            'fg_code',
            'fg_description',
            'component_code',
            'component_description',
            'category',
            'component_role',
            'qty',
            'uom',
            'bom_version',
            'is_active',
            'lead_time_days_override',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'fg_description', 'component_description', 'category', 'created_at', 'updated_at']

    def get_component_description(self, obj):
        return obj.component.component_description if obj.component else ''

    def get_category(self, obj):
        return obj.component.category if obj.component else ''

    def validate_qty(self, value):
        if value <= 0:
            raise serializers.ValidationError("Usage quantity (qty) must be strictly greater than 0.")
        return value

    def validate(self, attrs):
        fg = attrs.get('fg') or (self.instance.fg if self.instance else None)
        component = attrs.get('component') or (self.instance.component if self.instance else None)

        if fg and not fg.fg_code.startswith('7'):
            raise serializers.ValidationError({"fg_code": "Finished Good code must start with '7'."})

        if component and component.component_code.startswith('7'):
            raise serializers.ValidationError({"component_code": "Component code cannot start with '7'."})

        return attrs


class VendorBuyerSerializer(serializers.ModelSerializer):
    """
    Serializer for Vendor and Buyer relationship master.
    Includes nested supplied_components list of component codes.
    On save/update, manages the junction table vendor_supplied_components.
    """
    supplied_components = serializers.ListField(
        child=serializers.CharField(max_length=100),
        required=True,
        allow_empty=False
    )

    class Meta:
        model = VendorBuyerMaster
        fields = [
            'id',
            'vendor_code',
            'vendor_name',
            'buyer_name',
            'buyer_email',
            'buyer_phone',
            'category',
            'lead_time_days',
            'city',
            'gst_no',
            'is_active',
            'supplied_components',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Pull list of component codes from the junction table
        data['supplied_components'] = list(
            instance.supplied_components_rel.values_list('component_id', flat=True)
        )
        return data

    def validate_lead_time_days(self, value):
        if value <= 0:
            raise serializers.ValidationError("Lead time days must be greater than 0.")
        return value

    def validate_supplied_components(self, values):
        if not values or len(values) == 0:
            raise serializers.ValidationError("At least one component must be supplied by the vendor.")

        # Deduplicate while preserving order
        clean_codes = list(dict.fromkeys([c.strip().upper() for c in values if c and c.strip()]))
        if not clean_codes:
            raise serializers.ValidationError("At least one valid component code must be supplied.")

        # Verify all supplied components exist in RMPMComponentMaster
        existing_codes = set(
            RMPMComponentMaster.objects.filter(component_code__in=clean_codes).values_list('component_code', flat=True)
        )
        missing = [c for c in clean_codes if c not in existing_codes]
        if missing:
            raise serializers.ValidationError(
                f"The following components do not exist in RM/PM Component Master: {', '.join(missing)}"
            )

        return clean_codes

    @transaction.atomic
    def create(self, validated_data):
        supplied_components = validated_data.pop('supplied_components', [])
        vendor_buyer = VendorBuyerMaster.objects.create(**validated_data)

        # Bulk create junction rows
        junction_rows = [
            VendorSuppliedComponent(vendor_buyer=vendor_buyer, component_id=code)
            for code in supplied_components
        ]
        VendorSuppliedComponent.objects.bulk_create(junction_rows)

        return vendor_buyer

    @transaction.atomic
    def update(self, instance, validated_data):
        supplied_components = validated_data.pop('supplied_components', None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if supplied_components is not None:
            # Delete existing and recreate
            instance.supplied_components_rel.all().delete()
            junction_rows = [
                VendorSuppliedComponent(vendor_buyer=instance, component_id=code)
                for code in supplied_components
            ]
            VendorSuppliedComponent.objects.bulk_create(junction_rows)

        return instance


class UploadBatchSerializer(serializers.ModelSerializer):
    """
    Read-only serializer for tracking file ingestion history.
    """
    class Meta:
        model = UploadBatch
        fields = [
            'id',
            'upload_type',
            'uploaded_by',
            'uploaded_at',
            'file_name',
            'minio_path',
            'status',
            'total_rows',
            'imported_rows',
            'error_rows',
            'error_detail',
        ]
        read_only_fields = [
            'id',
            'upload_type',
            'uploaded_by',
            'uploaded_at',
            'file_name',
            'minio_path',
            'status',
            'total_rows',
            'imported_rows',
            'error_rows',
            'error_detail',
        ]


class WeekDefinitionSerializer(serializers.ModelSerializer):
    """
    Serializer for WeekDefinition.
    - Computes days_count and working_days server-side via WeekService.
    - Generates standard week_code (w-{YYYY-MM}-{0N}) on creation.
    - Exposes week_code as read-only.
    """
    week_label = serializers.CharField(max_length=100, required=False, allow_blank=True)
    month_weight = serializers.FloatField(read_only=True)

    class Meta:
        model = WeekDefinition
        fields = [
            'id',
            'month',
            'week_no',
            'week_code',
            'week_label',
            'start_date',
            'end_date',
            'days_count',
            'holiday_days',
            'working_days',
            'month_weight',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'week_code',
            'days_count',
            'working_days',
            'month_weight',
            'created_at',
            'updated_at',
        ]

    def validate_month(self, value):
        val = value.strip()
        parts = val.split('-')
        if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
            raise serializers.ValidationError("Month must be in YYYY-MM format (e.g. 2026-08).")
        month_num = int(parts[1])
        if not (1 <= month_num <= 12):
            raise serializers.ValidationError("Month number must be between 01 and 12.")
        return val

    def validate(self, attrs):
        start_date = attrs.get('start_date') or (self.instance.start_date if self.instance else None)
        end_date = attrs.get('end_date') or (self.instance.end_date if self.instance else None)
        month = attrs.get('month') or (self.instance.month if self.instance else None)

        if not start_date or not end_date:
            raise serializers.ValidationError("Both start_date and end_date are required.")

        if end_date < start_date:
            raise serializers.ValidationError({"end_date": "End date cannot be earlier than start date."})

        # Validate dates fall within calendar month boundaries
        if month:
            from django.core.exceptions import ValidationError as DjangoValidationError
            try:
                WeekService.validate_dates_within_month(month, start_date, end_date)
            except DjangoValidationError as ex:
                msg = ex.messages if hasattr(ex, 'messages') else [str(ex)]
                raise serializers.ValidationError({"start_date": msg})

            # Validate no overlap with other weeks in this month
            exclude_id = self.instance.pk if self.instance else None
            try:
                WeekService.validate_no_overlap(month, start_date, end_date, exclude_id=exclude_id)
            except DjangoValidationError as ex:
                msg = ex.messages if hasattr(ex, 'messages') else [str(ex)]
                raise serializers.ValidationError({"date_range": msg})

        # Holiday days
        holiday_days = attrs.get('holiday_days')
        if holiday_days is None:
            holiday_days = self.instance.holiday_days if self.instance else 0
        if holiday_days < 0:
            raise serializers.ValidationError({"holiday_days": "Holiday days cannot be negative."})

        # Server-side computation of days_count & working_days
        days_count = WeekService.compute_days_count(start_date, end_date)
        working_days = WeekService.compute_working_days(days_count, holiday_days)
        attrs['days_count'] = days_count
        attrs['working_days'] = working_days

        # Auto-generate week_code on create
        if not self.instance:
            week_no = attrs.get('week_no')
            if not week_no:
                raise serializers.ValidationError({"week_no": "week_no is required."})
            attrs['week_code'] = WeekService.generate_week_code(month, week_no)

            # Auto-generate week_label if not provided
            if not attrs.get('week_label'):
                month_short = start_date.strftime('%b')
                attrs['week_label'] = f"Week {week_no} ({start_date.strftime('%d')}-{end_date.strftime('%d')} {month_short})"

        return attrs


class MonthlyPlanSerializer(serializers.ModelSerializer):
    """
    Serializer for MonthlyPlan.
    - weekly_breakdown is exposed as read-only computed field.
    - fg_code must exist in or auto-create bom_fg_header and start with '7'.
    - Auto-computes weekly_breakdown using ProrateService.prorate(monthly_target, weeks).
    """
    fg_code = serializers.CharField(max_length=50, required=False)
    fg_description = serializers.CharField(max_length=200, required=False, allow_blank=True)
    customer_name = serializers.CharField(required=False, allow_blank=True, default='')
    month = serializers.CharField(max_length=7)
    monthly_target = serializers.IntegerField(min_value=1)
    uom = serializers.CharField(max_length=20, default='PC', required=False)
    weekly_breakdown = serializers.DictField(read_only=True)
    custom_notes = serializers.CharField(required=False, allow_blank=True, default='')
    upload_batch_id = serializers.IntegerField(source='upload_batch.id', read_only=True, allow_null=True)

    class Meta:
        model = MonthlyPlan
        fields = [
            'id',
            'fg_code',
            'fg_description',
            'customer_name',
            'month',
            'monthly_target',
            'uom',
            'weekly_breakdown',
            'custom_notes',
            'upload_batch_id',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'weekly_breakdown',
            'upload_batch_id',
            'created_at',
            'updated_at',
        ]

    def validate_month(self, value):
        val = value.strip()
        parts = val.split('-')
        if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
            raise serializers.ValidationError("Month must be in YYYY-MM format (e.g. 2026-08).")
        month_num = int(parts[1])
        if not (1 <= month_num <= 12):
            raise serializers.ValidationError("Month number must be between 01 and 12.")
        return val

    def validate(self, attrs):
        # Determine fg_code
        fg_code = attrs.get('fg_code')
        if not fg_code:
            if self.instance:
                fg_code = self.instance.fg_id
            else:
                raise serializers.ValidationError({"fg_code": "Finished Good code is required."})

        fg_code = str(fg_code).strip()
        if not fg_code.startswith('7'):
            raise serializers.ValidationError({"fg_code": "FG code must start with '7'."})
        if len(fg_code) > 30:
            raise serializers.ValidationError({"fg_code": "FG code cannot exceed 30 characters."})

        attrs['fg_code'] = fg_code

        # Determine Month
        month = attrs.get('month') or (self.instance.month if self.instance else None)
        if not month:
            raise serializers.ValidationError({"month": "Month is required."})

        # Uniqueness check on (fg_code, month)
        qs = MonthlyPlan.objects.filter(fg__fg_code=fg_code, month=month)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                {"non_field_errors": [f"A monthly plan for Finished Good '{fg_code}' in month '{month}' already exists."]}
            )

        # Target check
        monthly_target = attrs.get('monthly_target')
        if monthly_target is None:
            monthly_target = self.instance.monthly_target if self.instance else 0
        if monthly_target <= 0:
            raise serializers.ValidationError({"monthly_target": "Monthly target must be greater than 0."})

        # Fetch week definitions for this month
        weeks = list(WeekDefinition.objects.filter(month=month).order_by('week_no'))
        if not weeks:
            raise serializers.ValidationError(
                {"month": [f"No week definitions configured for month '{month}'. Please configure or auto-generate weeks first."]}
            )

        # Auto-compute weekly_breakdown server-side (never accept from client)
        attrs['weekly_breakdown'] = ProrateService.prorate(monthly_target, weeks)

        return attrs

    def create(self, validated_data):
        fg_code = validated_data.pop('fg_code')
        fg_description = validated_data.pop('fg_description', '')
        customer_name = validated_data.get('customer_name', '')
        uom = validated_data.get('uom', 'PC')

        # Get or create BOMFGHeader
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

        if not customer_name and fg_header.customer_segment:
            validated_data['customer_name'] = fg_header.customer_segment

        validated_data['fg'] = fg_header
        return MonthlyPlan.objects.create(**validated_data)

    def update(self, instance, validated_data):
        fg_description = validated_data.pop('fg_description', None)
        if fg_description and instance.fg:
            instance.fg.fg_description = fg_description
            instance.fg.save(update_fields=['fg_description'])

        return super().update(instance, validated_data)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['fg_code'] = instance.fg_id
        data['fg_description'] = instance.fg.fg_description if instance.fg else ''
        return data


class UploadBatchSerializer(serializers.ModelSerializer):
    """
    Serializer for UploadBatch audit record.
    """
    class Meta:
        model = UploadBatch
        fields = [
            'id',
            'upload_type',
            'uploaded_by',
            'uploaded_at',
            'file_name',
            'minio_path',
            'status',
            'total_rows',
            'imported_rows',
            'error_rows',
            'error_detail',
        ]
        read_only_fields = fields


class MB51TransactionSerializer(serializers.ModelSerializer):
    """
    Serializer for SAP MB51 Material Movement Transactions.
    classification and week_code are read-only computed fields:
    - classification is computed via MB51ClassificationService
    - week_code is computed via WeekMappingService based on posting_date
    """
    classification = serializers.CharField(read_only=True)
    week_code = serializers.CharField(source='week_id', read_only=True, allow_null=True)
    upload_batch_id = serializers.IntegerField(source='upload_batch.id', read_only=True, allow_null=True)

    class Meta:
        model = MB51Transaction
        fields = [
            'id',
            'material_document',
            'posting_date',
            'movement_type',
            'part_number',
            'material_description',
            'quantity',
            'uom',
            'storage_location',
            'plant',
            'vendor_customer',
            'po_order_number',
            'classification',
            'week_code',
            'upload_batch_id',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'classification',
            'week_code',
            'upload_batch_id',
            'created_at',
            'updated_at',
        ]

    def to_internal_value(self, data):
        # Support both snake_case and camelCase input keys
        normalized = data.copy() if hasattr(data, 'copy') else dict(data)
        camel_to_snake = {
            'materialDocument': 'material_document',
            'postingDate': 'posting_date',
            'movementType': 'movement_type',
            'partNumber': 'part_number',
            'materialDescription': 'material_description',
            'storageLocation': 'storage_location',
            'vendorOrCustomer': 'vendor_customer',
            'poOrOrderNumber': 'po_order_number',
        }
        for camel, snake in camel_to_snake.items():
            if camel in normalized and snake not in normalized:
                normalized[snake] = normalized[camel]

        return super().to_internal_value(normalized)

    def validate_quantity(self, value):
        if value <= 0:
            raise serializers.ValidationError("Transaction quantity must be greater than 0.")
        return value

    def validate(self, attrs):
        movement_type = attrs.get('movement_type') or (self.instance.movement_type if self.instance else '')
        part_number = attrs.get('part_number') or (self.instance.part_number if self.instance else '')
        posting_date = attrs.get('posting_date') or (self.instance.posting_date if self.instance else None)

        # Compute classification server-side
        attrs['classification'] = MB51ClassificationService.classify(movement_type, part_number)

        # Compute week_code server-side
        if posting_date:
            matched_week = WeekMappingService.map_to_week(posting_date)
            attrs['week_id'] = matched_week
        else:
            attrs['week_id'] = None

        return attrs

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        # Frontend camelCase aliases for seamless UI compatibility
        ret['materialDocument'] = instance.material_document
        ret['postingDate'] = instance.posting_date.isoformat() if instance.posting_date else ''
        ret['movementType'] = instance.movement_type
        ret['partNumber'] = instance.part_number
        ret['materialDescription'] = instance.material_description
        ret['storageLocation'] = instance.storage_location
        ret['vendorOrCustomer'] = instance.vendor_customer
        ret['poOrOrderNumber'] = instance.po_order_number
        ret['weekId'] = instance.week_id or ''
        return ret


class StockReportSerializer(serializers.ModelSerializer):
    """
    Serializer for SAP MB52 StockReport model.
    - material_type: read-only computed field derived from part_number prefix
      using MaterialTypeService.derive(part_number)
    - Supports both camelCase and snake_case inputs
    - Exposes camelCase aliases in output for frontend compatibility
    """
    material_type = serializers.CharField(read_only=True)
    total_stock = serializers.DecimalField(max_digits=12, decimal_places=3, read_only=True)
    is_below_safety_stock = serializers.BooleanField(read_only=True)

    class Meta:
        model = StockReport
        fields = [
            'id',
            'part_number',
            'material_description',
            'material_type',
            'unrestricted_stock',
            'in_quality_insp',
            'blocked',
            'storage_location',
            'uom',
            'safety_stock',
            'plant',
            'total_stock',
            'is_below_safety_stock',
            'upload_batch_id',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'material_type',
            'total_stock',
            'is_below_safety_stock',
            'upload_batch_id',
            'created_at',
            'updated_at',
        ]

    def to_internal_value(self, data):
        normalized = data.copy() if hasattr(data, 'copy') else dict(data)
        camel_to_snake = {
            'partNumber': 'part_number',
            'materialDescription': 'material_description',
            'materialType': 'material_type',
            'unrestrictedStock': 'unrestricted_stock',
            'inQualityInsp': 'in_quality_insp',
            'storageLocation': 'storage_location',
            'safetyStock': 'safety_stock',
        }
        for camel, snake in camel_to_snake.items():
            if camel in normalized and snake not in normalized:
                normalized[snake] = normalized[camel]

        return super().to_internal_value(normalized)

    def validate_part_number(self, value):
        val = str(value or '').strip()
        if not val:
            raise serializers.ValidationError("Part number cannot be blank.")
        return val

    def validate_unrestricted_stock(self, value):
        if value < 0:
            raise serializers.ValidationError("Unrestricted stock cannot be negative.")
        return value

    def validate_in_quality_insp(self, value):
        if value < 0:
            raise serializers.ValidationError("Quality inspection stock cannot be negative.")
        return value

    def validate_blocked(self, value):
        if value < 0:
            raise serializers.ValidationError("Blocked stock cannot be negative.")
        return value

    def validate_safety_stock(self, value):
        if value < 0:
            raise serializers.ValidationError("Safety stock cannot be negative.")
        return value

    def validate(self, attrs):
        part_number = attrs.get('part_number') or (self.instance.part_number if self.instance else '')
        # Compute material_type read-only from part_number prefix / DB
        attrs['material_type'] = MaterialTypeService.derive(part_number)
        return attrs

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        # Frontend camelCase aliases for seamless UI compatibility
        ret['partNumber'] = instance.part_number
        ret['materialDescription'] = instance.material_description
        ret['materialType'] = instance.material_type
        ret['unrestrictedStock'] = float(instance.unrestricted_stock)
        ret['inQualityInsp'] = float(instance.in_quality_insp)
        ret['blocked'] = float(instance.blocked)
        ret['storageLocation'] = instance.storage_location
        ret['safetyStock'] = float(instance.safety_stock)
        ret['totalStock'] = float(instance.total_stock)
        ret['isBelowSafetyStock'] = instance.is_below_safety_stock
        ret['lastUpdated'] = instance.updated_at.strftime('%Y-%m-%d %H:%M') if instance.updated_at else ''
        return ret



# ═══════════════════════════════════════════════════════════════════════════════
# Stage B — Monday Review Cockpit Serializers
# ═══════════════════════════════════════════════════════════════════════════════


class VendorDeliveryScheduleSerializer(serializers.ModelSerializer):
    """
    Serializer for VendorDeliverySchedule.
    - Resolves week_code server-side from expected_delivery_date
    - Auto-generates po_number if blank
    - Accepts component_code as a writable field
    """
    component_code = serializers.CharField(source='component_id')
    week_code = serializers.CharField(source='week_id', read_only=True)

    # For mutations: changed_by and reason_for_change are write-only pass-through fields
    # They are NOT stored on the schedule itself but used by the view to create audit logs
    changed_by = serializers.CharField(write_only=True, required=False, default='')
    reason_for_change = serializers.CharField(write_only=True, required=False, default='')

    class Meta:
        model = VendorDeliverySchedule
        fields = [
            'id',
            'po_number',
            'component_code',
            'vendor_code',
            'vendor_name',
            'buyer_name',
            'expected_delivery_date',
            'week_code',
            'promised_qty',
            'carrier_or_tracking',
            'delivery_status',
            'notes',
            'changed_by',
            'reason_for_change',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'week_code', 'created_at', 'updated_at']

    def validate_delivery_status(self, value):
        valid_statuses = [c[0] for c in VendorDeliverySchedule.DELIVERY_STATUS_CHOICES]
        if value not in valid_statuses:
            raise serializers.ValidationError(
                f"Invalid delivery_status '{value}'. Must be one of: {', '.join(valid_statuses)}"
            )
        return value

    def validate(self, attrs):
        # Remove pass-through fields before model save
        attrs.pop('changed_by', None)
        attrs.pop('reason_for_change', None)

        # Auto-generate po_number if blank
        po = attrs.get('component_id', '')
        if not attrs.get('po_number', '').strip():
            import uuid
            attrs['po_number'] = f"PO-AUTO-{uuid.uuid4().hex[:8].upper()}"

        # Resolve week_code from expected_delivery_date
        delivery_date = attrs.get('expected_delivery_date')
        if delivery_date:
            week_code = WeekMappingService.map_to_week(delivery_date)
            if week_code:
                attrs['week_id'] = week_code
            else:
                attrs['week_id'] = None

        return attrs

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        # Add camelCase aliases for frontend compatibility
        ret['id'] = str(instance.id)
        ret['componentCode'] = instance.component_id
        ret['weekId'] = instance.week_id or ''
        ret['weekCode'] = instance.week_id or ''
        ret['poNumber'] = instance.po_number
        ret['vendorCode'] = instance.vendor_code
        ret['vendorName'] = instance.vendor_name
        ret['buyerName'] = instance.buyer_name
        ret['expectedDeliveryDate'] = str(instance.expected_delivery_date) if instance.expected_delivery_date else ''
        ret['promisedQty'] = float(instance.promised_qty)
        ret['carrierOrTracking'] = instance.carrier_or_tracking or ''
        ret['deliveryStatus'] = instance.delivery_status
        ret['notes'] = instance.notes or ''
        return ret


class DeliveryScheduleChangeLogSerializer(serializers.ModelSerializer):
    """
    Read-only serializer for the delivery schedule audit trail.
    """
    schedule_id = serializers.PrimaryKeyRelatedField(source='schedule', read_only=True)

    class Meta:
        model = DeliveryScheduleChangeLog
        fields = [
            'id',
            'schedule_id',
            'po_number',
            'component_code',
            'component_description',
            'vendor_name',
            'changed_by',
            'changed_at',
            'field_changed',
            'old_value',
            'new_value',
            'reason_for_change',
        ]
        read_only_fields = fields

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        ret['scheduleId'] = instance.schedule_id
        ret['poNumber'] = instance.po_number
        ret['componentCode'] = instance.component_code
        ret['componentDescription'] = instance.component_description or ''
        ret['vendorName'] = instance.vendor_name
        ret['changedBy'] = instance.changed_by
        ret['changedAt'] = instance.changed_at.isoformat() if instance.changed_at else ''
        ret['fieldChanged'] = instance.field_changed
        ret['oldValue'] = instance.old_value
        ret['newValue'] = instance.new_value
        ret['reasonForChange'] = instance.reason_for_change
        return ret


class FGPlanFreezeSerializer(serializers.ModelSerializer):
    """
    Serializer for FGPlanFreeze.
    Validates the state machine: DRAFT → REVIEWED → FROZEN (forward only)
    FROZEN → DRAFT is the only backward transition allowed (unfreeze).
    """
    fg_code = serializers.CharField(source='fg_id')
    week_code = serializers.CharField(source='week_id')

    class Meta:
        model = FGPlanFreeze
        fields = [
            'id',
            'fg_code',
            'month',
            'week_code',
            'status',
            'frozen_at',
            'frozen_by',
            'freeze_notes',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'frozen_at', 'created_at', 'updated_at']

    VALID_TRANSITIONS = {
        None: ['DRAFT', 'REVIEWED', 'FROZEN'],  # New record: any status OK
        'DRAFT': ['REVIEWED', 'FROZEN'],
        'REVIEWED': ['FROZEN'],
        'FROZEN': ['DRAFT'],  # Only unfreeze is allowed
    }

    def validate_status(self, value):
        valid_statuses = [c[0] for c in FGPlanFreeze.FREEZE_STATUS_CHOICES]
        if value not in valid_statuses:
            raise serializers.ValidationError(
                f"Invalid status '{value}'. Must be one of: {', '.join(valid_statuses)}"
            )
        return value

    def validate(self, attrs):
        # Validate state machine transitions on update
        if self.instance:
            current_status = self.instance.status
            new_status = attrs.get('status', current_status)
            allowed = self.VALID_TRANSITIONS.get(current_status, [])
            if new_status != current_status and new_status not in allowed:
                raise serializers.ValidationError({
                    'status': f"Plan freeze status cannot transition from '{current_status}' to '{new_status}'. "
                              f"Allowed transitions: {', '.join(allowed)}"
                })

        # Auto-set frozen_at when status transitions to FROZEN
        new_status = attrs.get('status')
        if new_status == 'FROZEN':
            if not self.instance or self.instance.status != 'FROZEN':
                attrs['frozen_at'] = timezone.now()
        elif new_status and new_status != 'FROZEN':
            attrs['frozen_at'] = None

        # Validate monthly_plan exists
        fg_code = attrs.get('fg_id') or (self.instance.fg_id if self.instance else None)
        month = attrs.get('month') or (self.instance.month if self.instance else None)
        if fg_code and month:
            if not MonthlyPlan.objects.filter(fg_id=fg_code, month=month).exists():
                raise serializers.ValidationError({
                    'fg_code': f"No monthly plan exists for FG '{fg_code}' in month '{month}'. Cannot freeze."
                })

        return attrs

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        ret['fgCode'] = instance.fg_id
        ret['weekCode'] = instance.week_id
        ret['frozenAt'] = instance.frozen_at.isoformat() if instance.frozen_at else None
        ret['frozenBy'] = instance.frozen_by
        ret['freezeNotes'] = instance.freeze_notes
        # Include FG description for display
        if instance.fg:
            ret['fgDescription'] = instance.fg.fg_description
            ret['miniFactory'] = instance.fg.mini_factory
        return ret


class MondayReviewActionSerializer(serializers.ModelSerializer):
    """
    Serializer for MondayReviewAction.
    Implements upsert behavior on (fg, week, component_code).
    """
    fg_code = serializers.CharField(source='fg_id')
    week_code = serializers.CharField(source='week_id')

    class Meta:
        model = MondayReviewAction
        fields = [
            'id',
            'fg_code',
            'week_code',
            'month',
            'component_code',
            'component_description',
            'issue_type',
            'description',
            'impact_summary',
            'status',
            'resolution_notes',
            'agreed_action',
            'assigned_owner',
            'target_resolution_date',
            'escalated_to',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_issue_type(self, value):
        valid_types = [c[0] for c in MondayReviewAction.ISSUE_TYPE_CHOICES]
        if value not in valid_types:
            raise serializers.ValidationError(
                f"Invalid issue_type '{value}'. Must be one of: {', '.join(valid_types)}"
            )
        return value

    def validate_status(self, value):
        valid_statuses = [c[0] for c in MondayReviewAction.ACTION_STATUS_CHOICES]
        if value not in valid_statuses:
            raise serializers.ValidationError(
                f"Invalid status '{value}'. Must be one of: {', '.join(valid_statuses)}"
            )
        return value

    def to_representation(self, instance):
        ret = super().to_representation(instance)
        ret['fgCode'] = instance.fg_id
        ret['weekCode'] = instance.week_id
        ret['componentCode'] = instance.component_code or ''
        ret['componentDescription'] = instance.component_description
        ret['issueType'] = instance.issue_type
        ret['impactSummary'] = instance.impact_summary
        ret['resolutionNotes'] = instance.resolution_notes
        ret['agreedAction'] = instance.agreed_action
        ret['assignedOwner'] = instance.assigned_owner
        ret['targetResolutionDate'] = str(instance.target_resolution_date) if instance.target_resolution_date else None
        ret['escalatedTo'] = instance.escalated_to
        # Include FG description
        if instance.fg:
            ret['fgDescription'] = instance.fg.fg_description
        return ret
