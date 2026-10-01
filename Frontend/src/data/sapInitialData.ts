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
// 1. MASTER DATA: BOM MASTER (Part starting with 7 = FG, other = RM/PM)
// ============================================================================
export const INITIAL_BOM_MASTER: BOMItem[] = [
  // 1. Vacuum Pump Panther (7.06496.03.0)
  {
    id: 'bom-01',
    fgCode: '7.06496.03.0',
    fgDescription: 'Vacuum Pump Panther 2.0L',
    componentCode: '100201',
    componentDescription: 'Die-Cast Aluminum Housing (Panther)',
    qty: 1.0,
    uom: 'PC',
    category: 'RM',
    miniFactory: 'Pumps_Division',
    line: 'A-PMP2'
  },
  {
    id: 'bom-02',
    fgCode: '7.06496.03.0',
    fgDescription: 'Vacuum Pump Panther 2.0L',
    componentCode: '100202',
    componentDescription: 'Precision Rotor Assembly 40mm',
    qty: 1.0,
    uom: 'PC',
    category: 'RM',
    miniFactory: 'Pumps_Division',
    line: 'A-PMP2'
  },
  {
    id: 'bom-03',
    fgCode: '7.06496.03.0',
    fgDescription: 'Vacuum Pump Panther 2.0L',
    componentCode: '200405',
    componentDescription: 'Composite Carbon Sliding Vane (3-Set)',
    qty: 1.0,
    uom: 'SET',
    category: 'RM',
    miniFactory: 'Pumps_Division',
    line: 'A-PMP2'
  },
  {
    id: 'bom-04',
    fgCode: '7.06496.03.0',
    fgDescription: 'Vacuum Pump Panther 2.0L',
    componentCode: '200408',
    componentDescription: 'Fluorosilicone Shaft Oil Seal 22x35x7',
    qty: 1.0,
    uom: 'PC',
    category: 'RM',
    miniFactory: 'Pumps_Division',
    line: 'A-PMP2'
  },
  {
    id: 'bom-05',
    fgCode: '7.06496.03.0',
    fgDescription: 'Vacuum Pump Panther 2.0L',
    componentCode: '800101',
    componentDescription: 'VCI Anti-Corrosion Liner Bag',
    qty: 1.0,
    uom: 'PC',
    category: 'PM',
    miniFactory: 'Pumps_Division',
    line: 'A-PMP2'
  },
  {
    id: 'bom-06',
    fgCode: '7.06496.03.0',
    fgDescription: 'Vacuum Pump Panther 2.0L',
    componentCode: '800102',
    componentDescription: 'Modular Corrugated Box (Pack of 16)',
    qty: 0.0625,
    uom: 'PC',
    category: 'PM',
    miniFactory: 'Pumps_Division',
    line: 'A-PMP2'
  },

  // 2. FAM B Tandem Vacuum Pump (7.09629.01.0)
  {
    id: 'bom-07',
    fgCode: '7.09629.01.0',
    fgDescription: 'FAM B Tandem Vacuum Pump',
    componentCode: '100301',
    componentDescription: 'Stator Housing Machined (FAM B)',
    qty: 1.0,
    uom: 'PC',
    category: 'RM',
    miniFactory: 'Pumps_Division',
    line: 'A-PMP1'
  },
  {
    id: 'bom-08',
    fgCode: '7.09629.01.0',
    fgDescription: 'FAM B Tandem Vacuum Pump',
    componentCode: '100202',
    componentDescription: 'Precision Rotor Assembly 40mm',
    qty: 1.0,
    uom: 'PC',
    category: 'RM',
    miniFactory: 'Pumps_Division',
    line: 'A-PMP1'
  },
  {
    id: 'bom-09',
    fgCode: '7.09629.01.0',
    fgDescription: 'FAM B Tandem Vacuum Pump',
    componentCode: '300105',
    componentDescription: 'Torx Flange Bolt M6x30 Grade 10.9',
    qty: 4.0,
    uom: 'PC',
    category: 'RM',
    miniFactory: 'Pumps_Division',
    line: 'A-PMP1'
  },
  {
    id: 'bom-10',
    fgCode: '7.09629.01.0',
    fgDescription: 'FAM B Tandem Vacuum Pump',
    componentCode: '800101',
    componentDescription: 'VCI Anti-Corrosion Liner Bag',
    qty: 1.0,
    uom: 'PC',
    category: 'PM',
    miniFactory: 'Pumps_Division',
    line: 'A-PMP1'
  },

  // 3. Variable Engine Oil Pump (7.02551.11.0)
  {
    id: 'bom-11',
    fgCode: '7.02551.11.0',
    fgDescription: 'Variable Flow Oil Pump (Gen 3)',
    componentCode: '100401',
    componentDescription: 'Oil Pump Pressure Die Cast Body',
    qty: 1.0,
    uom: 'PC',
    category: 'RM',
    miniFactory: 'Pumps_Division',
    line: 'A-OIL2'
  },
  {
    id: 'bom-12',
    fgCode: '7.02551.11.0',
    fgDescription: 'Variable Flow Oil Pump (Gen 3)',
    componentCode: '100402',
    componentDescription: 'Sintered Inner & Outer Gerotor Set',
    qty: 1.0,
    uom: 'SET',
    category: 'RM',
    miniFactory: 'Pumps_Division',
    line: 'A-OIL2'
  },
  {
    id: 'bom-13',
    fgCode: '7.02551.11.0',
    fgDescription: 'Variable Flow Oil Pump (Gen 3)',
    componentCode: '200409',
    componentDescription: 'HNBR High-Temp O-Ring 58x2.5',
    qty: 2.0,
    uom: 'PC',
    category: 'RM',
    miniFactory: 'Pumps_Division',
    line: 'A-OIL2'
  },
  {
    id: 'bom-14',
    fgCode: '7.02551.11.0',
    fgDescription: 'Variable Flow Oil Pump (Gen 3)',
    componentCode: '800103',
    componentDescription: 'Heavy-Duty Corrugated Bulk Shipper',
    qty: 0.05,
    uom: 'PC',
    category: 'PM',
    miniFactory: 'Pumps_Division',
    line: 'A-OIL2'
  }
];

// ============================================================================
// 2. MASTER DATA: VENDOR & BUYER RELATIONSHIP
// ============================================================================
export const INITIAL_VENDOR_BUYER_MASTER: VendorBuyerItem[] = [
  {
    id: 'vb-01',
    vendorCode: 'V-1001',
    vendorName: 'Endurance Technologies Ltd',
    buyerName: 'Rajesh Kumar (Buyer - Castings)',
    buyerEmail: 'rajesh.k@autoparts.com',
    buyerPhone: '+91 98450 11223',
    category: 'RM',
    suppliedComponents: ['100201', '100301', '100401', '100601'],
    leadTimeDays: 7,
    city: 'Pune, Maharashtra',
    gstNo: '27AAACE1234F1Z5'
  },
  {
    id: 'vb-02',
    vendorCode: 'V-1002',
    vendorName: 'Sundaram Fasteners Ltd',
    buyerName: 'Amit Patel (Buyer - Machined & Fasteners)',
    buyerEmail: 'amit.p@autoparts.com',
    buyerPhone: '+91 98200 44556',
    category: 'RM',
    suppliedComponents: ['100202', '300105'],
    leadTimeDays: 4,
    city: 'Chennai, Tamil Nadu',
    gstNo: '33AAACS5678G2Z1'
  },
  {
    id: 'vb-03',
    vendorCode: 'V-1003',
    vendorName: 'Freudenberg Sealing Technologies',
    buyerName: 'Priya Sharma (Buyer - Seals & Polymers)',
    buyerEmail: 'priya.s@autoparts.com',
    buyerPhone: '+91 97110 88990',
    category: 'RM',
    suppliedComponents: ['200405', '200408', '200409'],
    leadTimeDays: 10,
    city: 'Gurugram, Haryana',
    gstNo: '06AAACF9012H1Z9'
  },
  {
    id: 'vb-04',
    vendorCode: 'V-1004',
    vendorName: 'GKN Sinter Metals Ltd',
    buyerName: 'Amit Patel (Buyer - Machined & Fasteners)',
    buyerEmail: 'amit.p@autoparts.com',
    buyerPhone: '+91 98200 44556',
    category: 'RM',
    suppliedComponents: ['100402'],
    leadTimeDays: 8,
    city: 'Ahmednagar, Maharashtra',
    gstNo: '27AAACG3456J1Z3'
  },
  {
    id: 'vb-06',
    vendorCode: 'V-1006',
    vendorName: 'Supreme Corrugators & Packaging',
    buyerName: 'Sneha Nair (Buyer - Packaging Materials)',
    buyerEmail: 'sneha.n@autoparts.com',
    buyerPhone: '+91 99887 66554',
    category: 'PM',
    suppliedComponents: ['800101', '800102', '800103'],
    leadTimeDays: 3,
    city: 'Hosur, Tamil Nadu',
    gstNo: '33AAACS1122L1Z4'
  }
];

// ============================================================================
// 3. MONTHLY UPLOAD: DEFINE WEEK NO.
// ============================================================================
export const INITIAL_WEEK_DEFINITIONS: WeekDefinition[] = [
  // August 2026
  {
    id: 'w-2026-08-01',
    month: '2026-08',
    weekNo: 1,
    weekLabel: 'Week 1 (01-07 Aug)',
    startDate: '2026-08-01',
    endDate: '2026-08-07',
    daysCount: 7,
    workingDays: 6
  },
  {
    id: 'w-2026-08-02',
    month: '2026-08',
    weekNo: 2,
    weekLabel: 'Week 2 (08-14 Aug)',
    startDate: '2026-08-08',
    endDate: '2026-08-14',
    daysCount: 7,
    workingDays: 6
  },
  {
    id: 'w-2026-08-03',
    month: '2026-08',
    weekNo: 3,
    weekLabel: 'Week 3 (15-21 Aug)',
    startDate: '2026-08-15',
    endDate: '2026-08-21',
    daysCount: 7,
    workingDays: 6
  },
  {
    id: 'w-2026-08-04',
    month: '2026-08',
    weekNo: 4,
    weekLabel: 'Week 4 (22-31 Aug)',
    startDate: '2026-08-22',
    endDate: '2026-08-31',
    daysCount: 10,
    workingDays: 8
  },
  // September 2026
  {
    id: 'w-2026-09-01',
    month: '2026-09',
    weekNo: 1,
    weekLabel: 'Week 1 (01-07 Sep)',
    startDate: '2026-09-01',
    endDate: '2026-09-07',
    daysCount: 7,
    workingDays: 6
  },
  {
    id: 'w-2026-09-02',
    month: '2026-09',
    weekNo: 2,
    weekLabel: 'Week 2 (08-14 Sep)',
    startDate: '2026-09-08',
    endDate: '2026-09-14',
    daysCount: 7,
    workingDays: 6
  },
  {
    id: 'w-2026-09-03',
    month: '2026-09',
    weekNo: 3,
    weekLabel: 'Week 3 (15-21 Sep)',
    startDate: '2026-09-15',
    endDate: '2026-09-21',
    daysCount: 7,
    workingDays: 6
  },
  {
    id: 'w-2026-09-04',
    month: '2026-09',
    weekNo: 4,
    weekLabel: 'Week 4 (22-30 Sep)',
    startDate: '2026-09-22',
    endDate: '2026-09-30',
    daysCount: 9,
    workingDays: 8
  }
];

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

// ============================================================================
// 4. MONTHLY UPLOAD: MONTHLY PLAN (Prorated for August and September 2026)
// ============================================================================
const augWeeks = INITIAL_WEEK_DEFINITIONS.filter((w) => w.month === '2026-08');
const sepWeeks = INITIAL_WEEK_DEFINITIONS.filter((w) => w.month === '2026-09');

export const INITIAL_MONTHLY_PLANS: MonthlyPlanItem[] = [
  // August Plans
  {
    id: 'mp-aug-01',
    fgCode: '7.06496.03.0',
    fgDescription: 'Vacuum Pump Panther 2.0L',
    customerName: 'Tata Motors PV & EV',
    month: '2026-08',
    monthlyTarget: 10000,
    uom: 'PC',
    weeklyBreakdown: calculateProratedWeeklyBreakdown(10000, augWeeks),
    customNotes: 'Harrier & Safari engine line schedule'
  },
  {
    id: 'mp-aug-02',
    fgCode: '7.09629.01.0',
    fgDescription: 'FAM B Tandem Vacuum Pump',
    customerName: 'Mahindra & Mahindra Auto',
    month: '2026-08',
    monthlyTarget: 8000,
    uom: 'PC',
    weeklyBreakdown: calculateProratedWeeklyBreakdown(8000, augWeeks),
    customNotes: 'Scorpio-N / XUV700 ramp-up'
  },
  {
    id: 'mp-aug-03',
    fgCode: '7.02551.11.0',
    fgDescription: 'Variable Flow Oil Pump (Gen 3)',
    customerName: 'Hyundai Motor India',
    month: '2026-08',
    monthlyTarget: 6200,
    uom: 'PC',
    weeklyBreakdown: calculateProratedWeeklyBreakdown(6200, augWeeks),
    customNotes: '1.5L Turbo TGDi program'
  },
  // September Plans
  {
    id: 'mp-01',
    fgCode: '7.06496.03.0',
    fgDescription: 'Vacuum Pump Panther 2.0L',
    customerName: 'Tata Motors PV & EV',
    month: '2026-09',
    monthlyTarget: 10000,
    uom: 'PC',
    weeklyBreakdown: calculateProratedWeeklyBreakdown(10000, sepWeeks),
    customNotes: 'Harrier & Safari engine line schedule'
  },
  {
    id: 'mp-02',
    fgCode: '7.09629.01.0',
    fgDescription: 'FAM B Tandem Vacuum Pump',
    customerName: 'Mahindra & Mahindra Auto',
    month: '2026-09',
    monthlyTarget: 8000,
    uom: 'PC',
    weeklyBreakdown: calculateProratedWeeklyBreakdown(8000, sepWeeks),
    customNotes: 'Scorpio-N / XUV700 ramp-up'
  },
  {
    id: 'mp-03',
    fgCode: '7.02551.11.0',
    fgDescription: 'Variable Flow Oil Pump (Gen 3)',
    customerName: 'Hyundai Motor India',
    month: '2026-09',
    monthlyTarget: 6200,
    uom: 'PC',
    weeklyBreakdown: calculateProratedWeeklyBreakdown(6200, sepWeeks),
    customNotes: '1.5L Turbo TGDi program'
  }
];

// ============================================================================
// 5. MONDAY UPLOAD: SAP MB51 MATERIAL DOCUMENT MOVEMENT REPORT
// ============================================================================
export const INITIAL_MB51_TRANSACTIONS: MB51TransactionItem[] = [
  // Week 1 actual production receipts (Mvt 101)
  {
    id: 'mb51-01',
    materialDocument: '5001089211',
    postingDate: '2026-08-04',
    movementType: '101',
    partNumber: '7.06496.03.0',
    materialDescription: 'Vacuum Pump Panther 2.0L',
    plant: '1001',
    storageLocation: 'FG01',
    quantity: 2150,
    uom: 'PC',
    classification: 'FG_PRODUCTION_RECEIPT',
    weekId: 'w-2026-08-01'
  },
  {
    id: 'mb51-02',
    materialDocument: '5001089212',
    postingDate: '2026-08-05',
    movementType: '101',
    partNumber: '7.09629.01.0',
    materialDescription: 'FAM B Tandem Vacuum Pump',
    plant: '1001',
    storageLocation: 'FG01',
    quantity: 1750,
    uom: 'PC',
    classification: 'FG_PRODUCTION_RECEIPT',
    weekId: 'w-2026-08-01'
  }
];

// ============================================================================
// 6. MONDAY UPLOAD: STOCK REPORT (SAP MB52 / Unrestricted Stock)
// ============================================================================
export const INITIAL_STOCK_REPORT: StockReportItem[] = [
  {
    id: 'st-01',
    partNumber: '100201',
    materialDescription: 'Die-Cast Aluminum Housing (Panther)',
    plant: '1001',
    storageLocation: 'RM01',
    unrestrictedStock: 850,
    blocked: 0,
    inQualityInsp: 50,
    safetyStock: 300,
    uom: 'PC',
    materialType: 'RM',
    lastUpdated: '2026-08-08 07:30'
  },
  {
    id: 'st-02',
    partNumber: '100202',
    materialDescription: 'Precision Rotor Assembly 40mm',
    plant: '1001',
    storageLocation: 'RM01',
    unrestrictedStock: 450,
    blocked: 0,
    inQualityInsp: 0,
    safetyStock: 250,
    uom: 'PC',
    materialType: 'RM',
    lastUpdated: '2026-08-08 07:30'
  },
  {
    id: 'st-03',
    partNumber: '200405',
    materialDescription: 'Composite Carbon Sliding Vane (3-Set)',
    plant: '1001',
    storageLocation: 'RM01',
    unrestrictedStock: 1200,
    blocked: 0,
    inQualityInsp: 0,
    safetyStock: 400,
    uom: 'SET',
    materialType: 'RM',
    lastUpdated: '2026-08-08 07:30'
  },
  {
    id: 'st-04',
    partNumber: '200408',
    materialDescription: 'Fluorosilicone Shaft Oil Seal 22x35x7',
    plant: '1001',
    storageLocation: 'RM01',
    unrestrictedStock: 600,
    blocked: 0,
    inQualityInsp: 0,
    safetyStock: 300,
    uom: 'PC',
    materialType: 'RM',
    lastUpdated: '2026-08-08 07:30'
  },
  {
    id: 'st-05',
    partNumber: '800101',
    materialDescription: 'VCI Anti-Corrosion Liner Bag',
    plant: '1001',
    storageLocation: 'PM01',
    unrestrictedStock: 3200,
    blocked: 0,
    inQualityInsp: 0,
    safetyStock: 500,
    uom: 'PC',
    materialType: 'PM',
    lastUpdated: '2026-08-08 07:30'
  },
  {
    id: 'st-06',
    partNumber: '800102',
    materialDescription: 'Modular Corrugated Box (Pack of 16)',
    plant: '1001',
    storageLocation: 'PM01',
    unrestrictedStock: 380,
    blocked: 0,
    inQualityInsp: 0,
    safetyStock: 50,
    uom: 'PC',
    materialType: 'PM',
    lastUpdated: '2026-08-08 07:30'
  },
  {
    id: 'st-07',
    partNumber: '100301',
    materialDescription: 'Stator Housing Machined (FAM B)',
    plant: '1001',
    storageLocation: 'RM01',
    unrestrictedStock: 550,
    blocked: 0,
    inQualityInsp: 0,
    safetyStock: 200,
    uom: 'PC',
    materialType: 'RM',
    lastUpdated: '2026-08-08 07:30'
  },
  {
    id: 'st-08',
    partNumber: '300105',
    materialDescription: 'Torx Flange Bolt M6x30 Grade 10.9',
    plant: '1001',
    storageLocation: 'RM01',
    unrestrictedStock: 9800,
    blocked: 0,
    inQualityInsp: 0,
    safetyStock: 2000,
    uom: 'PC',
    materialType: 'RM',
    lastUpdated: '2026-08-08 07:30'
  },
  {
    id: 'st-09',
    partNumber: '100401',
    materialDescription: 'Oil Pump Pressure Die Cast Body',
    plant: '1001',
    storageLocation: 'RM01',
    unrestrictedStock: 800,
    blocked: 0,
    inQualityInsp: 0,
    safetyStock: 300,
    uom: 'PC',
    materialType: 'RM',
    lastUpdated: '2026-08-08 07:30'
  },
  {
    id: 'st-10',
    partNumber: '100402',
    materialDescription: 'Sintered Inner & Outer Gerotor Set',
    plant: '1001',
    storageLocation: 'RM01',
    unrestrictedStock: 350,
    blocked: 0,
    inQualityInsp: 0,
    safetyStock: 200,
    uom: 'SET',
    materialType: 'RM',
    lastUpdated: '2026-08-08 07:30'
  },
  {
    id: 'st-11',
    partNumber: '200409',
    materialDescription: 'HNBR High-Temp O-Ring 58x2.5',
    plant: '1001',
    storageLocation: 'RM01',
    unrestrictedStock: 2400,
    blocked: 0,
    inQualityInsp: 0,
    safetyStock: 500,
    uom: 'PC',
    materialType: 'RM',
    lastUpdated: '2026-08-08 07:30'
  },
  {
    id: 'st-12',
    partNumber: '800103',
    materialDescription: 'Heavy-Duty Corrugated Bulk Shipper',
    plant: '1001',
    storageLocation: 'PM01',
    unrestrictedStock: 320,
    blocked: 0,
    inQualityInsp: 0,
    safetyStock: 50,
    uom: 'PC',
    materialType: 'PM',
    lastUpdated: '2026-08-08 07:30'
  }
];

// ============================================================================
// 7. VENDOR DELIVERY COMMITMENTS & PO SCHEDULES
// ============================================================================
export const INITIAL_VENDOR_DELIVERY_SCHEDULES: VendorDeliverySchedule[] = [
  // August 2026 (Week 2: 08-14 Aug)
  {
    id: 'sched-aug-01',
    poNumber: 'PO-88214',
    componentCode: '100201',
    vendorCode: 'V-1001',
    vendorName: 'Endurance Technologies Ltd',
    buyerName: 'Rajesh Kumar (Buyer - Castings)',
    expectedDeliveryDate: '2026-08-09',
    weekId: 'w-2026-08-02',
    promisedQty: 1800,
    carrierOrTracking: 'VRL Logistics (TRK-9901)',
    deliveryStatus: 'CONFIRMED_ON_TRACK',
    notes: 'Dispatched from Pune plant. Arrives Day 2 in time.'
  },
  {
    id: 'sched-aug-02',
    poNumber: 'PO-88219',
    componentCode: '100202',
    vendorCode: 'V-1002',
    vendorName: 'Sundaram Fasteners Ltd',
    buyerName: 'Amit Patel (Buyer - Machined)',
    expectedDeliveryDate: '2026-08-12', // 12-Aug is 4 days into week -> CRITICAL DELAY
    weekId: 'w-2026-08-02',
    promisedQty: 1200,
    carrierOrTracking: 'Safexpress (SF-4421)',
    deliveryStatus: 'IN_TRANSIT',
    notes: 'Machining delay at vendor. Expected arrival 12 Aug (3 days after stock exhaustion).'
  },
  {
    id: 'sched-aug-03',
    poNumber: 'PO-88225',
    componentCode: '200408',
    vendorCode: 'V-1003',
    vendorName: 'Freudenberg Sealing Technologies',
    buyerName: 'Priya Sharma (Buyer - Seals)',
    expectedDeliveryDate: '2026-08-10',
    weekId: 'w-2026-08-02',
    promisedQty: 1500,
    carrierOrTracking: 'DHL Express',
    deliveryStatus: 'CONFIRMED_ON_TRACK',
    notes: 'Batch ready for dispatch.'
  },
  {
    id: 'sched-aug-04',
    poNumber: 'PO-88230',
    componentCode: '100301',
    vendorCode: 'V-1001',
    vendorName: 'Endurance Technologies Ltd',
    buyerName: 'Rajesh Kumar (Buyer - Castings)',
    expectedDeliveryDate: '2026-08-10',
    weekId: 'w-2026-08-02',
    promisedQty: 1600,
    carrierOrTracking: 'Direct Truck Dedicated',
    deliveryStatus: 'CONFIRMED_ON_TRACK',
    notes: 'Castings batch arriving 10 Aug.'
  },
  {
    id: 'sched-aug-05',
    poNumber: 'PO-88241',
    componentCode: '300105',
    vendorCode: 'V-1002',
    vendorName: 'Sundaram Fasteners Ltd',
    buyerName: 'Amit Patel (Buyer - Machined & Fasteners)',
    expectedDeliveryDate: '2026-08-13',
    weekId: 'w-2026-08-02',
    promisedQty: 4500,
    carrierOrTracking: 'BlueDart Surface (BD-8831)',
    deliveryStatus: 'DELAYED_AT_RISK',
    notes: 'Heat treatment furnace breakdown at Chennai plant. Delayed by 4 days.'
  },
  {
    id: 'sched-aug-06',
    poNumber: 'PO-88249',
    componentCode: '100402',
    vendorCode: 'V-1004',
    vendorName: 'GKN Sinter Metals Ltd',
    buyerName: 'Amit Patel (Buyer - Machined & Fasteners)',
    expectedDeliveryDate: '2026-08-14',
    weekId: 'w-2026-08-02',
    promisedQty: 450,
    carrierOrTracking: 'DTDC Freight (DT-9912)',
    deliveryStatus: 'DELAYED_AT_RISK',
    notes: 'Raw powder metal shipment delayed at customs. Rescheduled to end of week.'
  },
  {
    id: 'sched-aug-07',
    poNumber: 'PO-88255',
    componentCode: '800101',
    vendorCode: 'V-1006',
    vendorName: 'Supreme Corrugators & Packaging',
    buyerName: 'Sneha Nair (Buyer - Packaging Materials)',
    expectedDeliveryDate: '2026-08-09',
    weekId: 'w-2026-08-02',
    promisedQty: 2500,
    carrierOrTracking: 'Local Logistics Hosur',
    deliveryStatus: 'CONFIRMED_ON_TRACK',
    notes: 'Corrugated boxes printed and staged for pickup.'
  },
  {
    id: 'sched-aug-08',
    poNumber: 'PO-88260',
    componentCode: '200409',
    vendorCode: 'V-1003',
    vendorName: 'Freudenberg Sealing Technologies',
    buyerName: 'Priya Sharma (Buyer - Seals & Polymers)',
    expectedDeliveryDate: '2026-08-11',
    weekId: 'w-2026-08-02',
    promisedQty: 2000,
    carrierOrTracking: 'DHL Express (DHL-4412)',
    deliveryStatus: 'CONFIRMED_ON_TRACK',
    notes: 'HNBR O-Rings batch cleared QA inspection.'
  },
  // September 2026 (Week 2: 08-14 Sep)
  {
    id: 'sched-sep-01',
    poNumber: 'PO-99101',
    componentCode: '100201',
    vendorCode: 'V-1001',
    vendorName: 'Endurance Technologies Ltd',
    buyerName: 'Rajesh Kumar (Buyer - Castings)',
    expectedDeliveryDate: '2026-09-09',
    weekId: 'w-2026-09-02',
    promisedQty: 1800,
    carrierOrTracking: 'VRL Logistics (TRK-9901)',
    deliveryStatus: 'CONFIRMED_ON_TRACK',
    notes: 'Dispatched from Pune plant. Arrives Day 2 in time.'
  },
  {
    id: 'sched-sep-02',
    poNumber: 'PO-99102',
    componentCode: '100202',
    vendorCode: 'V-1002',
    vendorName: 'Sundaram Fasteners Ltd',
    buyerName: 'Amit Patel (Buyer - Machined)',
    expectedDeliveryDate: '2026-09-12',
    weekId: 'w-2026-09-02',
    promisedQty: 1200,
    carrierOrTracking: 'Safexpress (SF-4421)',
    deliveryStatus: 'DELAYED_AT_RISK',
    notes: 'Vendor tool maintenance caused delay to 12 Sep. Stockout occurs 09 Sep.'
  },
  {
    id: 'sched-sep-03',
    poNumber: 'PO-99103',
    componentCode: '200408',
    vendorCode: 'V-1003',
    vendorName: 'Freudenberg Sealing Technologies',
    buyerName: 'Priya Sharma (Buyer - Seals)',
    expectedDeliveryDate: '2026-09-10',
    weekId: 'w-2026-09-02',
    promisedQty: 1500,
    carrierOrTracking: 'DHL Express',
    deliveryStatus: 'CONFIRMED_ON_TRACK',
    notes: 'Batch ready for dispatch.'
  },
  {
    id: 'sched-sep-04',
    poNumber: 'PO-99104',
    componentCode: '300105',
    vendorCode: 'V-1002',
    vendorName: 'Sundaram Fasteners Ltd',
    buyerName: 'Amit Patel (Buyer - Machined & Fasteners)',
    expectedDeliveryDate: '2026-09-13',
    weekId: 'w-2026-09-02',
    promisedQty: 4000,
    carrierOrTracking: 'Safexpress (SF-7712)',
    deliveryStatus: 'DELAYED_AT_RISK',
    notes: 'Raw forging shortage at vendor plant.'
  },
  {
    id: 'sched-sep-05',
    poNumber: 'PO-99105',
    componentCode: '100402',
    vendorCode: 'V-1004',
    vendorName: 'GKN Sinter Metals Ltd',
    buyerName: 'Amit Patel (Buyer - Machined & Fasteners)',
    expectedDeliveryDate: '2026-09-11',
    weekId: 'w-2026-09-02',
    promisedQty: 500,
    carrierOrTracking: 'DTDC Cargo',
    deliveryStatus: 'IN_TRANSIT',
    notes: 'In transit from Ahmednagar.'
  },
  {
    id: 'sched-sep-06',
    poNumber: 'PO-99106',
    componentCode: '800101',
    vendorCode: 'V-1006',
    vendorName: 'Supreme Corrugators & Packaging',
    buyerName: 'Sneha Nair (Buyer - Packaging Materials)',
    expectedDeliveryDate: '2026-09-09',
    weekId: 'w-2026-09-02',
    promisedQty: 2800,
    carrierOrTracking: 'Direct Truck',
    deliveryStatus: 'CONFIRMED_ON_TRACK',
    notes: 'Packaging delivery scheduled on time.'
  }
];

// ============================================================================
// 8. MONDAY REVIEW ACTIONS & RESOLUTION LOG (Persisted in state)
// ============================================================================
export const INITIAL_MONDAY_REVIEW_ACTIONS: MondayReviewActionItem[] = [
  {
    id: 'act-01',
    month: '2026-08',
    weekId: 'w-2026-08-02',
    fgCode: '7.06496.03.0',
    fgDescription: 'Vacuum Pump Panther 2.0L',
    componentCode: '100202',
    componentDescription: 'Precision Rotor Assembly 40mm',
    issueType: 'RM_SHORTAGE',
    description: 'Rotor Assembly stock covers only 1.2 days of production. Late arrival on 12-Aug causes line stoppage.',
    impactSummary: '3-day line starvation on Panther Line. Projected loss of 1,250 FG units.',
    status: 'AMICABLE_SOLUTION_AGREED',
    resolutionNotes: 'Vendor Sundaram agreed to air-freight 600 pcs for arrival on 09-Aug, balance 600 pcs on 12-Aug.',
    agreedAction: 'Split PO into emergency air shipment arriving 09 Aug to prevent line stoppage.',
    assignedOwner: 'Amit Patel (Buyer)',
    targetResolutionDate: '2026-08-09',
    escalatedTo: 'Head of SCM & Plant GM',
    createdAt: '2026-08-08 09:30',
    updatedAt: '2026-08-08 09:30'
  }
];

// ============================================================================
// 9. AUDIT LOG & PLAN FREEZE (Persisted in state)
// ============================================================================
export const INITIAL_PLAN_FREEZE_ITEMS: FGPlanFreezeItem[] = [
  {
    fgCode: '7.06496.03.0',
    month: '2026-08',
    weekId: 'w-2026-08-01',
    status: 'FROZEN',
    frozenAt: '01 Aug 2026, 08:30:00',
    frozenBy: 'Vikram Mehta (Supply Planner)',
    freezeNotes: 'Week 1 production plan locked post review with Plant GM'
  }
];

export const INITIAL_DELIVERY_CHANGE_LOGS: VendorDeliveryScheduleChangeLog[] = [
  {
    id: 'log-hist-001',
    scheduleId: 'sched-02',
    poNumber: 'PO-88102',
    componentCode: '100202',
    componentDescription: 'Precision Rotor Assembly 40mm',
    vendorName: 'Sundaram Fasteners Ltd',
    changedBy: 'Amit Patel (Buyer - Machined)',
    changedAt: '08 Aug 2026, 11:45:20',
    fieldChanged: 'Arrival Date & Status (Expedited Air Freight)',
    oldValue: '1,200 pcs on 2026-08-12 [DELAYED_AT_RISK]',
    newValue: '600 pcs on 2026-08-09 [CONFIRMED_ON_TRACK] + 600 pcs on 2026-08-12',
    reasonForChange: 'Vendor agreed to emergency split air shipment to prevent 3-day line starvation during Monday Review.'
  },
  {
    id: 'log-hist-002',
    scheduleId: 'sched-01',
    poNumber: 'PO-88101',
    componentCode: '100201',
    componentDescription: 'Aluminum Housing Machined V2',
    vendorName: 'Endurance Technologies Ltd',
    changedBy: 'Rajesh Kumar (Buyer - Castings)',
    changedAt: '07 Aug 2026, 16:15:00',
    fieldChanged: 'Promised Quantity (+300 pcs)',
    oldValue: '1,500 pcs on 2026-08-09 [CONFIRMED_ON_TRACK]',
    newValue: '1,800 pcs on 2026-08-09 [CONFIRMED_ON_TRACK]',
    reasonForChange: 'Negotiated extra 300 castings batch from vendor finished goods warehouse to cover buffer stock.'
  },
  {
    id: 'log-hist-003',
    scheduleId: 'sched-03',
    poNumber: 'PO-88103',
    componentCode: '200408',
    componentDescription: 'EPDM Quad-Ring Seal 42mm',
    vendorName: 'Freudenberg Sealing Technologies',
    changedBy: 'Priya Sharma (Buyer - Seals)',
    changedAt: '06 Aug 2026, 14:00:10',
    fieldChanged: 'Carrier / Tracking & Status',
    oldValue: 'Surface Cargo (Road Express) [PENDING_DISPATCH]',
    newValue: 'DHL Express (AWB-9988231) [IN_TRANSIT]',
    reasonForChange: 'Upgraded to DHL overnight priority to ensure gate receipt before Day 2 assembly shift.'
  },
  {
    id: 'log-hist-004',
    scheduleId: 'sched-sep-02',
    poNumber: 'PO-99102',
    componentCode: '100202',
    componentDescription: 'Precision Rotor Assembly 40mm',
    vendorName: 'Sundaram Fasteners Ltd',
    changedBy: 'Vikram Mehta (Supply Planner)',
    changedAt: '01 Sep 2026, 10:20:45',
    fieldChanged: 'Delivery Status (Warning Flagged)',
    oldValue: 'CONFIRMED_ON_TRACK',
    newValue: 'DELAYED_AT_RISK',
    reasonForChange: 'Vendor reported CNC milling tool breakdown. Projected delay of 3 days notified to Monday review team.'
  },
  {
    id: 'log-hist-005',
    scheduleId: 'sched-04',
    poNumber: 'PO-88104',
    componentCode: '100301',
    componentDescription: 'Stator Core Sub-Assembly 24V',
    vendorName: 'Lucas TVS Ltd',
    changedBy: 'Amit Patel (Buyer - Electricals)',
    changedAt: '05 Aug 2026, 09:15:30',
    fieldChanged: 'Expected Delivery Date (-1 day shift)',
    oldValue: '2026-08-11',
    newValue: '2026-08-10',
    reasonForChange: 'Supplier pre-poned batch dispatch by 24 hours following plant expedite request.'
  }
];


