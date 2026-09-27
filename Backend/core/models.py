from decimal import Decimal
from django.db import models
from django.contrib.postgres.indexes import GinIndex


class RMPMComponentMaster(models.Model):
    CATEGORY_CHOICES = (
        ('RM', 'Raw Material'),
        ('PM', 'Packaging Material'),
    )

    component_code = models.CharField(
        max_length=100,
        unique=True,
        db_index=True,
        help_text="Unique component identifier (must not start with '7')"
    )
    component_description = models.CharField(max_length=255)
    category = models.CharField(max_length=10, choices=CATEGORY_CHOICES, default='RM', db_index=True)
    uom = models.CharField(max_length=20, default='PC')
    default_storage_location = models.CharField(max_length=50, blank=True, default='')
    safety_stock = models.DecimalField(max_digits=12, decimal_places=3, default=0.000)
    is_critical = models.BooleanField(default=False)
    is_common_part = models.BooleanField(default=False, db_index=True)
    shared_in_fgs_count = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'rm_pm_component_master'
        verbose_name = 'RM/PM Component Master'
        verbose_name_plural = 'RM/PM Component Master'
        ordering = ['component_code']
        indexes = [
            models.Index(fields=['category']),
            models.Index(fields=['is_common_part']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f"{self.component_code} - {self.component_description}"


class BOMFGHeader(models.Model):
    fg_code = models.CharField(
        max_length=100,
        unique=True,
        db_index=True,
        help_text="Finished good identifier (must start with '7')"
    )
    fg_description = models.CharField(max_length=255)
    mini_factory = models.CharField(max_length=100, blank=True, default='')
    line = models.CharField(max_length=100, blank=True, default='')
    customer_segment = models.CharField(max_length=100, blank=True, default='')
    unit_price_inr = models.DecimalField(max_digits=12, decimal_places=2, default=1000.00)
    active_bom_version = models.CharField(max_length=20, default='v1')
    uom = models.CharField(max_length=20, default='PC')
    is_active = models.BooleanField(default=True, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'bom_fg_header'
        verbose_name = 'BOM Finished Good Header'
        verbose_name_plural = 'BOM Finished Good Headers'
        ordering = ['fg_code']
        indexes = [
            models.Index(fields=['mini_factory']),
            models.Index(fields=['line']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f"{self.fg_code} - {self.fg_description}"


class BOMMaster(models.Model):
    fg = models.ForeignKey(
        BOMFGHeader,
        to_field='fg_code',
        db_column='fg_code',
        on_delete=models.CASCADE,
        related_name='bom_lines'
    )
    component = models.ForeignKey(
        RMPMComponentMaster,
        to_field='component_code',
        db_column='component_code',
        on_delete=models.CASCADE,
        related_name='bom_usages'
    )
    qty = models.DecimalField(max_digits=12, decimal_places=4, default=1.0000)
    uom = models.CharField(max_length=20, default='PC')
    component_role = models.CharField(max_length=50, blank=True, default='')
    bom_version = models.CharField(max_length=20, default='v1')
    is_active = models.BooleanField(default=True, db_index=True)
    lead_time_days_override = models.IntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'bom_master'
        verbose_name = 'BOM Master'
        verbose_name_plural = 'BOM Master Lines'
        ordering = ['fg', 'component']
        constraints = [
            models.UniqueConstraint(
                fields=['fg', 'component', 'bom_version'],
                name='unique_bom_entry_per_version'
            )
        ]
        indexes = [
            models.Index(fields=['fg', 'bom_version', 'is_active']),
            models.Index(fields=['component']),
            models.Index(fields=['is_active']),
            models.Index(fields=['bom_version']),
        ]

    def __str__(self):
        return f"{self.fg_id} -> {self.component_id} ({self.qty} {self.uom})"


from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

@receiver([post_save, post_delete], sender=BOMMaster)
def on_bom_master_change(sender, instance, **kwargs):
    if instance.component_id:
        from core.services.bom_service import BOMService
        BOMService.update_common_part_flags(instance.component_id)


class VendorBuyerMaster(models.Model):
    CATEGORY_CHOICES = (
        ('RM', 'Raw Material'),
        ('PM', 'Packaging Material'),
    )

    vendor_code = models.CharField(max_length=100, unique=True, db_index=True)
    vendor_name = models.CharField(max_length=255, db_index=True)
    buyer_name = models.CharField(max_length=255, db_index=True)
    buyer_email = models.EmailField(blank=True, default='')
    buyer_phone = models.CharField(max_length=50, blank=True, default='')
    category = models.CharField(max_length=10, choices=CATEGORY_CHOICES, default='RM', db_index=True)
    lead_time_days = models.IntegerField(default=7)
    city = models.CharField(max_length=100, blank=True, default='')
    gst_no = models.CharField(max_length=50, blank=True, default='')
    is_active = models.BooleanField(default=True, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'vendor_buyer_master'
        verbose_name = 'Vendor Buyer Master'
        verbose_name_plural = 'Vendor Buyer Master'
        ordering = ['vendor_code']
        indexes = [
            models.Index(fields=['vendor_name']),
            models.Index(fields=['buyer_name']),
            models.Index(fields=['category']),
            models.Index(fields=['is_active']),
        ]

    def __str__(self):
        return f"{self.vendor_code} - {self.vendor_name} ({self.buyer_name})"

    @property
    def supplied_components(self):
        return list(self.supplied_components_rel.values_list('component_id', flat=True))



class VendorSuppliedComponent(models.Model):
    vendor_buyer = models.ForeignKey(
        VendorBuyerMaster,
        on_delete=models.CASCADE,
        related_name='supplied_components_rel'
    )
    component = models.ForeignKey(
        RMPMComponentMaster,
        to_field='component_code',
        db_column='component_code',
        on_delete=models.CASCADE,
        related_name='vendor_suppliers'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'vendor_supplied_components'
        verbose_name = 'Vendor Supplied Component'
        verbose_name_plural = 'Vendor Supplied Components'
        ordering = ['vendor_buyer', 'component']
        constraints = [
            models.UniqueConstraint(
                fields=['vendor_buyer', 'component'],
                name='unique_vendor_supplied_component'
            )
        ]
        indexes = [
            models.Index(fields=['vendor_buyer']),
            models.Index(fields=['component']),
        ]

    def __str__(self):
        return f"{self.vendor_buyer.vendor_code} supplies {self.component_id}"


class UploadBatch(models.Model):
    UPLOAD_TYPE_CHOICES = (
        ('BOM_UPLOAD', 'BOM Upload'),
        ('MONTHLY_PLAN', 'Monthly Plan'),
        ('MB51_REPORT', 'MB51 Report'),
        ('STOCK_REPORT', 'Stock Report'),
        ('VENDOR_DELIVERY_SCHEDULE', 'Vendor Delivery Schedule'),
        ('OTHER', 'Other Upload'),
    )

    STATUS_CHOICES = (
        ('PENDING', 'Pending'),
        ('PROCESSING', 'Processing'),
        ('COMPLETED', 'Completed'),
        ('PARTIAL', 'Partial Success'),
        ('FAILED', 'Failed'),
    )

    upload_type = models.CharField(max_length=50, choices=UPLOAD_TYPE_CHOICES)
    uploaded_by = models.CharField(max_length=150, blank=True, default='system')
    uploaded_at = models.DateTimeField(auto_now_add=True, db_index=True)
    file_name = models.CharField(max_length=255)
    minio_path = models.CharField(max_length=500, blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING', db_index=True)
    total_rows = models.IntegerField(default=0)
    imported_rows = models.IntegerField(default=0)
    error_rows = models.IntegerField(default=0)
    error_detail = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = 'upload_batch'
        verbose_name = 'Upload Batch'
        verbose_name_plural = 'Upload Batches'
        ordering = ['-uploaded_at']
        indexes = [
            models.Index(fields=['upload_type', 'status']),
            models.Index(fields=['-uploaded_at']),
        ]

    def __str__(self):
        return f"Batch #{self.id} - {self.upload_type} ({self.status}) - {self.file_name}"


class WeekDefinition(models.Model):
    month = models.CharField(
        max_length=7,
        db_index=True,
        help_text="Month bucket in YYYY-MM format, e.g. '2026-08'"
    )
    week_no = models.IntegerField(help_text="Week index within the month (1, 2, 3, 4, 5...)")
    week_code = models.CharField(
        max_length=50,
        unique=True,
        db_index=True,
        help_text="Unique week code identifier, e.g. 'w-2026-08-01'"
    )
    week_label = models.CharField(
        max_length=100,
        help_text="Human-readable label, e.g. 'Week 1 (01-09 Aug)'"
    )
    start_date = models.DateField(help_text="Week bucket starting date (inclusive)")
    end_date = models.DateField(help_text="Week bucket ending date (inclusive)")
    days_count = models.IntegerField(help_text="Total calendar days in this week bucket")
    holiday_days = models.IntegerField(default=0, help_text="Number of holidays / plant off-days")
    working_days = models.IntegerField(help_text="Effective working days available for production")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'week_definition'
        verbose_name = 'Week Definition'
        verbose_name_plural = 'Week Definitions'
        ordering = ['month', 'week_no']
        constraints = [
            models.UniqueConstraint(
                fields=['month', 'week_no'],
                name='unique_week_per_month'
            )
        ]
        indexes = [
            models.Index(fields=['month']),
            models.Index(fields=['start_date', 'end_date']),
        ]

    def __str__(self):
        return f"{self.week_code} | {self.week_label} ({self.working_days} working days)"


class MonthlyPlan(models.Model):
    fg = models.ForeignKey(
        BOMFGHeader,
        to_field='fg_code',
        db_column='fg_code',
        on_delete=models.PROTECT,
        related_name='monthly_plans',
        help_text="Finished Good header (FK to bom_fg_header)"
    )
    month = models.CharField(
        max_length=7,
        db_index=True,
        help_text="Month bucket in YYYY-MM format, e.g. '2026-08'"
    )
    monthly_target = models.PositiveIntegerField(
        help_text="Total planned FG production units for the month"
    )
    uom = models.CharField(max_length=20, default='PC')
    customer_name = models.CharField(max_length=150, blank=True, default='')
    custom_notes = models.TextField(blank=True, default='')
    weekly_breakdown = models.JSONField(
        default=dict,
        help_text="Computed prorated weekly breakdown JSONB mapping week_code to integer quantity"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'monthly_plan'
        verbose_name = 'Monthly Plan'
        verbose_name_plural = 'Monthly Plans'
        ordering = ['month', 'fg__fg_code']
        constraints = [
            models.UniqueConstraint(
                fields=['fg', 'month'],
                name='unique_monthly_plan_fg_month'
            )
        ]
        indexes = [
            models.Index(fields=['month']),
            models.Index(fields=['fg', 'month']),
            GinIndex(fields=['weekly_breakdown'], name='idx_monthly_plan_weekly_brk'),
        ]

    def __str__(self):
        return f"{self.fg_id} ({self.month}): {self.monthly_target} {self.uom}"

    @property
    def fg_code(self):
        return self.fg_id

    @fg_code.setter
    def fg_code(self, value):
        self.fg_id = value

    @property
    def fg_description(self):
        return self.fg.fg_description if self.fg else ''


class MB51Transaction(models.Model):
    CLASSIFICATION_CHOICES = (
        ('FG_PRODUCTION_RECEIPT', 'FG Production Receipt'),
        ('RMPM_RECEIPT', 'RM/PM Receipt'),
        ('FG_DISPATCH', 'FG Dispatch'),
        ('OTHER', 'Other Movement'),
    )

    material_document = models.CharField(
        max_length=50,
        db_index=True,
        help_text="SAP Material Document number (e.g. 5001089211)"
    )
    posting_date = models.DateField(
        db_index=True,
        help_text="Posting date of the material transaction"
    )
    movement_type = models.CharField(
        max_length=10,
        help_text="SAP Movement Type e.g. 101, 601"
    )
    part_number = models.CharField(
        max_length=50,
        db_index=True,
        help_text="Material or Component Part Number"
    )
    material_description = models.CharField(
        max_length=255,
        blank=True,
        default='',
        help_text="Material or Finished Good description"
    )
    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        help_text="Transaction quantity"
    )
    uom = models.CharField(max_length=20, default='PC')
    storage_location = models.CharField(
        max_length=50,
        blank=True,
        default='SL01',
        help_text="Storage location (e.g. SL01, FG01)"
    )
    plant = models.CharField(
        max_length=50,
        blank=True,
        default='1001',
        help_text="Plant code"
    )
    vendor_customer = models.CharField(
        max_length=150,
        blank=True,
        default='',
        help_text="Vendor code/name for 101 receipts or Customer for 601 dispatches"
    )
    po_order_number = models.CharField(
        max_length=100,
        blank=True,
        default='',
        help_text="Purchase Order or Production Order reference"
    )
    classification = models.CharField(
        max_length=50,
        choices=CLASSIFICATION_CHOICES,
        db_index=True,
        help_text="Auto-classified category from movement type and part prefix"
    )
    week = models.ForeignKey(
        WeekDefinition,
        to_field='week_code',
        db_column='week_code',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='mb51_transactions',
        help_text="Mapped week code bucket (e.g. w-2026-08-01)"
    )
    upload_batch = models.ForeignKey(
        UploadBatch,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='mb51_transactions',
        help_text="Batch audit trail for bulk uploads"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'mb51_transaction'
        verbose_name = 'MB51 Transaction'
        verbose_name_plural = 'MB51 Transactions'
        ordering = ['-posting_date', 'material_document']
        indexes = [
            models.Index(fields=['part_number', 'classification', 'week']),
            models.Index(fields=['posting_date']),
            models.Index(fields=['material_document']),
            models.Index(fields=['classification']),
            models.Index(fields=['week', 'classification']),
        ]

    def __str__(self):
        return f"{self.material_document} | {self.part_number} | Mvt {self.movement_type}: {self.quantity} {self.uom}"

    @property
    def week_code(self):
        return self.week_id


class StockReport(models.Model):
    """
    SAP MB52 Unrestricted Stock Snapshot Report.
    Stores on-hand, blocked, quality inspection, and safety stock per part number and storage location.
    Unique on (part_number, storage_location).
    """
    MATERIAL_TYPE_CHOICES = (
        ('FG', 'Finished Good'),
        ('RM', 'Raw Material'),
        ('PM', 'Packaging Material'),
    )

    part_number = models.CharField(
        max_length=50,
        db_index=True,
        help_text="Component or FG Part Number (e.g. 7.06496.03.0 or 100201)"
    )
    material_description = models.CharField(
        max_length=255,
        blank=True,
        default='',
        help_text="Material or Component Description"
    )
    material_type = models.CharField(
        max_length=10,
        choices=MATERIAL_TYPE_CHOICES,
        db_index=True,
        help_text="Classification: 'FG' (prefix 7), 'RM' or 'PM'"
    )
    unrestricted_stock = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        default=Decimal('0.000'),
        help_text="Unrestricted available inventory on hand"
    )
    in_quality_insp = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        default=Decimal('0.000'),
        help_text="Stock currently undergoing quality inspection"
    )
    blocked = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        default=Decimal('0.000'),
        help_text="Blocked / quarantined stock"
    )
    storage_location = models.CharField(
        max_length=50,
        default='SL01',
        help_text="Storage location (e.g. SL01, RM01, FG01)"
    )
    uom = models.CharField(
        max_length=20,
        default='PC',
        help_text="Unit of Measure (e.g. PC, KG, SET)"
    )
    safety_stock = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        default=Decimal('0.000'),
        help_text="Safety stock buffer threshold"
    )
    plant = models.CharField(
        max_length=50,
        blank=True,
        default='1001',
        help_text="Plant code (default 1001)"
    )
    upload_batch = models.ForeignKey(
        UploadBatch,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='stock_reports',
        help_text="Batch audit trail for bulk uploads"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'stock_report'
        verbose_name = 'Stock Report'
        verbose_name_plural = 'Stock Reports'
        ordering = ['part_number', 'storage_location']
        unique_together = [('part_number', 'storage_location')]
        constraints = [
            models.UniqueConstraint(
                fields=['part_number', 'storage_location'],
                name='unique_part_storage_location'
            )
        ]
        indexes = [
            models.Index(fields=['part_number']),
            models.Index(fields=['part_number', 'storage_location']),
            models.Index(fields=['material_type']),
        ]

    def __str__(self):
        return f"{self.part_number} [{self.storage_location}]: {self.unrestricted_stock} {self.uom} ({self.material_type})"

    @property
    def total_stock(self):
        return self.unrestricted_stock + self.in_quality_insp + self.blocked

    @property
    def is_below_safety_stock(self):
        return self.unrestricted_stock < self.safety_stock






