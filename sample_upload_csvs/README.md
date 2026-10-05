# MPS Sample Data Upload Files & Practical Testing Guide

This directory contains cohesive sample CSV datasets designed for end-to-end testing of the Master Production Schedule (MPS) and Monday Review Cockpit.

---

## 🏭 Manufacturing Scenario Overview

| Finished Good Code | Description | OEM Customer | August 2026 Target | W1 Target | W2 Target | W3 Target | W4 Target |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`7.06496.03.0`** | Vacuum Pump Panther 2.0L | Tata Motors | 10,000 | 2,500 | 2,500 | 2,500 | 2,500 |
| **`7.09629.01.0`** | FAM B Tandem Pump | Mahindra & Mahindra | 8,000 | 2,000 | 2,000 | 2,000 | 2,000 |

### Component Hierarchy (Bill of Materials):
- **`100201`** – Alu Die-Cast Housing (Used in `7.06496.03.0`, 1.0/unit) → Supplier: `V-1001` (CastAlu India)
- **`100202`** – Sintered Rotor Core (**COMMON PART** across both pumps! 1.0/unit each) → Supplier: `V-1002` (Sundaram Fasteners)
  - *Combined W2 Requirement: 2,500 + 2,000 + 500 W1 Backlog = 5,000 units!*
  - *Starting Stock: 800 units → **Triggers Critical Shortage Alert on Dashboard!***
- **`200405`** – Composite Sliding Vanes (Used in `7.06496.03.0`, 4.0/unit) → Supplier: `V-1002` (Sundaram Fasteners)
- **`200408`** – HNBR Shaft Oil Seal (Used in `7.09629.01.0`, 1.0/unit) → Supplier: `V-1003` (Freudenberg NOK Sealing)
- **`800101`** – Corrugated Packaging Box (Used in `7.06496.03.0`, 1.0/unit) → Supplier: `V-1006` (Supreme Packaging)

---

## 📂 Files Included

1. [`01_BOM_Master.csv`](./01_BOM_Master.csv)
2. [`02_Vendor_Buyer_Master.csv`](./02_Vendor_Buyer_Master.csv)
3. [`03_Monthly_Plan.csv`](./03_Monthly_Plan.csv)
4. [`04_SAP_MB51_Transactions.csv`](./04_SAP_MB51_Transactions.csv)
5. [`05_SAP_MB52_Stock_Report.csv`](./05_SAP_MB52_Stock_Report.csv)
6. [`06_Vendor_Delivery_Schedules.csv`](./06_Vendor_Delivery_Schedules.csv)

---

## 🚀 Recommended Upload Sequence (Step-by-Step)

### Step 1: Upload Bill of Materials (BOM)
- **Frontend Tab:** Navigate to **Master BOM** (or **BOM Upload**).
- **File to Upload:** `01_BOM_Master.csv`
- **What Happens:**
  - Auto-creates FG entries for `7.06496.03.0` and `7.09629.01.0`.
  - Auto-creates RM/PM components (`100201`, `100202`, `200405`, `200408`, `800101`).
  - Automatically identifies `100202` as a **Common Part** (`is_common_part = true`).

---

### Step 2: Upload Vendor & Buyer Master
- **Frontend Tab:** Navigate to **Vendor & Buyer Master** (or **Vendor Upload**).
- **File to Upload:** `02_Vendor_Buyer_Master.csv`
- **What Happens:**
  - Maps `V-1001`, `V-1002`, `V-1003`, and `V-1006` to buyers (Rajesh Sharma, Priya Nair, Amit Patel).
  - Associates components with their respective vendors and lead times.

---

### Step 3: Upload Monthly Plan
- **Frontend Tab:** Navigate to **Monthly Plan** (or **Monthly Plan Upload**).
- **Month Selector:** Ensure month is set to **`2026-08`**.
- **File to Upload:** `03_Monthly_Plan.csv`
- **What Happens:**
  - Generates monthly targets (10,000 and 8,000).
  - Calculates weekly prorated targets across W1 through W4.

---

### Step 4: Upload SAP MB51 Material Transactions
- **Frontend Tab:** Navigate to **SAP MB51 Report** (or **MB51 Upload**).
- **File to Upload:** `04_SAP_MB51_Transactions.csv`
- **What Happens:**
  - Ingests Week 1 actual production receipts (Movement 101):
    - `7.06496.03.0`: 2,000 units produced vs 2,500 planned (**500 unit Backlog!**).
    - `7.09629.01.0`: 2,000 units produced vs 2,000 planned (**0 Backlog, 100% on target**).
  - Ingests dispatches (Movement 601) to Tata Motors (1,800) and Mahindra (1,900).

---

### Step 5: Upload SAP MB52 Stock Inventory Report
- **Frontend Tab:** Navigate to **Stock Report MB52** (or **Stock Upload**).
- **File to Upload:** `05_SAP_MB52_Stock_Report.csv`
- **What Happens:**
  - Establishes current unrestricted on-hand stock and quality inspection stock.
  - Highlights acute deficit on Common Rotor `100202` (Stock: 800 vs Required: 5,000).

---

### Step 6: Upload Vendor Delivery Schedules (Optional / Interactive)
- **Frontend Tab:** Navigate to **Update Delivery Schedule** -> **Upload Schedule CSV/Excel** (or enter directly in matrix).
- **File to Upload:** `06_Vendor_Delivery_Schedules.csv`
- **What Happens:**
  - Populates delivery commitments for Week 2 (`2026-08-08` to `2026-08-14`).
  - Sets statuses (`CONFIRMED_ON_TRACK`, `PARTIAL_PROMISE`), carriers, and tracking notes.
  - Updates component coverage and shortfall calculations in the delivery matrix!

---

## 📊 Practical Results to Observe on Frontend

1. **Monday Review Cockpit:**
   - **Week 1 Review:** Shows `7.06496.03.0` with 500 unit production deficit (**Backlog Alert**).
   - **Week 2 Target:** Automatically includes W2 target (2,500) + W1 backlog (500) = **3,000 units Gross Demand**.
   - **Critical Bottleneck Alert:** Red badge on **`100202` (Sintered Rotor Core)** indicating stock deficit.
2. **Update Delivery Schedule Screen:**
   - Component matrix displays live stock, weekly gross requirement, vendor promised qty, and net deficit.
   - Status color pills (Green for `CONFIRMED_ON_TRACK`, Yellow/Orange for `PARTIAL_PROMISE`).
   - Auto-Fill Deficit feature and Buyer Quick Contact drawer.
