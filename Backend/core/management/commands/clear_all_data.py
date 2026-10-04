from django.core.management.base import BaseCommand
from django.db import transaction
from core.models import (
    DeliveryScheduleChangeLog,
    VendorDeliverySchedule,
    UploadBatch,
    MondayReviewAction,
    FGPlanFreeze,
    StockReport,
    MB51Transaction,
    MonthlyPlan,
    BOMMaster,
    VendorSuppliedComponent,
    VendorBuyerMaster,
    RMPMComponentMaster,
    BOMFGHeader,
    WeekDefinition,
)


class Command(BaseCommand):
    help = "Clear all dummy data from the database across all tabs"

    def add_arguments(self, parser):
        parser.add_argument(
            '--keep-weeks',
            action='store_true',
            help='Keep week definitions and clear only transactional & master data',
        )

    @transaction.atomic
    def handle(self, *args, **options):
        self.stdout.write("Clearing all data from database...")

        # 1. Delivery Schedules & Change Logs
        c1 = DeliveryScheduleChangeLog.objects.all().delete()[0]
        c2 = VendorDeliverySchedule.objects.all().delete()[0]
        self.stdout.write(f"  Deleted {c2} VendorDeliverySchedule records, {c1} DeliveryScheduleChangeLog records")

        # 2. Upload Batches
        c3 = UploadBatch.objects.all().delete()[0]
        self.stdout.write(f"  Deleted {c3} UploadBatch records")

        # 3. Monday Review Actions & Plan Freezes
        c4 = MondayReviewAction.objects.all().delete()[0]
        c5 = FGPlanFreeze.objects.all().delete()[0]
        self.stdout.write(f"  Deleted {c4} MondayReviewAction records, {c5} FGPlanFreeze records")

        # 4. Stock Reports & MB51 Material Transactions
        c6 = StockReport.objects.all().delete()[0]
        c7 = MB51Transaction.objects.all().delete()[0]
        self.stdout.write(f"  Deleted {c6} StockReport records, {c7} MB51Transaction records")

        # 5. Monthly Plans
        c8 = MonthlyPlan.objects.all().delete()[0]
        self.stdout.write(f"  Deleted {c8} MonthlyPlan records")

        # 6. BOM Master lines
        c9 = BOMMaster.objects.all().delete()[0]
        self.stdout.write(f"  Deleted {c9} BOMMaster records")

        # 7. Vendor-Buyer Master and Supplied Components
        c10 = VendorSuppliedComponent.objects.all().delete()[0]
        c11 = VendorBuyerMaster.objects.all().delete()[0]
        self.stdout.write(f"  Deleted {c10} VendorSuppliedComponent records, {c11} VendorBuyerMaster records")

        # 8. Finished Goods & RM/PM Components
        c12 = RMPMComponentMaster.objects.all().delete()[0]
        c13 = BOMFGHeader.objects.all().delete()[0]
        self.stdout.write(f"  Deleted {c12} RMPMComponentMaster records, {c13} BOMFGHeader records")

        # 9. Week Definitions
        if not options.get('keep_weeks'):
            c14 = WeekDefinition.objects.all().delete()[0]
            self.stdout.write(f"  Deleted {c14} WeekDefinition records")
        else:
            self.stdout.write("  Retained WeekDefinition records (--keep-weeks)")

        self.stdout.write(self.style.SUCCESS("All data cleared successfully!"))
