/**
 * Core Data Models for Weekly MRP & Supply Engine
 * Aligned with SAP ERP Data Flow:
 * - Master Data: BOM Master, Vendor & Buyer Relationship
 * - Monthly Upload: Define Week No. (Calendar Buckets), Monthly FG Plan (Auto-divided by days in week)
 * - Monday Upload: SAP MB51 (101 FG Receipts [prefix 7], 101 RM/PM Receipts [prefix non-7], 601 FG Dispatches), Stock Report (MB52)
 */

export type UserRole =
  | 'demand_planner'
  | 'supply_planner'
  | 'production'
  | 'management';

export interface UserRoleDefinition {
  id: UserRole;
  label: string;
  shortLabel: string;
  description: string;
  color: string;
  badgeBg: string;
}

export const USER_ROLES: UserRoleDefinition[] = [
  {
    id: 'demand_planner',
    label: 'Demand Planner',
    shortLabel: 'Demand',
    description: 'Configure monthly week calendars, upload monthly customer FG plans & review weekly prorated requirements.',
    color: 'blue',
    badgeBg: 'bg-blue-600 text-white'
  },
  {
    id: 'supply_planner',
    label: 'Supply / Buyer',
    shortLabel: 'Buyer',
    description: 'Maintain vendor-buyer mappings, review RM/PM gross requirements against stock, and track MB51 inward receipts.',
    color: 'amber',
    badgeBg: 'bg-amber-600 text-white'
  },
  {
    id: 'production',
    label: 'Production & Shop Floor',
    shortLabel: 'Production',
    description: 'Monitor weekly FG plan vs actual 101 production receipts and track finished goods dispatches.',
    color: 'emerald',
    badgeBg: 'bg-emerald-600 text-white'
  },
  {
    id: 'management',
    label: 'Plant Management',
    shortLabel: 'Management',
    description: 'Executive visibility into FG fulfillment, RM shortages by Buyer, and end-to-end supply chain health.',
    color: 'purple',
    badgeBg: 'bg-purple-600 text-white'
  }
];

// ============================================================================
// 1. MASTER DATA
// ============================================================================

// 1.1 BOM Master: Maps Parent FG (starts with 7) to RM/PM Components (starts with other)
export interface BOMItem {
  id: string;
  fgCode: string; // Starts with 7 (e.g., 7.06496.03.0 or 7001001)
  fgDescription: string;
  componentCode: string; // Starts other than 7 (e.g., RM-CASTING-VP01, 100201, PM-BOX-01)
  componentDescription: string;
  qty: number; // Usage multiplier per unit of FG
  uom: string; // PC, KG, LTR, MTR, SET
  category: 'RM' | 'PM'; // Raw Material or Packaging Material
  miniFactory?: string;
  line?: string;
}

// 1.2 Vendor and Buyer Relationship Master
export interface VendorBuyerItem {
  id: string;
  vendorCode: string; // e.g., V-1001
  vendorName: string; // e.g., Sundaram Fasteners Ltd
  buyerName: string; // e.g., Rajesh Kumar (Buyer - Castings & Hardware)
  buyerEmail?: string;
  buyerPhone?: string;
  category: 'RM' | 'PM';
  suppliedComponents: string[]; // List of componentCodes supplied
  leadTimeDays: number;
  city?: string;
  gstNo?: string;
}

// ============================================================================
// 2. MONTHLY UPLOAD DATA
// ============================================================================

// 2.1 Define Week No. (Week definitions for a month or entire year)
export interface WeekDefinition {
  id: string;
  month: string; // YYYY-MM e.g. "2026-08"
  weekNo: number; // 1, 2, 3, 4, 5...
  weekLabel: string; // e.g. "Week 1 (01-09 Aug)"
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  daysCount: number; // Number of days in that week bucket (e.g. 9 days)
  holidayDays?: number; // Optional holiday/off days
  workingDays?: number; // Optional working days (e.g. 8 days)
  monthWeight?: number; // Month weight percentage: (workingDays / totalWorkingDays) * 100
}

// 2.2 Monthly Plan (Uploaded monthly, auto-divided across defined weeks by days count)
export interface MonthlyPlanItem {
  id: string;
  fgCode: string; // Starts with 7
  fgDescription: string;
  customerName?: string;
  month: string; // YYYY-MM
  monthlyTarget: number; // Total monthly target
  uom: string;
  weeklyBreakdown: Record<string, number>; // weekId -> prorated target quantity
  customNotes?: string;
}

// ============================================================================
// 3. MONDAY UPLOAD DATA
// ============================================================================

// 3.1 MB51 Material Document Movement Report
export type MB51Classification =
  | 'FG_PRODUCTION_RECEIPT' // Mvt 101, Part starting with 7
  | 'RMPM_RECEIPT'          // Mvt 101, Part starting other than 7
  | 'FG_DISPATCH'           // Mvt 601, Finished Good Dispatches
  | 'OTHER';

export interface MB51TransactionItem {
  id: string;
  materialDocument: string; // SAP Material Doc e.g. 5000192841
  postingDate: string; // YYYY-MM-DD
  movementType: string; // "101" | "601" | other
  partNumber: string; // Part number
  materialDescription: string;
  quantity: number;
  uom: string;
  storageLocation: string; // SLOC e.g. SL01, 1001, FG01
  plant?: string;
  vendorOrCustomer?: string;
  poOrOrderNumber?: string;
  classification: MB51Classification; // Automatically computed from mvt + part prefix
  weekId?: string; // Mapped week from postingDate
}

// 3.2 Stock Report (SAP MB52 / Unrestricted On-Hand Stock)
export interface StockReportItem {
  id: string;
  partNumber: string;
  materialDescription: string;
  materialType: 'FG' | 'RM' | 'PM'; // startsWith('7') ? 'FG' : 'RM'/'PM'
  unrestrictedStock: number;
  inQualityInsp: number;
  blocked: number;
  storageLocation: string;
  uom: string;
  safetyStock: number;
  plant: string;
  lastUpdated?: string;
}

// ============================================================================
// 4. WEEKLY MRP & SUPPLY CONSOLIDATED CALCULATIONS
// ============================================================================

// 4.1 FG Weekly Supply Summary
export interface FGWeeklyCoverageSummary {
  fgCode: string;
  fgDescription: string;
  customerName?: string;
  startingStock: number;
  monthlyPlanTarget: number;
  weeks: {
    weekId: string;
    weekNo: number;
    weekLabel: string;
    daysCount: number;
    planTarget: number;
    actualProductionReceipt: number; // Sum of MB51 Mvt 101 (starts with 7)
    variance: number; // actual - plan
    actualDispatch: number; // Sum of MB51 Mvt 601
    closingStock: number;
  }[];
  totalActualProduction: number;
  totalActualDispatch: number;
  overallAchievementRate: number; // %
}

// 4.2 RM/PM Weekly Requirement & Shortage Summary
export interface RMWeeklyRequirementSummary {
  componentCode: string;
  componentDescription: string;
  category: 'RM' | 'PM';
  uom: string;
  buyerName: string;
  vendorName: string;
  vendorCode: string;
  leadTimeDays: number;
  currentStock: number;
  safetyStock: number;
  usedInFGs: { fgCode: string; fgDescription: string; usagePerFG: number }[];
  weeks: {
    weekId: string;
    weekNo: number;
    weekLabel: string;
    grossRequirement: number; // Sum of (FG Plan * BOM Qty)
    actualInwardReceipt: number; // Sum of MB51 Mvt 101 (prefix non-7)
    projectedStock: number;
    deficit: number; // If projectedStock < safetyStock or < 0
    status: 'OK' | 'WARNING' | 'SHORTAGE';
  }[];
  totalGrossRequirement: number;
  totalInwardReceived: number;
  overallStatus: 'OK' | 'WARNING' | 'SHORTAGE';
  maxShortageQty: number;
}

// ============================================================================
// 5. MONDAY REVIEW COCKPIT & SEAMLESS PRODUCTION ENGINE
// ============================================================================

// 5.1 Vendor Inward Delivery Commitment / PO Schedule
export type DeliveryCommitmentStatus =
  | 'CONFIRMED_ON_TRACK'
  | 'IN_TRANSIT'
  | 'PARTIAL_PROMISE'
  | 'DELAYED_AT_RISK'
  | 'CANCELLED'
  | 'CRITICAL_NO_PO';

export interface VendorDeliverySchedule {
  id: string;
  poNumber: string;
  componentCode: string;
  vendorCode: string;
  vendorName: string;
  buyerName: string;
  expectedDeliveryDate: string; // YYYY-MM-DD
  weekId: string;
  promisedQty: number;
  carrierOrTracking?: string;
  deliveryStatus: DeliveryCommitmentStatus;
  notes?: string;
}

// 5.1.1 Vendor Delivery Schedule Change Audit Log
export interface VendorDeliveryScheduleChangeLog {
  id: string;
  scheduleId: string;
  poNumber: string;
  componentCode: string;
  componentDescription?: string;
  vendorName: string;
  changedBy: string; // Supply planner / buyer name
  changedAt: string; // ISO / Formatted Timestamp
  fieldChanged: string; // e.g. "Expected Delivery Date", "Promised Quantity", "Delivery Status"
  oldValue: string | number;
  newValue: string | number;
  reasonForChange: string; // Mandatory explanation
}

// 5.1.2 Centralized Audit Log Entry
export interface AuditLogEntry {
  id: string;
  timestamp: string; // ISO / Formatted Timestamp
  userRole: UserRole;
  userName: string;
  changeType: 'DELIVERY_SCHEDULE' | 'FG_PLAN' | 'OTHER';
  description: string;
  referenceId: string; // PO Number or FG Code
  reason?: string;
}

// 5.1.2 FG Plan Freeze Record
export type PlanFreezeStatus = 'DRAFT' | 'REVIEWED' | 'FROZEN';

export interface FGPlanFreezeItem {
  fgCode: string;
  month: string;
  weekId: string;
  status: PlanFreezeStatus;
  frozenAt?: string;
  frozenBy?: string;
  freezeNotes?: string;
}

// 5.2 Monday Review Action Log & Escalation Item
export type MondayReviewStatus =
  | 'PENDING_DISCUSSION'
  | 'AMICABLE_SOLUTION_AGREED'
  | 'ESCALATED_LEVEL_1'
  | 'ESCALATED_LEVEL_2'
  | 'ESCALATED_LEVEL_3'
  | 'RESOLVED';

export type MondayReviewIssueType =
  | 'RM_SHORTAGE'
  | 'BACKLOG_RECOVERY'
  | 'VENDOR_DELAY'
  | 'CAPACITY_LINE_SPEED'
  | 'QUALITY_HOLD';

export interface MondayReviewActionItem {
  id: string;
  month: string; // YYYY-MM
  weekId: string; // e.g. w-2026-08-02
  fgCode: string;
  fgDescription: string;
  componentCode?: string;
  componentDescription?: string;
  issueType: MondayReviewIssueType;
  description: string;
  impactSummary: string; // e.g. "Prevents assembly of 711 Panther Vacuum Pumps"
  status: MondayReviewStatus;
  resolutionNotes: string; // e.g. "Vendor agreed to dispatch 500 pcs via air express on Tuesday"
  agreedAction: string;
  assignedOwner: string; // e.g. "Rajesh Kumar (Buyer)"
  targetResolutionDate: string; // YYYY-MM-DD
  escalatedTo?: string; // e.g. "Plant Head / SCM VP"
  createdAt: string;
  updatedAt: string;
}

// 5.2.1 Week-wise Detail for Exploded BOM Component
export interface ExplodedBOMWeekDetail {
  weekId: string;
  weekNo: number;
  weekLabel: string;
  isPrior: boolean;
  isCurrent: boolean;
  isFuture: boolean;
  grossRequired: number;
  scheduledInward: number;
  projectedClosing: number;
  deficit: number;
  status: 'ADEQUATE' | 'INADEQUATE' | 'CRITICAL_NO_DELIVERY' | 'EXCESS';
}

// 5.3 Exploded BOM Component Details in FG Dropdown
export interface ExplodedBOMComponentSummary {
  id: string;
  componentCode: string;
  componentDescription: string;
  category: 'RM' | 'PM';
  uom: string;
  bomQty: number; // Usage multiplier per 1 unit of FG
  currentStock: number; // On-hand unrestricted from MB52
  safetyStock: number;
  
  // Common shared parts & stock reservation
  isCommonPart: boolean;
  sharedInFGsCount: number;
  sharedInFGs: { fgCode: string; fgDescription: string; usagePerFG: number }[];
  totalPhysicalStock: number;
  reservedStock: number; // Total reserved across all frozen FGs
  reservedByFGs: { fgCode: string; fgDescription: string; reservedQty: number; isThisFG: boolean }[];
  unreservedAvailableStock: number; // Available stock for allocation

  totalRequiredForWeekWithBacklog: number; // (Week Plan + Backlog) * bomQty
  stockDeficit: number; // currentStock - totalRequired (negative if deficit)
  isCriticalShortage: boolean; // true if currentStock < totalRequired
  stockCoverageFgUnits: number; // Math.floor(currentStock / bomQty) -> how many FGs can build with stock alone
  vendorCode: string;
  vendorName: string;
  buyerName: string;
  leadTimeDays: number;
  deliverySchedules: VendorDeliverySchedule[];
  totalScheduledInward: number;
  projectedStockWithDeliveries: number; // currentStock + totalScheduledInward
  projectedDeficitWithDeliveries: number; // (currentStock + inward) - totalRequired
  projectedCoverageFgUnits: number; // Math.floor((currentStock + inward) / bomQty)
  scheduleHealth: 'ADEQUATE' | 'INADEQUATE' | 'CRITICAL_NO_DELIVERY' | 'EXCESS';
  productionImpactSummary: string; // Human readable impact on line
  weekDetails: ExplodedBOMWeekDetail[]; // W1, W2, W3, W4 forward schedule

  // Forward & Next Week Horizon Risk Tracking
  nextWeekNo?: number;
  nextWeekGrossReq?: number;
  nextWeekInward?: number;
  nextWeekClosingStock?: number;
  nextWeekDeficit?: number;
  hasNextWeekRisk?: boolean;
  hasForwardRisk?: boolean;
}

// 5.3.1 Previous Month Performance & Weekwise Breakdown for FG
export interface PreviousMonthPerformance {
  month: string;
  target: number;
  actual: number;
  achievementRate: number;
  backlogCarriedOver: number;
}

export interface FGWeekDetailSummary {
  weekId: string;
  weekNo: number;
  weekLabel: string;
  isPrior: boolean;
  isCurrent: boolean;
  isFuture: boolean;
  planTarget: number;
  actualProd: number;
  backlog: number;
  grossTarget: number; // For current week = plan + prior backlog; For future = plan
  stockBuildable: number;
  deliveriesBuildable: number;
  gap: number;
  rmStatus: 'CLEAR' | 'CRITICAL' | 'INADEQUATE';
}

// 5.4 Unified FG Production Cockpit Item for Monday Review
export interface FGWeekProductionCockpitItem {
  fgCode: string;
  fgDescription: string;
  customerName?: string;
  miniFactory: string;
  line: string;
  monthlyTarget: number;
  selectedWeek: WeekDefinition;
  
  // Freeze & Review Status
  freezeStatus: PlanFreezeStatus;
  frozenAt?: string;
  frozenBy?: string;
  freezeNotes?: string;

  // Previous Month Performance
  previousMonthPerf: PreviousMonthPerformance;

  // Prior Backlog
  priorBacklog: number; // Sum of max(0, planTarget - actual101Prod) for all prior weeks in month
  priorWeeksBreakdown: {
    weekNo: number;
    weekLabel: string;
    planTarget: number;
    actualProd: number;
    backlog: number;
  }[];
  currentWeekPlanTarget: number;
  totalWeekGrossTarget: number; // currentWeekPlanTarget + priorBacklog
  currentWeekActualProd: number; // MB51 101 receipts so far this week
  currentWeekRemainingToBuild: number; // max(0, totalWeekGrossTarget - currentWeekActualProd)
  
  // Week-wise full monthly horizon (W1, W2, W3, W4)
  allWeeksDetail: FGWeekDetailSummary[];

  explodedBOM: ExplodedBOMComponentSummary[];
  criticalComponentsCount: number;
  inadequateScheduleCount: number;
  nextWeekCriticalCount?: number;
  hasNextWeekRisk?: boolean;
  nextWeekBottleneckDesc?: string;
  nextWeekNo?: number;
  maxBuildableFGWithStock: number; // Bottleneck limit of FG build with stock only
  maxBuildableFGWithDeliveries: number; // Bottleneck limit of FG build with scheduled inward
  bottleneckComponentCode: string;
  bottleneckComponentDesc: string;
  fgHealthStatus: 'CRITICAL_SHORTAGE' | 'INADEQUATE_SCHEDULE' | 'SCHEDULE_ON_TRACK' | 'CLEAR_SEAMLESS';
  hasActiveEscalations: boolean;
  mondayReviewActions: MondayReviewActionItem[];
}

// ============================================================================
// 6. BOM COMPONENT DAILY PRODUCTION & ARRIVAL GANTT SIMULATION
// ============================================================================
export type BOMGanttDayStatus = 'SAFE' | 'WARNING' | 'CRITICAL_STOPPAGE';

export interface BOMGanttDayDelivery {
  scheduleId?: string;
  poNumber: string;
  vendorName: string;
  vendorCode?: string;
  buyerName?: string;
  qty: number;
  deliveryStatus: DeliveryCommitmentStatus;
  notes?: string;
}

export interface BOMGanttDaySimulation {
  date: string; // YYYY-MM-DD
  dayLabel: string; // e.g. "08 Sep"
  dayOfWeek: string; // "Mon", "Tue", "Wed", etc.
  dayIndex: number; // 0..N
  isWorkingDay: boolean;
  dailyFgPlan: number;
  dailyReq: number;
  startingStock: number;
  inwardDeliveries: BOMGanttDayDelivery[];
  totalInwardToday: number;
  stockAfterInward: number;
  endingStock: number;
  deficitToday: number;
  isStockout: boolean;
  status: BOMGanttDayStatus;
  productionCapacityPct: number; // 0 to 100%
  supportedFgUnitsToday: number;
}

export interface BOMGanttCriticalPathInfo {
  isCriticalPath: boolean;
  slackDays: number; // e.g. -2 for 2-day delay, 0 for zero float bottleneck, +3 for safe buffer
  criticalDays: string[]; // ISO date strings of critical path blocker/starvation days
  gatingDeliveryDates: string[]; // ISO date strings of deliveries that gate the production run
  impactOnFinalDelivery: string; // Plain-English dependency impact
  delayInFgDays: number; // Days final FG delivery is delayed due to this component
  recommendedExpediteDate?: string;
  criticalChainSummary: string;
}

export interface BOMGanttTimelineResult {
  componentCode: string;
  componentDescription: string;
  fgCode: string;
  fgDescription: string;
  uom: string;
  bomQty: number;
  initialStock: number;
  safetyStock: number;
  totalPeriodRequirement: number;
  totalInwardScheduled: number;
  days: BOMGanttDaySimulation[];
  isFeasible: boolean; // True if no critical stockout occurs on any day
  firstStockoutDate?: string;
  stockoutDaysCount: number;
  criticalPath?: BOMGanttCriticalPathInfo;
  arrivalEvaluation: {
    primaryArrivalDate?: string;
    primaryArrivalQty?: number;
    arrivalStatus: 'ON_TIME_SAFE' | 'ARRIVES_AFTER_STOCKOUT' | 'INSUFFICIENT_QTY' | 'NO_SCHEDULE';
    message: string;
    stockoutDate?: string;
    daysDelayed?: number;
  };
}

// ============================================================================
// 7. EXECUTIVE MANAGEMENT CRITICAL ITEMS & PRODUCTION LOSS REPORT
// ============================================================================
export interface ImpactedFGProgram {
  fgCode: string;
  fgDescription: string;
  customerName: string;
  line: string;
  miniFactory: string;
  bomUsageQty: number;
  uom: string;
  unitPriceINR: number;
  weekGrossTarget: number; // Plan + Prior Backlog
  maxBuildableWithStock: number;
  maxBuildableWithDeliveries: number;
  productionLossUnits: number; // GrossTarget - MaxBuildableWithDeliveries
  financialLossINR: number; // productionLossUnits * unitPriceINR
  stoppageDayEstimate: string; // e.g., "Day 3 (Wed, 10 Aug) - Shift B"
  stoppageHoursAtRisk: number;
  stockoutDeficitForThisFG: number;
}

export interface ManagementCriticalLossItem {
  id: string;
  componentCode: string;
  componentDescription: string;
  category: 'RM' | 'PM';
  categorySubtype: string;
  uom: string;
  storageLocation: string;
  
  // Stock Equation
  currentPhysicalStock: number;
  reservedStock: number;
  availableFreeStock: number;
  scheduledDeliveriesQty: number;
  totalAvailableSupply: number;
  totalGrossRequiredQty: number;
  netDeficitQty: number;
  safetyStock: number;
  coverageDays: number;
  
  // Procurement & Vendor Details
  vendorCode: string;
  vendorName: string;
  vendorCity?: string;
  buyerName: string;
  buyerEmail?: string;
  buyerPhone?: string;
  leadTimeDays: number;
  activeDeliverySchedules: {
    id: string;
    poNumber: string;
    expectedDeliveryDate: string;
    promisedQty: number;
    deliveryStatus: DeliveryCommitmentStatus;
    carrierOrTracking?: string;
  }[];
  deliveryStatusRating: 'NO_PO_ISSUED' | 'DELAYED_AT_RISK' | 'INSUFFICIENT_PROMISE' | 'CONFIRMED_ON_TRACK';

  // Impacted FGs & Loss Aggregates
  impactedFGs: ImpactedFGProgram[];
  totalProductionLossFGUnits: number; // Bottleneck loss across consuming FGs
  totalFinancialLossINR: number; // Total revenue / value at risk in INR
  worstStoppageDay: string;
  totalShiftsAtRisk: number;
  criticalityLevel: 'SEVEREST_IMMEDIATE_STOPPAGE' | 'HIGH_PRODUCTION_LOSS' | 'MODERATE_RISK';
  
  // Root Cause & Diagnostics
  rootCauseCategory: 'VENDOR_TOOLING_BREAKDOWN' | 'RAW_MATERIAL_SUPPLY_DELAY' | 'CUSTOMS_IMPORT_HOLD' | 'PURCHASING_PO_DELAY' | 'QUALITY_REJECTION_BATCH';
  rootCauseDescription: string;
  
  // Management Action & Mitigation
  recommendedActions: {
    actionType: 'EXPEDITE_AIR_FREIGHT' | 'ACTIVATE_SECOND_SOURCE' | 'DIVERT_STOCK_FROM_OTHER_LINE' | 'RESCHEDULE_LINE_VARIANTS' | 'OVERTIME_WEEKEND_RECOVERY';
    title: string;
    description: string;
    costINR: number;
    potentialUnitsRecovered: number;
    financialValueSavedINR: number;
    feasibility: 'HIGH' | 'MEDIUM' | 'REQUIRES_EXECUTIVE_APPROVAL';
  }[];
  
  // Current Action Status & Decision
  decisionStatus: 'PENDING_EXECUTIVE_DECISION' | 'EXPEDITE_APPROVED' | 'STOCK_REALLOCATED' | 'SECOND_SOURCE_ACTIVATED' | 'LINE_RESCHEDULED';
  managementNotes?: string;
  actionOwner?: string;
  targetResolutionDate?: string;
}


