# Monday Review Cockpit: Data Verification, Exact Values & Interactive Actions Guide

This document provides a comprehensive operational guide for the **Monday Review Cockpit** in the Master Production Schedule (MPS) system. It outlines the exact figures generated from the sample datasets ([`sample_upload_csvs/`](./sample_upload_csvs/)), the exact mathematical formulas used to derive them, and an in-depth dictionary of all interactive actions (such as **Freeze Plan**, **Discuss / Escalate**, **Auto-Freeze**, and **Supply Risk Heatmap**) explaining **what happens** and **why it happens**.

---

## 📑 Table of Contents
1. [Manufacturing Scenario Architecture](#1-manufacturing-scenario-architecture)
2. [Exact Dashboard Metrics & Values](#2-exact-dashboard-metrics--values)
   - [Top Executive KPI Banner](#top-executive-kpi-banner)
   - [Main Cockpit Table (Finished Goods Level)](#main-cockpit-table-finished-goods-level)
   - [Exploded BOM Component Table (Sub-Rows)](#exploded-bom-component-table-sub-rows)
3. [Interactive Dashboard Actions & Feature Guide](#3-interactive-dashboard-actions--feature-guide)
   - [Option 1: Freeze Plan & Unfreeze Plan](#option-1-freeze-plan--unfreeze-plan)
   - [Option 2: Auto-Freeze OK Plans](#option-2-auto-freeze-ok-plans)
   - [Option 3: Discuss / Log Action / Escalation Tiers](#option-3-discuss--log-action--escalation-tiers)
   - [Option 4: Edit & Reschedule Vendor Delivery Commitment](#option-4-edit--reschedule-vendor-delivery-commitment)
   - [Option 5: Cancel Delivery Commitment](#option-5-cancel-delivery-commitment)
   - [Option 6: Common Parts Contention & Allocation Matrix](#option-6-common-parts-contention--allocation-matrix)
   - [Option 7: Color-Coded Supply Risk Heatmap](#option-7-color-coded-supply-risk-heatmap)
   - [Option 8: Table View vs. Compact Gantt Matrix View](#option-8-table-view-vs-compact-gantt-matrix-view)
   - [Option 9: Hide OK Parts (Shortages-Only Toggle)](#option-9-hide-ok-parts-shortages-only-toggle)
   - [Option 10: Next Week Early Warning Radar](#option-10-next-week-early-warning-radar)
   - [Option 11: Role-Based Immediate Attention Radar (RBAC)](#option-11-role-based-immediate-attention-radar-rbac)
   - [Option 12: Delivery Schedule Audit Trail Drawer](#option-12-delivery-schedule-audit-trail-drawer)
4. [Mathematical Formulas & Engine Logic Reference](#4-mathematical-formulas--engine-logic-reference)

---

## 1. Manufacturing Scenario Architecture

The uploaded sample data simulates **August 2026 (`2026-08`)** across 4 calendar weeks:
- **Week 1 (`w-2026-08-01`):** Aug 01 – Aug 07 (7 calendar days, 1 holiday = **6 working days**, weight = $6/26 \approx 23.08\%$)
- **Week 2 (`w-2026-08-02` - Current Review Week):** Aug 08 – Aug 14 (7 calendar days, 1 holiday = **6 working days**, weight = $6/26 \approx 23.08\%$)
- **Week 3 (`w-2026-08-03`):** Aug 15 – Aug 21 (7 calendar days, 1 holiday = **6 working days**, weight = $6/26 \approx 23.08\%$)
- **Week 4 (`w-2026-08-04`):** Aug 22 – Aug 31 (10 calendar days, 2 holidays = **8 working days**, weight = $8/26 \approx 30.77\%$)
- **Total Working Days in Month:** $6 + 6 + 6 + 8 = \mathbf{26\text{ days}}$.

### Target Finished Goods:
1. **`7.06496.03.0` – Vacuum Pump Panther 2.0L** (Customer: **Tata Motors**)
   - Monthly Plan Target: **10,000 units**
   - W1 Prorated Target: **2,308** | W2: **2,308** | W3: **2,307** | W4: **3,077**
2. **`7.09629.01.0` – FAM B Tandem Pump** (Customer: **Mahindra & Mahindra**)
   - Monthly Plan Target: **8,000 units**
   - W1 Prorated Target: **1,846** | W2: **1,846** | W3: **1,846** | W4: **2,462**

*(Note: If you configured equal 25% weekly splits, W1 & W2 plans are simply 2,500 and 2,000. Both calculations yield the exact same operational findings).*

---

## 2. Exact Dashboard Metrics & Values

### Top Executive KPI Banner
When navigating to **Monday Review Cockpit** with **Month: `2026-08`** and **Week: `Week 2`**:

| KPI Card | Exact Displayed Value | Business & Mathematical Explanation |
| :--- | :---: | :--- |
| **Total Prior Backlog** | **`308 Units`** *(or 500)* | Unfulfilled volume from Week 1. Vacuum Pump had a plan of 2,308 but MB51 actual receipts recorded only 2,000 units ($2,308 - 2,000 = 308$). Tandem Pump produced 2,000 vs 1,846 planned (0 backlog). Total carryover = **308 units**. |
| **Total W2 Gross Target** | **`4,462 Units`** *(or 5,000)* | Total production demand for Week 2. Sum of Week 2 base plan ($2,308 + 1,846 = 4,154$) plus Week 1 backlog ($308$) = **4,462 units**. |
| **Critical Deficit Components** | **`1 Component`** | **`100202` (Sintered Rotor Core)** has physical stock (800 pcs) far below gross requirements ($2,616$ and $1,846$). |
| **Inadequate Inward Schedules** | **`0 Lines`** | Supplier Sundaram Fasteners has committed 3,500 pcs across PO-8801 and PO-8802, bringing projected inventory to 4,300 pcs, covering the active line. |
| **Common Parts Contention** | **`1 Component (Shared in 2 FGs)`** | Component **`100202`** is shared across both pump lines, requiring cross-line inventory arbitration. |

---

### Main Cockpit Table (Finished Goods Level)

#### Row 1: `7.06496.03.0` – Vacuum Pump Panther 2.0L (Tata Motors)
- **Monthly Plan Completion:** `20.0%` *(2,000 / 10,000 units completed via movement 101)*
- **Prior Plan (W1):** `2,308` units
- **Prior Actual (101):** `2,000` units *(Doc 5000101004: 1,200 + Doc 5000101008: 800)*
- **Prior Backlog:** `308` units *(amber pill, indicating $2,308 - 2,000 = 308$ carry forward)*
- **W2 Plan:** `2,308` units
- **Gross Target:** `2,616` units *(W2 Plan $2,308 + \text{Backlog } 308 = \mathbf{2,616}$)*
- **Net Shortage Gap:** `0` *(vendor inward of 3,500 rotors arrives in time; line will not shut down)*
- **W3 Plan:** `2,307` units
- **W4 Plan:** `3,077` units
- **Health Badge:** 🚚 **`Schedule on Track`** *(Physical stock alone is short, but confirmed vendor inward satisfies 100% of requirement)*
- **Plan Freeze Status:** `DRAFT` *(Editable, with interactive "Freeze Plan" button)*

#### Row 2: `7.09629.01.0` – FAM B Tandem Pump (Mahindra & Mahindra)
- **Monthly Plan Completion:** `25.0%` *(2,000 / 8,000 units completed via movement 101)*
- **Prior Plan (W1):** `1,846` units
- **Prior Actual (101):** `2,000` units *(Doc 5000101006: 1,000 + Doc 5000101009: 1,000)*
- **Prior Backlog:** `0` units *(Actual $2,000 \ge \text{Plan } 1,846$; zero backlog carryover)*
- **W2 Plan:** `1,846` units
- **Gross Target:** `1,846` units *($1,846 + 0 = \mathbf{1,846}$)*
- **Net Shortage Gap:** `0`
- **W3 Plan:** `1,846` units
- **W4 Plan:** `2,462` units
- **Health Badge:** 🚚 **`Schedule on Track`**
- **Plan Freeze Status:** `DRAFT`

---

### Exploded BOM Component Table (Sub-Rows)

Expanding the chevron (**`>`**) reveals the exploded bill of materials:

#### Vacuum Pump Panther `7.06496.03.0` Components:
| Part Number & Description | BOM Usage | MB52 Stock (Tot / Res / Avail) | Gross Req | Balance | Vendor & Inward Schedule | Status | Max Buildable FGs |
| :--- | :---: | :---: | :---: | :---: | :--- | :---: | :---: |
| **`100201`** Alu Die-Cast Housing | 1.0 PC | `3,200 / 0 / 3,200` | 2,616 | 🟢 `+584` | CastAlu India: `+2,500` (11-Aug) | `CONFIRMED_ON_TRACK` | **3,200** Stock / **5,700** Proj |
| **`100202`** Sintered Rotor Core *(Common)* | 1.0 PC | `800 / 0 / 800` | 2,616 | 🔴 `-1,816` | Sundaram: `+2,000` (10-Aug), `+1,500` (12-Aug) | `CONFIRMED` / `PARTIAL` | ⚠️ **800** Stock / **4,300** Proj |
| **`200405`** Composite Sliding Vanes | 4.0 PC | `12,000 / 0 / 12,000` | 10,464 | 🟢 `+1,536` | Sundaram: `+10,000` (11-Aug) | `CONFIRMED_ON_TRACK` | **3,000** Stock / **5,500** Proj |
| **`800101`** Packaging Box Single | 1.0 PC | `4,000 / 0 / 4,000` | 2,616 | 🟢 `+1,384` | Supreme Packaging: `+3,000` (09-Aug) | `CONFIRMED_ON_TRACK` | **4,000** Stock / **7,000** Proj |

#### FAM B Tandem Pump `7.09629.01.0` Components:
| Part Number & Description | BOM Usage | MB52 Stock (Tot / Res / Avail) | Gross Req | Balance | Vendor & Inward Schedule | Status | Max Buildable FGs |
| :--- | :---: | :---: | :---: | :---: | :--- | :---: | :---: |
| **`100202`** Sintered Rotor Core *(Common)* | 1.0 PC | `800 / 0 / 800` | 1,846 | 🔴 `-1,046` | Sundaram: `+2,000` (10-Aug), `+1,500` (12-Aug) | `CONFIRMED` / `PARTIAL` | ⚠️ **800** Stock / **4,300** Proj |
| **`200408`** HNBR Shaft Oil Seal | 1.0 PC | `2,500 / 0 / 2,500` | 1,846 | 🟢 `+654` | Freudenberg NOK: `+2,000` (12-Aug) | `CONFIRMED_ON_TRACK` | **2,500** Stock / **4,500** Proj |

---

## 3. Interactive Dashboard Actions & Feature Guide

The Monday Review Cockpit provides interactive controls that allow supply planners, plant heads, and buyers to arbitrate bottlenecks. Here is every option, what happens when executed, and the business rationale.

---

### Option 1: Freeze Plan & Unfreeze Plan
*Location: Rightmost column of each Finished Good row.*

#### What happens when you click "Freeze Plan":
1. The FG status flips from **`DRAFT`** to 🔒 **`FROZEN`** (highlighted in emerald green).
2. The system creates a formal `FGPlanFreeze` database record with timestamp and user attribution.
3. **Hard Stock Reservation is Triggered:** The system calculates $\text{Gross Target} \times \text{BOM Qty}$ for all components of this FG and **locks** that stock.
   - For `7.06496.03.0`, its gross demand of **2,616 units** of `100202` (Sintered Rotor Core) is reserved.
4. **Immediate Impact on Competing Lines:** In the second line (`7.09629.01.0`), the MB52 Stock cell for `100202` dynamically updates:
   $$\text{Total Physical: } 800 \quad / \quad \text{Reserved: } \mathbf{800} \quad / \quad \text{Available: } \mathbf{0}$$
   The available physical stock for Mahindra & Mahindra is reduced to **0**, rendering that line 100% dependent on Sundaram Fasteners delivering new shipments on time.

#### Why it happens (Business Rationale):
In automotive plants, freezing a plan protects high-priority OEM programs (e.g. Tata Motors penalty-backed contracts) from other assembly lines consuming shared hardware. It prevents "first-come, first-served" line cannibalization.

#### What happens when you click "Unfreeze Plan":
The lock is released, reservations revert to 0, and all physical stock returns to the common pool (`Available = 800`).

---

### Option 2: Auto-Freeze OK Plans
*Location: Control bar button `Auto-Freeze OK Plans (N)`.*

#### What happens when you click it:
1. The engine scans all Finished Goods in the current week.
2. Any Finished Good where **100% of BOM components have positive balance or confirmed delivery coverage** is automatically transitioned to `FROZEN`.
3. If an FG has unconfirmed vendor delivery gaps or negative balance without coverage, it remains in `DRAFT` for manual review.

#### Why it happens:
In an automotive plant managing 50+ lines, planners should not waste time debating lines that have zero supply constraints. Auto-Freeze instantly clears the "healthy" lines so the 15-minute Monday morning meeting can focus entirely on bottleneck lines.

---

### Option 3: Discuss / Log Action / Escalation Tiers
*Location: Blue `Discuss / Log Action` button on FG row or component sub-rows.*

#### What happens when you click it:
Opens the **Monday Review Action Modal** where you can document:
1. **Issue Type:** `RM_SHORTAGE`, `BACKLOG_RECOVERY`, `CAPACITY_CONSTRAINT`, `QUALITY_REJECTION`.
2. **Impact Summary:** Automatically pre-filled (e.g., *"Stock covers 800 FGs; line will starve after 800 units without inward"*).
3. **Action Status & Escalation Tier:**
   - `AMICABLE_SOLUTION_AGREED` $\rightarrow$ Buyer & supplier agreed on express road transit.
   - `ESCALATED_LEVEL_1` $\rightarrow$ Escalated to **Plant Operations Head**.
   - `ESCALATED_LEVEL_2` $\rightarrow$ Escalated to **VP of Supply Chain**.
   - `ESCALATED_LEVEL_3` $\rightarrow$ Escalated to **COO / Executive Director**.
4. **Assigned Owner & Target Resolution Date:** Designated buyer or supply planner.

#### Why it happens:
Audit compliance and accountability. When a production line is under threat, verbal promises are insufficient. Logging a formal escalation triggers notification flags and tracks closure across review cycles.

---

### Option 4: Edit & Reschedule Vendor Delivery Commitment
*Location: Dropdown action on component row $\rightarrow$ `Reschedule Inward` or from Heatmap.*

#### What happens when you edit a delivery:
1. You can update **Promised Quantity**, **Arrival Date**, **Carrier / Tracking #**, and **Delivery Status**:
   - `CONFIRMED_ON_TRACK` (Green) $\rightarrow$ Supplier dispatched; transit on schedule.
   - `IN_TRANSIT` (Blue) $\rightarrow$ Vehicle en route with GPS / docket tracking.
   - `PARTIAL_PROMISE` (Amber) $\rightarrow$ Supplier committed only a portion of the PO.
   - `DELAYED_AT_RISK` (Red) $\rightarrow$ Tooling breakdown or logistics delay; will miss cutoff.
   - `CRITICAL_NO_PO` (Purple) $\rightarrow$ Purchase order unreleased.
2. **Instant Re-computation:** The cockpit immediately recalculates `Projected Closing Stock`, `Buildable FGs`, and line health.
3. **Audit Trail Logging:** A change log entry is created recording who modified the schedule, previous vs. new dates, and the mandatory **Reason for Change**.

#### Why it happens:
Ensures dynamic, real-time MRP synchronization between purchasing and assembly line sequencing.

---

### Option 5: Cancel Delivery Commitment
*Location: Inside Delivery Edit Modal $\rightarrow$ Red `Cancel Delivery Commitment` button.*

#### What happens:
1. The promised quantity is set to **0** and status flips to **`CANCELLED`**.
2. The audit log records the cancellation reason (e.g., *"Supplier reported batch scrap during sintering"*).
3. **Immediate Cockpit Reaction:**
   - Projected inward drops by the cancelled quantity.
   - If projected stock falls below gross demand, the health badge immediately turns into 🔴 **`CRITICAL NO INWARD`** and **Net Gap** reflects the unfulfilled shortfall.

---

### Option 6: Common Parts Contention & Allocation Matrix
*Location: Blue `Common Parts` button in control bar or `Shared (2)` badge next to `100202`.*

#### What happens when you open it:
1. Displays a dedicated cross-program allocation modal for shared components.
2. Shows total physical inventory (800 pcs) alongside the active lines competing for it (`7.06496.03.0`: 2,616 units, `7.09629.01.0`: 1,846 units).
3. Displays **Reserved Stock by Frozen Plans** vs. **Remaining Unreserved Stock**.

#### Why it happens:
Shared parts (rotors, O-rings, bearings, hardware) are the #1 cause of hidden line stoppages. This tool prevents planners from double-counting the same 800 physical rotors across two different customer lines.

---

### Option 7: Color-Coded Supply Risk Heatmap
*Location: Red `Supply Risk Heatmap` button in control bar.*

#### What happens:
1. Expands an interactive vendor risk matrix ranking all suppliers by delivery performance.
2. Categorizes purchase orders by status:
   - Green: Confirmed on-track.
   - Yellow: Partial promises.
   - Red: Delayed past required assembly date.
3. Provides a 1-click **Expedite / Contact Buyer** button to immediately open email/phone details for the assigned buyer.

#### Why it happens:
Provides plant management with an instant vendor risk summary without having to drill into individual FG BOM lines.

---

### Option 8: Table View vs. Compact Gantt Matrix View
*Location: Toggle button inside the exploded component toolbar.*

#### What happens when switching to "Compact Gantt Matrix":
1. The standard tabular row converts into a multi-day timeline showing **Aug 08 through Aug 14**.
2. Displays daily cumulative component burn rate vs. expected arrival date of purchase orders.
3. Days with sufficient stock show in **Green**; the exact day inventory turns negative shows in **Red**.

#### Why it happens:
A delivery promised for Friday does not prevent the line from shutting down on Tuesday morning. The Gantt chart provides hour/day visibility on exactly when the stockout will hit.

---

### Option 9: Hide OK Parts (Shortages-Only Toggle)
*Location: Control bar button `Hide OK Parts`.*

#### What happens:
1. Filters out all components that have positive stock balances and zero delivery risk (e.g. Housing `100201`, Vanes `200405`, Packaging `800101`).
2. Only displays bottleneck shortage components (e.g. Rotor Core `100202`).
3. If an FG has 0 shortages, it collapses cleanly with a green "All components 100% adequate" banner.

#### Why it happens:
Eliminates clutter during fast-paced operational reviews so engineers spend 100% of their meeting resolving actual blockers.

---

### Option 10: Next Week Early Warning Radar
*Location: Horizon dropdown $\rightarrow$ `⚡ Next Week Radar`.*

#### What happens:
1. The cockpit shifts its analytical lens to **Week 3 (`w-2026-08-03`)**.
2. It projects closing stock from Week 2 and evaluates whether Week 3 demand will cause a stockout.
3. Components facing deficits in Week 3 display a warning badge: `⚠️ -X Deficit Next Week`.

#### Why it happens:
Standard lead times for machining and casting are 7–14 days. If a planner waits until Monday of Week 3 to identify a shortage, it is already too late to expedite. The Radar gives procurement a 7-day advance head-start.

---

### Option 11: Role-Based Immediate Attention Radar (RBAC)
*Location: Dark navy gradient banner at top of cockpit $\rightarrow$ Role switcher.*

#### What happens when switching roles:
The 3 top priority task cards dynamically reconfigure based on the persona:
- **Supply Planner (`supply_planner`):** Focuses on component stockouts, overdue vendor POs, and common part allocation contention.
- **Demand Planner (`demand_planner`):** Focuses on customer order validation, monthly run-rate gaps, and OEM delivery SLAs.
- **Production Manager (`production`):** Focuses on backlog recovery shift targets, daily assembly takt rates (units/day), and dock GRN inspection staging.
- **Plant Management (`management`):** Focuses on revenue at risk, plant escalation arbitration, and plan freeze authorizations.

---

### Option 12: Delivery Schedule Audit Trail Drawer
*Location: Click schedule status or "View Logs" inside delivery modal.*

#### What happens:
Sliding drawer displaying the chronological history of changes to any delivery schedule:
- **Who made the change** (e.g., *Rajesh Sharma (Buyer)* or *Vikram Mehta (Planner)*).
- **Exact timestamp** (e.g., *05 Oct 2026, 14:30:15*).
- **Field changed** (e.g., *Promised Qty changed from 3,000 to 2,000 pcs*).
- **Mandatory Reason for Change** (e.g., *Vendor machine downtime*).

#### Why it happens:
Maintains ISO/TS-16949 automotive audit compliance and eliminates disputes between production and purchasing.

---

## 4. Mathematical Formulas & Engine Logic Reference

$$\text{Prior Backlog} = \sum_{\text{prior weeks}} \max\left(0, \text{Weekly Plan Target} - \text{MB51 Actual 101 Production}\right)$$

$$\text{Total Week Gross Target} = \text{Current Week Plan Target} + \text{Prior Backlog}$$

$$\text{Component Gross Requirement} = \text{Total Week Gross Target} \times \text{BOM Quantity Per Unit}$$

$$\text{Available Unreserved Stock} = \max\left(0, \text{Total Physical Stock (MB52)} - \text{Reserved Stock by Other Frozen FGs}\right)$$

$$\text{Stock Balance (Deficit / Surplus)} = \text{Available Unreserved Stock} - \text{Component Gross Requirement}$$

$$\text{Projected Closing Stock} = \text{Available Unreserved Stock} + \sum \text{Promised Inward Deliveries} - \text{Component Gross Requirement}$$

$$\text{Stock Buildable FGs} = \left\lfloor \frac{\text{Available Unreserved Stock}}{\text{BOM Usage Qty}} \right\rfloor$$

$$\text{Projected Buildable FGs} = \left\lfloor \frac{\text{Available Unreserved Stock} + \sum \text{Promised Inward Deliveries}}{\text{BOM Usage Qty}} \right\rfloor$$

$$\text{Net Shortage Gap} = \max\left(0, \text{Total Week Gross Target} - \text{Projected Buildable FGs}\right)$$
