### Monday Review Cockpit — End-to-End Implementation Plan

---

### Part 1 — What the Cockpit Does (Conceptual Model)

Before touching any code, understand what the cockpit is. It answers one question every Monday morning:

> **"For each Finished Good we plan to build this week — do we have enough raw material right now and in committed vendor deliveries to hit the target, including anything we failed to build last week?"**

It does this in 7 sequential logical steps that build on each other. Every step's output feeds into the next.

```
STEP 1:  How many FG units are we supposed to build this week?
         → monthly plan prorated qty for selected week

STEP 2:  Did we fall short in previous weeks this month?
         → prior backlog = Σ(plan - actual) for all weeks before selected week

STEP 3:  What is the REAL target including the backlog?
         → gross target = current week plan + prior backlog

STEP 4:  What RM/PM does each unit of each FG need?
         → BOM explosion: fg → list of (componentCode, qty per unit)

STEP 5:  For each component, how much stock do we actually have FREE?
         → available stock = MB52 stock - stock reserved by OTHER frozen FG plans

STEP 6:  Can vendor deliveries make up the deficit?
         → projected stock = free stock + committed vendor inward (PO schedules)

STEP 7:  Can we build the gross target or not?
         → health status = CLEAR / SCHEDULE_ON_TRACK / INADEQUATE / CRITICAL_SHORTAGE
```

---

### Part 2 — Every Piece of Data the Cockpit Needs

This is the exact data the `computeMondayReviewCockpit` function reads. Nothing more, nothing less.

| #  | Data Needed               | Source Table                                         | Fields Used                                                                                  | When                                                  |
| -- | ------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 1  | Month's week buckets      | `week_definition`                                    | `month`, `week_no`, `week_code`, `start_date`, `end_date`, `working_days`                    | Step 1 — identify selected week; identify prior weeks |
| 2  | FG production plan        | `monthly_plan`                                       | `fg_code`, `fg_description`, `monthly_target`, `weekly_breakdown` (JSONB: weekCode→qty)      | Step 1 — get plan qty for each week                   |
| 3  | FG production actuals     | `mb51_transaction`                                   | `part_number` (prefix `7`), `movement_type = '101'`, `quantity`, `posting_date`, `week_code` | Step 2 — actual production receipts per FG per week   |
| 4  | BOM lines                 | `bom_master`                                         | `fg_code`, `component_code`, `qty`, `uom`, `component_role`, `is_active`, `bom_version`      | Step 4 — explode each FG into its components          |
| 5  | FG headers                | `bom_fg_header`                                      | `fg_code`, `mini_factory`, `line`, `active_bom_version`                                      | Step 4 — identify which BOM version is active         |
| 6  | Component master          | `rm_pm_component_master`                             | `component_code`, `category`, `is_common_part`, `shared_in_fgs_count`                        | Step 4 — component description, category (RM/PM)      |
| 7  | Stock snapshot (MB52)     | `stock_report`                                       | `part_number`, `unrestricted_stock`, `safety_stock`                                          | Step 5 — how much stock is physically on hand         |
| 8  | Plan freeze records       | `fg_plan_freeze`                                     | `fg_code`, `week_code`, `month`, `status` (FROZEN/REVIEWED/DRAFT)                            | Step 5 — determine which FGs have reserved stock      |
| 9  | Vendor delivery schedules | `vendor_delivery_schedule`                           | `component_code`, `week_code`, `expected_delivery_date`, `promised_qty`, `delivery_status`   | Step 6 — how much is committed to arrive this week    |
| 10 | Vendor-buyer mapping      | `vendor_buyer_master` + `vendor_supplied_components` | `vendor_code`, `vendor_name`, `buyer_name`, `lead_time_days`                                 | Step 6 — who to contact for each component            |
| 11 | Monday review actions     | `monday_review_action`                               | `fg_code`, `week_code`, `month`, `issue_type`, `status`, `assigned_owner`, `escalated_to`    | Displayed on each FG card, escalation count badge     |

---

### Part 3 — The Computation Algorithm (Step by Step)

This is the exact logic from `mondayReviewEngine.ts` translated into backend Python service steps.

---

#### STEP 1 — Load and Sort Week Calendar

```
Input : month (YYYY-MM), selectedWeekId (optional)
Action: Query week_definition WHERE month = selectedMonth ORDER BY week_no ASC
Output: monthWeeks[] sorted, selectedWeek (default to week_no=2 if weekId not found)
        priorWeeks = monthWeeks where week_no < selectedWeek.week_no
```

**Edge case:** If no weeks are defined for the month → return 400 error to the frontend. The cockpit cannot run without a week calendar.

---

#### STEP 2 — Preload All Data Into Memory Dicts (Performance Critical)

Before any per-FG loop, load everything into Python dicts keyed for O(1) lookup. This is the most important performance step — never query inside the FG loop.

```
Dict A: plans_by_fg           = {fg_code: MonthlyPlan} for month = selectedMonth
Dict B: mb51_by_part_week     = {(part_number, week_code): total_qty}
        → WHERE classification='FG_PRODUCTION_RECEIPT' OR classification='RMPM_RECEIPT'
        → Aggregate: GROUP BY part_number, week_code, SUM(quantity)
Dict C: bom_lines_by_fg       = {fg_code: [BOMLine]}
        → WHERE is_active=TRUE AND bom_version = bom_fg_header.active_bom_version
Dict D: stock_by_part         = {part_number: StockRow}
        → All stock_report rows (no filter — used for both FG and RM/PM parts)
Dict E: schedules_by_comp_week = {(component_code, week_code): [VendorDeliverySchedule]}
        → WHERE delivery_status NOT IN ('CANCELLED')
        → Also match by date range: expected_delivery_date BETWEEN week.start_date AND week.end_date
Dict F: vendor_by_component   = {component_code: VendorBuyerMaster}
        → JOIN vendor_supplied_components → vendor_buyer_master
        → If a component has multiple vendors: store as list, primary = first by lead_time_days ASC
Dict G: freeze_by_fg          = {fg_code: FGPlanFreezeItem}
        → WHERE month = selectedMonth AND week_code = selectedWeekId
Dict H: actions_by_fg         = {fg_code: [MondayReviewActionItem]}
        → WHERE month = selectedMonth AND (week_code = selectedWeekId OR month = selectedMonth)
Dict I: component_usage_map   = {component_code: [{fg_code, fg_description, usage_per_fg}]}
        → Built by iterating all BOM lines: which FGs use this component (for common-part detection)
```

---

#### STEP 3 — Compute Prior Backlog and Gross Target per FG

```
For each FG plan in plans_by_fg:

  prior_backlog = 0
  prior_weeks_breakdown = []

  For each prior_week in priorWeeks (weeks before selected week):
    plan_target_for_prior_week = plan.weekly_breakdown.get(prior_week.week_code, 0)
    actual_prod_in_prior_week  = mb51_by_part_week.get((plan.fg_code, prior_week.week_code), 0)
    backlog_for_this_week      = max(0, plan_target_for_prior_week - actual_prod_in_prior_week)
    prior_backlog             += backlog_for_this_week
    prior_weeks_breakdown.append({weekNo, weekLabel, planTarget, actualProd, backlog})

  current_week_plan_target = plan.weekly_breakdown.get(selectedWeek.week_code, 0)
  total_week_gross_target  = current_week_plan_target + prior_backlog

  current_week_actual_prod = mb51_by_part_week.get((plan.fg_code, selectedWeekId), 0)
  current_week_remaining   = max(0, total_week_gross_target - current_week_actual_prod)
```

---

#### STEP 4 — Compute Stock Reservations for Frozen FG Plans (Common Parts)

This step must run BEFORE the per-FG BOM explosion, because the reservation affects available stock for all FGs.

```
component_reservation_map = {}  # {component_code: [{fg_code, fg_description, reserved_qty}]}

For each FG plan in plans_by_fg:
  freeze_record = freeze_by_fg.get(plan.fg_code)
  if freeze_record and freeze_record.status == 'FROZEN':
    gross_target = gross_target_map[plan.fg_code]  # computed in Step 3
    for bom_line in bom_lines_by_fg[plan.fg_code]:
      reserved_qty = round(gross_target * bom_line.qty)
      component_reservation_map[bom_line.component_code].append({
        fg_code: plan.fg_code,
        fg_description: plan.fg_description,
        reserved_qty: reserved_qty
      })
```

**Why this matters:** If FG-A is FROZEN and uses 1000 pcs of component `100202`, and FG-B also uses `100202` but is NOT frozen, then FG-B sees `unrestricted_stock - 1000` as its available stock. This prevents double-allocation of common components.

---

#### STEP 5 — BOM Explosion and Component Analysis per FG

For each FG plan, loop through its BOM lines:

```
For each bom_line in bom_lines_by_fg[plan.fg_code]:

  component_code = bom_line.component_code

  # Stock
  stock_row              = stock_by_part.get(component_code)
  total_physical_stock   = stock_row.unrestricted_stock if stock_row else 0
  safety_stock           = stock_row.safety_stock if stock_row else 500

  # Common part detection
  shared_in_fgs          = component_usage_map.get(component_code, [])
  is_common_part         = len(shared_in_fgs) > 1

  # Reservations from OTHER frozen FGs (not this FG)
  all_reservations = component_reservation_map.get(component_code, [])
  other_reservations_qty = sum(r.reserved_qty for r in all_reservations if r.fg_code != plan.fg_code)
  unreserved_available_stock = max(0, total_physical_stock - other_reservations_qty)

  # Requirement for this week for this FG
  total_required = round(total_week_gross_target * bom_line.qty)
  stock_deficit  = unreserved_available_stock - total_required
  is_critical_shortage = stock_deficit < 0

  # How many FG units can stock alone build (bottleneck calculation)
  stock_covers_fg_units = floor(unreserved_available_stock / bom_line.qty) if bom_line.qty > 0 else total_week_gross_target

  # Track minimum across all components (this becomes maxBuildableFGWithStock)
  if stock_covers_fg_units < min_stock_buildable:
    min_stock_buildable = stock_covers_fg_units
    bottleneck_component_code = component_code

  # Vendor delivery schedules for this component, this week
  delivery_schedules = schedules_by_comp_week.get((component_code, selectedWeekId), [])
  total_scheduled_inward = sum(s.promised_qty for s in delivery_schedules)

  # Projected stock with deliveries
  projected_stock_with_deliveries = unreserved_available_stock + total_scheduled_inward
  projected_deficit = projected_stock_with_deliveries - total_required
  projected_coverage_fg_units = floor(projected_stock_with_deliveries / bom_line.qty)

  # Track minimum with deliveries (this becomes maxBuildableFGWithDeliveries)
  if projected_coverage_fg_units < min_projected_buildable:
    min_projected_buildable = projected_coverage_fg_units

  # Schedule health classification
  if not is_critical_shortage:
    schedule_health = 'EXCESS' if total_scheduled_inward > 0 else 'ADEQUATE'
  elif total_scheduled_inward == 0:
    schedule_health = 'CRITICAL_NO_DELIVERY'
    fg_inadequate_schedules++
    fg_critical_shortages++
  elif projected_deficit < 0:
    schedule_health = 'INADEQUATE'
    fg_inadequate_schedules++
    fg_critical_shortages++
  else:
    schedule_health = 'ADEQUATE'  # recoverable with deliveries
    fg_critical_shortages++

  # Vendor lookup
  vendor_info = vendor_by_component.get(component_code)

  # Build ExplodedBOMComponentSummary for this component
  result.append({ all fields })
```

---

#### STEP 6 — 4-Week Forward Horizon per Component

Inside the same component loop, also compute week-by-week rolling stock for all 4 weeks:

```
rolling_comp_stock = total_physical_stock  # starts from MB52 snapshot

For each week in monthWeeks (all 4 weeks, in order):
  is_prior   = week.week_no < selectedWeek.week_no
  is_current = week.week_no == selectedWeek.week_no
  is_future  = week.week_no > selectedWeek.week_no

  fg_week_plan = plan.weekly_breakdown.get(week.week_code, 0)

  # For current week use gross target (plan + backlog); for others use raw plan
  gross_req = round(total_week_gross_target * bom_line.qty) if is_current
              else round(fg_week_plan * bom_line.qty)

  # Deliveries for this week (from vendor_delivery_schedule)
  week_deliveries = schedules_by_comp_week.get((component_code, week.week_code), [])
  scheduled_inward = sum(s.promised_qty for s in week_deliveries)

  rolling_comp_stock = rolling_comp_stock + scheduled_inward - gross_req
  deficit = rolling_comp_stock if rolling_comp_stock < 0 else 0

  status = 'CRITICAL_NO_DELIVERY' if deficit < 0 and scheduled_inward == 0
           else 'INADEQUATE'       if deficit < 0
           else 'EXCESS'           if scheduled_inward > 0
           else 'ADEQUATE'

  week_detail = {weekId, weekNo, weekLabel, isPrior, isCurrent, isFuture,
                 grossRequired, scheduledInward, projectedClosing: rolling_comp_stock,
                 deficit, status}

# Next week risk detection
next_week_detail = weekDetails where weekNo == selectedWeek.week_no + 1
has_next_week_risk = next_week_detail.deficit < 0 or status in (INADEQUATE, CRITICAL_NO_DELIVERY)
has_forward_risk   = any week in future weekDetails has deficit < 0
```

---

#### STEP 7 — FG-Level Health Status

```
After processing all BOM components for the FG:

max_buildable_with_stock      = min_stock_buildable      (bounded by tightest component)
max_buildable_with_deliveries = min_projected_buildable  (bounded by tightest component)

# Health classification (priority order, first match wins)
if fg_inadequate_schedules > 0:
  fg_health_status = 'INADEQUATE_SCHEDULE'
  inadequate_delivery_count++
  critical_fgs_count++
elif fg_critical_shortages > 0:
  fg_health_status = 'SCHEDULE_ON_TRACK'   # shortfall exists but deliveries cover it
  critical_fgs_count++
else:
  fg_health_status = 'CLEAR_SEAMLESS'      # stock alone is sufficient

# Note: CRITICAL_SHORTAGE label used in frontend corresponds to INADEQUATE_SCHEDULE
# (when projected_buildable = 0 or delivery status is CRITICAL_NO_DELIVERY)
```

---

#### STEP 8 — Summary Counters and Cockpit Output

```
After processing all FGs:

Return:
  cockpit_items             : List[FGWeekProductionCockpitItem]
  selected_week             : WeekDefinition
  month_weeks               : List[WeekDefinition]
  overall_backlog_units     : sum of all FG prior_backlog values
  total_week_target_units   : sum of all total_week_gross_target values
  critical_fgs_count        : FGs with any component shortage
  inadequate_delivery_count : FGs where even deliveries can't cover target
  next_week_critical_fgs_count : FGs with hasNextWeekRisk=True
  active_escalations_count  : FGs with ESCALATED_LEVEL_1/2/3 actions
  frozen_fgs_count          : FGs with freeze_status = FROZEN
```

---

### Part 4 — What Can Be Mutated from the Cockpit

The cockpit is not read-only. These four mutation operations happen from within it:

---

#### Mutation 1 — Freeze / Unfreeze FG Plan

**What it does:** Locks a FG's weekly production plan so its component stock gets reserved before other FGs can claim it.

**State machine:**

```
DRAFT → REVIEWED → FROZEN    (forward only)
FROZEN → DRAFT               (only unfreeze, when plan needs replanning)
```

**Data written to:** `fg_plan_freeze`

**Triggers stock reservation immediately** in the next call to `computeMondayReviewCockpit` — common components will show reduced available stock for non-frozen FGs.

**Required inputs:**

```
fg_code, month, week_code, new_status, frozen_by (user name), freeze_notes
```

**Validation:**

- Only `supply_planner` or `management` role can freeze (403 otherwise)
- `monthly_plan` must exist for `(fg_code, month)` — cannot freeze a nonexistent plan
- Backward transition not allowed (FROZEN → REVIEWED → DRAFT → DRAFT is fine; FROZEN → REVIEWED is not)
- `frozen_at` set server-side automatically when status transitions to FROZEN

---

#### Mutation 2 — Add / Edit / Cancel Delivery Schedule

**What it does:** Creates or updates a vendor delivery commitment. Every change is audit-logged.

**Data written to:** `vendor_delivery_schedule` + `delivery_schedule_change_log`

**Three sub-operations:**

**2A — Create new delivery schedule:**

```
Fields: po_number (auto-generate if blank), component_code, vendor_code, vendor_name,
        buyer_name, expected_delivery_date, week_code (resolved from delivery date),
        promised_qty, carrier_or_tracking, delivery_status, notes

Audit log created:
  field_changed = 'New Delivery Commitment Created'
  old_value     = 'None'
  new_value     = '{qty} pcs on {date} [{status}]'
  changed_by    = plannerName from form
  reason        = reasonForChange from form (mandatory, min 10 chars)
```

**2B — Edit existing delivery schedule:**

```
Compare old vs new for each field:
  expected_delivery_date → if changed: log 'Arrival Date Changed (old → new)'
  promised_qty           → if changed: log 'Promised Qty (old → new)'
  delivery_status        → if changed: log 'Status (old → new)'
  vendor_name            → if changed: log 'Vendor (old → new)'
  buyer_name             → if changed: log 'Buyer (old → new)'

One log row per changed field. Or one combined row: fieldChanges.join('; ')
old_value = '{old_qty} pcs on {old_date} [{old_status}]'
new_value = '{new_qty} pcs on {new_date} [{new_status}]'
```

**2C — Cancel delivery schedule:**

```
Sets: delivery_status = 'CANCELLED', promised_qty = 0
Audit log:
  field_changed = 'Delivery Commitment Cancelled (0 pcs)'
  old_value     = '{qty} pcs on {date} [{old_status}]'
  new_value     = 'CANCELLED (0 pcs)'
```

**Critical rule:** `reason_for_change` is ALWAYS mandatory. The backend must reject any schedule mutation (create, update, cancel) where `reason_for_change` is blank or under 10 characters.

---

#### Mutation 3 — Add / Update Monday Review Action

**What it does:** Logs an issue, agreed resolution, and owner for each FG's production risk identified during the Monday meeting.

**Data written to:** `monday_review_action`

**Upsert behavior (matches frontend `handleSaveAction`):**\
&#x20;The frontend checks if an action for `(fg_code, week_code, component_code)` already exists and replaces it. The backend should implement upsert on `(fg_code, week_code, component_code)` — DELETE existing then INSERT new.

**Required fields:**

```
fg_code, week_code, month, issue_type, description, impact_summary,
status, resolution_notes, agreed_action, assigned_owner, target_resolution_date
```

**Optional:**

```
component_code, component_description, escalated_to
```

**`issue_type` enum:**

```
RM_SHORTAGE | BACKLOG_RECOVERY | VENDOR_DELAY | CAPACITY_LINE_SPEED | QUALITY_HOLD
```

**`status` enum:**

```
PENDING_DISCUSSION | AMICABLE_SOLUTION_AGREED | ESCALATED_LEVEL_1 |
ESCALATED_LEVEL_2 | ESCALATED_LEVEL_3 | RESOLVED
```

---

#### Mutation 4 — Auto-Freeze All OK Plans (Bulk Freeze)

**What it does:** One-click freezes all FGs that are CLEAR_SEAMLESS or SCHEDULE_ON_TRACK in one request. Used by the `handleAutoFreezeAllOkPlans` and `handleManagerApproveAndFreezeAll` buttons.

**Implementation:** Accepts a list of `fg_codes` to freeze in one atomic batch. Creates one `fg_plan_freeze` row per FG. Returns count of frozen FGs.

---

### Part 5 — API Endpoints for the Cockpit

---

#### GET — Main Cockpit Computation

```
GET /api/reports/monday-review-cockpit/

Query params:
  month       : YYYY-MM (required)
  week_code   : e.g. w-2026-08-02 (optional; defaults to week 2)
  fg_code     : filter to one FG (optional)
  status      : CRITICAL_SHORTAGE | INADEQUATE_SCHEDULE | SCHEDULE_ON_TRACK | CLEAR_SEAMLESS (optional filter)

Response:
{
  "cockpit_items": [FGWeekProductionCockpitItem],
  "selected_week": WeekDefinition,
  "month_weeks": [WeekDefinition],
  "overall_backlog_units": 4200,
  "total_week_target_units": 28500,
  "critical_fgs_count": 3,
  "inadequate_delivery_count": 1,
  "next_week_critical_fgs_count": 2,
  "active_escalations_count": 1,
  "frozen_fgs_count": 2
}
```

---

#### POST — Freeze / Unfreeze FG Plan

```
POST /api/plan-freeze/

Body:
{
  "fg_code": "7.06496.03.0",
  "month": "2026-08",
  "week_code": "w-2026-08-02",
  "status": "FROZEN",
  "frozen_by": "Vikram Mehta (Supply Planner)",
  "freeze_notes": "Week 2 plan locked post review"
}

Response: Upserted FGPlanFreezeItem (201 on create, 200 on update)
```

---

#### POST — Bulk Freeze Multiple FGs

```
POST /api/plan-freeze/bulk/

Body:
{
  "fg_codes": ["7.06496.03.0", "7.09629.01.0"],
  "month": "2026-08",
  "week_code": "w-2026-08-02",
  "status": "FROZEN",
  "frozen_by": "Plant GM (Management)"
}

Response: { "frozen_count": 2, "items": [FGPlanFreezeItem] }
```

---

#### POST — Add / Update Monday Review Action

```
POST /api/monday-review-actions/   (create)
PATCH /api/monday-review-actions/{id}/  (update)

Body:
{
  "fg_code": "7.06496.03.0",
  "month": "2026-08",
  "week_code": "w-2026-08-02",
  "component_code": "100201",
  "issue_type": "RM_SHORTAGE",
  "description": "...",
  "impact_summary": "...",
  "status": "ESCALATED_LEVEL_1",
  "resolution_notes": "...",
  "agreed_action": "...",
  "assigned_owner": "Rajesh Kumar (Buyer)",
  "target_resolution_date": "2026-08-12",
  "escalated_to": "Head of SCM"
}
```

---

#### POST/PATCH/DELETE — Delivery Schedule with Audit Log

```
POST   /api/vendor-delivery-schedules/         (create)
PATCH  /api/vendor-delivery-schedules/{id}/    (edit — requires changed_by + reason)
DELETE /api/vendor-delivery-schedules/{id}/    (delete — requires reason in request body)

All three automatically write to delivery_schedule_change_log.
```

---

#### GET — Delivery Schedule Change Log

```
GET /api/vendor-delivery-schedules/change-logs/

Query params:
  po_number, component_code, vendor_name, schedule_id, date_from, date_to, page

Response: Paginated list of VendorDeliveryScheduleChangeLog
```

---

### Part 6 — Build Order (Step by Step)

This is the exact order to build. Each step depends on the one before it.

---

#### Stage A — Data Prerequisites (Must Exist Before Cockpit Can Run)

| Order | What to Build                                             | Why Before Cockpit                                         |
| ----- | --------------------------------------------------------- | ---------------------------------------------------------- |
| A1    | `week_definition` model + CRUD API                        | Cockpit cannot start without month's week calendar         |
| A2    | `bom_fg_header` model + CRUD API                          | BOM lines need an FG header as parent                      |
| A3    | `rm_pm_component_master` model + CRUD API                 | BOM lines and stock rows need component records            |
| A4    | `bom_master` model + CRUD API                             | BOM explosion in Step 5 reads from here                    |
| A5    | `vendor_buyer_master` + `vendor_supplied_components` CRUD | Vendor lookup for each component in Step 5                 |
| A6    | `monthly_plan` model + CRUD + proration service           | The plan qty is the starting point for everything          |
| A7    | `mb51_transaction` model + bulk CSV upload                | Prior backlog and current week actual production need this |
| A8    | `stock_report` model + bulk CSV upload                    | Step 5 reads MB52 stock for every component                |

---

#### Stage B — Cockpit-Specific Models

| Order | What to Build                        | Detail                                                                                                                                                                                                            |
| ----- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1    | `vendor_delivery_schedule` model     | Fields: po_number, component_code, vendor_code, vendor_name, buyer_name, expected_delivery_date, week_code (FK), promised_qty, carrier_or_tracking, delivery_status, notes                                        |
| B2    | `delivery_schedule_change_log` model | Fields: schedule_id (FK SET NULL), po_number (denorm), component_code (denorm), vendor_name (denorm), changed_by, changed_at, field_changed, old_value, new_value, reason_for_change. Append-only, never updated  |
| B3    | `fg_plan_freeze` model               | Fields: fg_code (FK bom_fg_header), month, week_code (FK week_definition), status, frozen_at, frozen_by, freeze_notes. Unique on (fg_code, month, week_code)                                                      |
| B4    | `monday_review_action` model         | Fields: fg_code (FK), week_code (FK), month, component_code (FK SET NULL), issue_type, description, impact_summary, status, resolution_notes, agreed_action, assigned_owner, target_resolution_date, escalated_to |

---

#### Stage C — Services (Pure Python, Testable Independently)

| Order | Service                                                                                               | What It Does                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| C1    | `WeekMappingService.map_to_week(date, weeks_list)`                                                    | Given a posting date, find which week bucket it falls in. Used by MB51 classification and delivery schedule week resolution        |
| C2    | `MB51ClassificationService.classify(movement_type, part_number)`                                      | Returns FG_PRODUCTION_RECEIPT / RMPM_RECEIPT / FG_DISPATCH / OTHER                                                                 |
| C3    | `ProrateService.prorate(monthly_target, weeks)`                                                       | Returns {week_code: qty} dict. Already built in Stage A6                                                                           |
| C4    | `AuditLogService.create_log(schedule, changed_by, reason, changed_fields)`                            | Writes to `delivery_schedule_change_log`. Called by all delivery schedule mutations                                                |
| C5    | `PlanFreezeService.upsert(fg_code, month, week_code, new_status, user_role, frozen_by, freeze_notes)` | Validates forward-only transitions, sets frozen_at, upserts record                                                                 |
| C6    | `CockpitDataLoaderService.load(month, week_code)`                                                     | Queries DB and builds all 9 dicts (A through I) from Section 3, Part 2 above. Returns fully pre-loaded data package for the engine |
| C7    | `CockpitEngineService.compute(data_package, month, week_code)`                                        | Pure computation. Takes the dicts from C6, runs Steps 3–8, returns cockpit result. Zero DB queries inside                          |

**Why C6 and C7 are separate:** C6 owns all DB I/O. C7 is pure logic with no DB access. This means C7 can be unit-tested with mocked data without any DB setup. C6 can be integration-tested separately. This mirrors exactly how the frontend engine works — it receives pre-loaded data as props, runs pure computation.

---

#### Stage D — Django Views (Wire Services to Endpoints)

| Order | View                           | Endpoint                                            | Calls                                 |
| ----- | ------------------------------ | --------------------------------------------------- | ------------------------------------- |
| D1    | `MondayReviewCockpitView`      | `GET /api/reports/monday-review-cockpit/`           | C6 → C7                               |
| D2    | `PlanFreezeListView`           | `GET /api/plan-freeze/`                             | Query `fg_plan_freeze`                |
| D3    | `PlanFreezeUpdateView`         | `POST /api/plan-freeze/`                            | C5                                    |
| D4    | `PlanFreezeBulkView`           | `POST /api/plan-freeze/bulk/`                       | C5 per FG in list                     |
| D5    | `MondayActionListCreateView`   | `GET/POST /api/monday-review-actions/`              | Query / INSERT `monday_review_action` |
| D6    | `MondayActionDetailView`       | `PATCH/DELETE /api/monday-review-actions/{id}/`     | UPDATE / DELETE                       |
| D7    | `VendorScheduleListCreateView` | `GET/POST /api/vendor-delivery-schedules/`          | C4 on create                          |
| D8    | `VendorScheduleDetailView`     | `PATCH/DELETE /api/vendor-delivery-schedules/{id}/` | C4 on every mutation                  |
| D9    | `DeliveryChangeLogListView`    | `GET /api/vendor-delivery-schedules/change-logs/`   | Query `delivery_schedule_change_log`  |

---

#### Stage E — Cockpit Performance Optimizations

These are required before going to production, not optional.

| Order | What                                                                                        | Why                                                                                 |
| ----- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| E1    | `select_related` on all BOM queries                                                         | Avoids N+1 when resolving `bom_fg_header.active_bom_version`                        |
| E2    | `prefetch_related` on vendor_supplied_components → vendor_buyer_master                      | Avoids one DB query per component in the vendor lookup                              |
| E3    | Pre-aggregate MB51 with `GROUP BY part_number, week_code, SUM(quantity)` before the FG loop | Without this, the engine queries MB51 once per FG per week = O(FGs × Weeks) queries |
| E4    | Index on `mb51_transaction(part_number, classification, week_code)`                         | The most-hit index in the entire system — every FG's receipt aggregation hits this  |
| E5    | Index on `vendor_delivery_schedule(component_code, week_code)`                              | Inner loop in step 5 — one lookup per component per week                            |
| E6    | Index on `fg_plan_freeze(month, fg_code)`                                                   | Cockpit fetches freeze status for all FGs in a month with a single query            |
| E7    | Index on `monday_review_action(month, week_code, fg_code)`                                  | Attaching actions to each FG card                                                   |
| E8    | Profiling with `django-silk`                                                                | Run with 10 FGs × 5 weeks × 20 components. Target: < 500ms total response time      |

---

### Part 7 — Data Flow Diagram (How Monday Morning Actually Works)

```
MONDAY 8:00 AM — PLANNER OPENS COCKPIT

FRONTEND                                    BACKEND

1. App loads                                GET /api/reports/monday-review-cockpit/
   month = '2026-08'                            ?month=2026-08&week_code=w-2026-08-02
   week  = 'w-2026-08-02'
                                            CockpitDataLoaderService.load()
                                            ├── SELECT week_definition WHERE month='2026-08'
                                            ├── SELECT monthly_plan WHERE month='2026-08'
                                            ├── SELECT mb51_transaction (GROUP BY part, week)
                                            ├── SELECT bom_master WHERE is_active=TRUE
                                            ├── SELECT stock_report (all)
                                            ├── SELECT vendor_delivery_schedule (non-cancelled)
                                            ├── SELECT vendor_supplied_components + vendor_buyer
                                            ├── SELECT fg_plan_freeze WHERE month='2026-08'
                                            └── SELECT monday_review_action WHERE month='2026-08'

                                            CockpitEngineService.compute()  ← zero DB queries
                                            ├── Build gross targets (plan + backlog)
                                            ├── Build reservation map (frozen FGs)
                                            ├── For each FG: explode BOM
                                            │   For each component:
                                            │   ├── unreserved stock
                                            │   ├── total required
                                            │   ├── stock deficit
                                            │   ├── scheduled inward
                                            │   ├── projected stock with deliveries
                                            │   ├── schedule health
                                            │   └── 4-week forward horizon
                                            └── Classify FG health status

2. Planner sees FG cards                   ← Response: cockpit_items[], summary counts

3. Planner updates delivery date           PATCH /api/vendor-delivery-schedules/{id}/
   for component 100202                    Body: {expected_delivery_date, reason, changed_by}
                                           AuditLogService.create_log()  ← write to change_log
                                           UPDATE vendor_delivery_schedule

4. Planner re-computes                     GET /api/reports/monday-review-cockpit/
   (cockpit auto-refreshes)                (same call as step 1, now returns updated projections)

5. Planner freezes FG plan                 POST /api/plan-freeze/
   for 7.06496.03.0                        Body: {fg_code, month, week_code, status:'FROZEN', frozen_by}
                                           PlanFreezeService.upsert()
                                           ← Now 100202's stock is partially reserved for this FG

6. Cockpit shows 100202's                  GET /api/reports/monday-review-cockpit/
   available stock reduced                 (common-part reservation now deducted for other FGs)
   for OTHER FGs

7. Planner logs action item               POST /api/monday-review-actions/
   for escalation                         Body: {fg_code, issue_type:'VENDOR_DELAY', status:'ESCALATED_LEVEL_1', ...}
                                          INSERT monday_review_action
                                          active_escalations_count++ in next cockpit call

8. Export CSV                             GET /api/reports/monday-review-cockpit/export-csv/
                                          Returns cockpit data as .csv download
```

---

### Part 8 — Validation Rules Specific to the Cockpit

These must be enforced at the service layer, not just the serializer:

- **Delivery schedule create/update/cancel:** `reason_for_change` is mandatory, minimum 10 characters. Reject with 400 if blank or too short.
- **Plan freeze:** Role validation — only `supply_planner` or `management` can POST to `/api/plan-freeze/`. Return 403 for `demand_planner` or `production` roles.
- **Plan freeze backward transition:** If current status is `FROZEN` and new status is `REVIEWED` → 400, message "Plan freeze status cannot be reversed."
- **Plan freeze without plan:** If no `monthly_plan` row exists for `(fg_code, month)` → 404 before attempting upsert.
- **Delivery schedule week resolution:** When `expected_delivery_date` is provided, always resolve `week_code` server-side by looking up `week_definition` date ranges. Never trust `week_code` sent from client directly — the date is the authority.
- **Monday review action upsert:** If an action already exists for `(fg_code, week_code, component_code)`, replace it (DELETE + INSERT). This mirrors the frontend `handleSaveAction` filtering behavior.
- **Delivery status enum validation:** Only accept: `CONFIRMED_ON_TRACK`, `IN_TRANSIT`, `PARTIAL_PROMISE`, `DELAYED_AT_RISK`, `CANCELLED`, `CRITICAL_NO_PO`. Reject any other value with 400.