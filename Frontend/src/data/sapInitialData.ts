import {
  BOMItem,
  VendorBuyerItem,
  WeekDefinition,
  MonthlyPlanItem,
  MB51TransactionItem,
  StockReportItem,
  VendorDeliverySchedule,
  MondayReviewActionItem,
  FGPlanFreezeItem,
  VendorDeliveryScheduleChangeLog
} from '../types';

// ============================================================================
// Clean Initial Data — All initial dummy records cleared
// ============================================================================
export const INITIAL_BOM_MASTER: BOMItem[] = [];
export const INITIAL_VENDOR_BUYER_MASTER: VendorBuyerItem[] = [];
export const INITIAL_WEEK_DEFINITIONS: WeekDefinition[] = [];
export const INITIAL_MONTHLY_PLANS: MonthlyPlanItem[] = [];
export const INITIAL_MB51_TRANSACTIONS: MB51TransactionItem[] = [];
export const INITIAL_STOCK_REPORT: StockReportItem[] = [];
export const INITIAL_VENDOR_DELIVERY_SCHEDULES: VendorDeliverySchedule[] = [];
export const INITIAL_MONDAY_REVIEW_ACTIONS: MondayReviewActionItem[] = [];
export const INITIAL_PLAN_FREEZE_ITEMS: FGPlanFreezeItem[] = [];
export const INITIAL_DELIVERY_CHANGE_LOGS: VendorDeliveryScheduleChangeLog[] = [];

/**
 * Prorate monthly plan target across month's defined working days.
 * Used by MonthlyPlanManager when generating weekly targets.
 */
export function calculateProratedWeeklyBreakdown(
  monthlyTarget: number,
  weeks: WeekDefinition[]
): Record<string, number> {
  if (!weeks || weeks.length === 0 || !monthlyTarget || monthlyTarget <= 0) return {};

  const sortedWeeks = [...weeks].sort((a, b) => a.weekNo - b.weekNo);
  const totalWorkingDays = sortedWeeks.reduce((sum, w) => sum + (w.workingDays || w.daysCount), 0);
  if (totalWorkingDays <= 0) return {};

  const allocations = sortedWeeks.map((week, idx) => {
    const workingDays = week.workingDays || week.daysCount;
    const exactVal = monthlyTarget * (workingDays / totalWorkingDays);
    const floorVal = Math.floor(exactVal);
    const remainder = exactVal - floorVal;
    return {
      id: week.id,
      target: floorVal,
      remainder,
      originalIdx: idx,
    };
  });

  const leftover = monthlyTarget - allocations.reduce((sum, a) => sum + a.target, 0);

  if (leftover > 0) {
    const byRemainder = [...allocations].sort((a, b) => {
      if (b.remainder !== a.remainder) {
        return b.remainder - a.remainder;
      }
      return a.originalIdx - b.originalIdx;
    });

    for (let i = 0; i < leftover; i++) {
      byRemainder[i].target += 1;
    }
  }

  const breakdown: Record<string, number> = {};
  allocations.forEach((item) => {
    breakdown[item.id] = item.target;
  });

  return breakdown;
}
