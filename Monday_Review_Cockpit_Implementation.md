# Monday Review Cockpit — Complete Implementation Guide
## For the Codebase Agent

**Purpose:** This document is the single source of truth for building and fixing the
Monday Review Cockpit backend. Work through every section in the exact order listed.
Do not skip ahead. Each section's output is a dependency for the next.

---

## HOW TO READ THIS DOCUMENT

- Every section begins with **CURRENT STATE** (what exists or is broken) and
  **REQUIRED STATE** (what must exist after this section is done).
- Every field name, URL, status code, and formula is exact — do not rename, reorder,
  or combine unless instructed.
- After completing each section, run the verification command listed at the end of
  that section before moving to the next one.

---

## SECTION 1 — Fix the PostgreSQL Schema (Do This First)

### CURRENT STATE

Migration `0008` was applied with `--fake`. The following tables either do not exist
in Postgres or have the wrong columns:

| Table | Postgres State |
|---|---|
| `fg_plan_freeze` | Does not exist |
| `delivery_schedule_change_log` | Does not exist |
| `monday_review_action` | Does not exist |
| `vendor_delivery_schedule` | Exists but has only 3 columns (id, vendor_code, delivery_status) — missing 11 required columns |

### REQUIRED STATE

All four tables exist in Postgres with the exact column set defined below.

---

### Step 1.1 — Roll Back the Faked Migration

Run these commands in order. Do not skip any.

```bash
# Remove the fake migration record from Django's migration tracking table
python manage.py migrate core 0007

# Verify: migration 0008 is no longer in the applied list
python manage.py showmigrations core
# Expected output: 0008_... should show [ ] not [X]
```

---

### Step 1.2 — Drop the Broken Vendor Delivery Schedule Table

Connect to PostgreSQL and run:

```sql
-- Drop the 3-column stub table
DROP TABLE IF EXISTS vendor_delivery_schedule CASCADE;

-- Verify it is gone
\dt vendor_delivery_schedule
-- Expected: "Did not find any relation named vendor_delivery_schedule"
```

---

### Step 1.3 — Write the Correct Django Models

Open `core/models.py`. Replace or add the following four model classes exactly as
written. Do not rename any field. Use these exact `db_column` names where given
because the frontend JSON serializer must produce the snake_case names shown in
Section 5.

```python
# core/models.py

from django.db import models
from django.db.models import JSONField


class VendorDeliverySchedule(models.Model):
    """
    One row per PO delivery commitment. Mutable during the week.
    Every mutation writes a corresponding DeliveryScheduleChangeLog row.
    """
    po_number              = models.CharField(max_length=30, db_index=True)
    component_code         = models.CharField(max_length=30, db_index=True)
    vendor_code            = models.CharField(max_length=20, db_index=True)
    vendor_name            = models.CharField(max_length=80)
    buyer_name             = models.CharField(max_length=80)
    expected_delivery_date = models.DateField(db_index=True)
    week_code              = models.CharField(
                                 max_length=30, null=True, blank=True, db_index=True
                             )
    promised_qty           = models.DecimalField(max_digits=14, decimal_places=3)
    carrier_or_tracking    = models.CharField(max_length=80, blank=True)
    delivery_status        = models.CharField(
                                 max_length=30,
                                 choices=[
                                     ('CONFIRMED_ON_TRACK', 'Confirmed On Track'),
                                     ('IN_TRANSIT',         'In Transit'),
                                     ('PARTIAL_PROMISE',    'Partial Promise'),
                                     ('DELAYED_AT_RISK',    'Delayed At Risk'),
                                     ('CANCELLED',          'Cancelled'),
                                     ('CRITICAL_NO_PO',     'Critical — No PO'),
                                 ],
                                 db_index=True
                             )
    notes                  = models.TextField(blank=True)
    upload_batch_id        = models.IntegerField(null=True, blank=True, db_index=True)
    created_at             = models.DateTimeField(auto_now_add=True)
    updated_at             = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'vendor_delivery_schedule'
        indexes  = [
            models.Index(fields=['component_code', 'week_code']),
            models.Index(fields=['vendor_code']),
            models.Index(fields=['delivery_status']),
            models.Index(fields=['expected_delivery_date']),
        ]


class DeliveryScheduleChangeLog(models.Model):
    """
    Immutable append-only audit trail.
    One row per field changed on any VendorDeliverySchedule.
    Never updated after insert. SET NULL on schedule deletion so logs survive.
    """
    schedule       = models.ForeignKey(
                         VendorDeliverySchedule,
                         null=True, blank=True,
                         on_delete=models.SET_NULL,
                         db_index=True
                     )
    po_number      = models.CharField(max_length=30, db_index=True)
    component_code = models.CharField(max_length=30, db_index=True)
    component_description = models.CharField(max_length=120, blank=True)
    vendor_name    = models.CharField(max_length=80)
    changed_by     = models.CharField(max_length=80)
    changed_at     = models.DateTimeField(db_index=True)
    field_changed  = models.CharField(max_length=60)
    old_value      = models.TextField(null=True, blank=True)
    new_value      = models.TextField(null=True, blank=True)
    reason_for_change = models.TextField()

    class Meta:
        db_table = 'delivery_schedule_change_log'
        indexes  = [
            models.Index(fields=['schedule']),
            models.Index(fields=['po_number']),
            models.Index(fields=['component_code']),
            models.Index(fields=['-changed_at']),
        ]


class FGPlanFreeze(models.Model):
    """
    One row per FG per week per month.
    Tracks the freeze lifecycle: DRAFT → REVIEWED → FROZEN.
    Transitions are forward-only except FROZEN → DRAFT (unfreeze).
    """
    fg_code      = models.CharField(max_length=30, db_index=True)
    month        = models.CharField(max_length=7,  db_index=True)
    week_code    = models.CharField(max_length=30, db_index=True)
    status       = models.CharField(
                       max_length=10,
                       choices=[
                           ('DRAFT',    'Draft'),
                           ('REVIEWED', 'Reviewed'),
                           ('FROZEN',   'Frozen'),
                       ],
                       default='DRAFT'
                   )
    frozen_at    = models.DateTimeField(null=True, blank=True)
    frozen_by    = models.CharField(max_length=80, blank=True)
    freeze_notes = models.TextField(blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    updated_at   = models.DateTimeField(auto_now=True)

    class Meta:
        db_table        = 'fg_plan_freeze'
        unique_together = [('fg_code', 'month', 'week_code')]
        indexes         = [
            models.Index(fields=['month', 'fg_code']),
            models.Index(fields=['status']),
        ]


class MondayReviewAction(models.Model):
    """
    One action item per FG per component per week.
    Upserted on (fg_code, week_code, component_code) — see Service section.
    """
    month                = models.CharField(max_length=7,  db_index=True)
    week_code            = models.CharField(max_length=30, db_index=True)
    fg_code              = models.CharField(max_length=30, db_index=True)
    fg_description       = models.CharField(max_length=120)
    component_code       = models.CharField(max_length=30, null=True, blank=True, db_index=True)
    component_description = models.CharField(max_length=120, blank=True)
    issue_type           = models.CharField(
                               max_length=30,
                               choices=[
                                   ('RM_SHORTAGE',         'RM Shortage'),
                                   ('BACKLOG_RECOVERY',    'Backlog Recovery'),
                                   ('VENDOR_DELAY',        'Vendor Delay'),
                                   ('CAPACITY_LINE_SPEED', 'Capacity / Line Speed'),
                                   ('QUALITY_HOLD',        'Quality Hold'),
                               ]
                           )
    description          = models.TextField()
    impact_summary       = models.TextField()
    status               = models.CharField(
                               max_length=40,
                               choices=[
                                   ('PENDING_DISCUSSION',        'Pending Discussion'),
                                   ('AMICABLE_SOLUTION_AGREED',  'Amicable Solution Agreed'),
                                   ('ESCALATED_LEVEL_1',         'Escalated Level 1'),
                                   ('ESCALATED_LEVEL_2',         'Escalated Level 2'),
                                   ('ESCALATED_LEVEL_3',         'Escalated Level 3'),
                                   ('RESOLVED',                  'Resolved'),
                               ]
                           )
    resolution_notes     = models.TextField(blank=True)
    agreed_action        = models.TextField(blank=True)
    assigned_owner       = models.CharField(max_length=80)
    target_resolution_date = models.DateField()
    escalated_to         = models.CharField(max_length=80, blank=True)
    created_at           = models.DateTimeField(auto_now_add=True)
    updated_at           = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'monday_review_action'
        indexes  = [
            models.Index(fields=['month', 'week_code', 'fg_code']),
            models.Index(fields=['status']),
            models.Index(fields=['component_code']),
        ]
```

---

### Step 1.4 — Create and Run the New Migration

```bash
# Create the migration
python manage.py makemigrations core --name fix_cockpit_tables

# Run it — all four tables will be created from scratch
python manage.py migrate core

# Verify all four tables now exist in Postgres
python manage.py dbshell
```

Inside the psql shell run:

```sql
\dt vendor_delivery_schedule
\dt delivery_schedule_change_log
\dt fg_plan_freeze
\dt monday_review_action

-- Verify vendor_delivery_schedule has 14+ columns
\d vendor_delivery_schedule
-- Must show: id, po_number, component_code, vendor_code, vendor_name, buyer_name,
--            expected_delivery_date, week_code, promised_qty, carrier_or_tracking,
--            delivery_status, notes, upload_batch_id, created_at, updated_at
```

**Expected outcome:** All four tables exist. No UndefinedTable errors when any
cockpit endpoint is called.

---

## SECTION 2 — Fix URL Routing

### CURRENT STATE

```
GET  /api/v1/plan-freeze/        → PlanFreezeListView   ✓
POST /api/v1/plan-freeze/update/ → PlanFreezeUpdateView ✗ (wrong suffix)
```

A POST to `/api/v1/plan-freeze/` returns `405 Method Not Allowed`.

### REQUIRED STATE

```
GET  /api/v1/plan-freeze/        → handles list
POST /api/v1/plan-freeze/        → handles create/upsert
POST /api/v1/plan-freeze/bulk/   → handles bulk freeze
```

---

### Step 2.1 — Merge the Two Views Into One

Open the file containing `PlanFreezeListView` and `PlanFreezeUpdateView`.
Replace both with a single view:

```python
# In views.py or plan_freeze_views.py

class PlanFreezeView(APIView):
    """
    GET  /api/v1/plan-freeze/?month=YYYY-MM  → list freeze records
    POST /api/v1/plan-freeze/                → upsert one freeze record
    """

    def get(self, request):
        month     = request.query_params.get('month')
        fg_code   = request.query_params.get('fg_code')
        week_code = request.query_params.get('week_code')
        status    = request.query_params.get('status')

        if not month:
            return Response({'error': 'month is required'}, status=400)

        qs = FGPlanFreeze.objects.filter(month=month)
        if fg_code:
            qs = qs.filter(fg_code=fg_code)
        if week_code:
            qs = qs.filter(week_code=week_code)
        if status:
            qs = qs.filter(status=status)

        serializer = FGPlanFreezeSerializer(qs, many=True)
        return Response(serializer.data)

    def post(self, request):
        fg_code     = request.data.get('fg_code')
        month       = request.data.get('month')
        week_code   = request.data.get('week_code')
        new_status  = request.data.get('status')
        frozen_by   = request.data.get('frozen_by', '')
        freeze_notes = request.data.get('freeze_notes', '')

        # Extract role from request — check payload first, then request.user
        user_role = request.data.get('user_role') or getattr(
            getattr(request, 'user', None), 'role', None
        )

        if not all([fg_code, month, week_code, new_status]):
            return Response(
                {'error': 'fg_code, month, week_code, and status are all required'},
                status=400
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
            return Response(serializer.data, status=200)

        except PermissionError as e:
            return Response({'error': str(e)}, status=403)

        except FGPlanFreeze.DoesNotExist:
            # monthly_plan does not exist for this fg_code + month
            return Response(
                {'error': f'No monthly plan found for FG {fg_code} in {month}. '
                           'Cannot freeze a plan that does not exist.'},
                status=404          # MUST be 404, not 400
            )

        except ValueError as e:
            return Response({'error': str(e)}, status=400)
```

---

### Step 2.2 — Fix urls.py

Open `core/urls.py` (or whichever file registers the cockpit URLs). Remove the
`plan-freeze/update/` entry and replace with:

```python
# urls.py

from .views import PlanFreezeView, PlanFreezeBulkView  # adjust import path

urlpatterns = [
    # ... other patterns ...

    path('plan-freeze/',       PlanFreezeView.as_view(),     name='plan-freeze'),
    path('plan-freeze/bulk/',  PlanFreezeBulkView.as_view(), name='plan-freeze-bulk'),

    # REMOVE this line if it exists:
    # path('plan-freeze/update/', PlanFreezeUpdateView.as_view(), ...),
]
```

---

### Step 2.3 — Verify

```bash
python manage.py show_urls | grep plan-freeze
# Must show exactly:
#   /api/v1/plan-freeze/       PlanFreezeView
#   /api/v1/plan-freeze/bulk/  PlanFreezeBulkView

# Test with curl (Django dev server must be running):
curl -X POST http://localhost:8000/api/v1/plan-freeze/ \
  -H "Content-Type: application/json" \
  -d '{"fg_code":"7.TEST.01","month":"2026-08","week_code":"w-2026-08-02","status":"FROZEN","frozen_by":"Test"}'
# Must return 200 or 404 (not 405)
```

---

## SECTION 3 — Fix PlanFreezeService Validation Rules

### CURRENT STATE

Three validation defects in `PlanFreezeService.upsert()` and its callers:

1. `user_role` is never passed to the service → role check is bypassed.
2. Missing monthly plan raises `ValueError` → view returns `400` instead of `404`.
3. Action upsert fails when `component_code=""` (empty string) instead of null.

### REQUIRED STATE

All three fixed. Role check enforced. Correct HTTP status codes. Upsert works for
null, empty string, and populated component codes.

---

### Step 3.1 — Rewrite PlanFreezeService.upsert()

Open `core/services/plan_freeze_service.py` (or wherever this service lives).
Replace `upsert()` with the following exact implementation:

```python
# core/services/plan_freeze_service.py

from django.utils import timezone
from django.db import transaction

ALLOWED_FREEZE_ROLES = {'supply_planner', 'management'}

# Forward-only transitions allowed:
ALLOWED_TRANSITIONS = {
    'DRAFT':    {'REVIEWED', 'FROZEN'},
    'REVIEWED': {'FROZEN'},
    'FROZEN':   {'DRAFT'},   # unfreeze allowed
}

class PlanFreezeService:

    @staticmethod
    def upsert(fg_code, month, week_code, new_status,
               user_role=None, frozen_by='', freeze_notes=''):
        """
        Creates or updates an FGPlanFreeze record.

        Raises:
            PermissionError   — role is not supply_planner or management
            FGPlanFreeze.DoesNotExist — no monthly_plan for (fg_code, month)
                                        NOTE: callers must catch this and return 404
            ValueError        — invalid status transition
        """
        # Rule 1 — Role validation (FIXED: user_role now passed from view)
        if user_role and user_role not in ALLOWED_FREEZE_ROLES:
            raise PermissionError(
                f"Role '{user_role}' cannot freeze plans. "
                "Only supply_planner or management may freeze."
            )

        # Rule 2 — Monthly plan must exist (FIXED: raises DoesNotExist, not ValueError)
        from core.models import MonthlyPlan, FGPlanFreeze  # avoid circular imports
        if not MonthlyPlan.objects.filter(fg_code=fg_code, month=month).exists():
            raise FGPlanFreeze.DoesNotExist(
                f"No monthly plan for fg_code={fg_code}, month={month}"
            )

        with transaction.atomic():
            record, _ = FGPlanFreeze.objects.get_or_create(
                fg_code=fg_code,
                month=month,
                week_code=week_code,
                defaults={'status': 'DRAFT'}
            )

            current_status = record.status

            # Allow same-status re-submission without error (idempotent)
            if current_status == new_status:
                return record

            # Validate forward-only transitions
            allowed = ALLOWED_TRANSITIONS.get(current_status, set())
            if new_status not in allowed:
                raise ValueError(
                    f"Cannot transition from {current_status} to {new_status}. "
                    f"Allowed transitions from {current_status}: {allowed}"
                )

            record.status = new_status

            if new_status == 'FROZEN':
                record.frozen_at   = timezone.now()
                record.frozen_by   = frozen_by
                record.freeze_notes = freeze_notes
            elif new_status == 'DRAFT':
                # Unfreeze — clear frozen metadata
                record.frozen_at    = None
                record.frozen_by    = ''
                record.freeze_notes = ''

            record.save()
            return record
```

---

### Step 3.2 — Fix the Action Upsert Edge Case in MondayActionListCreateView

Open the view that handles `POST /api/v1/monday-review-actions/`.
Find the deletion query before inserting the new action. Replace it with:

```python
# In MondayActionListCreateView.post() or equivalent

from django.db.models import Q

component_code = request.data.get('component_code') or None
# Normalize: treat empty string the same as null
# so we don't create duplicates when client sends "" vs null

# Delete any existing action for this FG + week + component combination
existing_qs = MondayReviewAction.objects.filter(
    fg_code=request.data.get('fg_code'),
    week_code=request.data.get('week_code'),
)

if component_code:
    # Component specified: delete exact match
    existing_qs = existing_qs.filter(component_code=component_code)
else:
    # No component: delete any row where component_code is null OR empty string
    existing_qs = existing_qs.filter(
        Q(component_code__isnull=True) | Q(component_code='')
    )

existing_qs.delete()

# Now insert the new action record
# ... rest of insert logic unchanged
```

---

### Step 3.3 — Verify

```bash
# Role check test — should return 403
curl -X POST http://localhost:8000/api/v1/plan-freeze/ \
  -H "Content-Type: application/json" \
  -d '{"fg_code":"7.TEST.01","month":"2026-08","week_code":"w-2026-08-02",
       "status":"FROZEN","user_role":"demand_planner"}'
# Expected: HTTP 403

# Missing plan test — should return 404
curl -X POST http://localhost:8000/api/v1/plan-freeze/ \
  -H "Content-Type: application/json" \
  -d '{"fg_code":"7.NONEXISTENT","month":"2026-08",
       "week_code":"w-2026-08-02","status":"FROZEN","user_role":"supply_planner"}'
# Expected: HTTP 404

# Valid freeze — should return 200
# (requires a real monthly_plan row for this fg_code + month)
curl -X POST http://localhost:8000/api/v1/plan-freeze/ \
  -H "Content-Type: application/json" \
  -d '{"fg_code":"7.06496.03.0","month":"2026-08","week_code":"w-2026-08-02",
       "status":"FROZEN","user_role":"supply_planner","frozen_by":"Test Planner"}'
# Expected: HTTP 200
```

---

## SECTION 4 — Fix Vendor Schedule Week Matching

### CURRENT STATE

In `cockpit_data_loader.py`, Dict E is built with:

```python
schedules_qs = VendorDeliverySchedule.objects.exclude(
    delivery_status='CANCELLED'
).filter(week_id__in=week_codes)
```

**Problem:** If a delivery schedule has `week_code=None` (because it was inserted via
direct DB write or date-resolution failed), it is completely omitted even if its
`expected_delivery_date` falls inside a defined week.

### REQUIRED STATE

Dict E must match schedules by `week_code` OR by date range
(`expected_delivery_date BETWEEN week.start_date AND week.end_date`).

---

### Step 4.1 — Rewrite Dict E Query in cockpit_data_loader.py

Open `cockpit_data_loader.py` (or `services/cockpit_data_loader.py`).
Find the Dict E construction. Replace it with:

```python
# In CockpitDataLoaderService.load() or equivalent function

from django.db.models import Q
import datetime

# Fetch all non-cancelled schedules for this month's date range
# Build a Q filter: week_code IN (week_codes) OR date within any week's range
week_date_q = Q()
for week in month_weeks:
    week_date_q |= Q(
        expected_delivery_date__gte=week.start_date,
        expected_delivery_date__lte=week.end_date
    )

schedules_qs = VendorDeliverySchedule.objects.exclude(
    delivery_status='CANCELLED'
).filter(
    Q(week_code__in=week_codes) | week_date_q
).distinct()

# Build Dict E: {(component_code, week_code): [VendorDeliverySchedule]}
dict_e = {}

for schedule in schedules_qs:
    # Resolve which week this schedule belongs to
    resolved_week_code = schedule.week_code

    if not resolved_week_code:
        # week_code is null — resolve from expected_delivery_date
        for week in month_weeks:
            if week.start_date <= schedule.expected_delivery_date <= week.end_date:
                resolved_week_code = week.week_code
                break

    if not resolved_week_code:
        # Date is outside all defined weeks — skip this schedule
        continue

    key = (schedule.component_code, resolved_week_code)
    if key not in dict_e:
        dict_e[key] = []
    dict_e[key].append(schedule)

# dict_e is now: {(component_code, week_code): [schedule_objects]}
```

---

### Step 4.2 — Verify

```bash
# Insert a test schedule with week_code=NULL but valid expected_delivery_date
python manage.py shell
```

```python
from core.models import VendorDeliverySchedule
import datetime

VendorDeliverySchedule.objects.create(
    po_number='TEST-NULL-WEEK',
    component_code='100201',
    vendor_code='V-TEST',
    vendor_name='Test Vendor',
    buyer_name='Test Buyer',
    expected_delivery_date=datetime.date(2026, 8, 10),  # falls in Week 2
    week_code=None,          # NULL week_code
    promised_qty=500,
    delivery_status='CONFIRMED_ON_TRACK'
)

# Now call the cockpit endpoint and verify:
# - The schedule for component 100201 in Week 2 includes this 500 qty
# - total_scheduled_inward for 100201 in Week 2 is >= 500
```

---

## SECTION 5 — Fix Field Name Mismatches in cockpit_engine.py

### CURRENT STATE vs REQUIRED STATE

This is the most critical section. Every mismatch below causes a runtime crash or
blank render in the frontend. The frontend reads the response using the exact keys
defined in `types.ts`. The backend must output those exact keys.

**Complete Field Name Mapping Table:**

| Frontend Key (types.ts / MondayReviewCockpit.tsx) | Current Backend Key | Action |
|---|---|---|
| `explodedBOM` | `explodedComponents` | RENAME to `explodedBOM` |
| `fgHealthStatus` | `healthStatus` | RENAME to `fgHealthStatus` |
| `maxBuildableFGWithStock` | `maxBuildableWithStock` | RENAME to `maxBuildableFGWithStock` |
| `maxBuildableFGWithDeliveries` | `maxBuildableWithDeliveries` | RENAME to `maxBuildableFGWithDeliveries` |
| `criticalComponentsCount` | `criticalShortageCount` | RENAME to `criticalComponentsCount` |
| `hasActiveEscalations` (bool) | `escalationCount` (int) | CHANGE type to bool |
| `mondayReviewActions` | `actions` | RENAME to `mondayReviewActions` |
| `currentWeekRemainingToBuild` | `currentWeekRemaining` | RENAME to `currentWeekRemainingToBuild` |
| `comp.bomQty` | `comp.bomQtyPerUnit` | RENAME to `bomQty` |
| `comp.currentStock` | *(omitted)* | ADD field |
| `comp.vendorName` | nested under `comp.vendorInfo.vendorName` | FLATTEN to `comp.vendorName` |
| `comp.buyerName` | nested under `comp.vendorInfo.buyerName` | FLATTEN to `comp.buyerName` |
| `comp.id` | *(omitted)* | ADD field |

---

### Step 5.1 — Rewrite the FG-Level Output Dict in cockpit_engine.py

Open `cockpit_engine.py` (or `services/cockpit_engine.py`). Find where each
`FGWeekProductionCockpitItem` dict is assembled for the `cockpit_items` list.
Replace the entire assembly block with this exact structure:

```python
# cockpit_engine.py — FG item assembly

fg_item = {
    # Identity
    'fgCode':             plan.fg_code,
    'fgDescription':      plan.fg_description,
    'customerName':       plan.customer_name or '',
    'miniFactory':        mini_factory,
    'line':               line,
    'monthlyTarget':      plan.monthly_target,
    'selectedWeek':       selected_week_dict,   # WeekDefinition dict

    # Freeze status
    'freezeStatus':       freeze_status,         # 'DRAFT' | 'REVIEWED' | 'FROZEN'
    'frozenAt':           freeze_record.frozen_at.isoformat() if freeze_record and freeze_record.frozen_at else None,
    'frozenBy':           freeze_record.frozen_by if freeze_record else None,
    'freezeNotes':        freeze_record.freeze_notes if freeze_record else None,

    # Previous month performance (mock values — see Step 5.2)
    'previousMonthPerf':  previous_month_perf,

    # Backlog
    'priorBacklog':            prior_backlog,
    'priorWeeksBreakdown':     prior_weeks_breakdown,
    'currentWeekPlanTarget':   current_week_plan_target,
    'totalWeekGrossTarget':    total_week_gross_target,
    'currentWeekActualProd':   current_week_actual_prod,
    'currentWeekRemainingToBuild': max(0, total_week_gross_target - current_week_actual_prod),

    # Full 4-week horizon — REQUIRED (see Section 6 for how to compute)
    'allWeeksDetail':     all_weeks_detail,

    # BOM — KEY MUST BE explodedBOM (not explodedComponents)
    'explodedBOM':        exploded_bom_list,

    # Summary counts
    'criticalComponentsCount':   fg_critical_shortages,   # int
    'inadequateScheduleCount':   fg_inadequate_schedules,  # int
    'nextWeekCriticalCount':     next_week_critical_count,
    'hasNextWeekRisk':           has_next_week_risk,        # bool
    'nextWeekBottleneckDesc':    next_week_bottleneck_desc,
    'nextWeekNo':                next_week_no,

    # Buildable quantities — EXACT KEY NAMES
    'maxBuildableFGWithStock':       max_buildable_with_stock,
    'maxBuildableFGWithDeliveries':  max_buildable_with_deliveries,
    'bottleneckComponentCode':       bottleneck_code,
    'bottleneckComponentDesc':       bottleneck_desc,

    # Health — KEY MUST BE fgHealthStatus
    'fgHealthStatus':     fg_health_status,

    # Escalations — MUST BE bool, not int
    'hasActiveEscalations': has_active_escalations,   # True/False

    # Actions — KEY MUST BE mondayReviewActions
    'mondayReviewActions': matching_actions_list,
}
```

---

### Step 5.2 — Add previousMonthPerf to Each FG Item

The frontend accesses `item.previousMonthPerf.achievementRate` and
`item.previousMonthPerf.backlogCarriedOver`. Add this block before the `fg_item`
assembly:

```python
# Compute previous month reference string
year, month_num = selected_month.split('-')
year, month_num = int(year), int(month_num)
if month_num == 1:
    prev_month_str = f"{year - 1}-12"
else:
    prev_month_str = f"{year}-{(month_num - 1):02d}"

prev_month_target = round(plan.monthly_target * 0.95)
prev_month_actual = round(prev_month_target * 0.94)
prev_month_backlog = max(0, prev_month_target - prev_month_actual)
prev_achieve_rate  = round((prev_month_actual / (prev_month_target or 1)) * 100)

previous_month_perf = {
    'month':               prev_month_str,
    'target':              prev_month_target,
    'actual':              prev_month_actual,
    'achievementRate':     prev_achieve_rate,
    'backlogCarriedOver':  prev_month_backlog,
}
```

---

### Step 5.3 — Fix the Component (ExplodedBOMComponentSummary) Output Dict

For each component in the BOM explosion loop, replace the assembly dict with this
exact structure. Every key here is used by `MondayReviewCockpit.tsx`:

```python
# cockpit_engine.py — component item assembly inside BOM loop

component_item = {
    # REQUIRED: id field — frontend uses comp.id for checklist selection
    'id':  f"exp-{bom_line.id}",

    # Identity
    'componentCode':        bom_line.component_code,
    'componentDescription': bom_line.component_description,
    'category':             bom_line.category,    # 'RM' or 'PM'
    'uom':                  bom_line.uom,

    # Usage — KEY MUST BE bomQty (not bomQtyPerUnit)
    'bomQty':               float(bom_line.qty),

    # Stock — currentStock MUST be present (causes crash if omitted)
    'currentStock':              unreserved_available_stock,
    'safetyStock':               safety_stock,
    'totalPhysicalStock':        total_physical_stock,
    'reservedStock':             total_reserved_stock_across_all,
    'reservedByFGs':             reserved_by_fgs_list,
    'unreservedAvailableStock':  unreserved_available_stock,

    # Common part
    'isCommonPart':        is_common_part,
    'sharedInFGsCount':    len(shared_in_fgs),
    'sharedInFGs':         shared_in_fgs,

    # Requirement
    'totalRequiredForWeekWithBacklog': total_required,
    'stockDeficit':                    stock_deficit,
    'isCriticalShortage':              is_critical_shortage,
    'stockCoverageFgUnits':            stock_covers_fg_units,

    # Vendor — FLATTENED (not nested under vendorInfo)
    'vendorCode':    vendor_code,
    'vendorName':    vendor_name,
    'buyerName':     buyer_name,
    'leadTimeDays':  lead_time_days,

    # Delivery
    'deliverySchedules':             delivery_schedules_list,
    'totalScheduledInward':          total_scheduled_inward,
    'projectedStockWithDeliveries':  projected_stock_with_deliveries,
    'projectedDeficitWithDeliveries': projected_deficit_with_deliveries,
    'projectedCoverageFgUnits':      projected_coverage_fg_units,
    'scheduleHealth':                schedule_health,
    'productionImpactSummary':       production_impact_summary,

    # 4-week forward horizon
    'weekDetails':          week_details_list,

    # Next week risk
    'nextWeekNo':            next_week_no,
    'nextWeekGrossReq':      next_week_gross_req,
    'nextWeekInward':        next_week_inward,
    'nextWeekClosingStock':  next_week_closing_stock,
    'nextWeekDeficit':       next_week_deficit,
    'hasNextWeekRisk':       has_next_week_risk,
    'hasForwardRisk':        has_forward_risk,
}
```

---

### Step 5.4 — Fix deliverySchedules List Shape

The frontend reads `comp.deliverySchedules` and accesses fields on each schedule using
the `VendorDeliverySchedule` interface from `types.ts`. Serialize each schedule as:

```python
# deliverySchedules list inside component_item

delivery_schedules_list = [
    {
        'id':                    str(sched.id),
        'poNumber':              sched.po_number,
        'componentCode':         sched.component_code,
        'vendorCode':            sched.vendor_code,
        'vendorName':            sched.vendor_name,
        'buyerName':             sched.buyer_name,
        'expectedDeliveryDate':  sched.expected_delivery_date.isoformat(),
        'weekId':                sched.week_code or '',
        'promisedQty':           float(sched.promised_qty),
        'carrierOrTracking':     sched.carrier_or_tracking or '',
        'deliveryStatus':        sched.delivery_status,
        'notes':                 sched.notes or '',
    }
    for sched in delivery_schedules_for_this_component_this_week
]
```

---

### Step 5.5 — Fix mondayReviewActions List Shape

The frontend reads `fg.mondayReviewActions` and accesses each item using the
`MondayReviewActionItem` interface. Serialize each action as:

```python
# mondayReviewActions list inside fg_item

matching_actions_list = [
    {
        'id':                    str(action.id),
        'month':                 action.month,
        'weekId':                action.week_code,
        'fgCode':                action.fg_code,
        'fgDescription':         action.fg_description,
        'componentCode':         action.component_code or None,
        'componentDescription':  action.component_description or None,
        'issueType':             action.issue_type,
        'description':           action.description,
        'impactSummary':         action.impact_summary,
        'status':                action.status,
        'resolutionNotes':       action.resolution_notes,
        'agreedAction':          action.agreed_action,
        'assignedOwner':         action.assigned_owner,
        'targetResolutionDate':  action.target_resolution_date.isoformat(),
        'escalatedTo':           action.escalated_to or None,
        'createdAt':             action.created_at.isoformat(),
        'updatedAt':             action.updated_at.isoformat(),
    }
    for action in actions_for_this_fg
]
```

---

### Step 5.6 — Fix weekDetails (ExplodedBOMWeekDetail) List Shape

Inside the component loop, `week_details_list` must use these exact keys:

```python
week_details_list = [
    {
        'weekId':          week.week_code,
        'weekNo':          week.week_no,
        'weekLabel':       week.week_label,
        'isPrior':         is_prior,
        'isCurrent':       is_current,
        'isFuture':        is_future,
        'grossRequired':   gross_req,
        'scheduledInward': scheduled_inward,
        'projectedClosing': rolling_comp_stock,
        'deficit':         deficit,
        'status':          status_value,  # 'ADEQUATE'|'INADEQUATE'|'CRITICAL_NO_DELIVERY'|'EXCESS'
    }
    for week, is_prior, is_current, is_future, gross_req,
        scheduled_inward, rolling_comp_stock, deficit, status_value
    in computed_week_details
]
```

---

### Step 5.7 — Fix Top-Level Cockpit Response Shape

The cockpit view's `GET` response must be exactly:

```python
# In MondayReviewCockpitView.get()

return Response({
    'cockpitItems':              cockpit_items_list,
    'selectedWeek':              selected_week_dict,
    'monthWeeks':                month_weeks_list,
    'overallBacklogUnits':       overall_backlog_units,
    'totalWeekTargetUnits':      total_week_target_units,
    'criticalFGsCount':          critical_fgs_count,
    'inadequateDeliveryCount':   inadequate_delivery_count,
    'nextWeekCriticalFGsCount':  next_week_critical_fgs_count,
    'activeEscalationsCount':    active_escalations_count,
    'frozenFGsCount':            frozen_fgs_count,
})
```

---

## SECTION 6 — Build the Missing allWeeksDetail Feature

### CURRENT STATE

`allWeeksDetail` is not built in `cockpit_engine.py`. It is missing entirely.

### REQUIRED STATE

Each `fg_item` has an `allWeeksDetail` array of `FGWeekDetailSummary` objects —
one entry per week in the month (`W1, W2, W3, W4`).

`MondayReviewCockpit.tsx` accesses this array on lines 899, 900, 1742, 1749, and
1802. Missing it causes an immediate `TypeError: Cannot read properties of undefined`
crash when rendering monthly plan summaries.

---

### Step 6.1 — Add allWeeksDetail Computation to cockpit_engine.py

Add this block inside the per-FG computation loop, AFTER the BOM explosion and
after `min_stock_buildable` and `min_projected_buildable` are finalized:

```python
# cockpit_engine.py — inside per-FG loop, after BOM explosion

# Build allWeeksDetail: FGWeekDetailSummary[] for W1, W2, W3, W4
all_weeks_detail = []

for week in month_weeks_sorted:
    w_is_prior   = week.week_no < selected_week.week_no
    w_is_current = week.week_no == selected_week.week_no
    w_is_future  = week.week_no > selected_week.week_no

    # Plan target for this week from JSONB
    plan_target = plan_weekly_breakdown.get(week.week_code, 0)

    # Actual production (MB51 Mvt 101 for this FG in this week)
    # Uses Dict B which is pre-loaded: {(part_number, week_code): total_qty}
    actual_prod = dict_b.get((plan.fg_code, week.week_code), 0)

    # Backlog only for prior weeks; future and current weeks have backlog = 0
    backlog = max(0, plan_target - actual_prod) if w_is_prior else 0

    # Gross target:
    #   current week → plan + accumulated prior backlog (already computed above)
    #   prior weeks  → their actual plan target
    #   future weeks → their prorated plan target
    if w_is_current:
        gross_target = total_week_gross_target
    else:
        gross_target = plan_target

    # Buildable limits:
    #   current week → bottleneck values computed from BOM explosion
    #   other weeks  → no computation; use plan_target as proxy
    if w_is_current:
        stock_buildable       = min_stock_buildable      if min_stock_buildable < 999999 else gross_target
        deliveries_buildable  = min_projected_buildable  if min_projected_buildable < 999999 else gross_target
    else:
        stock_buildable      = gross_target
        deliveries_buildable = gross_target

    gap = max(0, gross_target - deliveries_buildable)

    # RM status classification
    if gap > 0:
        rm_status = 'INADEQUATE'
    elif stock_buildable < gross_target:
        rm_status = 'CRITICAL'
    else:
        rm_status = 'CLEAR'

    all_weeks_detail.append({
        'weekId':             week.week_code,
        'weekNo':             week.week_no,
        'weekLabel':          week.week_label,
        'isPrior':            w_is_prior,
        'isCurrent':          w_is_current,
        'isFuture':           w_is_future,
        'planTarget':         plan_target,
        'actualProd':         actual_prod,
        'backlog':            backlog,
        'grossTarget':        gross_target,
        'stockBuildable':     stock_buildable,
        'deliveriesBuildable': deliveries_buildable,
        'gap':                gap,
        'rmStatus':           rm_status,   # 'CLEAR' | 'CRITICAL' | 'INADEQUATE'
    })
```

---

### Step 6.2 — Verify allWeeksDetail is Present

```bash
curl "http://localhost:8000/api/v1/reports/monday-review-cockpit/?month=2026-08&week_code=w-2026-08-02" \
  -H "Accept: application/json" | python3 -c "
import json, sys
data = json.load(sys.stdin)
items = data.get('cockpitItems', [])
if not items:
    print('ERROR: cockpitItems is empty')
    sys.exit(1)
first = items[0]
awd = first.get('allWeeksDetail')
if awd is None:
    print('ERROR: allWeeksDetail is missing')
    sys.exit(1)
print(f'OK: allWeeksDetail has {len(awd)} weeks')
for w in awd:
    keys = ['weekId','weekNo','weekLabel','isPrior','isCurrent','isFuture',
            'planTarget','actualProd','backlog','grossTarget',
            'stockBuildable','deliveriesBuildable','gap','rmStatus']
    missing = [k for k in keys if k not in w]
    if missing:
        print(f'  MISSING KEYS in week {w.get(\"weekNo\")}: {missing}')
    else:
        print(f'  Week {w[\"weekNo\"]} OK — grossTarget={w[\"grossTarget\"]}')
"
```

---

## SECTION 7 — Build the Missing CSV Export Endpoint

### CURRENT STATE

No view and no URL route for
`GET /api/v1/reports/monday-review-cockpit/export-csv/`.

### REQUIRED STATE

`GET /api/v1/reports/monday-review-cockpit/export-csv/?month=YYYY-MM&week_code=X`
returns a `text/csv` file that the frontend's `handleExportCSV` button can trigger.

---

### Step 7.1 — Write MondayReviewCockpitExportCSVView

Add this view to the cockpit views file:

```python
# views.py

import csv
from django.http import StreamingHttpResponse

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

    def get(self, request):
        month     = request.query_params.get('month')
        week_code = request.query_params.get('week_code')

        if not month:
            return Response({'error': 'month is required'}, status=400)

        # Reuse the same data loader and engine as the main cockpit view
        from core.services.cockpit_data_loader import CockpitDataLoaderService
        from core.services.cockpit_engine      import CockpitEngineService

        data_package = CockpitDataLoaderService.load(month, week_code)
        result       = CockpitEngineService.compute(data_package, month, week_code)

        cockpit_items = result['cockpitItems']
        month_weeks   = result['monthWeeks']

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
                prior_plan   = sum(pw['planTarget']  for pw in prior_breakdown)
                prior_actual = sum(pw['actualProd']   for pw in prior_breakdown)

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
```

---

### Step 7.2 — Register the URL

Add to `urls.py`:

```python
from .views import MondayReviewCockpitExportCSVView

urlpatterns = [
    # ... existing patterns ...
    path(
        'reports/monday-review-cockpit/export-csv/',
        MondayReviewCockpitExportCSVView.as_view(),
        name='cockpit-export-csv'
    ),
]
```

---

### Step 7.3 — Verify

```bash
curl "http://localhost:8000/api/v1/reports/monday-review-cockpit/export-csv/?month=2026-08&week_code=w-2026-08-02" \
  --output cockpit_export.csv

# Verify file exists and has content
wc -l cockpit_export.csv
# Expected: at least 2 lines (header + 1+ data rows)

head -2 cockpit_export.csv
# Expected: first line = "FG Code,FG Description,Mini Factory,..."
```

---

## SECTION 8 — Full Integration Verification

After completing all sections above, run these checks in order.
Every check must pass before the cockpit is considered done.

---

### Check 1 — Database Tables

```bash
python manage.py dbshell
```

```sql
-- All four must show column counts as listed
SELECT table_name, COUNT(*) as col_count
FROM information_schema.columns
WHERE table_name IN (
    'vendor_delivery_schedule',
    'delivery_schedule_change_log',
    'fg_plan_freeze',
    'monday_review_action'
)
GROUP BY table_name
ORDER BY table_name;

-- Expected minimum column counts:
-- delivery_schedule_change_log → 12
-- fg_plan_freeze               → 10
-- monday_review_action         → 19
-- vendor_delivery_schedule     → 15
```

---

### Check 2 — URL Routes

```bash
python manage.py show_urls | grep -E "plan-freeze|cockpit|monday-review"
# Must show ALL of these:
#   /api/v1/plan-freeze/                                    PlanFreezeView
#   /api/v1/plan-freeze/bulk/                               PlanFreezeBulkView
#   /api/v1/reports/monday-review-cockpit/                  MondayReviewCockpitView
#   /api/v1/reports/monday-review-cockpit/export-csv/       MondayReviewCockpitExportCSVView
#   /api/v1/monday-review-actions/                          MondayActionListCreateView
#   /api/v1/monday-review-actions/<id>/                     MondayActionDetailView
#   /api/v1/vendor-delivery-schedules/                      VendorScheduleListCreateView
#   /api/v1/vendor-delivery-schedules/<id>/                 VendorScheduleDetailView
#   /api/v1/vendor-delivery-schedules/change-logs/          DeliveryChangeLogListView
```

---

### Check 3 — Cockpit Response Field Names

```bash
curl "http://localhost:8000/api/v1/reports/monday-review-cockpit/?month=2026-08" \
  | python3 -c "
import json, sys

data = json.load(sys.stdin)

# Top-level keys
required_top = [
    'cockpitItems', 'selectedWeek', 'monthWeeks',
    'overallBacklogUnits', 'totalWeekTargetUnits', 'criticalFGsCount',
    'inadequateDeliveryCount', 'nextWeekCriticalFGsCount',
    'activeEscalationsCount', 'frozenFGsCount'
]
for key in required_top:
    if key not in data:
        print(f'MISSING top-level key: {key}')
    else:
        print(f'OK: {key}')

items = data.get('cockpitItems', [])
if not items:
    print('WARNING: cockpitItems is empty — add seed data and retest')
    sys.exit(0)

fg = items[0]

# FG-level keys
required_fg = [
    'fgCode','fgDescription','customerName','miniFactory','line','monthlyTarget',
    'selectedWeek','freezeStatus','frozenAt','frozenBy','freezeNotes',
    'previousMonthPerf','priorBacklog','priorWeeksBreakdown',
    'currentWeekPlanTarget','totalWeekGrossTarget','currentWeekActualProd',
    'currentWeekRemainingToBuild','allWeeksDetail','explodedBOM',
    'criticalComponentsCount','inadequateScheduleCount','nextWeekCriticalCount',
    'hasNextWeekRisk','nextWeekBottleneckDesc','nextWeekNo',
    'maxBuildableFGWithStock','maxBuildableFGWithDeliveries',
    'bottleneckComponentCode','bottleneckComponentDesc',
    'fgHealthStatus','hasActiveEscalations','mondayReviewActions'
]
for key in required_fg:
    if key not in fg:
        print(f'MISSING fg key: {key}')
    else:
        print(f'OK: fg.{key}')

# Type checks
assert isinstance(fg['hasActiveEscalations'], bool), \
    f'hasActiveEscalations must be bool, got {type(fg[\"hasActiveEscalations\"])}'
assert isinstance(fg['allWeeksDetail'], list), \
    f'allWeeksDetail must be list'
assert isinstance(fg['explodedBOM'], list), \
    f'explodedBOM must be list'
assert isinstance(fg['mondayReviewActions'], list), \
    f'mondayReviewActions must be list'

print('Type checks: OK')

# Component-level keys
if fg['explodedBOM']:
    comp = fg['explodedBOM'][0]
    required_comp = [
        'id','componentCode','componentDescription','category','uom',
        'bomQty','currentStock','safetyStock','isCommonPart','sharedInFGsCount',
        'sharedInFGs','totalPhysicalStock','reservedStock','reservedByFGs',
        'unreservedAvailableStock','totalRequiredForWeekWithBacklog',
        'stockDeficit','isCriticalShortage','stockCoverageFgUnits',
        'vendorCode','vendorName','buyerName','leadTimeDays',
        'deliverySchedules','totalScheduledInward','projectedStockWithDeliveries',
        'projectedDeficitWithDeliveries','projectedCoverageFgUnits',
        'scheduleHealth','productionImpactSummary','weekDetails',
        'nextWeekNo','nextWeekGrossReq','nextWeekInward',
        'nextWeekClosingStock','nextWeekDeficit','hasNextWeekRisk','hasForwardRisk'
    ]
    for key in required_comp:
        if key not in comp:
            print(f'MISSING comp key: {key}')
        else:
            print(f'OK: comp.{key}')

print('All checks done.')
"
```

---

### Check 4 — Role Validation

```bash
# Must return 403
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:8000/api/v1/plan-freeze/ \
  -H "Content-Type: application/json" \
  -d '{"fg_code":"7.06496.03.0","month":"2026-08","week_code":"w-2026-08-02",
       "status":"FROZEN","user_role":"demand_planner"}'
# Expected output: 403

# Must return 404 when plan does not exist
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:8000/api/v1/plan-freeze/ \
  -H "Content-Type: application/json" \
  -d '{"fg_code":"7.GHOST.NONE","month":"2026-08","week_code":"w-2026-08-02",
       "status":"FROZEN","user_role":"supply_planner"}'
# Expected output: 404
```

---

### Check 5 — CSV Export

```bash
curl -s -o cockpit_test.csv \
  "http://localhost:8000/api/v1/reports/monday-review-cockpit/export-csv/?month=2026-08&week_code=w-2026-08-02"

# Verify it downloaded
ls -lh cockpit_test.csv

# Verify header row
head -1 cockpit_test.csv
# Must equal: FG Code,FG Description,Mini Factory,Line,Prior Plan,Prior Actual 101,
#             Prior Backlog,Current Week Plan,Gross Target,Net Shortage Gap,W3 Plan,
#             W4 Plan,Health Status,Freeze Status
```

---

## SECTION 9 — Summary Checklist

Work through each item in order. Tick it off only after the verification
command for that section passes.

| # | Section | Task | Done? |
|---|---|---|---|
| 1 | Database | Roll back faked migration, drop 3-column stub table | |
| 2 | Database | Add all four model classes to models.py | |
| 3 | Database | Run makemigrations + migrate, verify 4 tables in Postgres | |
| 4 | URL Routing | Merge PlanFreezeListView + PlanFreezeUpdateView → PlanFreezeView | |
| 5 | URL Routing | Remove plan-freeze/update/ from urls.py, add plan-freeze/bulk/ | |
| 6 | Validation | Rewrite PlanFreezeService.upsert() with role check and DoesNotExist | |
| 7 | Validation | Fix MondayAction upsert to handle empty string component_code | |
| 8 | Dict E | Rewrite schedule query to match by week_code OR date range | |
| 9 | Field Names | Rename all 14 mismatched keys in cockpit_engine.py | |
| 10 | Field Names | Add id, currentStock, flatten vendorName/buyerName in component dict | |
| 11 | Field Names | Fix deliverySchedules, mondayReviewActions, weekDetails shapes | |
| 12 | Field Names | Add previousMonthPerf block per FG | |
| 13 | allWeeksDetail | Add computation block for W1–W4 FG horizon summary | |
| 14 | CSV Export | Write MondayReviewCockpitExportCSVView and register URL | |
| 15 | Verification | Run all 5 integration checks from Section 8 | |

---

## APPENDIX A — Data That Must Exist for Tests to Pass

If the database has no seed data, all checks will pass structurally but return empty
arrays. Insert this minimum seed data via `python manage.py shell` before running
Check 3:

```python
from core.models import (
    WeekDefinition, MonthlyPlan, BOMFGHeader,
    RMPMComponentMaster, BOMMaster, StockReport,
    VendorBuyerMaster, VendorSuppliedComponent
)
import datetime

# 1. FG Header
BOMFGHeader.objects.get_or_create(
    fg_code='7.06496.03.0',
    defaults={
        'fg_description': 'Vacuum Pump Panther 2.0L',
        'active_bom_version': 'v1',
        'uom': 'PC',
        'unit_price_inr': 5800,
        'is_active': True,
    }
)

# 2. Component
comp, _ = RMPMComponentMaster.objects.get_or_create(
    component_code='100201',
    defaults={
        'component_description': 'Die-Cast Aluminum Housing (Panther)',
        'category': 'RM',
        'uom': 'PC',
        'safety_stock': 1000,
        'is_active': True,
    }
)

# 3. BOM Line
BOMMaster.objects.get_or_create(
    fg_code='7.06496.03.0',
    component_code='100201',
    bom_version='v1',
    defaults={'qty': 1.0, 'uom': 'PC', 'is_active': True}
)

# 4. Weeks for 2026-08
weeks_data = [
    ('w-2026-08-01','2026-08',1,'Week 1 (01-07 Aug)','2026-08-01','2026-08-07',7,1,6),
    ('w-2026-08-02','2026-08',2,'Week 2 (08-14 Aug)','2026-08-08','2026-08-14',7,1,6),
    ('w-2026-08-03','2026-08',3,'Week 3 (15-21 Aug)','2026-08-15','2026-08-21',7,1,6),
    ('w-2026-08-04','2026-08',4,'Week 4 (22-31 Aug)','2026-08-22','2026-08-31',10,2,8),
]
for wc,mo,wno,lbl,sd,ed,dc,hd,wd in weeks_data:
    WeekDefinition.objects.get_or_create(
        week_code=wc,
        defaults={
            'month': mo, 'week_no': wno, 'week_label': lbl,
            'start_date': sd, 'end_date': ed,
            'days_count': dc, 'holiday_days': hd, 'working_days': wd
        }
    )

# 5. Monthly Plan with prorated breakdown
from core.services.prorate_service import ProrateService
from core.models import WeekDefinition as WD
weeks = list(WD.objects.filter(month='2026-08').order_by('week_no'))
breakdown = ProrateService.prorate(10000, weeks)
MonthlyPlan.objects.get_or_create(
    fg_code='7.06496.03.0',
    month='2026-08',
    defaults={
        'fg_description': 'Vacuum Pump Panther 2.0L',
        'customer_name': 'Tata Motors PV & EV',
        'monthly_target': 10000,
        'uom': 'PC',
        'weekly_breakdown': breakdown,
    }
)

# 6. Stock
StockReport.objects.get_or_create(
    part_number='100201',
    storage_location='RM01',
    defaults={
        'material_description': 'Die-Cast Aluminum Housing (Panther)',
        'material_type': 'RM',
        'unrestricted_stock': 850,
        'safety_stock': 1000,
        'uom': 'PC',
        'plant': '1001',
    }
)

print('Seed data inserted.')
```

---

## APPENDIX B — Environment Setup Requirements

Before running any command in this document, confirm these are true:

```bash
# Python version
python --version
# Must be 3.10+

# Django version
python -c "import django; print(django.VERSION)"
# Must be 4.x or 5.x

# psycopg2 installed
python -c "import psycopg2; print('ok')"

# Postgres connection works
python manage.py dbshell --command "\conninfo"

# Django can see all apps
python manage.py check --deploy 2>&1 | head -5
```

All five must succeed before starting Section 1.

---

*End of implementation guide.*
*Work through sections 1 → 9 in order. Do not reorder sections.*
*Every verification command must pass before moving to the next section.*
