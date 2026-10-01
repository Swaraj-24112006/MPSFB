import io
import csv
from datetime import date
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework import status

from core.models import (
    WeekDefinition,
    MonthlyPlan,
    BOMFGHeader,
    UploadBatch,
    FGPlanFreeze,
    MondayReviewAction,
)
from core.services.week_service import WeekService
from core.services.prorate_service import ProrateService
from core.services.monthly_plan_parser import MonthlyPlanParser
from core.services.monthly_plan_upload_service import MonthlyPlanUploadService


from unittest.mock import patch
from core.services.storage_service import StorageService
from django.contrib.auth.models import User

class MonthlyUploadTests(TestCase):
    def setUp(self):
        self.patcher = patch.object(StorageService, 'upload_file', side_effect=lambda f, dest: f"mock_storage/{dest}")
        self.patcher.start()
        self.user = User.objects.create_user(username='testplanner', password='password123')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.month = '2026-08'

        # Create sample BOM Finished Good header
        self.fg1 = BOMFGHeader.objects.create(
            fg_code='7.06496.03.0',
            fg_description='Vacuum Pump Panther 2.0L',
            customer_segment='Tata Motors PV & EV',
            uom='PC',
            is_active=True
        )
        self.fg2 = BOMFGHeader.objects.create(
            fg_code='7.08241.00.0',
            fg_description='FAM B Tandem Vacuum Pump',
            customer_segment='Mahindra',
            uom='PC',
            is_active=True
        )

    def tearDown(self):
        self.patcher.stop()

    # ─────────────────────────────────────────────────────────────────────────
    # Stage B: Week Service & Week Definition API Tests
    # ─────────────────────────────────────────────────────────────────────────

    def test_compute_days_and_working_days(self):
        """Test calculation of days count and working days (minimum clamped to 1)"""
        days = WeekService.compute_days_count(date(2026, 8, 1), date(2026, 8, 7))
        self.assertEqual(days, 7)
        working = WeekService.compute_working_days(days, holiday_days=1)
        self.assertEqual(working, 6)

        # Holiday deduction clamped to minimum 1
        zero_working = WeekService.compute_working_days(1, holiday_days=5)
        self.assertEqual(zero_working, 1)

    def test_create_week_auto_computes_fields(self):
        """Creating a week auto-computes days_count, working_days, and week_code"""
        payload = {
            'month': self.month,
            'week_no': 1,
            'start_date': '2026-08-01',
            'end_date': '2026-08-07',
            'holiday_days': 1,
        }
        res = self.client.post('/api/weeks/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        data = res.json()
        self.assertEqual(data['week_code'], 'w-2026-08-01')
        self.assertEqual(data['days_count'], 7)
        self.assertEqual(data['working_days'], 6)

    def test_week_validation_dates_outside_month(self):
        """Dates outside calendar month boundaries must be rejected with 400"""
        payload = {
            'month': self.month,
            'week_no': 1,
            'start_date': '2026-07-31',  # July date in August bucket
            'end_date': '2026-08-07',
            'holiday_days': 0,
        }
        res = self.client.post('/api/weeks/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_week_validation_overlapping_dates(self):
        """Weeks with overlapping date ranges within the same month must be rejected"""
        # Create W1
        WeekDefinition.objects.create(
            month=self.month,
            week_no=1,
            week_code='w-2026-08-01',
            week_label='Week 1',
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 7),
            days_count=7,
            holiday_days=1,
            working_days=6
        )
        # Attempt to create W2 overlapping on 2026-08-07
        payload = {
            'month': self.month,
            'week_no': 2,
            'start_date': '2026-08-07',
            'end_date': '2026-08-14',
            'holiday_days': 1,
        }
        res = self.client.post('/api/weeks/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_auto_generate_standard_4_week_split(self):
        """Auto-generate month creates standard 4-week split with correct dates and working days"""
        res = self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        weeks = list(WeekDefinition.objects.filter(month=self.month).order_by('week_no'))
        self.assertEqual(len(weeks), 4)

        # W1: 01-07 (6 working)
        self.assertEqual(str(weeks[0].start_date), '2026-08-01')
        self.assertEqual(str(weeks[0].end_date), '2026-08-07')
        self.assertEqual(weeks[0].working_days, 6)

        # W2: 08-14 (6 working)
        self.assertEqual(str(weeks[1].start_date), '2026-08-08')
        self.assertEqual(str(weeks[1].end_date), '2026-08-14')
        self.assertEqual(weeks[1].working_days, 6)

        # W3: 15-21 (6 working)
        self.assertEqual(str(weeks[2].start_date), '2026-08-15')
        self.assertEqual(str(weeks[2].end_date), '2026-08-21')
        self.assertEqual(weeks[2].working_days, 6)

        # W4: 22-31 (10 days, 2 holidays -> 8 working)
        self.assertEqual(str(weeks[3].start_date), '2026-08-22')
        self.assertEqual(str(weeks[3].end_date), '2026-08-31')
        self.assertEqual(weeks[3].days_count, 10)
        self.assertEqual(weeks[3].working_days, 8)

    def test_auto_generate_full_year(self):
        """Auto-generate full year creates 48 week buckets (12 months x 4 weeks)"""
        res = self.client.post('/api/weeks/auto-generate/', {'year': '2026', 'overwrite': True}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        count = WeekDefinition.objects.filter(month__startswith='2026-').count()
        self.assertEqual(count, 48)

    def test_delete_week_blocked_when_referenced(self):
        """Deleting a week referenced by plan freeze or Monday review action must return 409"""
        w = WeekDefinition.objects.create(
            month=self.month,
            week_no=1,
            week_code='w-2026-08-01',
            week_label='Week 1',
            start_date=date(2026, 8, 1),
            end_date=date(2026, 8, 7),
            days_count=7,
            holiday_days=1,
            working_days=6
        )
        # Create plan freeze referencing week
        FGPlanFreeze.objects.create(
            fg=self.fg1,
            month=self.month,
            week=w,
            status='FROZEN'
        )
        res = self.client.delete(f'/api/weeks/{w.id}/')
        self.assertEqual(res.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(WeekDefinition.objects.filter(id=w.id).exists())

    # ─────────────────────────────────────────────────────────────────────────
    # Stage C: Proration Formula & Cascade Tests
    # ─────────────────────────────────────────────────────────────────────────

    def test_proration_worked_example_august_2026(self):
        """
        Verify exact formula from Part 2 worked example:
        August 2026: W1=6, W2=6, W3=6, W4=8 working days (total 26).
        Vacuum Pump (target=10,000):
          W1 = round(10000 * 6/26) = 2308
          W2 = round(10000 * 6/26) = 2308
          W3 = round(10000 * 6/26) = 2308
          W4 = remainder 10000 - 6924 = 3076
          Sum = 10,000 exactly
        """
        # Create standard August weeks
        self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')
        weeks = list(WeekDefinition.objects.filter(month=self.month).order_by('week_no'))

        breakdown = ProrateService.prorate(10000, weeks)
        self.assertEqual(breakdown['w-2026-08-01'], 2308)
        self.assertEqual(breakdown['w-2026-08-02'], 2308)
        self.assertEqual(breakdown['w-2026-08-03'], 2308)
        self.assertEqual(breakdown['w-2026-08-04'], 3076)
        self.assertEqual(sum(breakdown.values()), 10000)

        # FAM B Tandem Vacuum Pump (target=8,000)
        breakdown_8k = ProrateService.prorate(8000, weeks)
        self.assertEqual(breakdown_8k['w-2026-08-01'], 1846)
        self.assertEqual(breakdown_8k['w-2026-08-02'], 1846)
        self.assertEqual(breakdown_8k['w-2026-08-03'], 1846)
        self.assertEqual(breakdown_8k['w-2026-08-04'], 2462)
        self.assertEqual(sum(breakdown_8k.values()), 8000)

    def test_cascade_reprorate_on_week_update(self):
        """Updating a week's holiday days cascades re-proration to all monthly plans"""
        # Set up weeks and plan
        self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')
        plan = MonthlyPlan.objects.create(
            fg=self.fg1,
            month=self.month,
            monthly_target=10000,
            weekly_breakdown=ProrateService.prorate(10000, WeekDefinition.objects.filter(month=self.month))
        )
        self.assertEqual(plan.weekly_breakdown['w-2026-08-04'], 3076)

        # Update W4 holiday days from 2 to 4 (working days decreases from 8 to 6)
        # Total working days becomes 6 + 6 + 6 + 6 = 24
        w4 = WeekDefinition.objects.get(month=self.month, week_no=4)
        patch_res = self.client.patch(f'/api/weeks/{w4.id}/', {'holiday_days': 4}, format='json')
        self.assertEqual(patch_res.status_code, status.HTTP_200_OK)
        self.assertEqual(patch_res.json()['cascade_plans_updated'], 1)

        # Refresh plan and verify re-prorated: 10000 / 24 * 6 = 2500 per week
        plan.refresh_from_db()
        self.assertEqual(plan.weekly_breakdown['w-2026-08-01'], 2500)
        self.assertEqual(plan.weekly_breakdown['w-2026-08-02'], 2500)
        self.assertEqual(plan.weekly_breakdown['w-2026-08-03'], 2500)
        self.assertEqual(plan.weekly_breakdown['w-2026-08-04'], 2500)
        self.assertEqual(sum(plan.weekly_breakdown.values()), 10000)

    def test_cascade_reprorate_on_week_delete(self):
        """Deleting a week cascades re-proration across remaining weeks"""
        self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')
        plan = MonthlyPlan.objects.create(
            fg=self.fg1,
            month=self.month,
            monthly_target=10000,
            weekly_breakdown=ProrateService.prorate(10000, WeekDefinition.objects.filter(month=self.month))
        )
        # Delete W4
        w4 = WeekDefinition.objects.get(month=self.month, week_no=4)
        del_res = self.client.delete(f'/api/weeks/{w4.id}/')
        self.assertEqual(del_res.status_code, status.HTTP_200_OK)

        # Now only 3 weeks (6, 6, 6 working days, total 18)
        # round(10000 * 6/18) = 3333, last week gets 10000 - 6666 = 3334
        plan.refresh_from_db()
        self.assertNotIn('w-2026-08-04', plan.weekly_breakdown)
        self.assertEqual(plan.weekly_breakdown['w-2026-08-01'], 3333)
        self.assertEqual(plan.weekly_breakdown['w-2026-08-02'], 3333)
        self.assertEqual(plan.weekly_breakdown['w-2026-08-03'], 3334)
        self.assertEqual(sum(plan.weekly_breakdown.values()), 10000)

    # ─────────────────────────────────────────────────────────────────────────
    # Stage D: Monthly Plan CRUD Tests
    # ─────────────────────────────────────────────────────────────────────────

    def test_create_monthly_plan_prorates_and_validates(self):
        """Creating a monthly plan validates fg_code starts with '7', target > 0, and prorates"""
        self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')

        payload = {
            'fg_code': self.fg1.fg_code,
            'month': self.month,
            'monthly_target': 10000,
            'customer_name': 'Tata Motors',
            'uom': 'PC'
        }
        res = self.client.post('/api/monthly-plans/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_201_CREATED)
        data = res.json()
        self.assertEqual(data['fg_code'], self.fg1.fg_code)
        self.assertEqual(data['monthly_target'], 10000)
        self.assertEqual(data['weekly_breakdown']['w-2026-08-01'], 2308)
        self.assertEqual(sum(data['weekly_breakdown'].values()), 10000)

    def test_create_monthly_plan_rejects_non_7_fg(self):
        """FG Code not starting with '7' is rejected with 400"""
        self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')
        payload = {
            'fg_code': '1.WRONG.01',
            'month': self.month,
            'monthly_target': 5000,
        }
        res = self.client.post('/api/monthly-plans/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_monthly_plan_duplicate_returns_409(self):
        """Duplicate (fg_code, month) on manual creation returns 409 Conflict"""
        self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')
        payload = {
            'fg_code': self.fg1.fg_code,
            'month': self.month,
            'monthly_target': 5000,
        }
        # First creation succeeds
        res1 = self.client.post('/api/monthly-plans/', payload, format='json')
        self.assertEqual(res1.status_code, status.HTTP_201_CREATED)

        # Duplicate returns 409 Conflict
        res2 = self.client.post('/api/monthly-plans/', payload, format='json')
        self.assertEqual(res2.status_code, status.HTTP_409_CONFLICT)

    def test_create_monthly_plan_without_weeks_returns_400(self):
        """Creating a monthly plan when no weeks exist for month returns 400"""
        payload = {
            'fg_code': self.fg1.fg_code,
            'month': '2028-01',  # No weeks configured for 2028-01
            'monthly_target': 5000,
        }
        res = self.client.post('/api/monthly-plans/', payload, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('No week definitions configured', str(res.json()))

    def test_update_monthly_plan_target_re_prorates(self):
        """Updating target re-prorates weekly_breakdown server-side and ignores client breakdown"""
        self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')
        plan = MonthlyPlan.objects.create(
            fg=self.fg1,
            month=self.month,
            monthly_target=10000,
            weekly_breakdown=ProrateService.prorate(10000, WeekDefinition.objects.filter(month=self.month))
        )
        # Update target to 8000 and try to tamper with weekly_breakdown
        patch_res = self.client.patch(
            f'/api/monthly-plans/{plan.id}/',
            {'monthly_target': 8000, 'weekly_breakdown': {'w-2026-08-01': 99999}},
            format='json'
        )
        self.assertEqual(patch_res.status_code, status.HTTP_200_OK)
        data = patch_res.json()
        self.assertEqual(data['monthly_target'], 8000)
        # Server must ignore client breakdown and recompute
        self.assertEqual(data['weekly_breakdown']['w-2026-08-01'], 1846)
        self.assertEqual(sum(data['weekly_breakdown'].values()), 8000)

    def test_delete_monthly_plan_blocked_when_frozen(self):
        """Plan deletion is blocked (409) if plan is FROZEN"""
        self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')
        plan = MonthlyPlan.objects.create(
            fg=self.fg1,
            month=self.month,
            monthly_target=10000,
            weekly_breakdown=ProrateService.prorate(10000, WeekDefinition.objects.filter(month=self.month))
        )
        w1 = WeekDefinition.objects.get(month=self.month, week_no=1)
        FGPlanFreeze.objects.create(
            fg=self.fg1,
            month=self.month,
            week=w1,
            status='FROZEN'
        )
        del_res = self.client.delete(f'/api/monthly-plans/{plan.id}/')
        self.assertEqual(del_res.status_code, status.HTTP_409_CONFLICT)
        self.assertIn('frozen', del_res.json()['error'].lower())

    def test_delete_monthly_plan_allowed_when_draft(self):
        """Plan deletion is allowed if freeze status is DRAFT (cascades freeze record)"""
        self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')
        plan = MonthlyPlan.objects.create(
            fg=self.fg1,
            month=self.month,
            monthly_target=10000,
            weekly_breakdown=ProrateService.prorate(10000, WeekDefinition.objects.filter(month=self.month))
        )
        w1 = WeekDefinition.objects.get(month=self.month, week_no=1)
        draft_freeze = FGPlanFreeze.objects.create(
            fg=self.fg1,
            month=self.month,
            week=w1,
            status='DRAFT'
        )
        del_res = self.client.delete(f'/api/monthly-plans/{plan.id}/')
        self.assertEqual(del_res.status_code, status.HTTP_200_OK)
        self.assertFalse(MonthlyPlan.objects.filter(id=plan.id).exists())
        self.assertFalse(FGPlanFreeze.objects.filter(id=draft_freeze.id).exists())

    # ─────────────────────────────────────────────────────────────────────────
    # Stage E: Bulk Upload Tests
    # ─────────────────────────────────────────────────────────────────────────

    def test_bulk_upload_csv_success_and_upsert(self):
        """Bulk upload valid CSV parses rows, prorates, creates audit batch, and upserts duplicates"""
        self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')

        csv_content = (
            "FG Code,Description,Customer Name,Monthly Target,UOM\n"
            "7.06496.03.0,Vacuum Pump Panther 2.0L,Tata Motors,10000,PC\n"
            "7.08241.00.0,FAM B Tandem Vacuum Pump,Mahindra,8000,PC\n"
            "1.INVALID.01,Non FG Part,Customer,5000,PC\n"  # Skipped (doesn't start with 7)
            "7.09999.00.0,Zero Target Product,Customer,0,PC\n"  # Skipped (target <= 0)
        )

        res = self.client.post('/api/uploads/monthly-plan/', {
            'month': self.month,
            'pasted_text': csv_content,
        }, format='json')

        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.json()
        self.assertEqual(data['total_rows'], 4)
        self.assertEqual(data['imported_rows'], 2)
        self.assertEqual(data['error_rows'], 2)
        self.assertIn('batch_id', data)

        # Verify batch record in DB
        batch = UploadBatch.objects.get(id=data['batch_id'])
        self.assertEqual(batch.status, 'PARTIAL')
        self.assertEqual(batch.imported_rows, 2)
        self.assertEqual(batch.error_rows, 2)

        # Upload again with updated target to verify upsert (not duplicate)
        csv_update = (
            "FG Code,Description,Customer Name,Monthly Target,UOM\n"
            "7.06496.03.0,Vacuum Pump Panther 2.0L,Tata Motors,12000,PC\n"
        )
        res_update = self.client.post('/api/uploads/monthly-plan/', {
            'month': self.month,
            'pasted_text': csv_update,
        }, format='json')
        self.assertEqual(res_update.status_code, status.HTTP_200_OK)
        # Should still be 2 monthly plans for this month
        self.assertEqual(MonthlyPlan.objects.filter(month=self.month).count(), 2)
        updated_plan = MonthlyPlan.objects.get(fg__fg_code='7.06496.03.0', month=self.month)
        self.assertEqual(updated_plan.monthly_target, 12000)
        self.assertEqual(sum(updated_plan.weekly_breakdown.values()), 12000)

    def test_bulk_upload_fails_without_week_definitions(self):
        """Bulk upload without week definitions fails entire batch with 400"""
        csv_content = (
            "FG Code,Description,Customer Name,Monthly Target,UOM\n"
            "7.06496.03.0,Vacuum Pump,Tata,10000,PC\n"
        )
        res = self.client.post('/api/uploads/monthly-plan/', {
            'month': '2029-05',
            'pasted_text': csv_content,
        }, format='json')
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('No week definitions found', res.json()['error'])

    # ─────────────────────────────────────────────────────────────────────────
    # Stage F: Export & Full Workflow Integration Test
    # ─────────────────────────────────────────────────────────────────────────

    def test_export_plans_csv(self):
        """CSV export formats columns and flattens weekly breakdown columns properly"""
        self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')
        MonthlyPlan.objects.create(
            fg=self.fg1,
            month=self.month,
            monthly_target=10000,
            customer_name='Tata Motors',
            weekly_breakdown=ProrateService.prorate(10000, WeekDefinition.objects.filter(month=self.month))
        )

        res = self.client.get(f'/api/exports/monthly-plan-csv/?month={self.month}')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res['Content-Type'], 'text/csv')
        self.assertIn('Monthly_Plan_2026-08.csv', res['Content-Disposition'])

        content = b''.join(res.streaming_content).decode('utf-8')
        lines = content.strip().splitlines()
        self.assertGreaterEqual(len(lines), 2)
        # Check header contains week targets
        self.assertIn('Week 1', lines[0])
        self.assertIn('Week 4', lines[0])
        # Check data row contains prorated numbers
        self.assertIn('7.06496.03.0', lines[1])
        self.assertIn('2308', lines[1])
        self.assertIn('3076', lines[1])

    def test_recalculate_weeks_endpoint(self):
        """Recalculate endpoint re-runs proration across all plans for month"""
        self.client.post('/api/weeks/auto-generate/', {'month': self.month, 'overwrite': True}, format='json')
        plan = MonthlyPlan.objects.create(
            fg=self.fg1,
            month=self.month,
            monthly_target=10000,
            weekly_breakdown={}  # unprorated
        )
        res = self.client.post('/api/monthly-plans/recalculate/', {'month': self.month}, format='json')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        plan.refresh_from_db()
        self.assertEqual(sum(plan.weekly_breakdown.values()), 10000)

    def test_upload_batch_status_endpoint(self):
        """Batch status endpoint returns batch progress and row counts"""
        batch = UploadBatch.objects.create(
            upload_type='MONTHLY_PLAN',
            uploaded_by='tester',
            file_name='test.csv',
            status='COMPLETED',
            total_rows=10,
            imported_rows=10,
            error_rows=0
        )
        res = self.client.get(f'/api/uploads/batches/{batch.id}/')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertEqual(res.json()['status'], 'COMPLETED')
        self.assertEqual(res.json()['imported_rows'], 10)
