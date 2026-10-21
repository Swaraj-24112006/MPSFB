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
  ExplodedBOMComponentSummary,
  FGWeekProductionCockpitItem,
  FGWeekDetailSummary,
  ExplodedBOMWeekDetail,
  PreviousMonthPerformance
} from '../types';
import { isDateInWeek } from './weeklyMrpEngine';

/**
 * Monday Review & Seamless Production Execution Engine
 * Computes:
 * 1. Production backlog from all previous weeks of the month & previous month
 * 2. Total Week Gross Target = Current Week Plan + Prior Backlog
 * 3. In-line Exploded BOM Requirements, Stock Balances & Critical Flags
 * 4. Common component stock reservations when plans are FROZEN
 * 5. Vendor Delivery Commitments & Impact on Weekly Assembly Line Flow
 * 6. Week-wise forward horizon (W1..W4) for all remaining weeks
 * 7. Monday Review Resolutions and Plant Escalation Tracking
 */
export function computeMondayReviewCockpit(
  selectedMonth: string,
  selectedWeekId: string | undefined,
  monthlyPlans: MonthlyPlanItem[],
  weeks: WeekDefinition[],
  boms: BOMItem[],
  vendorBuyers: VendorBuyerItem[],
  mb51List: MB51TransactionItem[],
  stockList: StockReportItem[],
  vendorDeliverySchedules: VendorDeliverySchedule[],
  mondayReviewActions: MondayReviewActionItem[],
  planFreezeList: FGPlanFreezeItem[] = [],
  openingStockDate?: string
): {
  cockpitItems: FGWeekProductionCockpitItem[];
  selectedWeek: WeekDefinition;
  monthWeeks: WeekDefinition[];
  overallBacklogUnits: number;
  totalWeekTargetUnits: number;
  criticalFGsCount: number;
  inadequateDeliveryCount: number;
  nextWeekCriticalFGsCount: number;
  activeEscalationsCount: number;
  frozenFGsCount: number;
} {
  // 1. Filter and sort calendar weeks for selected month
  const monthWeeks = weeks
    .filter((w) => w.month === selectedMonth)
    .sort((a, b) => a.weekNo - b.weekNo);

  // Default to Week 2 if available (as requested by user scenario), else first week or fallback
  let selectedWeek = monthWeeks.find((w) => w.id === selectedWeekId);
  if (!selectedWeek) {
    selectedWeek =
      monthWeeks.find((w) => w.weekNo === 2) ||
      monthWeeks[0] || {
        id: 'w-default',
        month: selectedMonth,
        weekNo: 2,
        weekLabel: 'Week 2',
        startDate: `${selectedMonth}-08`,
        endDate: `${selectedMonth}-14`,
        daysCount: 7,
        workingDays: 6
      };
  }

  // 2. Identify all prior weeks in the current month
  const priorWeeks = monthWeeks.filter((w) => w.weekNo < selectedWeek.weekNo);

  // 3. Filter monthly plans for selected month
  const monthPlans = monthlyPlans.filter((p) => p.month === selectedMonth);

  // 4. Precompute Gross Targets for each FG in the selected week (Plan + Backlog)
  const fgGrossTargetMap = new Map<string, { planTarget: number; priorBacklog: number; grossTarget: number }>();
  
  monthPlans.forEach((plan) => {
    const priorBacklog = priorWeeks.reduce((sum, pw) => {
      const pTarget = plan.weeklyBreakdown[pw.id] || 0;
      const actualProd = mb51List
        .filter((tx) => {
          const isMvt101 = tx.movementType === '101';
          const isThisFG = tx.partNumber === plan.fgCode;
          const matchesWeek = tx.weekId === pw.id || isDateInWeek(tx.postingDate, pw);
          return isMvt101 && isThisFG && matchesWeek;
        })
        .reduce((s, tx) => s + tx.quantity, 0);
      return sum + Math.max(0, pTarget - actualProd);
    }, 0);

    const currentPlanTarget = plan.weeklyBreakdown[selectedWeek.id] || 0;
    const grossTarget = currentPlanTarget + priorBacklog;
    fgGrossTargetMap.set(plan.fgCode, { planTarget: currentPlanTarget, priorBacklog, grossTarget });
  });

  // 5. Precompute Stock Reservations for FROZEN FGs
  // When an FG plan is FROZEN for this week/month, its required quantity of BOM components is reserved
  // Map: componentCode -> Array of { fgCode, fgDescription, reservedQty }
  const componentReservationMap = new Map<
    string,
    { fgCode: string; fgDescription: string; reservedQty: number }[]
  >();

  monthPlans.forEach((plan) => {
    const freezeRec = planFreezeList.find(
      (f) => f.fgCode === plan.fgCode && (f.weekId === selectedWeek.id || f.month === selectedMonth)
    );
    const isFrozen = freezeRec?.status === 'FROZEN';

    if (isFrozen) {
      const grossInfo = fgGrossTargetMap.get(plan.fgCode);
      const grossTarget = grossInfo ? grossInfo.grossTarget : 0;
      const fgBOMs = boms.filter((b) => b.fgCode === plan.fgCode);

      fgBOMs.forEach((bom) => {
        const requiredQty = Math.round(grossTarget * bom.qty);
        const existing = componentReservationMap.get(bom.componentCode) || [];
        existing.push({
          fgCode: plan.fgCode,
          fgDescription: plan.fgDescription,
          reservedQty: requiredQty
        });
        componentReservationMap.set(bom.componentCode, existing);
      });
    }
  });

  // 6. Precompute Component Usage Map across all FGs (for Common Parts detection)
  const componentUsageMap = new Map<
    string,
    { fgCode: string; fgDescription: string; usagePerFG: number }[]
  >();

  boms.forEach((b) => {
    const existing = componentUsageMap.get(b.componentCode) || [];
    if (!existing.some((e) => e.fgCode === b.fgCode)) {
      existing.push({
        fgCode: b.fgCode,
        fgDescription: b.fgDescription,
        usagePerFG: b.qty
      });
      componentUsageMap.set(b.componentCode, existing);
    }
  });

  let overallBacklogUnits = 0;
  let totalWeekTargetUnits = 0;
  let criticalFGsCount = 0;
  let inadequateDeliveryCount = 0;
  let activeEscalationsCount = 0;
  let frozenFGsCount = 0;

  const cockpitItems: FGWeekProductionCockpitItem[] = monthPlans.map((plan) => {
    const freezeRec = planFreezeList.find(
      (f) => f.fgCode === plan.fgCode && (f.weekId === selectedWeek.id || f.month === selectedMonth)
    );
    const freezeStatus = freezeRec ? freezeRec.status : 'DRAFT';
    if (freezeStatus === 'FROZEN') {
      frozenFGsCount++;
    }

    // 6.1 Previous Month Performance Mock/Benchmark
    const prevMonthStr = getPreviousMonthString(selectedMonth);
    const prevMonthTarget = Math.round(plan.monthlyTarget * 0.95);
    const prevMonthActual = Math.round(prevMonthTarget * 0.94);
    const prevMonthBacklog = Math.max(0, prevMonthTarget - prevMonthActual);
    const prevMonthAchieveRate = Math.round((prevMonthActual / (prevMonthTarget || 1)) * 100);

    const previousMonthPerf: PreviousMonthPerformance = {
      month: prevMonthStr,
      target: prevMonthTarget,
      actual: prevMonthActual,
      achievementRate: prevMonthAchieveRate,
      backlogCarriedOver: prevMonthBacklog
    };

    // 6.2 Prior Weeks Breakdown for Current Month
    const priorWeeksBreakdown = priorWeeks.map((pw) => {
      const planTarget = plan.weeklyBreakdown[pw.id] || 0;

      const actualProd = mb51List
        .filter((tx) => {
          const isMvt101 = tx.movementType === '101';
          const isThisFG = tx.partNumber === plan.fgCode;
          const matchesWeek = tx.weekId === pw.id || isDateInWeek(tx.postingDate, pw);
          return isMvt101 && isThisFG && matchesWeek;
        })
        .reduce((sum, tx) => sum + tx.quantity, 0);

      const backlog = Math.max(0, planTarget - actualProd);
      return {
        weekNo: pw.weekNo,
        weekLabel: pw.weekLabel,
        planTarget,
        actualProd,
        backlog
      };
    });

    const priorBacklog = priorWeeksBreakdown.reduce((sum, item) => sum + item.backlog, 0);
    overallBacklogUnits += priorBacklog;

    // 6.3 Current Week Plan Target & Gross Target
    const currentWeekPlanTarget = plan.weeklyBreakdown[selectedWeek.id] || 0;
    const totalWeekGrossTarget = currentWeekPlanTarget + priorBacklog;
    totalWeekTargetUnits += totalWeekGrossTarget;

    // Actual production in current week so far
    const currentWeekActualProd = mb51List
      .filter((tx) => {
        const isMvt101 = tx.movementType === '101';
        const isThisFG = tx.partNumber === plan.fgCode;
        const matchesWeek = tx.weekId === selectedWeek.id || isDateInWeek(tx.postingDate, selectedWeek);
        return isMvt101 && isThisFG && matchesWeek;
      })
      .reduce((sum, tx) => sum + tx.quantity, 0);

    const currentWeekRemainingToBuild = Math.max(0, totalWeekGrossTarget - currentWeekActualProd);

    // 6.4 Explode BOM for this FG
    const fgBOMItems = boms.filter((b) => b.fgCode === plan.fgCode);

    const miniFactory = fgBOMItems.find((b) => b.miniFactory)?.miniFactory || 'Pumps_Division';
    const line = fgBOMItems.find((b) => b.line)?.line || 'Line-1';

    let fgCriticalShortages = 0;
    let fgInadequateSchedules = 0;
    let minStockBuildable = totalWeekGrossTarget > 0 ? 999999 : 0;
    let minProjectedBuildable = totalWeekGrossTarget > 0 ? 999999 : 0;
    let bottleneckCode = '';
    let bottleneckDesc = '';

    const explodedBOM: ExplodedBOMComponentSummary[] = fgBOMItems.map((bom) => {
      // Stock Report (MB52)
      const stockItem = stockList.find((s) => s.partNumber === bom.componentCode);
      const effectiveOpeningDate = openingStockDate || (stockItem ? stockItem.stockDate : undefined);
      const totalPhysicalStock = stockItem ? stockItem.unrestrictedStock : 0;
      const safetyStock = stockItem ? stockItem.safetyStock : 500;

      // Common Part & Shared Usages
      const sharedInFGs = componentUsageMap.get(bom.componentCode) || [];
      const isCommonPart = sharedInFGs.length > 1;

      // Reservations from other frozen FGs
      const allReservations = componentReservationMap.get(bom.componentCode) || [];
      const otherReservations = allReservations.filter((r) => r.fgCode !== plan.fgCode);
      const stockReservedByOtherFGs = otherReservations.reduce((sum, r) => sum + r.reservedQty, 0);

      // Reserved by this FG specifically
      const thisFGReservation = allReservations.find((r) => r.fgCode === plan.fgCode);
      const isThisFGFrozen = freezeStatus === 'FROZEN';

      // Effective Available Stock for this FG
      // If this FG is frozen, it claims its share. If not frozen, it sees what remains after frozen plans.
      const unreservedAvailableStock = Math.max(0, totalPhysicalStock - stockReservedByOtherFGs);
      const currentStock = unreservedAvailableStock;

      const totalReservedStockAcrossAll = allReservations.reduce((sum, r) => sum + r.reservedQty, 0);
      const reservedByFGs = allReservations.map((r) => ({
        fgCode: r.fgCode,
        fgDescription: r.fgDescription,
        reservedQty: r.reservedQty,
        isThisFG: r.fgCode === plan.fgCode
      }));

      // Requirement for this specific FG including backlog
      const totalRequiredForWeekWithBacklog = Math.round(totalWeekGrossTarget * bom.qty);
      const stockDeficit = currentStock - totalRequiredForWeekWithBacklog;
      const isCriticalShortage = stockDeficit < 0;

      const stockCoverageFgUnits =
        bom.qty > 0 ? Math.floor(currentStock / bom.qty) : totalWeekGrossTarget;

      if (stockCoverageFgUnits < minStockBuildable) {
        minStockBuildable = stockCoverageFgUnits;
        bottleneckCode = bom.componentCode;
        bottleneckDesc = bom.componentDescription;
      }

      // Vendor & Buyer Lookup
      const vb = vendorBuyers.find((v) => v.suppliedComponents.includes(bom.componentCode));
      const vendorCode = vb ? vb.vendorCode : 'V-AUTO';
      const vendorName = vb ? vb.vendorName : 'Primary Supplier';
      const buyerName = vb ? vb.buyerName : 'Assigned Category Buyer';
      const leadTimeDays = vb ? vb.leadTimeDays : 7;

      // Vendor Delivery Commitments for selectedWeek
      const deliverySchedules = vendorDeliverySchedules.filter((s) => {
        const matchesComp = s.componentCode === bom.componentCode;
        const matchesWeek =
          s.weekId === selectedWeek.id ||
          (selectedWeek.startDate &&
            selectedWeek.endDate &&
            s.expectedDeliveryDate >= selectedWeek.startDate &&
            s.expectedDeliveryDate <= selectedWeek.endDate);
        return matchesComp && matchesWeek;
      });

      const totalScheduledInward = deliverySchedules.reduce((sum, s) => sum + s.promisedQty, 0);

      const projectedStockWithDeliveries = currentStock + totalScheduledInward;
      const projectedDeficitWithDeliveries =
        projectedStockWithDeliveries - totalRequiredForWeekWithBacklog;

      const projectedCoverageFgUnits =
        bom.qty > 0 ? Math.floor(projectedStockWithDeliveries / bom.qty) : totalWeekGrossTarget;

      if (projectedCoverageFgUnits < minProjectedBuildable) {
        minProjectedBuildable = projectedCoverageFgUnits;
      }

      // Determine Schedule Health & Impact
      let scheduleHealth: 'ADEQUATE' | 'INADEQUATE' | 'CRITICAL_NO_DELIVERY' | 'EXCESS' = 'ADEQUATE';
      let productionImpactSummary = '';

      if (!isCriticalShortage) {
        scheduleHealth = totalScheduledInward > 0 ? 'EXCESS' : 'ADEQUATE';
        productionImpactSummary = `Stock (${currentStock.toLocaleString()} ${bom.uom}) is sufficient for Week ${selectedWeek.weekNo} target (${totalWeekGrossTarget.toLocaleString()} FGs). No risk.`;
      } else {
        fgCriticalShortages++;
        if (totalScheduledInward === 0) {
          scheduleHealth = 'CRITICAL_NO_DELIVERY';
          fgInadequateSchedules++;
          productionImpactSummary = `CRITICAL NO PO / DELIVERY: Stock covers ${stockCoverageFgUnits.toLocaleString()} FGs. Line will starve after ${stockCoverageFgUnits.toLocaleString()} units with NO vendor inward!`;
        } else if (projectedDeficitWithDeliveries < 0) {
          scheduleHealth = 'INADEQUATE';
          fgInadequateSchedules++;
          const shortageGap = totalWeekGrossTarget - projectedCoverageFgUnits;
          productionImpactSummary = `INADEQUATE PROMISE: Vendor promised ${totalScheduledInward.toLocaleString()} ${bom.uom} vs deficit ${Math.abs(stockDeficit).toLocaleString()} needed. Assembly capped at ${projectedCoverageFgUnits.toLocaleString()} FGs (loss of ${shortageGap.toLocaleString()} FGs).`;
        } else {
          scheduleHealth = 'ADEQUATE';
          const dates = deliverySchedules.map((s) => s.expectedDeliveryDate.slice(5)).join(', ');
          productionImpactSummary = `RECOVERABLE: Initial stock covers ${stockCoverageFgUnits.toLocaleString()} units. Vendor delivery of ${totalScheduledInward.toLocaleString()} ${bom.uom} [${dates}] fulfills 100% of plan.`;
        }
      }

      // 6.5 Week-wise details across all 4 weeks of the month for this component
      let rollingCompStock = totalPhysicalStock;
      const weekDetails: ExplodedBOMWeekDetail[] = monthWeeks.map((w) => {
        const isPrior = w.weekNo < selectedWeek.weekNo;
        const isCurrent = w.weekNo === selectedWeek.weekNo;
        const isFuture = w.weekNo > selectedWeek.weekNo;

        // Calculate Gross requirement for this week across this FG
        const fgWeekPlan = plan.weeklyBreakdown[w.id] || 0;
        const grossReq = isCurrent
          ? Math.round(totalWeekGrossTarget * bom.qty)
          : Math.round(fgWeekPlan * bom.qty);

        // Find scheduled inward deliveries for this week
        const weekDeliveries = vendorDeliverySchedules.filter((s) => {
          const matchesComp = s.componentCode === bom.componentCode;
          const matchesWeek =
            s.weekId === w.id ||
            (w.startDate &&
              w.endDate &&
              s.expectedDeliveryDate >= w.startDate &&
              s.expectedDeliveryDate <= w.endDate);
          return matchesComp && matchesWeek;
        });

        const scheduledInward = weekDeliveries.reduce((sum, s) => sum + s.promisedQty, 0);

        // Opening stock date aware rolling stock:
        // If week is strictly before effectiveOpeningDate, past consumption/receipts already occurred prior to snapshot.
        if (effectiveOpeningDate && w.endDate < effectiveOpeningDate) {
          // Historical week prior to opening stock snapshot — do not adjust rolling stock
        } else {
          rollingCompStock = rollingCompStock + scheduledInward - grossReq;
        }
        const deficit = rollingCompStock < 0 ? rollingCompStock : 0;

        let status: 'ADEQUATE' | 'INADEQUATE' | 'CRITICAL_NO_DELIVERY' | 'EXCESS' = 'ADEQUATE';
        if (deficit < 0) {
          status = scheduledInward === 0 ? 'CRITICAL_NO_DELIVERY' : 'INADEQUATE';
        } else {
          status = scheduledInward > 0 ? 'EXCESS' : 'ADEQUATE';
        }

        return {
          weekId: w.id,
          weekNo: w.weekNo,
          weekLabel: w.weekLabel,
          isPrior,
          isCurrent,
          isFuture,
          grossRequired: grossReq,
          scheduledInward,
          projectedClosing: rollingCompStock,
          deficit,
          status
        };
      });

      // Next Week (W(N+1)) Forward Horizon Risk Detection
      const nextWeekObj = monthWeeks.find((w) => w.weekNo === selectedWeek.weekNo + 1);
      const nextWeekDetail = nextWeekObj
        ? weekDetails.find((wd) => wd.weekNo === nextWeekObj.weekNo)
        : undefined;
      const nextWeekNo = nextWeekObj ? nextWeekObj.weekNo : undefined;
      const nextWeekGrossReq = nextWeekDetail ? nextWeekDetail.grossRequired : 0;
      const nextWeekInward = nextWeekDetail ? nextWeekDetail.scheduledInward : 0;
      const nextWeekClosingStock = nextWeekDetail ? nextWeekDetail.projectedClosing : 0;
      const nextWeekDeficit = nextWeekDetail ? nextWeekDetail.deficit : 0;
      const hasNextWeekRisk = nextWeekDetail
        ? nextWeekDetail.deficit < 0 ||
          nextWeekDetail.status === 'INADEQUATE' ||
          nextWeekDetail.status === 'CRITICAL_NO_DELIVERY'
        : false;
      const hasForwardRisk = weekDetails.some(
        (wd) =>
          wd.isFuture &&
          (wd.deficit < 0 || wd.status === 'INADEQUATE' || wd.status === 'CRITICAL_NO_DELIVERY')
      );

      return {
        id: `exp-${bom.id}`,
        componentCode: bom.componentCode,
        componentDescription: bom.componentDescription,
        category: bom.category,
        uom: bom.uom,
        bomQty: bom.qty,
        currentStock,
        safetyStock,
        isCommonPart,
        sharedInFGsCount: sharedInFGs.length,
        sharedInFGs,
        totalPhysicalStock,
        reservedStock: totalReservedStockAcrossAll,
        reservedByFGs,
        unreservedAvailableStock,
        totalRequiredForWeekWithBacklog,
        stockDeficit,
        isCriticalShortage,
        stockCoverageFgUnits,
        vendorCode,
        vendorName,
        buyerName,
        leadTimeDays,
        deliverySchedules,
        totalScheduledInward,
        projectedStockWithDeliveries,
        projectedDeficitWithDeliveries,
        projectedCoverageFgUnits,
        scheduleHealth,
        productionImpactSummary,
        weekDetails,
        nextWeekNo,
        nextWeekGrossReq,
        nextWeekInward,
        nextWeekClosingStock,
        nextWeekDeficit,
        hasNextWeekRisk,
        hasForwardRisk
      };
    });

    // Next week FG level aggregation
    const nextWeekObj = monthWeeks.find((w) => w.weekNo === selectedWeek.weekNo + 1);
    const nextWeekCriticalCount = explodedBOM.filter((b) => b.hasNextWeekRisk).length;
    const hasNextWeekRisk = nextWeekCriticalCount > 0;
    const nextWeekBottleneck = explodedBOM.find((b) => b.hasNextWeekRisk);
    const nextWeekBottleneckDesc = nextWeekBottleneck
      ? `${nextWeekBottleneck.componentCode} (${nextWeekBottleneck.componentDescription})`
      : undefined;

    // 6.6 Full Month Horizon Week-wise Details for this FG
    const allWeeksDetail: FGWeekDetailSummary[] = monthWeeks.map((w) => {
      const isPrior = w.weekNo < selectedWeek.weekNo;
      const isCurrent = w.weekNo === selectedWeek.weekNo;
      const isFuture = w.weekNo > selectedWeek.weekNo;

      const planTarget = plan.weeklyBreakdown[w.id] || 0;

      // Actual production
      const actualProd = mb51List
        .filter((tx) => {
          const isMvt101 = tx.movementType === '101';
          const isThisFG = tx.partNumber === plan.fgCode;
          const matchesWeek = tx.weekId === w.id || isDateInWeek(tx.postingDate, w);
          return isMvt101 && isThisFG && matchesWeek;
        })
        .reduce((sum, tx) => sum + tx.quantity, 0);

      const backlog = isPrior ? Math.max(0, planTarget - actualProd) : 0;
      const grossTarget = isCurrent ? totalWeekGrossTarget : planTarget;

      const stockBuildable = isCurrent
        ? minStockBuildable === 999999
          ? grossTarget
          : minStockBuildable
        : planTarget;
      const deliveriesBuildable = isCurrent
        ? minProjectedBuildable === 999999
          ? grossTarget
          : minProjectedBuildable
        : planTarget;

      const gap = Math.max(0, grossTarget - deliveriesBuildable);

      let rmStatus: 'CLEAR' | 'CRITICAL' | 'INADEQUATE' = 'CLEAR';
      if (gap > 0) {
        rmStatus = 'INADEQUATE';
      } else if (stockBuildable < grossTarget) {
        rmStatus = 'CRITICAL';
      }

      return {
        weekId: w.id,
        weekNo: w.weekNo,
        weekLabel: w.weekLabel,
        isPrior,
        isCurrent,
        isFuture,
        planTarget,
        actualProd,
        backlog,
        grossTarget,
        stockBuildable,
        deliveriesBuildable,
        gap,
        rmStatus
      };
    });

    // 6.7 Overall FG Health Status
    let fgHealthStatus:
      | 'CRITICAL_SHORTAGE'
      | 'INADEQUATE_SCHEDULE'
      | 'SCHEDULE_ON_TRACK'
      | 'CLEAR_SEAMLESS' = 'CLEAR_SEAMLESS';

    if (fgInadequateSchedules > 0) {
      fgHealthStatus = 'INADEQUATE_SCHEDULE';
      inadequateDeliveryCount++;
      criticalFGsCount++;
    } else if (fgCriticalShortages > 0) {
      fgHealthStatus = 'SCHEDULE_ON_TRACK';
      criticalFGsCount++;
    } else {
      fgHealthStatus = 'CLEAR_SEAMLESS';
    }

    // Match Monday Review Actions
    const matchingActions = mondayReviewActions.filter(
      (a) => a.fgCode === plan.fgCode && (a.weekId === selectedWeek.id || a.month === selectedMonth)
    );

    const hasActiveEscalations = matchingActions.some(
      (a) =>
        a.status === 'ESCALATED_LEVEL_1' ||
        a.status === 'ESCALATED_LEVEL_2' ||
        a.status === 'ESCALATED_LEVEL_3'
    );

    if (hasActiveEscalations) {
      activeEscalationsCount++;
    }

    return {
      fgCode: plan.fgCode,
      fgDescription: plan.fgDescription,
      customerName: plan.customerName,
      miniFactory,
      line,
      monthlyTarget: plan.monthlyTarget,
      selectedWeek,
      freezeStatus,
      frozenAt: freezeRec?.frozenAt,
      frozenBy: freezeRec?.frozenBy,
      freezeNotes: freezeRec?.freezeNotes,
      previousMonthPerf,
      priorBacklog,
      priorWeeksBreakdown,
      currentWeekPlanTarget,
      totalWeekGrossTarget,
      currentWeekActualProd,
      currentWeekRemainingToBuild,
      allWeeksDetail,
      explodedBOM,
      criticalComponentsCount: fgCriticalShortages,
      inadequateScheduleCount: fgInadequateSchedules,
      nextWeekCriticalCount,
      hasNextWeekRisk,
      nextWeekBottleneckDesc,
      nextWeekNo: nextWeekObj ? nextWeekObj.weekNo : undefined,
      maxBuildableFGWithStock:
        minStockBuildable === 999999 ? totalWeekGrossTarget : minStockBuildable,
      maxBuildableFGWithDeliveries:
        minProjectedBuildable === 999999 ? totalWeekGrossTarget : minProjectedBuildable,
      bottleneckComponentCode: bottleneckCode,
      bottleneckComponentDesc: bottleneckDesc,
      fgHealthStatus,
      hasActiveEscalations,
      mondayReviewActions: matchingActions
    };
  });

  const nextWeekCriticalFGsCount = cockpitItems.filter((i) => i.hasNextWeekRisk).length;

  return {
    cockpitItems,
    selectedWeek,
    monthWeeks,
    overallBacklogUnits,
    totalWeekTargetUnits,
    criticalFGsCount,
    inadequateDeliveryCount,
    nextWeekCriticalFGsCount,
    activeEscalationsCount,
    frozenFGsCount
  };
}

function getPreviousMonthString(currentMonth: string): string {
  const [year, month] = currentMonth.split('-').map(Number);
  if (month === 1) {
    return `${year - 1}-12`;
  }
  const prevMonth = month - 1;
  return `${year}-${prevMonth < 10 ? '0' : ''}${prevMonth}`;
}
