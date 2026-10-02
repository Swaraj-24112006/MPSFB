from django.urls import path
from .views import (
    health_check,
    BOMFGHeaderListCreateView,
    BOMFGHeaderDetailView,
    ComponentListCreateView,
    ComponentDetailView,
    BOMMasterListCreateView,
    BOMMasterDetailView,
    ExplodedBOMView,
    CommonComponentsView,
    VendorBuyerListCreateView,
    VendorBuyerDetailView,
    BOMCSVUploadView,
    VendorBuyerCSVUploadView,
    WeekListCreateView,
    WeekDetailView,
    WeekAutoGenerateView,
    WeekCSVExportView,
    MonthlyPlanListCreateView,
    MonthlyPlanDetailView,
    MonthlyPlanBulkUploadView,
    MonthlyPlanRecalculateView,
    MonthlyPlanCSVExportView,
    UploadBatchDetailView,
    MB51ListCreateView,
    MB51DetailView,
    MB51BulkUploadView,
    MB51ExportCSVView,
    StockListCreateView,
    StockDetailView,
    StockBulkUploadView,
    StockExportCSVView,
    # Monday Review Cockpit views
    MondayReviewCockpitView,
    MondayReviewCockpitExportCSVView,
    PlanFreezeListView,
    PlanFreezeUpdateView,
    PlanFreezeBulkView,
    MondayActionListCreateView,
    MondayActionDetailView,
    VendorScheduleListCreateView,
    VendorScheduleDetailView,
    DeliveryChangeLogListView,
)



urlpatterns = [
    path('health/', health_check, name='health_check'),

    # Step 9: BOM FG Header CRUD
    path('bom/fg-headers/', BOMFGHeaderListCreateView.as_view(), name='bom_fg_header_list_create'),
    path('bom/fg-headers/<str:fg_code>/', BOMFGHeaderDetailView.as_view(), name='bom_fg_header_detail'),

    # Step 10: RM/PM Component Master CRUD
    path('components/', ComponentListCreateView.as_view(), name='component_list_create'),
    path('components/<str:component_code>/', ComponentDetailView.as_view(), name='component_detail'),

    # Step 11: BOM Master CRUD + Exploded BOM + Common Components + CSV Upload
    path('bom/common-components/', CommonComponentsView.as_view(), name='bom_common_components'),
    path('bom/exploded/<str:fg_code>/', ExplodedBOMView.as_view(), name='bom_exploded'),
    path('bom/upload-csv/', BOMCSVUploadView.as_view(), name='bom_upload_csv'),
    path('bom/', BOMMasterListCreateView.as_view(), name='bom_master_list_create'),
    path('bom/<int:pk>/', BOMMasterDetailView.as_view(), name='bom_master_detail'),

    # Step 12: Vendor-Buyer Master CRUD + CSV Upload
    path('vendor-buyers/upload-csv/', VendorBuyerCSVUploadView.as_view(), name='vendor_buyer_upload_csv'),
    path('vendor-buyers/', VendorBuyerListCreateView.as_view(), name='vendor_buyer_list_create'),
    path('vendor-buyers/<int:pk>/', VendorBuyerDetailView.as_view(), name='vendor_buyer_detail'),

    # Step 13: Week Definitions CRUD + Auto-Generate + CSV Export
    path('weeks/auto-generate/', WeekAutoGenerateView.as_view(), name='week_auto_generate'),
    path('weeks/', WeekListCreateView.as_view(), name='week_list_create'),
    path('weeks/<str:pk>/', WeekDetailView.as_view(), name='week_detail'),
    path('exports/weeks-csv/', WeekCSVExportView.as_view(), name='week_export_csv'),

    # Step 14: Monthly Plan CRUD + Recalculate + CSV Export
    path('monthly-plans/recalculate/', MonthlyPlanRecalculateView.as_view(), name='monthly_plan_recalculate'),
    path('monthly-plans/', MonthlyPlanListCreateView.as_view(), name='monthly_plan_list_create'),
    path('monthly-plans/<int:pk>/', MonthlyPlanDetailView.as_view(), name='monthly_plan_detail'),
    path('exports/monthly-plan-csv/', MonthlyPlanCSVExportView.as_view(), name='monthly_plan_export_csv'),

    # Step 15: Monthly Plan Bulk Upload + Batch Detail
    path('uploads/monthly-plan/', MonthlyPlanBulkUploadView.as_view(), name='monthly_plan_bulk_upload'),
    path('uploads/batches/<int:pk>/', UploadBatchDetailView.as_view(), name='upload_batch_detail'),

    # Step 17: MB51 Material Movement Transactions CRUD + Bulk Upload + CSV Export
    path('mb51/', MB51ListCreateView.as_view(), name='mb51_list_create'),
    path('mb51/<int:pk>/', MB51DetailView.as_view(), name='mb51_detail'),
    path('uploads/mb51/', MB51BulkUploadView.as_view(), name='mb51_bulk_upload'),
    path('exports/mb51-csv/', MB51ExportCSVView.as_view(), name='mb51_export_csv'),

    # Step 19: Stock Report CRUD + Bulk Upload + CSV Export
    path('stock/', StockListCreateView.as_view(), name='stock_list_create'),
    path('stock/<int:pk>/', StockDetailView.as_view(), name='stock_detail'),
    path('uploads/stock-report/', StockBulkUploadView.as_view(), name='stock_bulk_upload'),
    path('exports/stock-csv/', StockExportCSVView.as_view(), name='stock_export_csv'),

    # ─── Monday Review Cockpit ───────────────────────────────────────────
    # D1: Main cockpit computation
    path('reports/monday-review-cockpit/', MondayReviewCockpitView.as_view(), name='monday_review_cockpit'),
    path('reports/monday-review-cockpit/export-csv/', MondayReviewCockpitExportCSVView.as_view(), name='cockpit_export_csv'),

    # D2-D4: Plan Freeze (list+upsert on same path, bulk separate)
    path('plan-freeze/', PlanFreezeListView.as_view(), name='plan_freeze'),
    path('plan-freeze/bulk/', PlanFreezeBulkView.as_view(), name='plan_freeze_bulk'),

    # D5-D6: Monday Review Actions
    path('monday-review-actions/', MondayActionListCreateView.as_view(), name='monday_action_list_create'),
    path('monday-review-actions/<int:pk>/', MondayActionDetailView.as_view(), name='monday_action_detail'),

    # D7-D8: Vendor Delivery Schedules
    path('vendor-delivery-schedules/', VendorScheduleListCreateView.as_view(), name='vendor_schedule_list_create'),
    path('vendor-delivery-schedules/<int:pk>/', VendorScheduleDetailView.as_view(), name='vendor_schedule_detail'),

    # D9: Delivery Schedule Change Logs (audit trail)
    path('vendor-delivery-schedules/change-logs/', DeliveryChangeLogListView.as_view(), name='delivery_change_log_list'),
]
