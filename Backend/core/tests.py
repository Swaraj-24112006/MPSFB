from django.test import TestCase
from django.contrib.auth.models import User
from rest_framework import status
from rest_framework.test import APIClient, APITestCase
from core.models import (
    BOMFGHeader,
    RMPMComponentMaster,
    BOMMaster,
    VendorBuyerMaster,
    VendorSuppliedComponent,
)


class MasterDataAPITests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='testplanner', password='password123')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        # Components
        self.comp_rm1 = RMPMComponentMaster.objects.create(
            component_code='RM-CAST-01',
            component_description='Casting Part 01',
            category='RM',
            uom='KG',
            safety_stock=50,
            is_active=True
        )
        self.comp_pm1 = RMPMComponentMaster.objects.create(
            component_code='PM-BOX-01',
            component_description='Cardboard Box 01',
            category='PM',
            uom='PCS',
            safety_stock=100,
            is_active=True
        )

        # FG Header
        self.fg1 = BOMFGHeader.objects.create(
            fg_code='7001001',
            fg_description='Finished Pump Model X',
            mini_factory='MF-A',
            line='Line-1',
            unit_price_inr=15000.0,
            active_bom_version='v1',
            is_active=True
        )

    # --- Step 9: BOM FG Header Tests ---
    def test_fg_header_crud(self):
        # List
        res = self.client.get('/api/bom/fg-headers/')
        self.assertEqual(res.status_code, 200)

        # Create valid
        res = self.client.post('/api/bom/fg-headers/', {
            'fg_code': '7001002',
            'fg_description': 'Finished Motor Y',
            'mini_factory': 'MF-B',
            'line': 'Line-2',
            'unit_price_inr': 22000.0,
        }, content_type='application/json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()['active_bom_version'], 'v1')

        # Create invalid (code not starting with 7)
        res = self.client.post('/api/bom/fg-headers/', {
            'fg_code': '6001002',
            'fg_description': 'Invalid FG',
        }, content_type='application/json')
        self.assertEqual(res.status_code, 400)

        # Patch with version change gives warning
        res = self.client.patch('/api/bom/fg-headers/7001001/', {
            'active_bom_version': 'v2'
        }, content_type='application/json')
        self.assertEqual(res.status_code, 200)
        self.assertIn('warning', res.json())

    # --- Step 10: RM/PM Component Tests ---
    def test_component_crud(self):
        # List
        res = self.client.get('/api/components/')
        self.assertEqual(res.status_code, 200)

        # Create valid
        res = self.client.post('/api/components/', {
            'component_code': 'RM-BOLT-01',
            'component_description': 'Steel Bolt M8',
            'category': 'RM',
            'uom': 'PCS',
            'safety_stock': 200
        }, content_type='application/json')
        self.assertEqual(res.status_code, 201)

        # Create invalid (starts with 7)
        res = self.client.post('/api/components/', {
            'component_code': '7009999',
            'component_description': 'Illegal RM',
            'category': 'RM'
        }, content_type='application/json')
        self.assertEqual(res.status_code, 400)

        # Create invalid (negative safety stock)
        res = self.client.post('/api/components/', {
            'component_code': 'RM-PUMP-SUB',
            'component_description': 'Sub',
            'category': 'RM',
            'safety_stock': -5
        }, content_type='application/json')
        self.assertEqual(res.status_code, 400)

    # --- Step 11: BOM Master Tests ---
    def test_bom_master_crud_and_exploded(self):
        # Create BOM line
        res = self.client.post('/api/bom/', {
            'fg_code': self.fg1.fg_code,
            'component_code': self.comp_rm1.component_code,
            'qty': 2.5,
            'uom': 'KG',
            'bom_version': 'v1'
        }, content_type='application/json')
        self.assertEqual(res.status_code, 201)
        bom_id = res.json()['id']

        # Exploded BOM
        res_exp = self.client.get(f'/api/bom/exploded/{self.fg1.fg_code}/')
        self.assertEqual(res_exp.status_code, 200)
        exp_data = res_exp.json()
        self.assertEqual(exp_data['components_count'], 1)
        self.assertEqual(exp_data['components'][0]['component_code'], self.comp_rm1.component_code)

        # Component cannot be deleted while referenced in BOM (409 Conflict)
        res_del_comp = self.client.delete(f'/api/components/{self.comp_rm1.component_code}/')
        self.assertEqual(res_del_comp.status_code, 409)

        # Delete BOM line
        res_del = self.client.delete(f'/api/bom/{bom_id}/')
        self.assertEqual(res_del.status_code, 204)

    # --- Step 12: Vendor-Buyer Master CRUD Tests ---
    def test_vendor_buyer_crud(self):
        # 1. Validation: missing supplied_components
        res_bad1 = self.client.post('/api/vendor-buyers/', {
            'vendor_code': 'V-9001',
            'vendor_name': 'Test Vendor',
            'buyer_name': 'Suresh',
            'category': 'RM',
            'lead_time_days': 5,
            'supplied_components': []
        }, content_type='application/json')
        self.assertEqual(res_bad1.status_code, 400)

        # 2. Validation: non-existent component
        res_bad2 = self.client.post('/api/vendor-buyers/', {
            'vendor_code': 'V-9001',
            'vendor_name': 'Test Vendor',
            'buyer_name': 'Suresh',
            'category': 'RM',
            'lead_time_days': 5,
            'supplied_components': ['DOES-NOT-EXIST']
        }, content_type='application/json')
        self.assertEqual(res_bad2.status_code, 400)

        # 3. Create valid
        res_create = self.client.post('/api/vendor-buyers/', {
            'vendor_code': 'V-9001',
            'vendor_name': 'Mahindra Foundry',
            'buyer_name': 'Suresh Patil',
            'category': 'RM',
            'lead_time_days': 10,
            'city': 'Kolhapur',
            'gst_no': '27ABCDE1234F1Z5',
            'supplied_components': [self.comp_rm1.component_code]
        }, content_type='application/json')
        self.assertEqual(res_create.status_code, 201)
        data = res_create.json()
        vendor_id = data['id']
        self.assertEqual(data['supplied_components'], [self.comp_rm1.component_code])
        self.assertTrue(VendorSuppliedComponent.objects.filter(vendor_buyer_id=vendor_id).exists())

        # 4. Filters & Search
        res_filter = self.client.get('/api/vendor-buyers/?buyer_name=Suresh')
        self.assertEqual(res_filter.status_code, 200)
        self.assertEqual(len(res_filter.json()['results']), 1)

        res_unpaginated = self.client.get('/api/vendor-buyers/?paginate=false')
        self.assertEqual(res_unpaginated.status_code, 200)
        self.assertIsInstance(res_unpaginated.json(), list)

        # 5. Patch scalar only
        res_patch1 = self.client.patch(f'/api/vendor-buyers/{vendor_id}/', {
            'lead_time_days': 12
        }, content_type='application/json')
        self.assertEqual(res_patch1.status_code, 200)
        self.assertEqual(res_patch1.json()['lead_time_days'], 12)
        self.assertEqual(res_patch1.json()['supplied_components'], [self.comp_rm1.component_code])

        # 6. Patch supplied_components replaces junction rows
        res_patch2 = self.client.patch(f'/api/vendor-buyers/{vendor_id}/', {
            'supplied_components': [self.comp_pm1.component_code]
        }, content_type='application/json')
        self.assertEqual(res_patch2.status_code, 200)
        self.assertEqual(res_patch2.json()['supplied_components'], [self.comp_pm1.component_code])
        junction_codes = list(VendorSuppliedComponent.objects.filter(vendor_buyer_id=vendor_id).values_list('component_id', flat=True))
        self.assertEqual(junction_codes, [self.comp_pm1.component_code])

        # 7. Delete vendor cascades junction rows
        res_del = self.client.delete(f'/api/vendor-buyers/{vendor_id}/')
        self.assertEqual(res_del.status_code, 200)
        self.assertFalse(VendorBuyerMaster.objects.filter(id=vendor_id).exists())
        self.assertFalse(VendorSuppliedComponent.objects.filter(vendor_buyer_id=vendor_id).exists())


class MB51Step16Tests(TestCase):
    def setUp(self):
        from core.models import WeekDefinition, MB51Transaction
        from datetime import date

        self.w1 = WeekDefinition.objects.create(
            month='2026-08',
            week_no=1,
            week_code='w-2026-08-01',
            week_label='Week 1 (01-09 Aug)',
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 9),
            days_count=9,
            holiday_days=1,
            working_days=8
        )
        self.w2 = WeekDefinition.objects.create(
            month='2026-08',
            week_no=2,
            week_code='w-2026-08-02',
            week_label='Week 2 (10-16 Aug)',
            start_date=date(2026, 8, 10),
            end_date=date(2026, 8, 16),
            days_count=7,
            holiday_days=1,
            working_days=6
        )

    def test_classification_service(self):
        from core.services.mb51_classification_service import MB51ClassificationService

        # 101 with part starting with 7
        self.assertEqual(
            MB51ClassificationService.classify('101', '7001001'),
            MB51ClassificationService.FG_PRODUCTION_RECEIPT
        )
        self.assertEqual(
            MB51ClassificationService.classify('101', '7.06496.03.0'),
            MB51ClassificationService.FG_PRODUCTION_RECEIPT
        )

        # 101 with part NOT starting with 7
        self.assertEqual(
            MB51ClassificationService.classify('101', '100201'),
            MB51ClassificationService.RMPM_RECEIPT
        )
        self.assertEqual(
            MB51ClassificationService.classify('101', 'RM-CAST-01'),
            MB51ClassificationService.RMPM_RECEIPT
        )

        # 601 dispatch
        self.assertEqual(
            MB51ClassificationService.classify('601', '7001001'),
            MB51ClassificationService.FG_DISPATCH
        )
        self.assertEqual(
            MB51ClassificationService.classify('601', 'RM-CAST-01'),
            MB51ClassificationService.FG_DISPATCH
        )

        # Other movements
        self.assertEqual(
            MB51ClassificationService.classify('541', '100201'),
            MB51ClassificationService.OTHER
        )

    def test_week_mapping_service(self):
        from core.services.week_mapping_service import WeekMappingService
        from datetime import date

        # In-memory mapping with supplied weeks
        weeks = [self.w1, self.w2]
        self.assertEqual(WeekMappingService.map_to_week('2026-08-05', weeks), 'w-2026-08-01')
        self.assertEqual(WeekMappingService.map_to_week(date(2026, 8, 12), weeks), 'w-2026-08-02')
        self.assertIsNone(WeekMappingService.map_to_week('2026-09-01', weeks))

        # DB fallback mapping
        self.assertEqual(WeekMappingService.map_to_week('2026-08-09'), 'w-2026-08-01')
        self.assertEqual(WeekMappingService.map_to_week('2026-08-10'), 'w-2026-08-02')

        # Helper is_date_in_week
        self.assertTrue(WeekMappingService.is_date_in_week('2026-08-03', self.w1))
        self.assertFalse(WeekMappingService.is_date_in_week('2026-08-11', self.w1))

    def test_mb51_model_and_serializer(self):
        from core.models import MB51Transaction
        from core.serializers import MB51TransactionSerializer
        from datetime import date

        # Model direct create
        tx = MB51Transaction.objects.create(
            material_document='5001089211',
            posting_date=date(2026, 8, 4),
            movement_type='101',
            part_number='7.06496.03.0',
            material_description='Vacuum Pump 2.0L',
            quantity=2150,
            uom='PC',
            storage_location='FG01',
            classification='FG_PRODUCTION_RECEIPT',
            week=self.w1
        )
        self.assertEqual(tx.week_code, 'w-2026-08-01')
        self.assertEqual(tx.classification, 'FG_PRODUCTION_RECEIPT')

        # Serializer create with auto-computed classification & auto-resolved week
        payload = {
            'material_document': '5001089212',
            'posting_date': '2026-08-11',
            'movement_type': '101',
            'part_number': 'RM-HOUSING-01',
            'material_description': 'Housing Casting',
            'quantity': 500,
            'uom': 'PC',
            'storage_location': 'SL01',
        }
        serializer = MB51TransactionSerializer(data=payload)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        instance = serializer.save()

        # Classification auto-computed to RMPM_RECEIPT
        self.assertEqual(instance.classification, 'RMPM_RECEIPT')
        # Week auto-mapped to w-2026-08-02 based on 2026-08-11
        self.assertEqual(instance.week_id, 'w-2026-08-02')

        # Output representation checks (includes camelCase aliases)
        data = serializer.data
        self.assertEqual(data['classification'], 'RMPM_RECEIPT')
        self.assertEqual(data['week_code'], 'w-2026-08-02')
        self.assertEqual(data['materialDocument'], '5001089212')
        self.assertEqual(data['weekId'], 'w-2026-08-02')


class MB51Step17Tests(APITestCase):
    def setUp(self):
        from core.models import WeekDefinition, MB51Transaction
        self.user = User.objects.create_user(username='planner_test', password='password123')
        self.client.force_authenticate(user=self.user)

        self.w1 = WeekDefinition.objects.create(
            week_code='w-2026-08-01',
            month='2026-08',
            week_no=1,
            start_date='2026-08-01',
            end_date='2026-08-09',
            days_count=9,
            working_days=7
        )
        self.w2 = WeekDefinition.objects.create(
            week_code='w-2026-08-02',
            month='2026-08',
            week_no=2,
            start_date='2026-08-10',
            end_date='2026-08-16',
            days_count=7,
            working_days=6
        )

    def test_mb51_parser_comma_and_tab(self):
        from core.services.mb51_parser import MB51Parser
        # Test comma-separated with header
        csv_data = (
            "Material Document,Posting Date,Movement Type,Part Number,Description,Quantity,UOM,Storage Location,Vendor/Customer\n"
            '"5001001","2026-08-04","101","7.06496.03.0","FG Pump","1500","PC","FG01","CustA"\n'
            '"5001002","2026-08-12","101","RM-1002","Raw Housing","300","PC","SL01","VendorX"\n'
        )
        res = MB51Parser.parse(csv_data, weeks=[self.w1, self.w2])
        self.assertEqual(res['total_rows'], 2)
        self.assertEqual(len(res['valid_rows']), 2)
        self.assertEqual(res['valid_rows'][0]['material_document'], '5001001')
        self.assertEqual(res['valid_rows'][0]['quantity'], 1500)
        self.assertEqual(res['valid_rows'][1]['part_number'], 'RM-1002')

        # Test tab-separated with quotes & mvt header keyword
        tsv_data = (
            "MVT_DOC\tDATE\tBWART\tMATNR\tMAKTX\tMENGE\tMEINS\tLGORT\tLIFNR\n"
            "5002001\t2026-08-05\t601\t7.06496.03.0\tFG Pump\t800\tPC\tFG01\tCustB\n"
        )
        res_tsv = MB51Parser.parse(tsv_data, weeks=[self.w1, self.w2])
        self.assertEqual(len(res_tsv['valid_rows']), 1)
        self.assertEqual(res_tsv['valid_rows'][0]['movement_type'], '601')
        self.assertEqual(res_tsv['valid_rows'][0]['quantity'], 800)

    def test_mb51_parser_dd_mm_yyyy_dates_and_partner_header(self):
        from core.services.mb51_parser import MB51Parser
        from datetime import date
        csv_data = (
            "Material Document,Posting Date,Movement Type,Part Number,Material Description,Quantity,UOM,Storage Location,Partner / Vendor / Line,PO / Order No\n"
            "5000210031,05-08-2026,101,7.06496.03.0,Vacuum Pump Panther 2.0L,1500,PC,FG01,Line A-PMP2,PRD-88201\n"
            "5000210032,06-08-2026,101,100201,Die-Cast Aluminum Housing,3000,PC,SL01,Endurance Technologies,PO-4500091211\n"
            "5000210033,07-08-2026,601,7.06496.03.0,Vacuum Pump Panther 2.0L,2600,PC,FG01,Tata Motors PV & EV,SO-9021102\n"
            "5000210034,08-08-2026,101,100202,Precision Rotor Assembly,2200,PC,SL01,Bosch India,PO-4500091244\n"
        )
        res = MB51Parser.parse(csv_data, weeks=[self.w1, self.w2])
        self.assertEqual(res['total_rows'], 4)
        self.assertEqual(len(res['valid_rows']), 4)
        self.assertEqual(len(res['error_rows']), 0)
        self.assertEqual(res['valid_rows'][0]['material_document'], '5000210031')
        self.assertEqual(res['valid_rows'][0]['posting_date'], date(2026, 8, 5))
        self.assertEqual(res['valid_rows'][0]['vendor_customer'], 'Line A-PMP2')
        self.assertEqual(res['valid_rows'][0]['po_order_number'], 'PRD-88201')
        self.assertEqual(res['valid_rows'][0]['plant'], '1001')
        self.assertEqual(res['valid_rows'][1]['vendor_customer'], 'Endurance Technologies')

    def test_mb51_bulk_upload_endpoint_user_csv(self):
        from rest_framework import status
        csv_data = (
            "Material Document,Posting Date,Movement Type,Part Number,Material Description,Quantity,UOM,Storage Location,Partner / Vendor / Line,PO / Order No\n"
            "5000210031,05-08-2026,101,7.06496.03.0,Vacuum Pump Panther 2.0L,1500,PC,FG01,Line A-PMP2,PRD-88201\n"
            "5000210032,06-08-2026,101,100201,Die-Cast Aluminum Housing,3000,PC,SL01,Endurance Technologies,PO-4500091211\n"
            "5000210033,07-08-2026,601,7.06496.03.0,Vacuum Pump Panther 2.0L,2600,PC,FG01,Tata Motors PV & EV,SO-9021102\n"
            "5000210034,08-08-2026,101,100202,Precision Rotor Assembly,2200,PC,SL01,Bosch India,PO-4500091244\n"
        )
        res = self.client.post('/api/uploads/mb51/', {'csv_text': csv_data, 'month': '2026-08'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['total_rows'], 4)
        self.assertEqual(res.data['imported_rows'], 4)
        self.assertEqual(res.data['error_rows'], 0)

    def test_single_create_validations(self):
        # 1. Invalid movement type (e.g. 541) should be rejected on single create
        invalid_mvt = {
            'material_document': '5003001',
            'posting_date': '2026-08-05',
            'movement_type': '541',
            'part_number': 'RM-HOUSING',
            'quantity': 100,
        }
        res = self.client.post('/api/mb51/', invalid_mvt, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('movement_type', res.data)

        # 2. Invalid quantity (<= 0) should be rejected
        invalid_qty = {
            'material_document': '5003002',
            'posting_date': '2026-08-05',
            'movement_type': '101',
            'part_number': 'RM-HOUSING',
            'quantity': 0,
        }
        res = self.client.post('/api/mb51/', invalid_qty, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

        # 3. Valid 101 creation -> auto classify + map_to_week
        valid_payload = {
            'materialDocument': '5003003',
            'postingDate': '2026-08-05',
            'movementType': '101',
            'partNumber': '7.06496.03.0',
            'quantity': 1200,
            'storageLocation': 'FG01',
        }
        res = self.client.post('/api/mb51/', valid_payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['classification'], 'FG_PRODUCTION_RECEIPT')
        self.assertEqual(res.data['week_code'], 'w-2026-08-01')

    def test_list_and_filter_endpoints(self):
        from core.models import MB51Transaction
        MB51Transaction.objects.create(
            material_document='DOC001',
            posting_date='2026-08-05',
            movement_type='101',
            part_number='7.001',
            quantity=100,
            classification='FG_PRODUCTION_RECEIPT',
            week=self.w1
        )
        MB51Transaction.objects.create(
            material_document='DOC002',
            posting_date='2026-08-12',
            movement_type='101',
            part_number='RM001',
            quantity=200,
            classification='RMPM_RECEIPT',
            week=self.w2
        )
        MB51Transaction.objects.create(
            material_document='DOC003',
            posting_date='2026-08-14',
            movement_type='601',
            part_number='7.001',
            quantity=50,
            classification='FG_DISPATCH',
            week=self.w2
        )

        # List all
        res = self.client.get('/api/mb51/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 3)

        # Filter by classification
        res = self.client.get('/api/mb51/?classification=FG_DISPATCH')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 1)
        self.assertEqual(res.data['results'][0]['material_document'], 'DOC003')

        # Filter by week_code
        res = self.client.get('/api/mb51/?week_code=w-2026-08-01')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 1)

        # Filter by date range
        res = self.client.get('/api/mb51/?date_from=2026-08-10&date_to=2026-08-15')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.data['count'], 2)

        # Unpaginated list
        res = self.client.get('/api/mb51/?paginate=false')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertIsInstance(res.data, list)
        self.assertEqual(len(res.data), 3)

    def test_delete_endpoint(self):
        from core.models import MB51Transaction
        tx = MB51Transaction.objects.create(
            material_document='DOC_DEL',
            posting_date='2026-08-05',
            movement_type='101',
            part_number='7.001',
            quantity=100,
            classification='FG_PRODUCTION_RECEIPT',
            week=self.w1
        )
        res = self.client.delete(f'/api/mb51/{tx.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertFalse(MB51Transaction.objects.filter(id=tx.id).exists())

    def test_bulk_upload_endpoint_and_duplicate_warning(self):
        from core.models import MB51Transaction, UploadBatch
        csv_text = (
            "Material Document,Posting Date,Movement Type,Part Number,Description,Quantity,UOM,Storage Location,Vendor/Customer\n"
            "DOC_DUP1,2026-08-05,101,7.001,FG One,100,PC,FG01,Cust1\n"
            "DOC_DUP1,2026-08-06,101,7.001,FG One,150,PC,FG01,Cust1\n"
            "DOC_NEW1,2026-08-11,101,RM-01,RM Housing,500,PC,SL01,VendorX\n"
        )
        res = self.client.post('/api/uploads/mb51/', {'csv_text': csv_text, 'month': '2026-08'}, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        self.assertEqual(res.data['imported_rows'], 3)
        self.assertTrue(len(res.data['warnings']) > 0)
        self.assertIn("DOC_DUP1", res.data['warnings'][0])

        # Verify records created in DB
        self.assertEqual(MB51Transaction.objects.count(), 3)
        # Verify batch status
        batch = UploadBatch.objects.get(id=res.data['batch_id'])
        self.assertEqual(batch.status, 'COMPLETED')
        self.assertEqual(batch.imported_rows, 3)

    def test_csv_export_streaming(self):
        from core.models import MB51Transaction
        MB51Transaction.objects.create(
            material_document='EXP001',
            posting_date='2026-08-05',
            movement_type='101',
            part_number='7.001',
            quantity=120,
            classification='FG_PRODUCTION_RECEIPT',
            week=self.w1
        )
        res = self.client.get('/api/exports/mb51-csv/?month=2026-08&classification=FG_PRODUCTION_RECEIPT')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res['Content-Type'], 'text/csv')
        content = b"".join(res.streaming_content).decode('utf-8')
        self.assertIn("Material Document,Posting Date", content)
        self.assertIn("EXP001", content)
        self.assertIn("FG_PRODUCTION_RECEIPT", content)


class StockReportStep18Tests(APITestCase):
    def setUp(self):
        from core.models import StockReport, UploadBatch
        self.user = User.objects.create_user(username='stock_planner', password='password123')
        self.client.force_authenticate(user=self.user)
        self.batch = UploadBatch.objects.create(
            upload_type='STOCK_REPORT',
            uploaded_by='stock_planner',
            file_name='mb52_stock_snapshot.csv'
        )

    def test_stock_report_model_and_uniqueness(self):
        from django.db import IntegrityError
        from core.models import StockReport
        from decimal import Decimal

        # 1. Create valid stock report
        item1 = StockReport.objects.create(
            part_number='100201',
            material_description='Die-Cast Aluminum Housing',
            material_type='RM',
            unrestricted_stock=Decimal('850.000'),
            in_quality_insp=Decimal('50.000'),
            blocked=Decimal('0.000'),
            storage_location='RM01',
            uom='PC',
            safety_stock=Decimal('300.000'),
            plant='1001',
            upload_batch=self.batch
        )
        self.assertEqual(item1.total_stock, Decimal('900.000'))
        self.assertFalse(item1.is_below_safety_stock)

        # 2. Attempt duplicate on (part_number, storage_location) -> should fail
        from django.db import transaction
        with transaction.atomic():
            with self.assertRaises(IntegrityError):
                StockReport.objects.create(
                    part_number='100201',
                    storage_location='RM01',
                    unrestricted_stock=Decimal('100.000'),
                    material_type='RM'
                )

        # 3. Same part_number but different storage_location -> should succeed
        item2 = StockReport.objects.create(
            part_number='100201',
            storage_location='SL02',
            unrestricted_stock=Decimal('150.000'),
            safety_stock=Decimal('200.000'),
            material_type='RM'
        )
        self.assertTrue(item2.is_below_safety_stock)
        self.assertEqual(item2.total_stock, Decimal('150.000'))

    def test_upload_batch_foreign_key_set_null(self):
        from core.models import StockReport, UploadBatch
        from decimal import Decimal

        item = StockReport.objects.create(
            part_number='200405',
            material_description='Sliding Vanes',
            material_type='RM',
            unrestricted_stock=Decimal('500.000'),
            storage_location='RM01',
            upload_batch=self.batch
        )
        self.assertEqual(item.upload_batch_id, self.batch.id)

        # Delete batch -> FK must become NULL (SET_NULL)
        self.batch.delete()
        item.refresh_from_db()
        self.assertIsNone(item.upload_batch)

    def test_stock_report_serializer_computed_material_type(self):
        from core.serializers import StockReportSerializer

        # 1. Finished Good (starts with 7) -> material_type auto-computed to 'FG'
        fg_payload = {
            'partNumber': '7.06496.03.0',
            'materialDescription': 'Vacuum Pump Panther',
            'unrestrictedStock': 2400,
            'storageLocation': 'FG01',
            'safetyStock': 1000,
            'materialType': 'WILL_BE_OVERRIDDEN'
        }
        ser = StockReportSerializer(data=fg_payload)
        self.assertTrue(ser.is_valid(), ser.errors)
        instance = ser.save()
        self.assertEqual(instance.material_type, 'FG')
        self.assertEqual(ser.data['materialType'], 'FG')
        self.assertEqual(ser.data['partNumber'], '7.06496.03.0')
        self.assertEqual(ser.data['unrestrictedStock'], 2400.0)
        self.assertFalse(ser.data['isBelowSafetyStock'])

        # 2. Raw Material (starts with 1 or 2) -> auto-computed to 'RM'
        rm_payload = {
            'part_number': '100201',
            'material_description': 'Housing',
            'unrestricted_stock': 150,
            'safety_stock': 300,
            'storage_location': 'RM01'
        }
        ser_rm = StockReportSerializer(data=rm_payload)
        self.assertTrue(ser_rm.is_valid(), ser_rm.errors)
        instance_rm = ser_rm.save()
        self.assertEqual(instance_rm.material_type, 'RM')
        self.assertEqual(ser_rm.data['materialType'], 'RM')
        self.assertTrue(ser_rm.data['isBelowSafetyStock'])

        # 3. Packaging Material (starts with PM- or matching pattern) -> auto-computed to 'PM'
        pm_payload = {
            'partNumber': 'PM-BOX-01',
            'materialDescription': 'Corrugated Master Box',
            'unrestrictedStock': 5000,
            'storageLocation': 'PM01'
        }
        ser_pm = StockReportSerializer(data=pm_payload)
        self.assertTrue(ser_pm.is_valid(), ser_pm.errors)
        instance_pm = ser_pm.save()
        self.assertEqual(instance_pm.material_type, 'PM')
        self.assertEqual(ser_pm.data['materialType'], 'PM')

    def test_stock_report_serializer_validations(self):
        from core.serializers import StockReportSerializer

        # Reject negative unrestricted stock
        invalid_stock = {
            'partNumber': '100201',
            'unrestrictedStock': -50,
            'storageLocation': 'RM01'
        }
        ser = StockReportSerializer(data=invalid_stock)
        self.assertFalse(ser.is_valid())
        self.assertIn('unrestricted_stock', ser.errors)


class StockReportStep19APITests(APITestCase):
    """Step 19 — Stock Report CRUD + Bulk Upload + CSV Export API Tests"""

    def setUp(self):
        self.user = User.objects.create_user(username='stocktester', password='pw')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        from core.models import StockReport
        self.stock1 = StockReport.objects.create(
            part_number='100201',
            material_description='Casting Part A',
            material_type='RM',
            unrestricted_stock=500,
            in_quality_insp=20,
            blocked=5,
            safety_stock=200,
            uom='KG',
            storage_location='RM01',
            plant='1001'
        )
        self.stock2 = StockReport.objects.create(
            part_number='7.06496.03.0',
            material_description='Finished Good Alpha',
            material_type='FG',
            unrestricted_stock=1000,
            safety_stock=100,
            uom='PC',
            storage_location='FG01',
            plant='1001'
        )

    # --- List ---
    def test_list_stock(self):
        resp = self.client.get('/api/v1/stock/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('results', resp.data)
        self.assertEqual(resp.data['count'], 2)

    def test_list_stock_filter_material_type(self):
        resp = self.client.get('/api/v1/stock/', {'material_type': 'FG'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 1)
        self.assertEqual(resp.data['results'][0]['partNumber'], '7.06496.03.0')

    def test_list_stock_search(self):
        resp = self.client.get('/api/v1/stock/', {'search': 'Casting'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 1)

    def test_list_stock_below_safety(self):
        # stock1 has 500 > 200 safety, stock2 has 1000 > 100 safety — neither below
        resp = self.client.get('/api/v1/stock/', {'below_safety_stock': 'true'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['count'], 0)

        # Lower stock1 unrestricted below safety
        self.stock1.unrestricted_stock = 100
        self.stock1.save()
        resp2 = self.client.get('/api/v1/stock/', {'below_safety_stock': 'true'})
        self.assertEqual(resp2.data['count'], 1)

    def test_list_stock_unpaginated(self):
        resp = self.client.get('/api/v1/stock/', {'paginate': 'false'})
        self.assertEqual(resp.status_code, 200)
        self.assertIsInstance(resp.data, list)
        self.assertEqual(len(resp.data), 2)

    # --- Create ---
    def test_create_stock_single(self):
        payload = {
            'partNumber': 'PM-BOX-01',
            'materialDescription': 'Corrugated Box',
            'unrestrictedStock': 2000,
            'storageLocation': 'PM01'
        }
        resp = self.client.post('/api/v1/stock/', payload, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['materialType'], 'PM')
        self.assertEqual(resp.data['partNumber'], 'PM-BOX-01')

    def test_create_stock_auto_material_type(self):
        payload = {
            'partNumber': '7.11111.00.0',
            'materialDescription': 'FG Widget',
            'unrestrictedStock': 50,
            'storageLocation': 'FG01'
        }
        resp = self.client.post('/api/v1/stock/', payload, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['materialType'], 'FG')

    # --- Update ---
    def test_update_stock(self):
        resp = self.client.patch(f'/api/v1/stock/{self.stock1.id}/', {
            'unrestrictedStock': 999
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['unrestrictedStock'], 999.0)

    # --- Delete ---
    def test_delete_stock(self):
        resp = self.client.delete(f'/api/v1/stock/{self.stock1.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('deleted successfully', resp.data['message'])

        from core.models import StockReport
        self.assertFalse(StockReport.objects.filter(id=self.stock1.id).exists())

    # --- Bulk Upload (replace mode) ---
    def test_bulk_upload_replace_mode(self):
        csv_content = (
            "Part Number,Description,Unrestricted Stock,In QI,Blocked,Safety Stock,UOM,Storage Location\n"
            "100201,Casting Part A Updated,800,10,0,200,KG,RM01\n"
            "NEW-PART-01,New Component,300,0,0,50,PC,SL01\n"
        )
        resp = self.client.post('/api/v1/uploads/stock-report/', {
            'csv_text': csv_content,
            'mode': 'replace'
        }, format='multipart')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['imported_rows'], 2)

        # Verify 100201 was updated (not duplicated)
        from core.models import StockReport
        updated = StockReport.objects.get(part_number='100201', storage_location='RM01')
        self.assertEqual(float(updated.unrestricted_stock), 800.0)
        self.assertEqual(updated.material_description, 'Casting Part A Updated')

    # --- CSV Export ---
    def test_export_csv(self):
        resp = self.client.get('/api/v1/exports/stock-csv/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp['Content-Type'], 'text/csv')
        self.assertIn('stock_report_', resp['Content-Disposition'])

    def test_export_csv_filtered(self):
        resp = self.client.get('/api/v1/exports/stock-csv/', {'material_type': 'RM'})
        self.assertEqual(resp.status_code, 200)
        content = b''.join(resp.streaming_content).decode('utf-8')
        self.assertIn('100201', content)
        self.assertNotIn('7.06496.03.0', content)
