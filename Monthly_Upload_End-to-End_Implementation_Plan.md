Now I have a thorough understanding of both components. Let me write the full implementation plan for the Monthly Upload section, covering:&#x20;

1. Define Week section - WeekDefinitionManager
2. Monthly Plan section - MonthlyPlanManager

I need to cover:

- All functions
- The exact proration formula with worked examples
- All API endpoints
- Data models
- Business rules
- Build order

Let me put together a comprehensive plan.

The proration formula from the code:

typescript

```typescript
export function calculateProratedWeeklyBreakdown(
  monthlyTarget: number,
  weeks: WeekDefinition[]
): Record<string, number> {
  const totalWorkingDays = weeks.reduce((sum, w) => sum + (w.workingDays || w.daysCount), 0);
  if (totalWorkingDays === 0 || weeks.length === 0) return {};

  const breakdown: Record<string, number> = {};
  let accumulated = 0;

  weeks.forEach((week, idx) => {
    const workingDays = week.workingDays || week.daysCount;
    if (idx === weeks.length - 1) {
      // Last week gets the remainder to prevent rounding drift
      breakdown[week.id] = Math.max(0, monthlyTarget - accumulated);
    } else {
      const calculated = Math.round(monthlyTarget * (workingDays / totalWorkingDays));
      breakdown[week.id] = calculated;
      accumulated += calculated;
    }
  });

  return breakdown;
}
```

The auto-generate standard month pattern is:

- W1: 01-07 (7 days, 6 working)
- W2: 08-14 (7 days, 6 working)
- W3: 15-21 (7 days, 6 working)
- W4: 22-EOM (varies, e.g., 10 days for August which ends on 31st)

For a full year auto-generation, the same 4-week pattern is applied to each month.

Now let me write the implementation plan.\
&#x20;\</thinking>

Now I have the complete picture of both components, all service contracts, and the exact proration formula. Let me write the full implementation plan.

---

### Monthly Upload — End-to-End Implementation Plan

---

### Part 1 — What Monthly Upload Does (Conceptual Model)

Monthly Upload is the **starting point of the entire MRP chain**. Nothing in the Monday Review Cockpit can run without it. It has two sub-sections that must be done in order:

```
STEP A: Define Week Calendar
        → Planner defines how the month is split into 3–5 week buckets
        → Each week gets: start date, end date, day count, holiday deduction, working days
        → Working days per week = the weights used for proration

STEP B: Monthly Plan Entry / Upload
        → Planner uploads customer FG demand: "Build 10,000 Vacuum Pumps in August"
        → Backend uses the week calendar from Step A to prorate that 10,000
          across the defined weeks proportional to their working days
        → Result: weekly_breakdown = {W1: 2308, W2: 2308, W3: 2308, W4: 3076}
        → This weekly_breakdown is then used by the cockpit engine every Monday
```

**The dependency is hard:** Monthly Plan proration cannot run without Week Definitions. The frontend enforces this — `handleCSVUpload` in `MonthlyPlanManager` checks `monthWeeks.length === 0` before allowing upload and blocks with a message. The backend must enforce it too.

---

### Part 2 — The Proration Formula (Exact Logic)

This is the most important formula in the entire Monthly Upload section. Every weekly breakdown in the system is produced by this logic.

---

#### Formula Name: Working-Day Proportional Proration

**Source:** `calculateProratedWeeklyBreakdown()` in `src/data/sapInitialData.ts`

**Inputs:**

- `monthly_target` — total FG units planned for the month (integer, > 0)
- `weeks[]` — sorted list of `week_definition` rows for the month, ordered by `week_no` ascending
- Each week has: `working_days` (preferred) OR `days_count` (fallback if `working_days` not set)

**Algorithm (step by step):**

```
Step 1 — Sum total working days across all weeks:
  total_working_days = Σ(week.working_days) for all weeks in month
  
  If total_working_days = 0 OR weeks list is empty:
    Return {} (empty dict — block plan creation with 400)

Step 2 — For each week EXCEPT the last:
  week_qty = round(monthly_target × (week.working_days / total_working_days))
  Store in breakdown[week.week_code] = week_qty
  accumulated += week_qty

Step 3 — Last week gets the remainder (prevents rounding drift):
  breakdown[last_week.week_code] = max(0, monthly_target - accumulated)

Return breakdown = {week_code: integer_qty}
```

**Why remainder to last week:** `round()` on each intermediate week creates cumulative rounding errors. If 10,000 × (6/26) = 2307.69 rounds to 2308 three times, that's 6924. The last week then gets 10000 − 6924 = 3076 exactly. The total always sums to exactly `monthly_target`.

---

#### Worked Example (August 2026 — actual data from the codebase)

**Week definitions for August 2026:**

| Week | Start      | End        | Days Count | Holiday Days | Working Days |
| ---- | ---------- | ---------- | ---------- | ------------ | ------------ |
| W1   | 2026-08-01 | 2026-08-07 | 7          | 1            | 6            |
| W2   | 2026-08-08 | 2026-08-14 | 7          | 1            | 6            |
| W3   | 2026-08-15 | 2026-08-21 | 7          | 1            | 6            |
| W4   | 2026-08-22 | 2026-08-31 | 10         | 2            | 8            |

**total_working_days = 6 + 6 + 6 + 8 = 26**

**FG: Vacuum Pump Panther 2.0L → monthly_target = 10,000 units**

| Week | Formula                              | Result   | Running Total |
| ---- | ------------------------------------ | -------- | ------------- |
| W1   | round(10000 × 6/26) = round(2307.69) | 2308     | 2308          |
| W2   | round(10000 × 6/26) = round(2307.69) | 2308     | 4616          |
| W3   | round(10000 × 6/26) = round(2307.69) | 2308     | 6924          |
| W4   | **REMAINDER: 10000 − 6924**          | **3076** | **10000** ✓   |

**weekly_breakdown stored as JSONB:**

json

```json
{
  "w-2026-08-01": 2308,
  "w-2026-08-02": 2308,
  "w-2026-08-03": 2308,
  "w-2026-08-04": 3076
}
```

**FG: FAM B Tandem Vacuum Pump → monthly_target = 8,000 units**

| Week | Formula            | Result   | Running Total |
| ---- | ------------------ | -------- | ------------- |
| W1   | round(8000 × 6/26) | 1846     | 1846          |
| W2   | round(8000 × 6/26) | 1846     | 3692          |
| W3   | round(8000 × 6/26) | 1846     | 5538          |
| W4   | 8000 − 5538        | **2462** | **8000** ✓    |

**When does proration re-run:**

- On `create_monthly_plan` — always runs on creation
- On `update_monthly_plan` — only if `monthly_target` changes or `month` changes
- On `update_week_definition` — cascade rerun for all plans in that month (dates or holiday_days changed, so working_days changed, so weights changed)
- On `delete_week_definition` — cascade rerun for all plans in that month (now one fewer week, weights shift)
- On `bulk_upload_monthly_plan` — runs per row after validation

---

### Part 3 — Auto-Generate Week Calendar Logic

This is the `handleGeneratePromptStandard` and `handleGenerateFullYear` functions. The standard pattern used in the codebase is:

```
W1: days 01–07 of month (7 days)
W2: days 08–14 of month (7 days)
W3: days 15–21 of month (7 days)
W4: day 22 to end of month (varies: 8 days for 29-day months,
                                      9 days for 30-day months,
                                      10 days for 31-day months)
```

**Holiday deduction default:** 1 holiday per 7-day week (Sunday), 2 holidays for the last longer week. This means `working_days = days_count - holiday_days`.

**For a 5-week month** (when the planner manually adds a 5th week, e.g., splitting W4 into W4 + W5): the backend must support any split as long as the date ranges do not overlap and both fall within the same calendar month.

**Full-year auto-generate:** The `autoGenerate` endpoint accepts `year` instead of `month`. It iterates all 12 months of the year and applies the standard 4-week pattern to each, deleting existing week definitions for the year if `overwrite=true`.

---

### Part 4 — All Functions to Implement

#### Section A: Define Week — All Functions

| #   | Function Name             | Trigger                                               | What It Does                                                                                                                                               |
| --- | ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1  | `list_weeks`              | GET request with `?month=YYYY-MM`                     | Returns all week definitions for a month, sorted by week_no. Used on every page load                                                                       |
| W2  | `create_week`             | POST from Add Custom Week form                        | Creates one week bucket. Computes `days_count` and `working_days` server-side. Validates date range is within month. Checks no overlap with existing weeks |
| W3  | `update_week`             | PATCH from Edit Week form                             | Updates dates, holiday_days, or label. Recomputes `days_count` and `working_days`. Triggers cascade proration on all monthly plans for this month          |
| W4  | `delete_week`             | DELETE from week row action                           | Hard deletes week. Blocks if any monthly plan's `weekly_breakdown` contains this week_code as a key. Triggers cascade proration on remaining plans         |
| W5  | `auto_generate_month`     | POST `weeks/auto-generate/` with `{month, overwrite}` | Generates standard 4-week split for one month. If `overwrite=true`, deletes existing weeks for that month first. Triggers cascade proration on all plans   |
| W6  | `auto_generate_year`      | POST `weeks/auto-generate/` with `{year, overwrite}`  | Generates 48 week buckets (12 months × 4 weeks) for the full year. If `overwrite=true`, deletes all existing weeks for that year first                     |
| W7  | `export_weeks_csv`        | GET from Export CSV button                            | Returns all weeks (current month, or all months depending on filter) as a `.csv` file. No DB write                                                         |
| W8  | `compute_days_count`      | Internal utility (called by W2, W3, W5, W6)           | `days_count = (end_date - start_date).days + 1`. Validates `end_date >= start_date`                                                                        |
| W9  | `compute_working_days`    | Internal utility (called by W2, W3, W5, W6)           | `working_days = max(1, days_count - holiday_days)`. Minimum clamped to 1                                                                                   |
| W10 | `generate_week_code`      | Internal utility (called by W2, W5, W6)               | Generates `week_code = w-{YYYY-MM}-{0N}` from month and week_no e.g. `w-2026-08-02`                                                                        |
| W11 | `validate_no_overlap`     | Internal utility (called by W2, W3)                   | Checks that the new/updated week's date range does not intersect with any other existing week in the same month                                            |
| W12 | `cascade_reprorate_plans` | Internal service (called by W3, W4, W5, W6)           | After any week definition change, fetches all `monthly_plan` rows for the affected month, re-runs proration on each, bulk-updates `weekly_breakdown` JSONB |

---

#### Section B: Monthly Plan — All Functions

| #   | Function Name              | Trigger                                            | What It Does                                                                                                                                                                                                        |
| --- | -------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | `list_monthly_plans`       | GET `monthly-plans/?month=&paginate=false`         | Returns all plans for a month. Called on mount and after every mutation. Returns `weekly_breakdown` JSONB as-is                                                                                                     |
| P2  | `create_monthly_plan`      | POST from Add FG Plan form                         | Creates one FG plan for the month. Fetches week definitions for the month, runs proration, stores `weekly_breakdown`. Validates `fg_code` starts with `7`. Validates no duplicate `(fg_code, month)`                |
| P3  | `update_monthly_plan`      | PATCH from Edit modal                              | Updates `monthly_target`, `customer_name`, `custom_notes`, `uom`. If `monthly_target` changed: re-runs proration and updates `weekly_breakdown`. If `month` changed: re-fetches weeks for new month and re-prorates |
| P4  | `delete_monthly_plan`      | DELETE from table row                              | Hard deletes plan. Also deletes any `fg_plan_freeze` records for `(fg_code, month)` to avoid orphaned freeze records                                                                                                |
| P5  | `bulk_upload_monthly_plan` | POST `uploads/monthly-plan/` (file or pasted text) | Parses CSV/Excel/pasted text. Validates each row. Runs proration per valid row. Upserts on `(fg_code, month)`. Creates `upload_batch` record. Stores original file in MinIO                                         |
| P6  | `prorate_monthly_plan`     | Internal service (called by P2, P3, P5, W12)       | Core formula: `round(monthly_target × week.working_days / total_working_days)` per week. Last week gets remainder. Returns `{week_code: qty}` dict                                                                  |
| P7  | `recalculate_all_prorated` | GET triggered by "Recalculate Weeks" button        | Fetches current weeks for month, re-runs proration on ALL plans for that month, bulk-updates. Called when planner changes week definitions after plans are already entered                                          |
| P8  | `download_template`        | GET (frontend-side only, no backend)               | Returns a hardcoded CSV template string. Pure frontend — no API call                                                                                                                                                |
| P9  | `export_plans_csv`         | GET `exports/monthly-plan-csv/?month=`             | Returns all plans for the month as CSV with weekly breakdown columns flattened. Headers: FG Code, FG Description, Customer Name, Month, Monthly Target, W1 (Nd), W2 (Nd), W3 (Nd), W4 (Nd), UOM                     |
| P10 | `parse_csv_file`           | Internal utility (called by P5)                    | Handles `.csv` (Python csv module), `.xlsx` (openpyxl), pasted text (string split + strip). Auto-detects delimiter (tab or comma). Skips header row if first cell contains `fg`/`code`/`material`                   |
| P11 | `parse_pasted_text`        | Internal utility (called by P5)                    | Splits pasted text by newline, then by comma or tab. Strips quotes and whitespace. Returns list of dicts with column names                                                                                          |
| P12 | `validate_plan_row`        | Internal utility (called by P5 per row)            | Validates: `fg_code` starts with `7`, `monthly_target > 0`, `monthly_target` is numeric, FG code max 30 chars                                                                                                       |
| P13 | `get_upload_batch_status`  | GET `uploads/batches/{batch_id}/`                  | Returns batch status, row counts, and per-row error details. Used by frontend to display upload result report                                                                                                       |

---

### Part 5 — Database Schema (Monthly Upload Tables Only)

---

#### Table: `week_definition`

| Field Name   | Data Type   | PK/FK/Index | Nullable | Description                                                                        |
| ------------ | ----------- | ----------- | -------- | ---------------------------------------------------------------------------------- |
| id           | SERIAL      | PK          | No       | Auto-increment integer PK                                                          |
| week_code    | VARCHAR(30) | UNIQUE, IDX | No       | Business key e.g. `w-2026-08-02`; used as the foreign key by all downstream tables |
| month        | VARCHAR(7)  | IDX         | No       | `YYYY-MM` e.g. `2026-08`                                                           |
| week_no      | SMALLINT    |             | No       | Position within month: 1–5                                                         |
| week_label   | VARCHAR(60) |             | No       | Human-readable label e.g. `Week 2 (08-14 Aug)`                                     |
| start_date   | DATE        | IDX         | No       | Inclusive start of week bucket                                                     |
| end_date     | DATE        | IDX         | No       | Inclusive end of week bucket                                                       |
| days_count   | SMALLINT    |             | No       | `(end_date - start_date).days + 1`; computed server-side, never from client        |
| holiday_days | SMALLINT    |             | No       | Non-working days: Sundays, national holidays; default 0                            |
| working_days | SMALLINT    |             | No       | `max(1, days_count - holiday_days)`; the proration weight                          |
| created_at   | TIMESTAMPTZ |             | No       |                                                                                    |

**Unique Constraint:** `(month, week_no)` — one bucket per week number per month.

**Relationships:**

- `week_definition.week_code` → `mb51_transaction.week_code` (SET NULL on delete)
- `week_definition.week_code` → `vendor_delivery_schedule.week_code` (SET NULL on delete)
- `week_definition.week_code` → `fg_plan_freeze.week_code` (RESTRICT on delete)
- `week_definition.week_code` → `monday_review_action.week_code` (RESTRICT on delete)
- `week_definition.month` → `monthly_plan.month` (logical join for proration)

**Indexes:**

- `idx_wd_month` on `month` — primary filter: all week lookups start here
- `idx_wd_date_range` on `(start_date, end_date)` — `map_transaction_to_week` date scan used by MB51 upload and delivery schedule week resolution

---

#### Table: `monthly_plan`

| Field Name       | Data Type    | PK/FK/Index                               | Nullable | Description                                                                                     |
| ---------------- | ------------ | ----------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| id               | SERIAL       | PK                                        | No       | Auto-increment integer PK                                                                       |
| fg_code          | VARCHAR(30)  | FK(`bom_fg_header.fg_code`) RESTRICT, IDX | No       | FG part number; must exist in `bom_fg_header`; must start with `7`                              |
| fg_description   | VARCHAR(120) |                                           | No       | Denormalized from `bom_fg_header` for display without join                                      |
| customer_name    | VARCHAR(80)  |                                           | Yes      | OEM customer for this plan entry e.g. `Tata Motors PV & EV`                                     |
| month            | VARCHAR(7)   | IDX                                       | No       | `YYYY-MM`                                                                                       |
| monthly_target   | INTEGER      |                                           | No       | Total planned FG units for the month; must be > 0                                               |
| uom              | VARCHAR(10)  |                                           | No       | Unit of measure; defaults to `PC`                                                               |
| weekly_breakdown | JSONB        |                                           | No       | `{week_code: integer_qty}` — computed by proration service; never accepted from client directly |
| custom_notes     | TEXT         |                                           | Yes      | Planner annotations                                                                             |
| upload_batch_id  | INTEGER      | FK(`upload_batch.id`) SET NULL, IDX       | Yes      | Source batch if created via bulk upload; NULL if created manually                               |
| created_at       | TIMESTAMPTZ  |                                           | No       |                                                                                                 |
| updated_at       | TIMESTAMPTZ  |                                           | No       |                                                                                                 |

**Unique Constraint:** `(fg_code, month)` — one plan per FG per month.

**Relationships:**

- `monthly_plan.fg_code` → `bom_fg_header.fg_code` (RESTRICT — cannot create a plan for an FG that has no header)
- `monthly_plan.id` → `fg_plan_freeze` (logical: freeze records reference fg_code + month)

**Indexes:**

- `idx_mp_month` on `month` — primary filter; all MRP computations begin with this
- `idx_mp_fg_code` on `fg_code` — lookup when freezing, deleting, or updating a specific FG
- `idx_mp_weekly_breakdown` GIN on `weekly_breakdown` — JSONB key-value extraction in MRP cockpit engine inner loop

---

#### Table: `upload_batch` (shared across all upload types)

| Field Name    | Data Type    | PK/FK/Index | Nullable | Description                                                                        |
| ------------- | ------------ | ----------- | -------- | ---------------------------------------------------------------------------------- |
| id            | SERIAL       | PK          | No       |                                                                                    |
| upload_type   | VARCHAR(40)  | IDX         | No       | `MONTHLY_PLAN` / `BOM_IMPORT` / `MB51` / `MB52_STOCK` / `VENDOR_DELIVERY_SCHEDULE` |
| uploaded_by   | VARCHAR(80)  |             | No       | User name or role initiating the upload                                            |
| uploaded_at   | TIMESTAMPTZ  | IDX         | No       | Server timestamp                                                                   |
| file_name     | VARCHAR(255) |             | Yes      | Original uploaded file name                                                        |
| minio_path    | VARCHAR(500) |             | Yes      | MinIO object key where the raw file is stored for audit                            |
| status        | VARCHAR(20)  | IDX         | No       | `PENDING` / `PROCESSING` / `COMPLETED` / `PARTIAL` / `FAILED`                      |
| total_rows    | INTEGER      |             | No       | Total parsed rows                                                                  |
| imported_rows | INTEGER      |             | No       | Successfully upserted rows                                                         |
| error_rows    | INTEGER      |             | No       | Rows skipped due to validation failure                                             |
| error_detail  | JSONB        |             | Yes      | `[{row_index, fg_code, reason}]` per-row error log                                 |
| created_at    | TIMESTAMPTZ  |             | No       |                                                                                    |

---

### Part 6 — API Endpoint Specification

---

#### Week Definition Endpoints

| #  | URL                         | Method | Request                                                              | Response                                             | Notes                                                                    |
| -- | --------------------------- | ------ | -------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| W1 | `/api/weeks/`               | GET    | `?month=YYYY-MM&paginate=false`                                      | `WeekDTO[]` flat array                               | No pagination; `paginate=false` returns raw array for calendar rendering |
| W2 | `/api/weeks/`               | POST   | `{month, week_no, start_date, end_date, holiday_days?, week_label?}` | Created `WeekDTO` (201)                              | Computes `days_count`, `working_days`, `week_code` server-side           |
| W3 | `/api/weeks/{id}/`          | PATCH  | `{start_date?, end_date?, holiday_days?, week_label?, week_no?}`     | Updated `WeekDTO` (200) + triggers cascade proration |                                                                          |
| W4 | `/api/weeks/{id}/`          | DELETE | —                                                                    | `{deleted: true, cascade_plans_updated: N}`          | Blocks if `fg_plan_freeze` rows reference this `week_code`               |
| W5 | `/api/weeks/auto-generate/` | POST   | `{month?: 'YYYY-MM', year?: 'YYYY', overwrite?: bool}`               | `{message, count, results: WeekDTO[]}`               | Either `month` or `year` must be present; not both                       |

---

#### Monthly Plan Endpoints

| #  | URL                              | Method | Request                                                                 | Response                                                                                       | Notes                                                                                  |
| -- | -------------------------------- | ------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P1 | `/api/monthly-plans/`            | GET    | `?month=YYYY-MM&paginate=false&search=`                                 | `BackendMonthlyPlan[]` flat array                                                              | `weekly_breakdown` JSONB included in every row                                         |
| P2 | `/api/monthly-plans/`            | POST   | `{fg_code, month, monthly_target, uom?, customer_name?, custom_notes?}` | Created `BackendMonthlyPlan` (201) with computed `weekly_breakdown`                            |                                                                                        |
| P3 | `/api/monthly-plans/{id}/`       | PATCH  | `{monthly_target?, customer_name?, custom_notes?, uom?}`                | Updated `BackendMonthlyPlan` (200); `weekly_breakdown` re-prorated if `monthly_target` changed |                                                                                        |
| P4 | `/api/monthly-plans/{id}/`       | DELETE | —                                                                       | `{deleted: true}`                                                                              |                                                                                        |
| P5 | `/api/uploads/monthly-plan/`     | POST   | `multipart: file (.csv/.xlsx) OR json: {month, pasted_text}`            | `MonthlyPlanUploadResponse`                                                                    |                                                                                        |
| P6 | `/api/exports/monthly-plan-csv/` | GET    | `?month=YYYY-MM`                                                        | `.csv` file download                                                                           | Columns: FG Code, FG Description, Customer, Month, Monthly Target, W1, W2, W3, W4, UOM |

---

### Part 7 — Django Models

```
# app/models.py

class WeekDefinition(models.Model):
    week_code             = CharField(max_length=30, unique=True)
    month                 = CharField(max_length=7, db_index=True)
    week_no               = SmallIntegerField()
    week_label            = CharField(max_length=60)
    start_date            = DateField(db_index=True)
    end_date              = DateField(db_index=True)
    days_count            = SmallIntegerField()
    holiday_days          = SmallIntegerField(default=0)
    working_days          = SmallIntegerField()
    created_at            = DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('month', 'week_no')]
        indexes = [
            Index(fields=['month']),
            Index(fields=['start_date', 'end_date']),
        ]


class MonthlyPlan(models.Model):
    fg_code               = CharField(max_length=30, db_index=True)
    fg_description        = CharField(max_length=120)
    customer_name         = CharField(max_length=80, blank=True)
    month                 = CharField(max_length=7, db_index=True)
    monthly_target        = IntegerField()
    uom                   = CharField(max_length=10, default='PC')
    weekly_breakdown      = JSONField(default=dict)
    custom_notes          = TextField(blank=True)
    upload_batch          = ForeignKey('UploadBatch', null=True, blank=True,
                                       on_delete=SET_NULL, db_index=True)
    created_at            = DateTimeField(auto_now_add=True)
    updated_at            = DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('fg_code', 'month')]
        indexes = [
            Index(fields=['month']),
            Index(fields=['fg_code']),
            GinIndex(fields=['weekly_breakdown']),
        ]
```

---

### Part 8 — Django Services (Pure Python Logic)

---

#### Service 1: `WeekService`

```
class WeekService:

  @staticmethod
  def compute_days_count(start_date: date, end_date: date) -> int:
      """
      Returns inclusive day count.
      Example: 2026-08-01 to 2026-08-07 = 7 days
      """
      delta = end_date - start_date
      return delta.days + 1

  @staticmethod
  def compute_working_days(days_count: int, holiday_days: int) -> int:
      """
      Returns max(1, days_count - holiday_days).
      Clamped to minimum 1 to prevent zero-division in proration.
      """
      return max(1, days_count - holiday_days)

  @staticmethod
  def generate_week_code(month: str, week_no: int) -> str:
      """
      Returns 'w-{YYYY-MM}-{0N}'.
      Example: month='2026-08', week_no=2 → 'w-2026-08-02'
      """
      return f"w-{month}-{week_no:02d}"

  @staticmethod
  def validate_dates_within_month(month: str, start_date: date, end_date: date):
      """
      Ensures start_date and end_date fall within the calendar month.
      Example: for month='2026-08', valid range is 2026-08-01 to 2026-08-31.
      Raises ValidationError if either date is outside.
      """

  @staticmethod
  def validate_no_overlap(month: str, start_date: date, end_date: date, exclude_id=None):
      """
      Queries week_definition for the month.
      Raises ValidationError if any existing week's date range
      intersects with [start_date, end_date].
      Excludes the row being updated (exclude_id) from the check.
      """

  @staticmethod
  def generate_standard_4_week_split(month: str) -> list[dict]:
      """
      Returns 4 week definition dicts for standard pattern:
        W1: 01–07  (7 days, 1 holiday → 6 working)
        W2: 08–14  (7 days, 1 holiday → 6 working)
        W3: 15–21  (7 days, 1 holiday → 6 working)
        W4: 22–EOM (days_in_month - 21 days, 2 holidays → remainder working days)
      
      Uses Python calendar.monthrange(year, month) to get last day of month.
      """

  @staticmethod
  def generate_full_year(year: str) -> list[dict]:
      """
      Calls generate_standard_4_week_split for each of 12 months in year.
      Returns 48 week definition dicts (12 months × 4 weeks).
      """
```

---

#### Service 2: `ProrateService`

This is the most critical service. Every monthly plan goes through it.

```
class ProrateService:

  @staticmethod
  def prorate(monthly_target: int, weeks: QuerySet | list) -> dict:
      """
      The core proration formula.
      
      Args:
          monthly_target: Total FG units planned for the month. Must be > 0.
          weeks: List/QuerySet of WeekDefinition objects for the month,
                 ordered by week_no ASC. Must not be empty.
      
      Returns:
          {week_code: integer_qty} dict.
          Sum of all values == monthly_target exactly (remainder to last week).
      
      Raises:
          ValueError: if weeks is empty or total_working_days == 0
      
      Algorithm:
          total_working_days = sum(w.working_days for w in weeks)
          if total_working_days == 0 or len(weeks) == 0:
              raise ValueError("No weeks defined for this month")
          
          breakdown = {}
          accumulated = 0
          weeks_sorted = sorted(weeks, key=lambda w: w.week_no)
          
          for idx, week in enumerate(weeks_sorted):
              if idx == len(weeks_sorted) - 1:
                  # Last week gets exact remainder — prevents rounding drift
                  breakdown[week.week_code] = max(0, monthly_target - accumulated)
              else:
                  qty = round(monthly_target * (week.working_days / total_working_days))
                  breakdown[week.week_code] = qty
                  accumulated += qty
          
          return breakdown
      
      Example (August 2026, monthly_target=10000, weeks W1-W4 with 6,6,6,8 working days):
          total_working_days = 26
          W1: round(10000 × 6/26) = round(2307.69) = 2308; accumulated=2308
          W2: round(10000 × 6/26) = round(2307.69) = 2308; accumulated=4616
          W3: round(10000 × 6/26) = round(2307.69) = 2308; accumulated=6924
          W4: 10000 - 6924 = 3076 (REMAINDER)
          Result: {w-2026-08-01:2308, w-2026-08-02:2308, w-2026-08-03:2308, w-2026-08-04:3076}
          Sum: 2308+2308+2308+3076 = 10000 ✓
      """

  @staticmethod
  def cascade_reprorate(month: str) -> int:
      """
      Called whenever week definitions change for a month.
      Fetches all monthly_plan rows where month=month.
      Re-runs prorate() for each.
      Bulk-updates weekly_breakdown JSONB for all plans.
      Returns count of plans updated.
      
      This must run inside a transaction: if any plan update fails,
      all roll back and the week definition change is also rolled back.
      Uses transaction.atomic() wrapping the entire update_week / delete_week view.
      """
```

---

#### Service 3: `MonthlyPlanUploadService`

```
class MonthlyPlanUploadService:

  @staticmethod
  def parse_csv_file(file_obj) -> list[dict]:
      """
      Handles .xlsx via openpyxl, .csv via Python csv module.
      Reads first sheet only for .xlsx.
      Auto-detects delimiter: if first data line has tab chars → tab; else comma.
      Skips header row if first cell lowercased contains any of:
          'fg', 'code', 'material', 'part', 'finished'
      Returns list of dicts: [{fg_code, fg_description, customer_name, monthly_target, uom, custom_notes}]
      Strips quotes and leading/trailing whitespace from all string fields.
      Strips commas from monthly_target before float() parse.
      """

  @staticmethod
  def parse_pasted_text(text: str) -> list[dict]:
      """
      Splits by newline. Strips blank lines.
      For each line: split by tab (preferred) or comma.
      Minimum 4 columns required: FG Code, FG Description, Customer, Monthly Target.
      Optional column 5: UOM (defaults to 'PC').
      Optional column 6: Notes.
      Returns same structure as parse_csv_file.
      """

  @staticmethod
  def validate_row(row: dict, row_index: int) -> tuple[bool, str]:
      """
      Returns (is_valid, error_reason).
      Checks:
        1. fg_code is non-empty → "FG Code is required"
        2. fg_code starts with '7' → "FG Code must start with '7' (SAP Finished Good rule)"
        3. fg_code max 30 chars → "FG Code too long"
        4. monthly_target is numeric after stripping commas → "Monthly Target must be a number"
        5. monthly_target > 0 → "Monthly Target must be greater than 0"
      """

  @staticmethod
  def upload(month: str, file_or_text, uploaded_by: str, minio_service) -> dict:
      """
      Main orchestrator. Steps:
      
      1. Create upload_batch record with status='PENDING'.
      2. If file: upload original to MinIO → store minio_path in batch.
      3. Parse file or text → list of raw rows.
      4. Fetch week_definition rows for month → if empty, fail entire batch with message.
      5. For each row:
           a. validate_row() → if invalid, add to errors, skip row.
           b. Build payload: {fg_code, fg_description, month, monthly_target, uom, customer_name, custom_notes}.
           c. Run ProrateService.prorate(monthly_target, weeks) → weekly_breakdown.
           d. Upsert MonthlyPlan on (fg_code, month):
                - If exists: UPDATE monthly_target, fg_description, customer_name, custom_notes, weekly_breakdown, upload_batch_id.
                - If not: INSERT new row with all fields.
           e. imported_rows++.
      6. Update upload_batch: status='COMPLETED' or 'PARTIAL', counts, error_detail.
      7. Return MonthlyPlanUploadResponse.
      
      Rollback: if step 4 fails (no weeks), set batch status='FAILED', return immediately.
      Partial import: individual row errors do not roll back other rows.
      """
```

---

### Part 9 — Django Views (Wire Everything Together)

---

#### Week Definition Views

```
WeekListCreateView       → GET/POST   /api/weeks/
WeekDetailView           → PATCH/DELETE /api/weeks/{id}/
WeekAutoGenerateView     → POST       /api/weeks/auto-generate/
```

**`WeekListCreateView.create()` logic:**

```
1. Deserialize and validate payload
2. Call WeekService.validate_dates_within_month(month, start_date, end_date)
3. Call WeekService.validate_no_overlap(month, start_date, end_date)
4. week_code = WeekService.generate_week_code(month, week_no)
5. days_count = WeekService.compute_days_count(start_date, end_date)
6. working_days = WeekService.compute_working_days(days_count, holiday_days)
7. if week_label is blank: auto-generate label
8. INSERT WeekDefinition
9. Return 201 with WeekDTO
```

**`WeekDetailView.partial_update()` logic:**

```
1. Fetch existing week by id → 404 if not found
2. If start_date or end_date in payload:
   - validate_dates_within_month
   - validate_no_overlap (exclude this week's id)
3. Recompute days_count and working_days
4. UPDATE week row
5. Call ProrateService.cascade_reprorate(week.month)
   inside transaction.atomic() — if cascade fails, rollback week update too
6. Return 200 with {updated WeekDTO, cascade_plans_updated: N}
```

**`WeekDetailView.destroy()` logic:**

```
1. Fetch week by id → 404 if not found
2. Check if any fg_plan_freeze rows reference this week_code (RESTRICT) → 409
3. Check if any monday_review_action rows reference this week_code → 409
4. DELETE week
5. Call ProrateService.cascade_reprorate(week.month) for remaining plans
   (remaining weeks now have different weights)
6. Return {deleted: true, cascade_plans_updated: N}
```

**`WeekAutoGenerateView.post()` logic:**

```
If 'month' in payload:
  1. Validate month format YYYY-MM
  2. Call WeekService.generate_standard_4_week_split(month) → 4 dicts
  3. If overwrite=True: DELETE all existing WeekDefinition WHERE month=month
     Check cascade blocks first — if any freeze/action rows exist → 409
  4. Bulk INSERT 4 week rows
  5. Call ProrateService.cascade_reprorate(month)
  6. Return {message, count=4, results: WeekDTO[]}

If 'year' in payload:
  1. Validate year format YYYY
  2. Call WeekService.generate_full_year(year) → 48 dicts (12 × 4)
  3. If overwrite=True: DELETE all existing weeks WHERE month LIKE 'YYYY-%'
     Check cascade blocks across all 12 months first
  4. Bulk INSERT 48 week rows
  5. For each of the 12 months: call ProrateService.cascade_reprorate(month)
  6. Return {message, count=48, results: WeekDTO[]}
```

---

#### Monthly Plan Views

```
MonthlyPlanListCreateView  → GET/POST   /api/monthly-plans/
MonthlyPlanDetailView      → PATCH/DELETE /api/monthly-plans/{id}/
MonthlyPlanBulkUploadView  → POST       /api/uploads/monthly-plan/
MonthlyPlanCSVExportView   → GET        /api/exports/monthly-plan-csv/
```

**`MonthlyPlanListCreateView.create()` logic:**

```
1. Validate fg_code starts with '7' → 400
2. Validate monthly_target > 0 → 400
3. Check (fg_code, month) unique → 409 if duplicate
4. Resolve fg_description from bom_fg_header (if not provided in payload)
5. Fetch WeekDefinition rows for month → 400 if none
6. weekly_breakdown = ProrateService.prorate(monthly_target, weeks)
7. INSERT MonthlyPlan with all fields
8. Return 201 with BackendMonthlyPlan (weekly_breakdown included)
```

**`MonthlyPlanDetailView.partial_update()` logic:**

```
1. Fetch plan by id → 404 if not found
2. PATCH non-computed fields (customer_name, custom_notes, uom)
3. If monthly_target in payload and changed:
   - Validate > 0
   - Fetch weeks for plan.month
   - weekly_breakdown = ProrateService.prorate(new_monthly_target, weeks)
   - UPDATE monthly_target and weekly_breakdown together
4. Return 200 with updated BackendMonthlyPlan

NOTE: weekly_breakdown is never accepted directly from the client payload.
It is always computed server-side. If client sends weekly_breakdown, ignore it.
```

**`MonthlyPlanDetailView.destroy()` logic:**

```
1. Fetch plan by id → 404
2. Check if fg_plan_freeze rows exist for (fg_code, month):
   - If any are FROZEN → 409 with message "Cannot delete a frozen plan"
   - If DRAFT or REVIEWED → delete freeze records first, then delete plan
3. Hard DELETE MonthlyPlan
4. Return {deleted: true}
```

**`MonthlyPlanBulkUploadView.post()` logic:**

```
1. Validate month is in request (form field or JSON) → 400 if missing
2. Validate week_definitions exist for month → 400 if none
   Error message: "No week definitions found for {month}. Define weeks first."
3. Validate file OR pasted_text in payload → 400 if neither
4. Call MonthlyPlanUploadService.upload(month, file_or_text, uploaded_by, minio_service)
5. Return MonthlyPlanUploadResponse:
   {
     message: "Monthly Plan upload complete for 2026-08",
     batch_id: 42,
     month: "2026-08",
     total_rows: 5,
     imported_rows: 4,
     error_rows: 1,
     errors: [{row_index: 3, fg_code: "1.WRONG.01", reason: "FG Code must start with '7'"}],
     results: [BackendMonthlyPlan, ...]  // all successfully imported plans
   }
```

**`MonthlyPlanCSVExportView.get()` logic:**

```
1. Validate month param → 400 if missing
2. Fetch MonthlyPlan WHERE month=month, ordered by fg_code
3. Fetch WeekDefinition WHERE month=month, ordered by week_no
4. Build CSV headers: ['FG Code', 'FG Description', 'Customer Name', 'Month',
                        'Monthly Target', ...week_labels..., 'UOM']
5. For each plan: serialize all fields, extract weekly_breakdown[w.week_code]
   for each week (0 if key not present)
6. StreamingHttpResponse with Content-Disposition: attachment; filename=Monthly_Plan_2026-08.csv
```

---

### Part 10 — Build Order (Step by Step)

---

#### Stage A — Foundation (Required Before Anything Else)

| Step | What to Build                                                                                                | Why                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| A1   | `WeekDefinition` Django model + migration                                                                    | All downstream tables reference `week_code`. Must exist first                    |
| A2   | `UploadBatch` Django model + migration                                                                       | All upload views write to this. Must exist before any upload view                |
| A3   | `MonthlyPlan` Django model + migration (no FK to `bom_fg_header` initially — add FK after BOM stage is done) | Core data table for this section                                                 |
| A4   | `WeekService` — all 7 utility methods                                                                        | No DB dependency, pure Python. Write and unit-test independently                 |
| A5   | `ProrateService.prorate()`                                                                                   | Pure Python. Unit-test with the worked example from Part 2. Zero DB calls inside |

---

#### Stage B — Week Definition API

| Step | What to Build                                             | Detail                                                                                                                                                                                                       |
| ---- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1   | `WeekSerializer`                                          | Fields: all WeekDTO fields. `days_count`, `working_days`, `week_code` are read-only (computed server-side)                                                                                                   |
| B2   | `WeekListCreateView` — GET + POST `/api/weeks/`           | GET: filter by month, order by week_no, return flat array when `paginate=false`. POST: full create flow from Part 9                                                                                          |
| B3   | `WeekDetailView` — PATCH + DELETE `/api/weeks/{id}/`      | PATCH: update + cascade. DELETE: block check + cascade                                                                                                                                                       |
| B4   | `WeekAutoGenerateView` — POST `/api/weeks/auto-generate/` | Handle both `month` and `year` keys. Wrap in `transaction.atomic()`                                                                                                                                          |
| B5   | Unit tests for Week API                                   | Test: create with auto-computed days_count; reject overlapping dates; reject dates outside month; auto-generate produces correct date ranges; full-year generates 48 rows; delete blocks on freeze reference |

**After B5: Week Definition Manager is fully functional.**

---

#### Stage C — Proration Cascade

| Step | What to Build                                       | Detail                                                                                                                                                                                 |
| ---- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1   | `ProrateService.cascade_reprorate(month)`           | Requires `MonthlyPlan` model from A3. Wraps all updates in `transaction.atomic()`                                                                                                      |
| C2   | Wire cascade into `WeekDetailView.partial_update()` | After week update, call `cascade_reprorate`. If cascade fails, rollback week update                                                                                                    |
| C3   | Wire cascade into `WeekDetailView.destroy()`        | After week delete, call `cascade_reprorate` for remaining plans                                                                                                                        |
| C4   | Wire cascade into `WeekAutoGenerateView.post()`     | After bulk insert, call `cascade_reprorate` for each affected month                                                                                                                    |
| C5   | Unit tests for cascade                              | Test: update week dates → all plan breakdowns change correctly; delete week → plans re-prorated across remaining weeks; weekly_breakdown sums still equal monthly_target after cascade |

---

#### Stage D — Monthly Plan CRUD API

| Step | What to Build                                                       | Detail                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1   | `MonthlyPlanSerializer`                                             | Fields: all BackendMonthlyPlan fields. `weekly_breakdown` read-only from client; `fg_description` auto-resolved from `bom_fg_header`                                                      |
| D2   | `MonthlyPlanListCreateView` — GET + POST `/api/monthly-plans/`      | GET: filter by month and search, return flat array when `paginate=false`. POST: full create flow including proration                                                                      |
| D3   | `MonthlyPlanDetailView` — PATCH + DELETE `/api/monthly-plans/{id}/` | PATCH: re-prorate if `monthly_target` changes. DELETE: freeze check                                                                                                                       |
| D4   | Unit tests for Monthly Plan CRUD                                    | Test: create prorates correctly; update target re-prorates and sum still equals new target; delete blocked when FROZEN; duplicate (fg_code, month) returns 409; missing weeks returns 400 |

---

#### Stage E — Bulk Upload

| Step | What to Build                                                   | Detail                                                                                                                                                                                                                                                                       |
| ---- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1   | `MonthlyPlanParser.parse_csv_file()`                            | openpyxl for .xlsx, Python `csv` module for .csv. Header row detection. Delimiter auto-detect                                                                                                                                                                                |
| E2   | `MonthlyPlanParser.parse_pasted_text()`                         | Newline split, tab/comma split per line, minimum 4 columns                                                                                                                                                                                                                   |
| E3   | `MonthlyPlanParser.validate_row()`                              | 5 validation checks from Service 3 spec                                                                                                                                                                                                                                      |
| E4   | `MonthlyPlanUploadService.upload()`                             | Full orchestrator from Service 3 spec                                                                                                                                                                                                                                        |
| E5   | `MonthlyPlanBulkUploadView` — POST `/api/uploads/monthly-plan/` | Handles both multipart file and JSON pasted_text                                                                                                                                                                                                                             |
| E6   | MinIO integration — store original file                         | `StorageService.upload_file(file_obj, 'uploads/monthly-plan/{month}/{batch_id}.{ext}')`                                                                                                                                                                                      |
| E7   | Unit tests for bulk upload                                      | Test: valid CSV imports all rows with correct proration; row with fg_code not starting with '7' is skipped; row with zero target is skipped; no weeks for month returns 400 blocking entire upload; duplicate fg_code is upserted not duplicated; upload result counts match |

---

#### Stage F — Export and Polish

| Step | What to Build                                                     | Detail                                                                                                                                                                                                                                      |
| ---- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1   | `MonthlyPlanCSVExportView` — GET `/api/exports/monthly-plan-csv/` | StreamingHttpResponse. Flatten `weekly_breakdown` JSONB into week columns                                                                                                                                                                   |
| F2   | Week CSV export — GET (can be frontend-only or backend endpoint)  | Frontend already generates this client-side in `handleExportCSV`. Backend endpoint optional                                                                                                                                                 |
| F3   | `GET /api/uploads/batches/{id}/`                                  | Return upload batch status for result display                                                                                                                                                                                               |
| F4   | Integration test: full Monthly Upload workflow                    | Test: define 4 weeks → upload CSV with 3 FG plans → verify 3 plans exist → verify weekly_breakdown sums for each → update one week's holiday_days → verify all 3 plans re-prorated → export CSV → verify CSV has correct week column values |

---

### Part 11 — Validation Rules Summary

These must all be enforced at the **service layer**, not just the serializer:

**Week Definition rules:**

- `start_date` and `end_date` must both fall within the `month`'s calendar boundaries (first day to last day of the month)
- `end_date >= start_date` — zero-length weeks rejected with 400
- No date overlap with any other week in the same month
- `working_days` minimum is 1 — never allow zero (prevents division by zero in proration)
- Unique constraint on `(month, week_no)` — cannot have two Week 2s in the same month
- Delete blocked if `fg_plan_freeze` OR `monday_review_action` rows reference the `week_code`

**Monthly Plan rules:**

- `fg_code` must start with `'7'` — enforced at both CRUD and bulk upload
- `monthly_target` must be an integer greater than 0
- Unique constraint on `(fg_code, month)` — upsert on bulk upload, 409 on manual duplicate
- Week definitions must exist for the plan's month — 400 if none found
- `weekly_breakdown` is always computed server-side — client-submitted values are silently ignored
- Delete is blocked if any `fg_plan_freeze` with `status='FROZEN'` exists for `(fg_code, month)`

**Cascade proration rules:**

- Runs inside `transaction.atomic()` — if any plan update fails, the week definition change is also rolled back
- After cascade: sum of all values in each plan's `weekly_breakdown` must equal that plan's `monthly_target` exactly (verified by test)
- If a week is deleted and no weeks remain for the month, `weekly_breakdown` is set to `{}` for all plans — plans are not deleted but effectively become un-prorated