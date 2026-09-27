### Master Data Backend Test Descriptions

**Base URL:** `http://localhost:8000/api/`

**Test runner context:** Django `pytest` with `pytest-django` and `djangorestframework`. Each test group should use `@pytest.mark.django_db`. Use Django's `APIClient` from `rest_framework.test`. All tests are independent — each one sets up its own data and tears down after.

---

### GROUP 1 — FG Header (`/api/bom/fg-headers/`)

---

#### TEST 1.1 — Create a valid FG Header

**Description:**

Send a POST request to `/api/bom/fg-headers/` with a valid payload where `fg_code` starts with `7`. Verify that the response status is `201 Created`. Verify the response body contains all submitted fields with exact values. Verify `active_bom_version` defaults to `v1` if not sent. Verify `is_active` defaults to `true`. Verify `created_at` and `updated_at` are present and are valid ISO 8601 timestamps.

**Request:**

```
POST /api/bom/fg-headers/
Content-Type: application/json

{
  "fg_code": "7.06496.03.0",
  "fg_description": "Vacuum Pump Panther 2.0L",
  "mini_factory": "Pumps_Division",
  "line": "A-PMP2",
  "unit_price_inr": 5800,
  "uom": "PC"
}
```

**Expected Response:**

```
HTTP 201 Created
{
  "fg_code": "7.06496.03.0",
  "fg_description": "Vacuum Pump Panther 2.0L",
  "mini_factory": "Pumps_Division",
  "line": "A-PMP2",
  "unit_price_inr": 5800.0,
  "active_bom_version": "v1",
  "uom": "PC",
  "is_active": true,
  "created_at": <non-null ISO timestamp>,
  "updated_at": <non-null ISO timestamp>
}
```

---

#### TEST 1.2 — Reject FG code that does not start with `7`

**Description:**

Send a POST request to `/api/bom/fg-headers/` where `fg_code` starts with a digit other than `7` (e.g., `1.06496.03.0`) or a letter (e.g., `A001`). Verify the response status is `400 Bad Request`. Verify the response body contains a validation error message that references `fg_code` and mentions the `7` prefix rule. The DB must not contain a new FG header row after this request.

**Request:**

```
POST /api/bom/fg-headers/
{
  "fg_code": "1.06496.03.0",
  "fg_description": "Wrong Prefix FG",
  "uom": "PC"
}
```

**Expected Response:**

```
HTTP 400 Bad Request
{
  "fg_code": ["FG part number must start with '7'."]
  // or any error message referencing the prefix rule
}
```

---

#### TEST 1.3 — Reject duplicate FG code

**Description:**

First create an FG header with `fg_code = "7.TEST.01.0"`. Then send a second POST request with the same `fg_code`. Verify the second request returns `409 Conflict` or `400 Bad Request` (whichever the backend uses for uniqueness violations). Verify only one row exists in the DB for this `fg_code`.

---

#### TEST 1.4 — List FG headers with pagination

**Description:**

Create 5 FG header records in the DB. Send a GET request to `/api/bom/fg-headers/?page=1`. Verify the response status is `200 OK`. Verify the response body has the fields `count`, `results`, and either `next`/`previous` or `total_pages`/`current_page`. Verify `results` is a list. Verify `count` equals 5.

---

#### TEST 1.5 — List FG headers with `paginate=false` returns flat list

**Description:**

Create 3 FG header records. Send GET `/api/bom/fg-headers/?paginate=false`. Verify response is `200 OK`. Verify the response body is a plain JSON array (not a paginated object). Verify the array length is 3. This matches `fgHeaderService.listAll()` used to populate the FG dropdown in the BOM modal.

---

#### TEST 1.6 — Search FG headers by description

**Description:**

Create two FG headers: one with `fg_description = "Vacuum Pump Panther 2.0L"` and one with `fg_description = "Oil Pump Gen 3"`. Send GET `/api/bom/fg-headers/?search=Vacuum`. Verify response is `200 OK`. Verify `results` contains only the Vacuum Pump record. Verify the Oil Pump is not in results.

---

#### TEST 1.7 — Filter FG headers by `is_active=false`

**Description:**

Create one FG header with `is_active=true` and one with `is_active=false`. Send GET `/api/bom/fg-headers/?is_active=false`. Verify only the inactive FG appears in results.

---

#### TEST 1.8 — Update FG header description and unit price

**Description:**

Create an FG header with `fg_code = "7.UPDATE.01.0"`. Send PATCH `/api/bom/fg-headers/7.UPDATE.01.0/` with `{"fg_description": "Updated Description", "unit_price_inr": 9999}`. Verify response is `200 OK`. Verify the returned body has updated `fg_description` and `unit_price_inr`. Verify `fg_code` has not changed.

---

#### TEST 1.9 — Changing `active_bom_version` returns a warning

**Description:**

Create an FG header with `active_bom_version = "v1"`. Send PATCH `/api/bom/fg-headers/{fg_code}/` with `{"active_bom_version": "v2"}`. Verify response is `200 OK`. Verify the response body contains a `warning` field (as defined in `FGHeaderUpdateResponse` in the service file) that mentions MRP results will change or BOM version has been updated. Verify `active_bom_version` is now `v2` in the DB.

---

#### TEST 1.10 — Delete FG header when no monthly plans exist

**Description:**

Create an FG header. Send DELETE `/api/bom/fg-headers/{fg_code}/`. Verify response is `200 OK` or `204 No Content`. Verify the record no longer exists in the DB.

---

#### TEST 1.11 — Block delete of FG header when active monthly plans reference it

**Description:**

Create an FG header with `fg_code = "7.PLAN.01.0"`. Create a `monthly_plan` record in the DB referencing the same `fg_code` and `month = "2026-08"`. Send DELETE `/api/bom/fg-headers/7.PLAN.01.0/`. Verify response is `409 Conflict`. Verify the FG header still exists in the DB. Verify the error message references that active plans exist.

---

### GROUP 2 — RM/PM Component Master (`/api/components/`)

---

#### TEST 2.1 — Create a valid RM component

**Description:**

Send POST `/api/components/` with a `component_code` that does NOT start with `7`, `category = "RM"`, `safety_stock = 500`. Verify response is `201 Created`. Verify `is_common_part` defaults to `false`. Verify `shared_in_fgs_count` defaults to `0`. Verify `is_active` defaults to `true`.

**Request:**

```
POST /api/components/
{
  "component_code": "100201",
  "component_description": "Die-Cast Aluminum Housing",
  "category": "RM",
  "uom": "PC",
  "safety_stock": 500,
  "is_critical": true
}
```

**Expected Response:**

```
HTTP 201 Created
{
  "component_code": "100201",
  "component_description": "Die-Cast Aluminum Housing",
  "category": "RM",
  "uom": "PC",
  "safety_stock": 500.0,
  "is_critical": true,
  "is_common_part": false,
  "shared_in_fgs_count": 0,
  "is_active": true
}
```

---

#### TEST 2.2 — Reject component code starting with `7`

**Description:**

Send POST `/api/components/` with `component_code = "7001001"`. Verify response is `400 Bad Request`. Verify the error references the rule that component codes must not start with `7`. Verify no record is created in the DB.

---

#### TEST 2.3 — Reject duplicate component code

**Description:**

Create component `component_code = "100201"`. Attempt to create another with the same code. Verify second attempt returns `409 Conflict` or `400 Bad Request`. Verify only one row exists in the DB.

---

#### TEST 2.4 — List components with `paginate=false` for dropdown

**Description:**

Create 4 components in the DB. Send GET `/api/components/?paginate=false`. Verify response is `200 OK`. Verify the body is a flat JSON array of 4 items. This is the call made by `componentService.listAll()` on mount for dropdown population.

---

#### TEST 2.5 — Filter components by `category=PM`

**Description:**

Create one RM component and one PM component. Send GET `/api/components/?category=PM`. Verify response contains only the PM component.

---

#### TEST 2.6 — Filter components by `is_common_part=true`

**Description:**

Create one component with `is_common_part = false` and one with `is_common_part = true` (set directly in DB). Send GET `/api/components/?is_common_part=true`. Verify only the common part appears.

---

#### TEST 2.7 — Search components by code and description

**Description:**

Create component `component_code = "100201"`, `component_description = "Die-Cast Aluminum Housing"`. Create another with `component_code = "200405"`, `component_description = "Carbon Vane"`. Send GET `/api/components/?search=Aluminum`. Verify only the first component appears. Send GET `/api/components/?search=100201`. Verify only the first component appears.

---

#### TEST 2.8 — Update component description and safety stock

**Description:**

Create a component with `component_code = "100201"`. Send PATCH `/api/components/100201/` with `{"component_description": "Updated Housing", "safety_stock": 750}`. Verify response is `200 OK`. Verify updated fields in response. Verify `component_code` is unchanged (read-only after create).

---

#### TEST 2.9 — Delete component when no BOM lines reference it

**Description:**

Create a component. Send DELETE `/api/components/{component_code}/`. Verify `200 OK` or `204 No Content`. Verify the record is gone from DB.

---

#### TEST 2.10 — Block delete of component that is referenced by bom_master

**Description:**

Create a component `component_code = "100201"`. Create an FG header `fg_code = "7.TEST.01.0"`. Create a `bom_master` line linking them. Send DELETE `/api/components/100201/`. Verify response is `409 Conflict`. Verify component still exists in DB. Verify error message references that BOM lines use this component.

---

### GROUP 3 — BOM Master Lines (`/api/bom/`)

---

#### TEST 3.1 — Create a BOM line linking an FG to a component

**Description:**

First create FG header `fg_code = "7.06496.03.0"` and component `component_code = "100201"`. Then send POST `/api/bom/` with the payload below. Verify response is `201 Created`. Verify `fg_description` is auto-populated from the FG header. Verify `component_description` and `category` are auto-populated from the component master. Verify `bom_version` defaults to `v1` if not sent. Verify `is_active` defaults to `true`.

**Request:**

```
POST /api/bom/
{
  "fg_code": "7.06496.03.0",
  "component_code": "100201",
  "qty": 1.0,
  "uom": "PC",
  "component_role": "Body/Housing"
}
```

**Expected Response:**

```
HTTP 201 Created
{
  "fg_code": "7.06496.03.0",
  "fg_description": "Vacuum Pump Panther 2.0L",
  "component_code": "100201",
  "component_description": "Die-Cast Aluminum Housing",
  "category": "RM",
  "qty": 1.0,
  "uom": "PC",
  "component_role": "Body/Housing",
  "bom_version": "v1",
  "is_active": true
}
```

---

#### TEST 3.2 — Reject BOM line where `qty` is zero or negative

**Description:**

Create FG header and component. Send POST `/api/bom/` with `qty = 0`. Verify `400 Bad Request`. Repeat with `qty = -1`. Verify `400 Bad Request`. Verify no BOM line is created in either case.

---

#### TEST 3.3 — Reject BOM line where `fg_code` does not exist in `bom_fg_header`

**Description:**

Create a valid component. Send POST `/api/bom/` with `fg_code = "7.NONEXISTENT.01.0"` (not in DB). Verify response is `400 Bad Request` or `404 Not Found`. Verify error references the missing FG header.

---

#### TEST 3.4 — Reject BOM line where `component_code` does not exist in `rm_pm_component_master`

**Description:**

Create a valid FG header. Send POST `/api/bom/` with `component_code = "GHOST-PART-999"` (not in DB). Verify `400 Bad Request` or `404 Not Found`. Verify error references the missing component.

---

#### TEST 3.5 — Reject duplicate `(fg_code, component_code, bom_version)` combination

**Description:**

Create FG header and component. Create a BOM line linking them with `bom_version = "v1"`. Attempt to create the exact same BOM line again. Verify `409 Conflict` or `400 Bad Request`. Verify only one line exists in the DB.

---

#### TEST 3.6 — Allow same component in two different FG products (shared/common part)

**Description:**

This tests the core many-to-many capability. Create component `component_code = "100202"`. Create two FG headers: `fg_code = "7.FGA.01.0"` and `fg_code = "7.FGB.01.0"`. Create one BOM line for each FG → component pair. Verify both POST requests return `201 Created`. Then GET `/api/components/100202/` and verify `is_common_part = true` and `shared_in_fgs_count = 2`. This verifies the `BOMService.update_common_part_flags()` cascade runs correctly after each BOM insert.

---

#### TEST 3.7 — `is_common_part` reverts to false when one FG's BOM line is deleted

**Description:**

Continuing from TEST 3.6: Delete the BOM line for `"7.FGA.01.0"` → `"100202"`. Then GET `/api/components/100202/`. Verify `is_common_part = false` and `shared_in_fgs_count = 1`. Verifies the common-part flag cascade recalculates after deletion.

---

#### TEST 3.8 — List BOM lines with filter by `fg_code`

**Description:**

Create FG headers `"7.FGA.01.0"` and `"7.FGB.01.0"`. Create 3 BOM lines under FGA and 2 under FGB. Send GET `/api/bom/?fg_code=7.FGA.01.0`. Verify only 3 results appear, all with `fg_code = "7.FGA.01.0"`.

---

#### TEST 3.9 — List BOM lines with filter by `category=PM`

**Description:**

Create one RM component and one PM component. Create BOM lines for both under the same FG. Send GET `/api/bom/?category=PM`. Verify only the PM BOM line appears.

---

#### TEST 3.10 — List BOM lines with `paginate=false` for cockpit engine use

**Description:**

Create 6 BOM lines across 2 FGs. Send GET `/api/bom/?paginate=false`. Verify response is a flat JSON array of 6 items (not paginated). This is used internally by the MRP engine to load the full BOM into memory.

---

#### TEST 3.11 — Search BOM lines by FG code, component code, and description

**Description:**

Create BOM line linking `fg_code = "7.06496.03.0"` and `component_code = "100201"` (description: `Die-Cast Aluminum Housing`). Send GET `/api/bom/?search=100201`. Verify the BOM line appears. Send GET `/api/bom/?search=Aluminum`. Verify the BOM line appears. Send GET `/api/bom/?search=7.06496`. Verify the BOM line appears.

---

#### TEST 3.12 — Update BOM line qty and component_role

**Description:**

Create a BOM line. Note its `id`. Send PATCH `/api/bom/{id}/` with `{"qty": 2.5, "component_role": "Dual Rotor Stage"}`. Verify `200 OK`. Verify response has `qty = 2.5` and `component_role = "Dual Rotor Stage"`. Verify `fg_code` and `component_code` are unchanged.

---

#### TEST 3.13 — Update `is_active` to false (soft-deactivate a BOM line)

**Description:**

Create a BOM line. Send PATCH `/api/bom/{id}/` with `{"is_active": false}`. Verify `200 OK`. Verify `is_active = false` in response. Send GET `/api/bom/?fg_code={fg_code}&is_active=true`. Verify this line does not appear. Send GET `/api/bom/?fg_code={fg_code}&is_active=false`. Verify it appears. This confirms inactive BOM lines are excluded from MRP calculations when filtered by `is_active=true`.

---

#### TEST 3.14 — Delete BOM line and verify common-part flag recalculates

**Description:**

Create component `"100202"`. Link it to two FGs. Verify `shared_in_fgs_count = 2`. Delete one BOM line. Verify `shared_in_fgs_count = 1` on the component. Delete the second BOM line. Verify `shared_in_fgs_count = 0` and `is_common_part = false`.

---

### GROUP 4 — Exploded BOM Endpoint (`/api/bom/exploded/{fg_code}/`)

---

#### TEST 4.1 — Exploded BOM returns all components for one FG with joined data

**Description:**

Create FG header `fg_code = "7.06496.03.0"`. Create components `"100201"` (RM, description: `Die-Cast Aluminum Housing`) and `"800101"` (PM, description: `VCI Liner Bag`). Create a vendor `V-1001` and link it to component `"100201"` via `vendor_supplied_components`. Add a stock record for `"100201"` with `unrestricted_stock = 3200`. Create BOM lines for both components under the FG. Send GET `/api/bom/exploded/7.06496.03.0/`. Verify `200 OK`. Verify the response shape matches the `ExplodedBOMResponse` interface: `fg_code`, `fg_description`, `active_bom_version`, `components_count`, `components[]`. Verify `components_count = 2`. Verify the component for `"100201"` has:

- `current_stock = 3200`
- `stock_covers_units = floor(3200 / 1.0) = 3200`
- `vendor_code = "V-1001"`
- `vendor_name` populated from vendor record
- `is_common_part = false`

---

#### TEST 4.2 — Exploded BOM marks a common part correctly

**Description:**

Create component `"100202"`. Link it to two different FGs. Create stock for `"100202"` with `unrestricted_stock = 1500`. Fetch exploded BOM for either FG. Verify the component entry for `"100202"` has `is_common_part = true` and `shared_in_fgs_count = 2`.

---

#### TEST 4.3 — Exploded BOM for nonexistent FG returns 404

**Description:**

Send GET `/api/bom/exploded/7.GHOST.99.9/`. Verify `404 Not Found`. Verify error message references that no FG exists with that code.

---

#### TEST 4.4 — Exploded BOM only includes `is_active = true` BOM lines

**Description:**

Create FG and two components. Create one active BOM line and one inactive BOM line (`is_active = false`). Send GET `/api/bom/exploded/{fg_code}/`. Verify `components_count = 1`. Verify only the active component appears in the list.

---

### GROUP 5 — Common Components Endpoint (`/api/bom/common-components/`)

---

#### TEST 5.1 — Returns only components used in 2 or more FGs

**Description:**

Create component `"100201"` (used in 1 FG only) and component `"100202"` (used in 2 FGs). Send GET `/api/bom/common-components/`. Verify `200 OK`. Verify `"100202"` appears in results. Verify `"100201"` does NOT appear. Verify each result has a list of consuming FGs with `fg_code`, `fg_description`, `qty`, and `component_role`.

---

#### TEST 5.2 — Returns empty list when no shared components exist

**Description:**

Create 3 components each used in only 1 unique FG. Send GET `/api/bom/common-components/`. Verify `200 OK`. Verify the response is an empty array or has `count = 0`.

---

### GROUP 6 — BOM CSV Upload (`/api/uploads/bom/`)

---

#### TEST 6.1 — Valid CSV upload creates FG headers, components, and BOM lines

**Description:**

Send POST `/api/uploads/bom/` as `multipart/form-data` with a CSV file in the format matching the frontend template: `FG Code, FG Description, Component Code, Component Description, Quantity Per Unit, UOM, Category`. Use this CSV content:

csv

```csv
FG Code,FG Description,Component Code,Component Description,Quantity Per Unit,UOM,Category
7.06496.03.0,Vacuum Pump Panther 2.0L,100201,Die-Cast Aluminum Housing,1.000,PC,RM
7.06496.03.0,Vacuum Pump Panther 2.0L,800101,VCI Anti-Corrosion Liner Bag,1.000,PC,PM
7.09629.01.0,FAM B Tandem Vacuum Pump,100201,Die-Cast Aluminum Housing,2.000,PC,RM
```

Verify response is `200 OK` or `201 Created`. Verify response body has fields: `batch_id`, `status`, `total_rows`, `imported_rows`, `skipped_rows`, `errors`, `message`. Verify `total_rows = 3`, `imported_rows = 3`, `skipped_rows = 0`. Verify FG header `"7.06496.03.0"` and `"7.09629.01.0"` exist in `bom_fg_header` table. Verify component `"100201"` exists in `rm_pm_component_master` with `category = "RM"`. Verify component `"800101"` exists with `category = "PM"`. Verify 3 BOM line records exist in `bom_master`. Verify `"100201"` has `is_common_part = true` and `shared_in_fgs_count = 2` because it is used in both FG products (shared component cascade verified). Verify an `upload_batch` record exists in DB with `upload_type = "BOM_IMPORT"` and `status = "COMPLETED"`.

---

#### TEST 6.2 — CSV with row where FG code does not start with `7` skips that row

**Description:**

Upload CSV with one valid row and one row where `FG Code = "1.INVALID.01.0"`. Verify `imported_rows = 1`, `skipped_rows = 1`. Verify `errors` array contains an entry referencing the invalid row. Verify the valid row is successfully imported. Verify no record is created for the invalid row.

---

#### TEST 6.3 — CSV with row where component code starts with `7` skips that row

**Description:**

Upload CSV with one row where `Component Code = "7001001"` (starts with `7`). Verify that row is skipped. Verify `errors` contains a message referencing the component code rule. Verify no BOM line is created for that row.

---

#### TEST 6.4 — CSV with zero or missing quantity skips that row

**Description:**

Upload CSV with one row where `Quantity Per Unit = 0` and one row where the quantity column is blank. Verify both rows are skipped. Verify `errors` contains entries for both.

---

#### TEST 6.5 — Upload with corrupt file returns 400 with no data written

**Description:**

Send POST `/api/uploads/bom/` with a `.txt` file (not CSV) or a binary file. Verify response is `400 Bad Request`. Verify `upload_batch` record (if created) has `status = "FAILED"`. Verify no FG header, component, or BOM line records are created.

---

### GROUP 7 — Vendor-Buyer Master (`/api/vendor-buyers/`)

---

#### TEST 7.1 — Create a valid vendor-buyer relationship

**Description:**

First create components `"100201"` and `"100202"` in the component master. Then send POST `/api/vendor-buyers/` with the payload below. Verify `201 Created`. Verify `supplied_components` appears in response as a list of component code strings. Verify `is_active` defaults to `true`.

**Request:**

```
POST /api/vendor-buyers/
{
  "vendor_code": "V-1001",
  "vendor_name": "Endurance Technologies Ltd",
  "buyer_name": "Rajesh Kumar (Buyer - Castings)",
  "buyer_email": "rajesh.kumar@plant.com",
  "buyer_phone": "+91 98765 43210",
  "category": "RM",
  "lead_time_days": 7,
  "city": "Pune",
  "gst_no": "27AAAAA0000A1Z5",
  "supplied_components": ["100201", "100202"]
}
```

**Expected Response:**

```
HTTP 201 Created
{
  "vendor_code": "V-1001",
  "vendor_name": "Endurance Technologies Ltd",
  "buyer_name": "Rajesh Kumar (Buyer - Castings)",
  "category": "RM",
  "lead_time_days": 7,
  "is_active": true,
  "supplied_components": ["100201", "100202"]
}
```

---

#### TEST 7.2 — Reject vendor with missing required fields

**Description:**

Send POST `/api/vendor-buyers/` without `vendor_code`. Verify `400 Bad Request` with field-level error for `vendor_code`. Send again without `vendor_name`. Verify `400`. Send again without `buyer_name`. Verify `400`. Send with `supplied_components = []`. Verify `400` with error stating at least one component must be specified. Send with `lead_time_days = 0`. Verify `400` with error stating lead time must be > 0.

---

#### TEST 7.3 — Reject duplicate vendor_code

**Description:**

Create vendor with `vendor_code = "V-1001"`. Attempt to create another with the same `vendor_code`. Verify `409 Conflict` or `400 Bad Request`. Verify only one record exists.

---

#### TEST 7.4 — Vendor code is read-only after creation (cannot be changed via PATCH)

**Description:**

Create vendor `vendor_code = "V-1001"`. Send PATCH `/api/vendor-buyers/{id}/` with `{"vendor_code": "V-9999"}`. Verify that `vendor_code` remains `"V-1001"` in the DB regardless of whether the server returns `200 OK` or silently ignores the field. The frontend disables the vendor_code field on edit (`disabled={!!editingItem}`), and the backend must not allow it to change.

---

#### TEST 7.5 — List vendors with pagination

**Description:**

Create 10 vendor records. Send GET `/api/vendor-buyers/?page=1`. Verify `200 OK`. Verify response has `count = 10`, `results` is a list. Verify pagination fields are present.

---

#### TEST 7.6 — Filter vendors by `buyer_name`

**Description:**

Create vendor A with `buyer_name = "Rajesh Kumar"` and vendor B with `buyer_name = "Amit Patel"`. Send GET `/api/vendor-buyers/?buyer_name=Rajesh%20Kumar`. Verify only vendor A appears.

---

#### TEST 7.7 — Filter vendors by `category=PM`

**Description:**

Create one RM vendor and one PM vendor. Send GET `/api/vendor-buyers/?category=PM`. Verify only the PM vendor appears.

---

#### TEST 7.8 — Filter vendors by `is_active=false`

**Description:**

Create one active and one inactive vendor. Send GET `/api/vendor-buyers/?is_active=false`. Verify only the inactive vendor appears.

---

#### TEST 7.9 — Search vendors by vendor code, vendor name, buyer name, and city

**Description:**

Create vendor with `vendor_code = "V-1001"`, `vendor_name = "Endurance Technologies"`, `buyer_name = "Rajesh Kumar"`, `city = "Pune"`. Send GET `/api/vendor-buyers/?search=Endurance`. Verify vendor appears. Send `?search=V-1001`. Verify vendor appears. Send `?search=Rajesh`. Verify vendor appears. Send `?search=Pune`. Verify vendor appears.

---

#### TEST 7.10 — List vendors with `paginate=false` returns flat array

**Description:**

Create 5 vendors. Send GET `/api/vendor-buyers/?paginate=false`. Verify response is a flat JSON array of 5 objects. This is what `vendorBuyerService.listAll()` calls.

---

#### TEST 7.11 — Update supplied_components list (full replacement)

**Description:**

Create components `"100201"`, `"100202"`, `"200405"`. Create vendor with `supplied_components = ["100201", "100202"]`. Send PATCH `/api/vendor-buyers/{id}/` with `{"supplied_components": ["200405"]}`. Verify `200 OK`. Verify response `supplied_components = ["200405"]`. Verify old components `"100201"` and `"100202"` are no longer linked to this vendor in `vendor_supplied_components` table. Verify only `"200405"` remains. This confirms the DELETE-then-INSERT pattern described in the build plan.

---

#### TEST 7.12 — Update vendor non-code fields

**Description:**

Create a vendor. Send PATCH with `{"vendor_name": "Updated Name", "lead_time_days": 14, "city": "Mumbai"}`. Verify `200 OK`. Verify all three fields are updated in response. Verify `vendor_code`, `buyer_name` unchanged.

---

#### TEST 7.13 — Delete vendor when no active delivery schedules reference it

**Description:**

Create a vendor. Send DELETE `/api/vendor-buyers/{id}/`. Verify `200 OK` or `204 No Content`. Verify record is gone from DB. Verify all related `vendor_supplied_components` rows are also deleted (CASCADE).

---

#### TEST 7.14 — Block delete of vendor when active delivery schedules reference its `vendor_code`

**Description:**

Create a vendor with `vendor_code = "V-1001"`. Create a `vendor_delivery_schedule` record in the DB with `vendor_code = "V-1001"`. Send DELETE `/api/vendor-buyers/{id}/`. Verify response is `409 Conflict`. Verify the error message mentions active delivery schedules. Verify the vendor record still exists. This matches the frontend behavior in `handleDelete` which catches `apiErr.status === 409`.

---

### GROUP 8 — Vendor-Buyer CSV Upload (`/api/uploads/vendor-buyers/` or whichever endpoint the vendorBuyerService.uploadCSV maps to)

---

#### TEST 8.1 — Valid CSV creates vendor records with supplied components

**Description:**

First create components `"1.02345.01.0"`, `"2.01234.05.0"` in the component master. Upload a CSV file with the format matching the frontend template:

csv

```csv
Vendor Code,Vendor Name,Buyer Name,Buyer Email,Buyer Phone,Category,Lead Time (Days),City,GST No,Supplied Component Codes
V-1001,PLASTI-PACK INDUSTRIES,Arun Kumar,arun.k@acme.com,+91 98765 43210,PM,7,Pune,27AAACP1234A1Z5,"1.02345.01.0; 1.02345.02.0"
V-1002,SUPREME PETROCHEM LTD,Neha Sharma,neha.s@acme.com,+91 98765 43211,RM,14,Mumbai,27AABCS5678B1Z2,2.01234.05.0
```

Verify `200 OK` or `201 Created`. Verify response has `batch_id`, `total_rows = 2`, `imported_rows = 2`. Verify both vendor records exist in `vendor_buyer_master`. Verify `vendor_supplied_components` rows are created for each. Verify `upload_batch` record exists with `status = "COMPLETED"` and `upload_type = "VENDOR_BUYER"` (or equivalent).

---

#### TEST 8.2 — CSV row with missing vendor_code is skipped

**Description:**

Upload CSV with one valid row and one row where `Vendor Code` is blank. Verify `imported_rows = 1`, `skipped_rows = 1`. Verify `errors` array contains an entry for the blank vendor code row.

---

#### TEST 8.3 — CSV row with `lead_time_days = 0` or negative is skipped

**Description:**

Upload CSV with a row where `Lead Time (Days) = 0`. Verify that row is skipped and appears in `errors`. Verify no vendor record is created for it.

---

#### TEST 8.4 — CSV with semicolon-separated component codes correctly links all components

**Description:**

Create components `"C-001"`, `"C-002"`, `"C-003"` in the DB. Upload CSV where `Supplied Component Codes = "C-001; C-002; C-003"`. Verify vendor is created. Verify `vendor_supplied_components` table has 3 rows linked to this vendor. This tests the frontend notice that "Separate multiple component codes with semicolons (`;`) or commas (`,`)".

---

### GROUP 9 — Cross-Entity Integration Tests

---

#### TEST 9.1 — Full master data chain: create FG → component → BOM → vendor link

**Description:**

This is an end-to-end integration test that mirrors what the frontend does when a user adds a new BOM item using "Create New FG" + "Create New Component" mode in the BOM modal. Execute the following sequence in order:

1. POST `/api/bom/fg-headers/` — create FG `"7.TEST.FULL.0"`
2. POST `/api/components/` — create component `"COMP-FULL-001"` (RM)
3. POST `/api/bom/` — create BOM line linking them with `qty = 1.5`
4. POST `/api/vendor-buyers/` — create vendor `"V-FULL"` with `supplied_components = ["COMP-FULL-001"]`
5. GET `/api/bom/exploded/7.TEST.FULL.0/`

Verify the exploded BOM response contains:

- `components_count = 1`
- The component entry with `component_code = "COMP-FULL-001"`, `qty = 1.5`, `vendor_code = "V-FULL"`, `vendor_name` populated, `buyer_name` populated
- `is_common_part = false`, `shared_in_fgs_count = 1`

---

#### TEST 9.2 — Common part logic: two FGs share same component, verify cascading flag and count

**Description:**

Create component `"SHARED-001"`. Create FG headers `"7.FG-A.01.0"` and `"7.FG-B.01.0"`. Create BOM line `"7.FG-A.01.0"` → `"SHARED-001"` with `qty = 1.0`. Verify `is_common_part = false`, `shared_in_fgs_count = 1` on component. Create BOM line `"7.FG-B.01.0"` → `"SHARED-001"` with `qty = 2.0`. Verify `is_common_part = true`, `shared_in_fgs_count = 2`. GET `/api/bom/common-components/`. Verify `"SHARED-001"` appears with a `used_in_fgs` list containing both FG codes. Delete the `"7.FG-A.01.0"` → `"SHARED-001"` BOM line. Verify `is_common_part = false`, `shared_in_fgs_count = 1`. Verify `"SHARED-001"` no longer appears in `/api/bom/common-components/`.

---

#### TEST 9.3 — Vendor link resolves in exploded BOM even when component is supplied by multiple vendors

**Description:**

Create component `"100202"`. Create vendor `"V-A"` with `supplied_components = ["100202"]`. Create vendor `"V-B"` with `supplied_components = ["100202"]`. Create FG and BOM line for the component. GET `/api/bom/exploded/{fg_code}/`. Verify the component entry in the response either has a `suppliers` array (as defined in `ExplodedBOMComponent.suppliers`) containing both vendors, OR has `is_multi_vendor = true` flag set. Verify `vendor_code` field is not null even when multiple vendors exist (it shows one primary vendor).

---

#### TEST 9.4 — Deleting a component that is referenced in BOM master is blocked

**Description:**

Create FG, create component `"PROTECTED-001"`, create BOM line linking them. Attempt DELETE `/api/components/PROTECTED-001/`. Verify `409 Conflict`. Verify component still in DB. Verify BOM line still in DB.

---

#### TEST 9.5 — `paginate=false` on all list endpoints returns complete dataset for cockpit engine

**Description:**

Create 15 BOM lines, 10 components, 8 FG headers, 5 vendors. Verify each of the following returns a flat array with all records (no pagination wrapper):

- GET `/api/bom/?paginate=false` → array of 15
- GET `/api/components/?paginate=false` → array of 10
- GET `/api/bom/fg-headers/?paginate=false` → array of 8
- GET `/api/vendor-buyers/?paginate=false` → array of 5

This is critical because the MRP engine loads all data into memory-keyed dicts before any computation begins. If these endpoints return paginated objects instead of flat arrays when `paginate=false`, the cockpit engine will break.