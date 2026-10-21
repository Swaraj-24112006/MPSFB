import React, { useState } from 'react';
import {
  Factory,
  Layers,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Truck,
  TrendingUp,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  MessageSquare,
  Plus,
  Edit3,
  Trash2,
  Download,
  PhoneCall,
  User,
  Building,
  ArrowRight,
  Package,
  AlertCircle,
  HelpCircle,
  Sparkles,
  Lock,
  Unlock,
  History,
  Share2,
  FileSpreadsheet,
  Info,
  Check,
  X,
  ShieldCheck,
  ShieldX,
  Eye,
  EyeOff,
  Zap,
  Radio,
  Compass,
  PanelLeftClose,
  PanelLeftOpen,
  Maximize2,
  BarChart3,
  Sliders,
  Flame,
  Bell,
  ChevronUp,
  CheckCheck
} from 'lucide-react';
import {
  MonthlyPlanItem,
  WeekDefinition,
  BOMItem,
  VendorBuyerItem,
  MB51TransactionItem,
  StockReportItem,
  VendorDeliverySchedule,
  VendorDeliveryScheduleChangeLog,
  DeliveryCommitmentStatus,
  MondayReviewActionItem,
  FGPlanFreezeItem,
  PlanFreezeStatus,
  MondayReviewStatus,
  MondayReviewIssueType,
  FGWeekProductionCockpitItem,
  ExplodedBOMComponentSummary,
  UserRole,
  USER_ROLES
} from '../../types';
import { computeMondayReviewCockpit } from '../../utils/mondayReviewEngine';
import { BOMGanttChart, MultiComponentMasterGantt } from './BOMGanttChart';
import { HistoryDrawer, HistoryDrawerFilter } from './HistoryDrawer';
import { SupplyRiskHeatmap } from './SupplyRiskHeatmap';

interface MondayReviewCockpitProps {
  monthlyPlans: MonthlyPlanItem[];
  weeks: WeekDefinition[];
  boms: BOMItem[];
  vendorBuyers: VendorBuyerItem[];
  mb51List: MB51TransactionItem[];
  stockList: StockReportItem[];
  vendorDeliverySchedules: VendorDeliverySchedule[];
  onUpdateVendorDeliverySchedules: (schedules: VendorDeliverySchedule[]) => void;
  mondayReviewActions: MondayReviewActionItem[];
  onUpdateMondayReviewActions: (actions: MondayReviewActionItem[]) => void;
  planFreezeList: FGPlanFreezeItem[];
  onUpdatePlanFreezeList: (freezeList: FGPlanFreezeItem[]) => void;
  deliveryScheduleChangeLogs: VendorDeliveryScheduleChangeLog[];
  onUpdateDeliveryScheduleChangeLogs: (logs: VendorDeliveryScheduleChangeLog[]) => void;
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  currentRole?: UserRole;
  onSelectRole?: (role: UserRole) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  openingStockDate?: string;
  onUpdateOpeningStockDate?: (date: string) => void;
}

export const MondayReviewCockpit: React.FC<MondayReviewCockpitProps> = ({
  monthlyPlans,
  weeks,
  boms,
  vendorBuyers,
  mb51List,
  stockList,
  vendorDeliverySchedules,
  onUpdateVendorDeliverySchedules,
  mondayReviewActions,
  onUpdateMondayReviewActions,
  planFreezeList,
  onUpdatePlanFreezeList,
  deliveryScheduleChangeLogs,
  onUpdateDeliveryScheduleChangeLogs,
  selectedMonth,
  onSelectMonth,
  currentRole = 'supply_planner',
  onSelectRole,
  isSidebarCollapsed = true,
  onToggleSidebar,
  openingStockDate,
  onUpdateOpeningStockDate
}) => {
  // Role-Based Access Control (RBAC)
  const isSupplyPlanner = currentRole === 'supply_planner';
  const currentRoleDef = USER_ROLES.find((r) => r.id === currentRole) || USER_ROLES[1];

  // Top Filter States
  const [selectedWeekId, setSelectedWeekId] = useState<string>('w-2026-08-02'); // Default Week 2
  const [selectedMiniFactory, setSelectedMiniFactory] = useState<string>('ALL');
  const [criticalityFilter, setCriticalityFilter] = useState<
    'ALL' | 'CRITICAL_ONLY' | 'NEXT_WEEK_RISK' | 'FORWARD_HORIZON' | 'INADEQUATE_ONLY' | 'READY_ONLY' | 'FROZEN_ONLY' | 'ESCALATIONS_ONLY'
  >('ALL');
  const [horizonFilter, setHorizonFilter] = useState<'CURRENT_WEEK' | 'NEXT_WEEK_AT_RISK' | 'ALL_WEEKS'>('CURRENT_WEEK');
  const [hideOkMaterials, setHideOkMaterials] = useState<boolean>(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Supply Risk Heatmap state (Default collapsed as per landing page attachment)
  const [isHeatmapExpanded, setIsHeatmapExpanded] = useState<boolean>(false);
  const [vendorHeatmapFilter, setVendorHeatmapFilter] = useState<string | null>(null);

  // Accordion Expand State: which FGs have their BOM exploded (Default all collapsed as per landing page attachment)
  const [expandedFGMap, setExpandedFGMap] = useState<Record<string, boolean>>({});

  // Prominent Notification Section State (Role Attention Radar)
  const [isNotificationExpanded, setIsNotificationExpanded] = useState<boolean>(true);
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState<boolean>(false);

  // View Mode per FG: 'TABLE' or 'GANTT' (Small compact Gantt Matrix)
  const [fgViewModeMap, setFgViewModeMap] = useState<Record<string, 'TABLE' | 'GANTT'>>({});

  // Modals
  // 1. Discuss & Escalation Action Modal
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [actionFormData, setActionFormData] = useState<{
    fgCode: string;
    componentCode: string;
    issueType: MondayReviewIssueType;
    description: string;
    impactSummary: string;
    status: MondayReviewStatus;
    resolutionNotes: string;
    agreedAction: string;
    assignedOwner: string;
    targetResolutionDate: string;
    escalatedTo: string;
  }>({
    fgCode: '',
    componentCode: '',
    issueType: 'RM_SHORTAGE',
    description: '',
    impactSummary: '',
    status: 'AMICABLE_SOLUTION_AGREED',
    resolutionNotes: '',
    agreedAction: '',
    assignedOwner: 'Rajesh Kumar (Buyer)',
    targetResolutionDate: '2026-08-12',
    escalatedTo: ''
  });

  // 2. Delivery Schedule Edit / Reschedule Modal with Mandatory Audit Log Reason
  const [isDeliveryModalOpen, setIsDeliveryModalOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [deliveryFormData, setDeliveryFormData] = useState<{
    scheduleRefId: string;
    componentCode: string;
    componentDescription: string;
    vendorCode: string;
    vendorName: string;
    buyerName: string;
    expectedDeliveryDate: string;
    weekId: string;
    promisedQty: number;
    carrierOrTracking: string;
    deliveryStatus: 'CONFIRMED_ON_TRACK' | 'IN_TRANSIT' | 'PARTIAL_PROMISE' | 'DELAYED_AT_RISK' | 'CRITICAL_NO_PO';
    notes: string;
    plannerName: string;
    reasonForChange: string;
  }>({
    scheduleRefId: '',
    componentCode: '',
    componentDescription: '',
    vendorCode: '',
    vendorName: '',
    buyerName: '',
    expectedDeliveryDate: '2026-08-11',
    weekId: 'w-2026-08-02',
    promisedQty: 1000,
    carrierOrTracking: 'Direct Truck Delivery',
    deliveryStatus: 'CONFIRMED_ON_TRACK',
    notes: '',
    plannerName: 'Vikram Mehta (Supply Planner)',
    reasonForChange: 'Vendor expedited delivery batch to support weekly assembly line plan.'
  });

  // 3. Plan Freeze Confirmation Modal
  const [isFreezeModalOpen, setIsFreezeModalOpen] = useState(false);
  const [freezeTargetFG, setFreezeTargetFG] = useState<{
    fgCode: string;
    fgDescription: string;
    grossTarget: number;
    currentStatus: PlanFreezeStatus;
  } | null>(null);
  const [freezePlannerName, setFreezePlannerName] = useState('Vikram Mehta (Supply Planner)');
  const [freezeNotes, setFreezeNotes] = useState('Plan frozen for Week 2 production. BOM stock reserved.');

  // 4. Inline History Drawer & Change Audit State
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [historyDrawerFilter, setHistoryDrawerFilter] = useState<HistoryDrawerFilter | null>(null);

  const handleOpenHistoryDrawer = (filter?: HistoryDrawerFilter) => {
    setHistoryDrawerFilter(filter || null);
    setIsHistoryDrawerOpen(true);
  };

  // 5. Common Parts Reservation Matrix Modal
  const [isCommonPartsModalOpen, setIsCommonPartsModalOpen] = useState(false);

  // 6. Expandable Component Sub-Rows in BOM Table
  const [expandedCompIds, setExpandedCompIds] = useState<Record<string, boolean>>({});
  // Sub-tabs in expanded view: 'GANTT' | 'SCHEDULES' | 'STOCK_EQUATION'
  const [compExpandedTab, setCompExpandedTab] = useState<Record<string, 'GANTT' | 'SCHEDULES' | 'STOCK_EQUATION'>>({});

  const toggleCompExpand = (compId: string) => {
    setExpandedCompIds((prev) => ({ ...prev, [compId]: !prev[compId] }));
  };
  const toggleAllCompExpandForFG = (compIds: string[], expand: boolean) => {
    setExpandedCompIds((prev) => {
      const next = { ...prev };
      compIds.forEach((id) => {
        next[id] = expand;
      });
      return next;
    });
  };

  const setComponentSubTab = (compId: string, tab: 'GANTT' | 'SCHEDULES' | 'STOCK_EQUATION') => {
    setCompExpandedTab((prev) => ({ ...prev, [compId]: tab }));
  };

  // 1-Click Update handler for Delivery Schedule directly from the Gantt chart simulator
  const handleUpdateSingleDeliverySchedule = (updatedSchedule: VendorDeliverySchedule) => {
    const exists = vendorDeliverySchedules.some((s) => s.id === updatedSchedule.id);
    let updatedList: VendorDeliverySchedule[];
    if (exists) {
      updatedList = vendorDeliverySchedules.map((s) => (s.id === updatedSchedule.id ? updatedSchedule : s));
    } else {
      updatedList = [...vendorDeliverySchedules, updatedSchedule];
    }
    onUpdateVendorDeliverySchedules(updatedList);

    // Audit log
    const changeLog: VendorDeliveryScheduleChangeLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      scheduleId: updatedSchedule.id,
      poNumber: updatedSchedule.poNumber || updatedSchedule.id,
      componentCode: updatedSchedule.componentCode,
      componentDescription: updatedSchedule.vendorName,
      vendorName: updatedSchedule.vendorName,
      changedBy: currentRoleDef.label,
      changedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      fieldChanged: 'Expected Delivery Date / Quantity (Gantt Schedule Alignment)',
      oldValue: updatedSchedule.expectedDeliveryDate,
      newValue: updatedSchedule.expectedDeliveryDate,
      reasonForChange: updatedSchedule.notes || 'Adjusted arrival date on Gantt chart to meet per-day production run'
    };
    onUpdateDeliveryScheduleChangeLogs([changeLog, ...deliveryScheduleChangeLogs]);
  };


  // Compute Engine Output
  const cockpit = computeMondayReviewCockpit(
    selectedMonth,
    selectedWeekId,
    monthlyPlans,
    weeks,
    boms,
    vendorBuyers,
    mb51List,
    stockList,
    vendorDeliverySchedules,
    mondayReviewActions,
    planFreezeList,
    openingStockDate
  );

  // Identify all "OK" Finished Goods (100% component availability, no deficits, max buildable covers gross target)
  const okFGs = cockpit.cockpitItems.filter(
    (fg) =>
      fg.freezeStatus !== 'FROZEN' &&
      fg.criticalComponentsCount === 0 &&
      fg.maxBuildableFGWithDeliveries >= fg.totalWeekGrossTarget
  );

  // System-Generated Auto-Freeze for all OK Lines
  const handleAutoFreezeAllOkPlans = () => {
    if (okFGs.length === 0) {
      alert('No unfreezed OK Finished Goods found. All remaining lines either have component deficits or are already frozen.');
      return;
    }

    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const okFgCodes = new Set(okFGs.map((f) => f.fgCode));

    const remaining = planFreezeList.filter(
      (f) => !(okFgCodes.has(f.fgCode) && f.month === selectedMonth && f.weekId === selectedWeekId)
    );

    const newFrozen: FGPlanFreezeItem[] = okFGs.map((fg) => ({
      fgCode: fg.fgCode,
      month: selectedMonth,
      weekId: selectedWeekId,
      status: 'FROZEN',
      frozenAt: nowTime,
      frozenBy: 'System Auto-Rule (All Materials OK)',
      freezeNotes: `Auto-frozen by System: Verified 100% component stock and inward delivery coverage for ${fg.totalWeekGrossTarget.toLocaleString()} units. No review discussion needed.`
    }));

    onUpdatePlanFreezeList([...remaining, ...newFrozen]);
  };

  // 1-Click single FG Auto-Freeze
  const handleAutoFreezeSingleFG = (fg: FGWeekProductionCockpitItem) => {
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const remaining = planFreezeList.filter(
      (f) => !(f.fgCode === fg.fgCode && f.month === selectedMonth && f.weekId === selectedWeekId)
    );
    const newFreezeItem: FGPlanFreezeItem = {
      fgCode: fg.fgCode,
      month: selectedMonth,
      weekId: selectedWeekId,
      status: 'FROZEN',
      frozenAt: nowTime,
      frozenBy: 'System Auto-Rule (All Materials OK)',
      freezeNotes: `Auto-frozen by System: Verified 100% component availability for ${fg.totalWeekGrossTarget.toLocaleString()} units. No discussion needed.`
    };
    onUpdatePlanFreezeList([...remaining, newFreezeItem]);
  };

  // Mini-Factories List
  const miniFactories = ['ALL', 'Pumps_Division', 'Valves_Division', 'Oil_Systems', 'EGR_Division'];

  // Months available
  const availableMonths = ['2026-07', '2026-08', '2026-09'];

  // Helper date formatter
  const formatDateDisplay = (dateStr?: string) => {
    if (!dateStr) return '-';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const year = parts[0];
        const monthNum = parseInt(parts[1], 10);
        const day = parts[2];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthName = months[monthNum - 1] || parts[1];
        return `${day}-${monthName}-${year}`;
      }
      return dateStr;
    } catch {
      return dateStr;
    }
  };

  // Toggle Accordion
  const toggleFGExpand = (fgCode: string) => {
    setExpandedFGMap((prev) => ({
      ...prev,
      [fgCode]: !prev[fgCode]
    }));
  };

  // Expand / Collapse All
  const handleExpandAll = (expand: boolean) => {
    const newMap: Record<string, boolean> = {};
    cockpit.cockpitItems.forEach((item) => {
      newMap[item.fgCode] = expand;
    });
    setExpandedFGMap(newMap);
  };

  // Filter Items
  const filteredCockpitItems = cockpit.cockpitItems.filter((item) => {
    if (selectedMiniFactory !== 'ALL' && item.miniFactory !== selectedMiniFactory) {
      return false;
    }
    if (horizonFilter === 'NEXT_WEEK_AT_RISK' && !item.hasNextWeekRisk) {
      return false;
    }
    if (criticalityFilter === 'CRITICAL_ONLY' && item.criticalComponentsCount === 0) {
      return false;
    }
    if (criticalityFilter === 'NEXT_WEEK_RISK' && !item.hasNextWeekRisk) {
      return false;
    }
    if (criticalityFilter === 'FORWARD_HORIZON' && !item.explodedBOM.some((b) => b.hasForwardRisk)) {
      return false;
    }
    if (criticalityFilter === 'INADEQUATE_ONLY' && item.fgHealthStatus !== 'INADEQUATE_SCHEDULE') {
      return false;
    }
    if (criticalityFilter === 'READY_ONLY' && item.fgHealthStatus !== 'CLEAR_SEAMLESS') {
      return false;
    }
    if (criticalityFilter === 'FROZEN_ONLY' && item.freezeStatus !== 'FROZEN') {
      return false;
    }
    if (criticalityFilter === 'ESCALATIONS_ONLY' && !item.hasActiveEscalations) {
      return false;
    }
    if (vendorHeatmapFilter) {
      const term = vendorHeatmapFilter.toLowerCase();
      const matchVendor = item.explodedBOM.some(
        (b) =>
          b.vendorName.toLowerCase().includes(term) ||
          b.vendorCode.toLowerCase() === term
      );
      if (!matchVendor) {
        return false;
      }
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchFG =
        item.fgCode.toLowerCase().includes(term) ||
        item.fgDescription.toLowerCase().includes(term) ||
        (item.customerName && item.customerName.toLowerCase().includes(term));
      const matchBOM = item.explodedBOM.some(
        (b) =>
          b.componentCode.toLowerCase().includes(term) ||
          b.componentDescription.toLowerCase().includes(term) ||
          b.vendorName.toLowerCase().includes(term) ||
          b.buyerName.toLowerCase().includes(term)
      );
      return matchFG || matchBOM;
    }
    return true;
  });

  // Open Discuss Modal
  const handleOpenDiscussModal = (
    fg: FGWeekProductionCockpitItem,
    comp?: ExplodedBOMComponentSummary
  ) => {
    const existingAction = comp
      ? mondayReviewActions.find((a) => a.fgCode === fg.fgCode && a.componentCode === comp.componentCode)
      : mondayReviewActions.find((a) => a.fgCode === fg.fgCode && !a.componentCode);

    if (existingAction) {
      setActionFormData({
        fgCode: fg.fgCode,
        componentCode: comp ? comp.componentCode : '',
        issueType: existingAction.issueType,
        description: existingAction.description,
        impactSummary: existingAction.impactSummary,
        status: existingAction.status,
        resolutionNotes: existingAction.resolutionNotes,
        agreedAction: existingAction.agreedAction,
        assignedOwner: existingAction.assignedOwner,
        targetResolutionDate: existingAction.targetResolutionDate,
        escalatedTo: existingAction.escalatedTo || ''
      });
    } else {
      const defaultImpact = comp
        ? `Deficit of ${Math.abs(comp.stockDeficit).toLocaleString()} ${comp.uom} limits production to ${comp.projectedCoverageFgUnits.toLocaleString()} FGs (Target: ${fg.totalWeekGrossTarget.toLocaleString()})`
        : `Week ${cockpit.selectedWeek.weekNo} gross target is ${fg.totalWeekGrossTarget.toLocaleString()} units (including prior backlog of ${fg.priorBacklog.toLocaleString()}).`;

      setActionFormData({
        fgCode: fg.fgCode,
        componentCode: comp ? comp.componentCode : '',
        issueType: comp ? 'RM_SHORTAGE' : 'BACKLOG_RECOVERY',
        description: comp
          ? `Shortage of component ${comp.componentCode} (${comp.componentDescription}) from vendor ${comp.vendorName}.`
          : `Review production plan and component alignment for ${fg.fgDescription}.`,
        impactSummary: defaultImpact,
        status: 'AMICABLE_SOLUTION_AGREED',
        resolutionNotes: '',
        agreedAction: comp
          ? `Supplier ${comp.vendorName} to expedite batch via express transit before Wednesday morning shift.`
          : 'Production line to sequence high-stock variants first while inward arrives.',
        assignedOwner: comp ? `${comp.buyerName} (Buyer)` : 'Vikram Mehta (Supply Planner)',
        targetResolutionDate: `${selectedMonth}-12`,
        escalatedTo: ''
      });
    }

    setIsActionModalOpen(true);
  };

  // Save Discuss Action
  const handleSaveAction = (e: React.FormEvent) => {
    e.preventDefault();
    const nowIso = new Date().toISOString();
    const targetFG = cockpit.cockpitItems.find((item) => item.fgCode === actionFormData.fgCode);

    const newActionItem: MondayReviewActionItem = {
      id: `act-${Date.now()}`,
      month: selectedMonth,
      weekId: selectedWeekId,
      fgCode: actionFormData.fgCode,
      fgDescription: targetFG ? targetFG.fgDescription : 'Finished Good',
      componentCode: actionFormData.componentCode || undefined,
      componentDescription: actionFormData.componentCode
        ? targetFG?.explodedBOM.find((b) => b.componentCode === actionFormData.componentCode)?.componentDescription
        : undefined,
      issueType: actionFormData.issueType,
      description: actionFormData.description,
      impactSummary: actionFormData.impactSummary,
      status: actionFormData.status,
      resolutionNotes: actionFormData.resolutionNotes,
      agreedAction: actionFormData.agreedAction,
      assignedOwner: actionFormData.assignedOwner,
      targetResolutionDate: actionFormData.targetResolutionDate,
      escalatedTo: actionFormData.escalatedTo || undefined,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    const filtered = mondayReviewActions.filter(
      (a) =>
        !(
          a.fgCode === actionFormData.fgCode &&
          a.weekId === selectedWeekId &&
          (actionFormData.componentCode ? a.componentCode === actionFormData.componentCode : !a.componentCode)
        )
    );

    onUpdateMondayReviewActions([...filtered, newActionItem]);
    setIsActionModalOpen(false);
  };

  // Open Freeze Confirmation Modal
  const handleOpenFreezeModal = (fg: FGWeekProductionCockpitItem) => {
    setFreezeTargetFG({
      fgCode: fg.fgCode,
      fgDescription: fg.fgDescription,
      grossTarget: fg.totalWeekGrossTarget,
      currentStatus: fg.freezeStatus
    });
    setFreezePlannerName('Vikram Mehta (Supply Planner)');
    setFreezeNotes(
      fg.freezeStatus === 'FROZEN'
        ? 'Unfreezing plan to allow rescheduling.'
        : `Week ${cockpit.selectedWeek.weekNo} plan frozen with stock reserved for ${fg.totalWeekGrossTarget} units.`
    );
    setIsFreezeModalOpen(true);
  };

  // Confirm Freeze Action
  const handleConfirmFreeze = () => {
    if (!freezeTargetFG) return;

    const isCurrentlyFrozen = freezeTargetFG.currentStatus === 'FROZEN';
    const newStatus: PlanFreezeStatus = isCurrentlyFrozen ? 'DRAFT' : 'FROZEN';
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const updatedFreezeList = planFreezeList.filter(
      (f) => !(f.fgCode === freezeTargetFG.fgCode && f.month === selectedMonth && f.weekId === selectedWeekId)
    );

    if (newStatus === 'FROZEN') {
      const newFreezeItem: FGPlanFreezeItem = {
        fgCode: freezeTargetFG.fgCode,
        month: selectedMonth,
        weekId: selectedWeekId,
        status: 'FROZEN',
        frozenAt: nowTime,
        frozenBy: freezePlannerName,
        freezeNotes: freezeNotes
      };
      updatedFreezeList.push(newFreezeItem);
    }

    onUpdatePlanFreezeList(updatedFreezeList);
    setIsFreezeModalOpen(false);
  };

  // Open Edit / Add Delivery Schedule Modal
  const handleOpenDeliveryModal = (comp: ExplodedBOMComponentSummary, existingSched?: VendorDeliverySchedule) => {
    const defaultPlannerName = isSupplyPlanner
      ? 'Vikram Mehta (Supply Planner)'
      : currentRole === 'buyer'
      ? `${comp.buyerName || 'Rajesh Kumar'} (Buyer)`
      : `${currentRoleDef.label} (${currentRoleDef.shortLabel})`;

    if (existingSched) {
      setEditingScheduleId(existingSched.id);
      setDeliveryFormData({
        scheduleRefId: existingSched.id,
        componentCode: existingSched.componentCode,
        componentDescription: comp.componentDescription,
        vendorCode: existingSched.vendorCode,
        vendorName: existingSched.vendorName,
        buyerName: existingSched.buyerName || comp.buyerName,
        expectedDeliveryDate: existingSched.expectedDeliveryDate,
        weekId: existingSched.weekId || selectedWeekId,
        promisedQty: existingSched.promisedQty,
        carrierOrTracking: existingSched.carrierOrTracking || 'Direct Road Express',
        deliveryStatus: existingSched.deliveryStatus,
        notes: existingSched.notes || '',
        plannerName: defaultPlannerName,
        reasonForChange: 'Rescheduled arrival date & quantity commitment for weekly production plan.'
      });
    } else {
      setEditingScheduleId(null);
      setDeliveryFormData({
        scheduleRefId: `SCH-${Date.now().toString().slice(-6)}`,
        componentCode: comp.componentCode,
        componentDescription: comp.componentDescription,
        vendorCode: comp.vendorCode,
        vendorName: comp.vendorName,
        buyerName: comp.buyerName,
        expectedDeliveryDate: `${selectedMonth}-11`,
        weekId: selectedWeekId,
        promisedQty: Math.max(500, Math.abs(comp.stockDeficit) || 1000),
        carrierOrTracking: 'Direct Road Express',
        deliveryStatus: 'CONFIRMED_ON_TRACK',
        notes: 'Delivery commitment confirmed with vendor',
        plannerName: defaultPlannerName,
        reasonForChange: 'New delivery commitment assigned during Monday review.'
      });
    }
    setIsDeliveryModalOpen(true);
  };

  // Open Delivery Modal from Supply Risk Heatmap
  const handleOpenDeliveryModalFromHeatmap = (componentCode: string, schedule?: VendorDeliverySchedule) => {
    const defaultPlannerName = isSupplyPlanner ? 'Vikram Mehta (Supply Planner)' : `${currentRoleDef.label}`;
    const compStock = stockList.find((s) => s.partNumber === componentCode);
    const vendorBuyer = vendorBuyers.find((vb) => vb.suppliedComponents.includes(componentCode));

    if (schedule) {
      setEditingScheduleId(schedule.id);
      setDeliveryFormData({
        scheduleRefId: schedule.id,
        componentCode: schedule.componentCode,
        componentDescription: compStock?.materialDescription || `Component ${schedule.componentCode}`,
        vendorCode: schedule.vendorCode,
        vendorName: schedule.vendorName,
        buyerName: schedule.buyerName || vendorBuyer?.buyerName || 'Rajesh Kumar (Buyer)',
        expectedDeliveryDate: schedule.expectedDeliveryDate,
        weekId: schedule.weekId || selectedWeekId,
        promisedQty: schedule.promisedQty,
        carrierOrTracking: schedule.carrierOrTracking || 'Direct Road Express',
        deliveryStatus: schedule.deliveryStatus,
        notes: schedule.notes || '',
        plannerName: defaultPlannerName,
        reasonForChange: 'Rescheduled arrival date & quantity commitment from Supply Risk Heatmap.'
      });
    } else {
      setEditingScheduleId(null);
      setDeliveryFormData({
        scheduleRefId: `SCH-${Date.now().toString().slice(-6)}`,
        componentCode: componentCode,
        componentDescription: compStock?.materialDescription || `Component ${componentCode}`,
        vendorCode: vendorBuyer?.vendorCode || 'V-1001',
        vendorName: vendorBuyer?.vendorName || 'Vendor',
        buyerName: vendorBuyer?.buyerName || 'Rajesh Kumar (Buyer)',
        expectedDeliveryDate: `${selectedMonth}-11`,
        weekId: selectedWeekId,
        promisedQty: 1000,
        carrierOrTracking: 'Direct Road Express',
        deliveryStatus: 'CONFIRMED_ON_TRACK',
        notes: 'Delivery commitment logged from Supply Risk Heatmap',
        plannerName: defaultPlannerName,
        reasonForChange: 'New delivery commitment from Supply Risk Heatmap review.'
      });
    }
    setIsDeliveryModalOpen(true);
  };

  // Open Discuss / Escalation modal from Supply Risk Heatmap
  const handleOpenActionModalFromHeatmap = (vendorName: string, componentCode?: string) => {
    const matchedFG =
      cockpit.cockpitItems.find((fg) =>
        fg.explodedBOM.some((b) => b.vendorName === vendorName || (componentCode && b.componentCode === componentCode))
      ) || cockpit.cockpitItems[0];

    if (matchedFG) {
      const comp = componentCode ? matchedFG.explodedBOM.find((b) => b.componentCode === componentCode) : undefined;
      handleOpenDiscussModal(matchedFG, comp);
    }
  };

  // Cancel Existing Delivery Schedule with Reason & Timestamp
  const handleCancelDeliveryScheduleInModal = () => {
    if (!editingScheduleId) return;

    const cancelReason = deliveryFormData.reasonForChange.trim() || 'Delivery schedule cancelled by user during Monday review';

    const existing = vendorDeliverySchedules.find((s) => s.id === editingScheduleId);
    if (existing) {
      const now = new Date();
      const formattedTimestamp = `${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

      const logEntry: VendorDeliveryScheduleChangeLog = {
        id: `log-${Date.now()}`,
        scheduleId: existing.id,
        poNumber: existing.poNumber || 'SCH-CANCELLED',
        componentCode: existing.componentCode,
        componentDescription: deliveryFormData.componentDescription,
        vendorName: existing.vendorName,
        changedBy: deliveryFormData.plannerName || 'Planner',
        changedAt: formattedTimestamp,
        fieldChanged: 'Delivery Commitment Cancelled (0 pcs)',
        oldValue: `${existing.promisedQty} pcs on ${existing.expectedDeliveryDate} [${existing.deliveryStatus}]`,
        newValue: 'CANCELLED (0 pcs)',
        reasonForChange: cancelReason
      };

      onUpdateDeliveryScheduleChangeLogs([logEntry, ...deliveryScheduleChangeLogs]);

      const updatedSchedules = vendorDeliverySchedules.map((s) =>
        s.id === editingScheduleId
          ? {
              ...s,
              promisedQty: 0,
              deliveryStatus: 'CANCELLED' as DeliveryCommitmentStatus,
              notes: `Cancelled on ${formattedTimestamp}: ${cancelReason}`
            }
          : s
      );
      onUpdateVendorDeliverySchedules(updatedSchedules);
      setIsDeliveryModalOpen(false);
    }
  };

  // Save Delivery Schedule & Log Reason (Seamless Editing for All Roles)
  const handleSaveDeliverySchedule = (e: React.FormEvent) => {
    e.preventDefault();

    const changeReason = deliveryFormData.reasonForChange.trim() || 'Delivery commitment updated during Monday review.';

    const now = new Date();
    const formattedTimestamp = `${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

    if (editingScheduleId) {
      const existing = vendorDeliverySchedules.find((s) => s.id === editingScheduleId);
      if (existing) {
        // Create Audit Log
        const fieldChanges: string[] = [];
        if (existing.expectedDeliveryDate !== deliveryFormData.expectedDeliveryDate) {
          fieldChanges.push(`Arrival Date Changed (${existing.expectedDeliveryDate} -> ${deliveryFormData.expectedDeliveryDate})`);
        }
        if (existing.promisedQty !== deliveryFormData.promisedQty) {
          fieldChanges.push(`Promised Qty (${existing.promisedQty} -> ${deliveryFormData.promisedQty})`);
        }
        if (existing.deliveryStatus !== deliveryFormData.deliveryStatus) {
          fieldChanges.push(`Status (${existing.deliveryStatus} -> ${deliveryFormData.deliveryStatus})`);
        }
        if (existing.vendorName !== deliveryFormData.vendorName) {
          fieldChanges.push(`Vendor (${existing.vendorName} -> ${deliveryFormData.vendorName})`);
        }
        if (existing.buyerName !== deliveryFormData.buyerName) {
          fieldChanges.push(`Buyer (${existing.buyerName} -> ${deliveryFormData.buyerName})`);
        }

        const logEntry: VendorDeliveryScheduleChangeLog = {
          id: `log-${Date.now()}`,
          scheduleId: existing.id,
          poNumber: existing.poNumber || 'SCH-UPDATED',
          componentCode: existing.componentCode,
          componentDescription: deliveryFormData.componentDescription,
          vendorName: deliveryFormData.vendorName,
          changedBy: deliveryFormData.plannerName || 'Planner',
          changedAt: formattedTimestamp,
          fieldChanged: fieldChanges.join('; ') || 'Schedule Parameters Updated',
          oldValue: `${existing.promisedQty} pcs on ${existing.expectedDeliveryDate} [${existing.deliveryStatus}]`,
          newValue: `${deliveryFormData.promisedQty} pcs on ${deliveryFormData.expectedDeliveryDate} [${deliveryFormData.deliveryStatus}]`,
          reasonForChange: changeReason
        };

        onUpdateDeliveryScheduleChangeLogs([logEntry, ...deliveryScheduleChangeLogs]);

        const updatedSchedules = vendorDeliverySchedules.map((s) =>
          s.id === editingScheduleId
            ? {
                ...s,
                vendorName: deliveryFormData.vendorName,
                buyerName: deliveryFormData.buyerName,
                promisedQty: Number(deliveryFormData.promisedQty),
                expectedDeliveryDate: deliveryFormData.expectedDeliveryDate,
                deliveryStatus: deliveryFormData.deliveryStatus,
                carrierOrTracking: deliveryFormData.carrierOrTracking,
                notes: deliveryFormData.notes
              }
            : s
        );
        onUpdateVendorDeliverySchedules(updatedSchedules);
      }
    } else {
      const newSchedule: VendorDeliverySchedule = {
        id: `vds-${Date.now()}`,
        poNumber: `SCH-${Date.now().toString().slice(-6)}`,
        componentCode: deliveryFormData.componentCode,
        vendorCode: deliveryFormData.vendorCode,
        vendorName: deliveryFormData.vendorName,
        buyerName: deliveryFormData.buyerName,
        expectedDeliveryDate: deliveryFormData.expectedDeliveryDate,
        weekId: deliveryFormData.weekId,
        promisedQty: Number(deliveryFormData.promisedQty),
        carrierOrTracking: deliveryFormData.carrierOrTracking,
        deliveryStatus: deliveryFormData.deliveryStatus,
        notes: deliveryFormData.notes
      };

      const logEntry: VendorDeliveryScheduleChangeLog = {
        id: `log-${Date.now()}`,
        scheduleId: newSchedule.id,
        poNumber: newSchedule.poNumber,
        componentCode: newSchedule.componentCode,
        componentDescription: deliveryFormData.componentDescription,
        vendorName: newSchedule.vendorName,
        changedBy: deliveryFormData.plannerName || 'Planner',
        changedAt: formattedTimestamp,
        fieldChanged: 'New Delivery Commitment Created',
        oldValue: 'None',
        newValue: `${newSchedule.promisedQty} pcs on ${newSchedule.expectedDeliveryDate} [${newSchedule.deliveryStatus}]`,
        reasonForChange: changeReason
      };

      onUpdateDeliveryScheduleChangeLogs([logEntry, ...deliveryScheduleChangeLogs]);
      onUpdateVendorDeliverySchedules([...vendorDeliverySchedules, newSchedule]);
    }

    setIsDeliveryModalOpen(false);
  };

  // Delete Delivery Schedule
  const handleDeleteSchedule = (scheduleId: string) => {
    const existing = vendorDeliverySchedules.find((s) => s.id === scheduleId);
    if (!existing) return;

    const reason = prompt('Please enter reason for deleting/cancelling this delivery schedule:', 'Vendor cancelled order / Line rescheduled');
    if (reason === null) return;

    const now = new Date();
    const formattedTimestamp = `${now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}, ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

    const logEntry: VendorDeliveryScheduleChangeLog = {
      id: `log-${Date.now()}`,
      scheduleId: existing.id,
      poNumber: existing.poNumber || 'SCH-DELETED',
      componentCode: existing.componentCode,
      vendorName: existing.vendorName,
      changedBy: isSupplyPlanner ? 'Vikram Mehta (Supply Planner)' : `${currentRoleDef.label}`,
      changedAt: formattedTimestamp,
      fieldChanged: 'Schedule Removed / Deleted',
      oldValue: `${existing.promisedQty} pcs on ${existing.expectedDeliveryDate} [${existing.deliveryStatus}]`,
      newValue: 'REMOVED',
      reasonForChange: reason || 'Schedule removed during Monday review'
    };
    onUpdateDeliveryScheduleChangeLogs([logEntry, ...deliveryScheduleChangeLogs]);
    onUpdateVendorDeliverySchedules(vendorDeliverySchedules.filter((s) => s.id !== scheduleId));
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
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
      'Freeze Status'
    ];

    const rows = cockpit.cockpitItems.map((item) => {
      const priorPlan = item.priorWeeksBreakdown.reduce((sum, pw) => sum + pw.planTarget, 0);
      const priorActual = item.priorWeeksBreakdown.reduce((sum, pw) => sum + pw.actualProd, 0);
      const netGap = Math.max(0, item.totalWeekGrossTarget - item.maxBuildableFGWithDeliveries);
      const w3 = item.allWeeksDetail.find((w) => w.weekNo === 3)?.planTarget || 0;
      const w4 = item.allWeeksDetail.find((w) => w.weekNo === 4)?.planTarget || 0;

      return [
        item.fgCode,
        `"${item.fgDescription}"`,
        item.miniFactory,
        item.line,
        priorPlan,
        priorActual,
        item.priorBacklog,
        item.currentWeekPlanTarget,
        item.totalWeekGrossTarget,
        netGap,
        w3,
        w4,
        item.fgHealthStatus,
        item.freezeStatus
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Monday_Review_Cockpit_${selectedMonth}_${selectedWeekId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Extract all common parts across all FGs for the Common Parts Modal
  const allCommonPartsMap = new Map<
    string,
    {
      componentCode: string;
      componentDescription: string;
      category: string;
      uom: string;
      totalStock: number;
      sharedInFGs: { fgCode: string; fgDescription: string; usagePerFG: number }[];
      reservations: { fgCode: string; fgDescription: string; reservedQty: number }[];
    }
  >();

  cockpit.cockpitItems.forEach((fg) => {
    fg.explodedBOM.forEach((comp) => {
      if (comp.isCommonPart) {
        if (!allCommonPartsMap.has(comp.componentCode)) {
          allCommonPartsMap.set(comp.componentCode, {
            componentCode: comp.componentCode,
            componentDescription: comp.componentDescription,
            category: comp.category,
            uom: comp.uom,
            totalStock: comp.totalPhysicalStock,
            sharedInFGs: comp.sharedInFGs,
            reservations: comp.reservedByFGs.filter((r) => r.reservedQty > 0)
          });
        }
      }
    });
  });
  const commonPartsList = Array.from(allCommonPartsMap.values());

  // Manager Approval: Approve and freeze all draft plans for current week
  const handleManagerApproveAndFreezeAll = () => {
    const draftItems = cockpit.cockpitItems.filter((i) => i.freezeStatus === 'DRAFT');
    if (draftItems.length === 0) return;

    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newFreezes: FGPlanFreezeItem[] = draftItems.map((fg) => ({
      fgCode: fg.fgCode,
      month: selectedMonth,
      weekId: selectedWeekId,
      status: 'FROZEN',
      frozenAt: nowTime,
      frozenBy: `${currentRoleDef.label} (Approved)`,
      freezeNotes: `Weekly production target of ${fg.totalWeekGrossTarget} units officially approved & frozen by Plant Management.`
    }));

    const draftCodes = new Set(draftItems.map((d) => d.fgCode));
    const keptFreezes = planFreezeList.filter(
      (f) => !(f.month === selectedMonth && f.weekId === selectedWeekId && draftCodes.has(f.fgCode))
    );
    onUpdatePlanFreezeList([...keptFreezes, ...newFreezes]);
  };

  // Immediate Attention Tasks based on Active Role
  const computeRoleTasks = () => {
    const totalBacklogUnits = cockpit.cockpitItems.reduce((acc, item) => acc + (item.priorBacklog || 0), 0);
    const draftPlans = cockpit.cockpitItems.filter((i) => i.freezeStatus === 'DRAFT');
    const deficitItems = cockpit.cockpitItems.filter((i) => (i.totalWeekGrossTarget - i.maxBuildableFGWithDeliveries) > 0);
    const totalNetGap = deficitItems.reduce((acc, i) => acc + (i.totalWeekGrossTarget - i.maxBuildableFGWithDeliveries), 0);
    const overduePOs = vendorDeliverySchedules.filter(
      (s) => s.deliveryStatus === 'DELAYED_AT_RISK' || s.deliveryStatus === 'CRITICAL_NO_PO'
    );
    const commonPartsCount = allCommonPartsMap.size;
    const totalGrossTarget = cockpit.cockpitItems.reduce((acc, item) => acc + (item.totalWeekGrossTarget || 0), 0);

    switch (currentRole) {
      case 'management':
        return [
          {
            id: 'mgmt-freeze-approvals',
            priority: 'DECISION REQUIRED',
            priorityColor: 'amber' as const,
            metric: `${draftPlans.length} Draft Plans`,
            title: 'Pending Weekly Plan Freeze Approvals',
            description: `${draftPlans.length} Finished Goods (${draftPlans.map((d) => d.fgDescription.split(' ')[0]).join(', ') || 'Panther, FAM B, Oil Pump'}) have draft schedules ready for executive review & sign-off.`,
            actionLabel: draftPlans.length > 0 ? 'Approve & Freeze Plans' : 'All Plans Frozen',
            actionDisabled: draftPlans.length === 0,
            onAction: () => {
              if (draftPlans.length > 0) {
                handleManagerApproveAndFreezeAll();
              }
            },
            icon: Lock
          },
          {
            id: 'mgmt-volume-deficit',
            priority: 'OUTPUT DEFICIT',
            priorityColor: 'rose' as const,
            metric: `-${totalNetGap.toLocaleString()} Units Gap`,
            title: 'Critical Output Deficits & Customer SLA Risk',
            description: `Cumulative volume gap across ${deficitItems.length} lines threatens key delivery quotas for Tata Motors, Mahindra & Hyundai.`,
            actionLabel: 'Filter Deficit Lines',
            actionDisabled: false,
            onAction: () => setCriticalityFilter('CRITICAL_ONLY'),
            icon: AlertTriangle
          },
          {
            id: 'mgmt-escalations',
            priority: 'LINE STOPPAGE RISK',
            priorityColor: 'purple' as const,
            metric: `${cockpit.activeEscalationsCount || 2} Critical Issues`,
            title: 'Executive Line Stoppage Escalations',
            description: `Supplier bottlenecks (Casting housings & sintered rotors) require managerial arbitration and expedite sign-off.`,
            actionLabel: 'Arbitrate Escalations',
            actionDisabled: false,
            onAction: () => setCriticalityFilter('ESCALATIONS_ONLY'),
            icon: ShieldAlert
          }
        ];

      case 'demand_planner':
        return [
          {
            id: 'dp-backlog-realignment',
            priority: 'BACKLOG CARRYOVER',
            priorityColor: 'rose' as const,
            metric: `${totalBacklogUnits.toLocaleString()} Backlog Units`,
            title: 'W1 Production Backlog Carryovers',
            description: `${totalBacklogUnits.toLocaleString()} units unfulfilled from W1 (Panther: 108, FAM B: 56, Oil Pump: 1,400) require demand rebalancing into Week 2 gross targets.`,
            actionLabel: 'Inspect Backlog Lines',
            actionDisabled: false,
            onAction: () => {
              setSearchTerm('');
              setCriticalityFilter('ALL');
            },
            icon: Clock
          },
          {
            id: 'dp-runrate-gap',
            priority: 'RUN-RATE LAG',
            priorityColor: 'amber' as const,
            metric: '0% MTD Completion',
            title: 'Monthly Plan Run-Rate Pace Deficits',
            description: `Variable Flow Oil Pump has 0 / 6,200 units produced. Panther is at 22%. Requires W3/W4 volume shifts to secure customer SLAs.`,
            actionLabel: 'Focus Oil Pump Line',
            actionDisabled: false,
            onAction: () => setSearchTerm('7.02551.11.0'),
            icon: TrendingUp
          },
          {
            id: 'dp-gross-validation',
            priority: 'DEMAND TARGETS',
            priorityColor: 'blue' as const,
            metric: `${totalGrossTarget.toLocaleString()} Gross Target`,
            title: 'Validate W2 Customer Gross Production Targets',
            description: `Total Week 2 gross demand is ${totalGrossTarget.toLocaleString()} units across 3 OEM programs awaiting final customer order confirmation.`,
            actionLabel: 'Export Demand Summary',
            actionDisabled: false,
            onAction: () => handleExportCSV(),
            icon: Download
          }
        ];

      case 'supply_planner':
        return [
          {
            id: 'sp-rm-shortages',
            priority: 'LINE BLOCKER',
            priorityColor: 'rose' as const,
            metric: `${cockpit.inadequateDeliveryCount} Lines Inadequate`,
            title: 'Component Shortages Blocking Assembly',
            description: `${cockpit.inadequateDeliveryCount} Finished Goods have inadequate raw material stock & inward coverage (Housing Castings, Rotor Shafts, O-rings).`,
            actionLabel: hideOkMaterials ? 'Show All Components' : 'Show Shortages Only',
            actionDisabled: false,
            onAction: () => setHideOkMaterials(!hideOkMaterials),
            icon: AlertCircle
          },
          {
            id: 'sp-delayed-pos',
            priority: 'DELIVERY DELAY',
            priorityColor: 'amber' as const,
            metric: `${overduePOs.length} Overdue POs`,
            title: 'Delayed Vendor Delivery Commitments',
            description: `${overduePOs.length} purchase orders are delayed past line arrival date (Sundaram Fasteners PO-88241, GKN Sinter PO-88249).`,
            actionLabel: 'Open Supply Risk Heatmap',
            actionDisabled: false,
            onAction: () => setIsHeatmapExpanded(true),
            icon: Flame
          },
          {
            id: 'sp-common-parts',
            priority: 'STOCK CONTENTION',
            priorityColor: 'purple' as const,
            metric: `${commonPartsCount} Common Parts`,
            title: 'Common Components Contention',
            description: `${commonPartsCount} shared hardware & packaging items (Hex Screws, Corrugated Boxes) are contended across multiple lines.`,
            actionLabel: 'Open Common Parts Matrix',
            actionDisabled: false,
            onAction: () => setIsCommonPartsModalOpen(true),
            icon: Layers
          }
        ];

      case 'production':
      default:
        return [
          {
            id: 'prod-backlog-shift',
            priority: 'OVERTIME RUN-RATE',
            priorityColor: 'rose' as const,
            metric: `${totalBacklogUnits.toLocaleString()} Shortfall Units`,
            title: 'W1 Backlog Recovery Shift Targets',
            description: `${totalBacklogUnits.toLocaleString()} units shortfall from W1 must be absorbed through weekend overtime and supplementary line shifts.`,
            actionLabel: 'Inspect Backlog Lines',
            actionDisabled: false,
            onAction: () => {
              setSearchTerm('');
              setCriticalityFilter('ALL');
            },
            icon: Clock
          },
          {
            id: 'prod-takt-rates',
            priority: 'DAILY VELOCITY',
            priorityColor: 'emerald' as const,
            metric: '3 Active Lines',
            title: 'Enforce Daily Assembly Takt Rates',
            description: `Required daily output: Panther (394/day), FAM B (310/day), Oil Pump (467/day) across 6 operational days to meet gross targets.`,
            actionLabel: 'Focus Active Lines',
            actionDisabled: false,
            onAction: () => setCriticalityFilter('ALL'),
            icon: Factory
          },
          {
            id: 'prod-dock-inward',
            priority: 'DOCK STAGING',
            priorityColor: 'blue' as const,
            metric: '11-Aug Inward Priority',
            title: 'Mid-Week Component Inward Staging',
            description: `Expedited component shipments arriving Wednesday 11-Aug require priority GRN inspection & line replenishment.`,
            actionLabel: 'Track Shipments',
            actionDisabled: false,
            onAction: () => setIsHeatmapExpanded(true),
            icon: Truck
          }
        ];
    }
  };

  const roleTasks = computeRoleTasks();

  return (
    <div className="space-y-2.5 w-full">
      {/* 1. Header Control Bar (CLEAN 2-ROW LAYOUT - NO SCROLLER) */}
      <div className="bg-white border border-slate-200 rounded-lg p-2 space-y-2 shadow-xs">
        {/* ROW 1: Navigation, Horizon, Factory, Status, and Role */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Toggle Left Navigation Panel for Full-Screen */}
            {onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                title={isSidebarCollapsed ? 'Expand Navigation Sidebar' : 'Hide Navigation Sidebar (Max Full Screen)'}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold border transition-all cursor-pointer ${
                  isSidebarCollapsed
                    ? 'bg-slate-900 text-white border-slate-900 shadow-2xs hover:bg-slate-800'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {isSidebarCollapsed ? (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>Full Screen</span>
                  </>
                ) : (
                  <>
                    <PanelLeftClose className="w-3.5 h-3.5" />
                    <span>Hide Panel</span>
                  </>
                )}
              </button>
            )}

            {/* Month Dropdown */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-medium text-[11px]">Month:</span>
              <select
                value={selectedMonth}
                onChange={(e) => onSelectMonth(e.target.value)}
                className="bg-transparent font-bold text-slate-900 focus:outline-hidden cursor-pointer text-xs"
              >
                {availableMonths.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            {/* Baseline Opening Stock Date Badge */}
            {openingStockDate && (
              <div
                className="flex items-center gap-1.5 bg-teal-50 border border-teal-200 rounded px-2 py-1 text-xs text-teal-800"
                title="Opening Stock Baseline Date (SAP MB52 Point-in-Time Snapshot Date). MB51 movements before this date are already counted in physical inventory."
              >
                <Calendar className="w-3.5 h-3.5 text-teal-600" />
                <span className="font-medium text-[11px]">Baseline:</span>
                <input
                  type="date"
                  value={openingStockDate}
                  onChange={(e) => onUpdateOpeningStockDate?.(e.target.value)}
                  className="bg-white border border-teal-300 rounded px-1 py-0.5 text-[11px] font-mono font-bold text-teal-900 focus:outline-hidden cursor-pointer"
                />
              </div>
            )}

            {/* Week Selector Tabs */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded border border-slate-200 text-xs">
              {cockpit.monthWeeks.map((w) => {
                const isSelected = w.id === cockpit.selectedWeek.id;
                return (
                  <button
                    key={w.id}
                    onClick={() => setSelectedWeekId(w.id)}
                    className={`px-2.5 py-1 rounded font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-900 text-white shadow-xs font-bold'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200'
                    }`}
                  >
                    {w.weekLabel}
                    {w.weekNo === 2 && (
                      <span className="ml-1 text-[10px] opacity-80 font-normal">(Review)</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Review Horizon Selector */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700">
              <Radio className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-medium text-[11px]">Horizon:</span>
              <select
                value={horizonFilter}
                onChange={(e) => setHorizonFilter(e.target.value as any)}
                className="bg-transparent font-semibold text-slate-900 focus:outline-hidden cursor-pointer text-xs"
              >
                <option value="CURRENT_WEEK">Current Week (W{cockpit.selectedWeek.weekNo} Focus)</option>
                <option value="NEXT_WEEK_AT_RISK">
                  ⚡ Next Week Radar ({cockpit.nextWeekCriticalFGsCount} Deficits)
                </option>
                <option value="ALL_WEEKS">Full Month (W1-W4)</option>
              </select>
            </div>

            {/* Mini-Factory Filter */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700">
              <Factory className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-medium text-[11px]">Factory:</span>
              <select
                value={selectedMiniFactory}
                onChange={(e) => setSelectedMiniFactory(e.target.value)}
                className="bg-transparent font-semibold text-slate-900 focus:outline-hidden cursor-pointer text-xs"
              >
                {miniFactories.map((mf) => (
                  <option key={mf} value={mf}>
                    {mf === 'ALL' ? 'All Divisions' : mf.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>

            {/* Criticality / Status Filter */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs text-slate-700">
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <span className="font-medium text-[11px]">Filter:</span>
              <select
                value={criticalityFilter}
                onChange={(e) => setCriticalityFilter(e.target.value as any)}
                className="bg-transparent font-semibold text-slate-900 focus:outline-hidden cursor-pointer text-xs"
              >
                <option value="ALL">All Lines ({cockpit.cockpitItems.length})</option>
                <option value="CRITICAL_ONLY">Current Week Deficits ({cockpit.criticalFGsCount})</option>
                <option value="NEXT_WEEK_RISK">⚠️ Next Week Deficits ({cockpit.nextWeekCriticalFGsCount})</option>
                <option value="INADEQUATE_ONLY">Inadequate Inward ({cockpit.inadequateDeliveryCount})</option>
                <option value="READY_ONLY">Clear & Seamless</option>
                <option value="FROZEN_ONLY">Frozen Plans ({cockpit.frozenFGsCount})</option>
                <option value="ESCALATIONS_ONLY">Escalations ({cockpit.activeEscalationsCount})</option>
              </select>
            </div>
          </div>
        </div>

        {/* ROW 2: RBAC Role & Prominent Notification Section (Immediate Attention Radar) */}
        <div className="space-y-2 border-t border-slate-100 pt-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            {/* RBAC Role Indicator Pill with Interactive Switcher Dropdown */}
            <div className="relative">
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border bg-slate-50 text-slate-800 border-slate-200 shadow-2xs"
              >
                <Info className="w-3.5 h-3.5 text-blue-600" />
                <span className="font-medium text-[11px] text-slate-500">Role:</span>
                <span className="font-bold text-slate-900">{currentRoleDef.label}</span>
                {onSelectRole && (
                  <button
                    onClick={() => setIsRoleMenuOpen(!isRoleMenuOpen)}
                    className="text-[11px] underline text-blue-600 hover:text-blue-800 ml-1 font-semibold cursor-pointer"
                    title="Switch active user role"
                  >
                    (Switch)
                  </button>
                )}
              </div>

              {/* Role Switcher Popover Dropdown */}
              {isRoleMenuOpen && (
                <div className="absolute left-0 top-full mt-1 w-72 bg-white rounded-lg shadow-xl border border-slate-200 p-1.5 z-40 space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 flex items-center justify-between">
                    <span>Select User Role</span>
                    <button
                      onClick={() => setIsRoleMenuOpen(false)}
                      className="text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  {USER_ROLES.map((r) => {
                    const isCurrent = r.id === currentRole;
                    return (
                      <button
                        key={r.id}
                        onClick={() => {
                          if (onSelectRole) onSelectRole(r.id);
                          setIsRoleMenuOpen(false);
                        }}
                        className={`w-full text-left px-2 py-1.5 rounded-md transition-all flex items-start gap-2 cursor-pointer ${
                          isCurrent
                            ? 'bg-blue-50 text-blue-900 border border-blue-200 font-bold'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <div className="mt-0.5">
                          {r.id === 'management' && <ShieldCheck className="w-3.5 h-3.5 text-purple-600" />}
                          {r.id === 'demand_planner' && <Layers className="w-3.5 h-3.5 text-blue-600" />}
                          {r.id === 'supply_planner' && <Truck className="w-3.5 h-3.5 text-amber-600" />}
                          {r.id === 'production' && <Factory className="w-3.5 h-3.5 text-emerald-600" />}
                        </div>
                        <div className="flex-1">
                          <div className="text-xs font-semibold flex items-center justify-between">
                            <span>{r.label}</span>
                            {isCurrent && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-600 text-white font-mono">
                                Active
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 font-normal leading-tight mt-0.5">
                            {r.description}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Notification Toggle & Attention Summary Chip */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsNotificationExpanded(!isNotificationExpanded)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold border transition-all cursor-pointer ${
                  isNotificationExpanded
                    ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-2xs hover:bg-amber-100'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
                title="Toggle Role Notification Radar"
              >
                <Bell className={`w-3.5 h-3.5 ${isNotificationExpanded ? 'text-amber-600 fill-amber-500' : 'text-slate-500'}`} />
                <span>
                  Immediate Attention ({roleTasks.length} Tasks)
                </span>
                {isNotificationExpanded ? (
                  <ChevronUp className="w-3 h-3 text-slate-500" />
                ) : (
                  <ChevronDown className="w-3 h-3 text-slate-500" />
                )}
              </button>
            </div>
          </div>

          {/* Prominent Notification Section (Role Attention Radar) */}
          {isNotificationExpanded && (
            <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white rounded-lg p-3 border border-slate-700 shadow-md animate-in fade-in duration-200">
              {/* Radar Section Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-700/60">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-amber-400/20 border border-amber-400/40 flex items-center justify-center text-amber-300">
                    <Bell className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-xs tracking-wide text-white uppercase">
                        {currentRoleDef.label} Attention Radar
                      </h4>
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/30 text-rose-300 border border-rose-400/40">
                        {roleTasks.length} Urgent Action Items
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      Immediate high-priority tasks requiring your review, execution, or sign-off for Week {cockpit.selectedWeek.weekNo}.
                    </p>
                  </div>
                </div>

                {/* Quick Role Switch Tabs & Collapse Button */}
                <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-md border border-slate-700 text-[11px]">
                  <span className="text-slate-400 px-1 font-medium">Switch Role:</span>
                  {USER_ROLES.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => onSelectRole && onSelectRole(r.id)}
                      className={`px-2 py-0.5 rounded transition-all cursor-pointer font-medium ${
                        currentRole === r.id
                          ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                          : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
                      }`}
                    >
                      {r.shortLabel}
                    </button>
                  ))}
                  <button
                    onClick={() => setIsNotificationExpanded(false)}
                    className="ml-1 p-1 text-slate-400 hover:text-white rounded hover:bg-slate-700/50 cursor-pointer"
                    title="Collapse Notification Section"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* 3 Prominent Action Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-2.5">
                {roleTasks.map((task) => {
                  const TaskIcon = task.icon;
                  return (
                    <div
                      key={task.id}
                      className="bg-slate-800/90 hover:bg-slate-800 rounded-lg p-2.5 border border-slate-700 flex flex-col justify-between transition-all hover:border-slate-500 shadow-xs"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${
                              task.priorityColor === 'rose'
                                ? 'bg-rose-950/70 text-rose-300 border-rose-800'
                                : task.priorityColor === 'amber'
                                ? 'bg-amber-950/70 text-amber-300 border-amber-800'
                                : task.priorityColor === 'emerald'
                                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800'
                                : task.priorityColor === 'purple'
                                ? 'bg-purple-950/70 text-purple-300 border-purple-800'
                                : 'bg-blue-950/70 text-blue-300 border-blue-800'
                            }`}
                          >
                            {task.priority}
                          </span>
                          <span className="font-mono text-xs font-bold text-amber-300">
                            {task.metric}
                          </span>
                        </div>
                        <h5 className="font-bold text-xs text-white flex items-center gap-1.5">
                          <TaskIcon className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span>{task.title}</span>
                        </h5>
                        <p className="text-[11px] text-slate-300 mt-1 leading-snug">
                          {task.description}
                        </p>
                      </div>

                      <div className="mt-2.5 pt-2 border-t border-slate-700/60 flex items-center justify-end">
                        <button
                          onClick={task.onAction}
                          disabled={task.actionDisabled}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                            task.actionDisabled
                              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                              : 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-xs active:scale-98'
                          }`}
                        >
                          <span>{task.actionLabel}</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ROW 2: Action Tools, Search, Toggles, Audit Log, Export, Expand/Collapse */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-t border-slate-100 pt-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Search Box */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Filter FG / Part / Buyer / Vendor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-7 pr-6 py-1 text-xs border border-slate-200 rounded w-48 focus:w-60 transition-all focus:outline-hidden focus:border-slate-400 bg-slate-50 focus:bg-white"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs cursor-pointer"
                >
                  ×
                </button>
              )}
            </div>

            {/* 1-Click Critical Materials Toggle */}
            <button
              onClick={() => setHideOkMaterials(!hideOkMaterials)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
                hideOkMaterials
                  ? 'bg-rose-50 border border-rose-300 text-rose-800 shadow-2xs'
                  : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {hideOkMaterials ? (
                <>
                  <Zap className="w-3 h-3 text-rose-600" />
                  <span>Showing Shortages Only</span>
                </>
              ) : (
                <>
                  <EyeOff className="w-3 h-3 text-slate-500" />
                  <span>Hide OK Parts</span>
                </>
              )}
            </button>

            {/* SYSTEM GENERATED FREEZE FOR OK FG (No discussion needed) */}
            {okFGs.length > 0 && (
              <button
                onClick={handleAutoFreezeAllOkPlans}
                title="System Auto-Freeze: Automatically lock all Finished Goods with 100% component availability."
                className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold transition-all shadow-2xs cursor-pointer"
              >
                <Zap className="w-3 h-3 text-emerald-200" />
                <span>Auto-Freeze OK Plans ({okFGs.length})</span>
              </button>
            )}

            {/* Supply Risk Heatmap Button */}
            <button
              onClick={() => setIsHeatmapExpanded(!isHeatmapExpanded)}
              title="Toggle Supply Risk Heatmap highlighting vendors with overdue delivery schedules"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer shadow-2xs ${
                isHeatmapExpanded
                  ? 'bg-rose-600 hover:bg-rose-700 text-white'
                  : 'bg-rose-50 border border-rose-300 text-rose-800 hover:bg-rose-100'
              }`}
            >
              <Flame className={`w-3.5 h-3.5 ${isHeatmapExpanded ? 'text-white animate-pulse' : 'text-rose-600'}`} />
              <span>Supply Risk Heatmap</span>
              {vendorDeliverySchedules.some((s) => s.deliveryStatus === 'DELAYED_AT_RISK' || s.deliveryStatus === 'CRITICAL_NO_PO') && (
                <span
                  className={`px-1.5 py-0.2 rounded-full font-mono text-[10px] font-extrabold ${
                    isHeatmapExpanded ? 'bg-white text-rose-800' : 'bg-rose-600 text-white'
                  }`}
                >
                  {
                    vendorDeliverySchedules.filter(
                      (s) => s.deliveryStatus === 'DELAYED_AT_RISK' || s.deliveryStatus === 'CRITICAL_NO_PO'
                    ).length
                  }{' '}
                  Overdue
                </span>
              )}
            </button>

            {/* Common Parts Inspector Button */}
            <button
              onClick={() => setIsCommonPartsModalOpen(true)}
              title="Inspect stock reserved for common parts across multiple frozen FGs"
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <Share2 className="w-3 h-3 text-slate-600" />
              <span>Common Parts Matrix ({commonPartsList.length})</span>
            </button>

            {/* Audit Trail Log Button */}
            <button
              onClick={() => handleOpenHistoryDrawer({ title: 'System-wide Delivery Schedule & Plan Audit Log' })}
              title="View all critical schedule changes, date shifts, and author modification logs"
              className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 border border-indigo-200 text-indigo-800 hover:bg-indigo-100 rounded text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
            >
              <History className="w-3.5 h-3.5 text-indigo-600" />
              <span>Change History ({deliveryScheduleChangeLogs.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Export CSV */}
            <button
              onClick={handleExportCSV}
              title="Download Monday review cockpit table as CSV"
              className="flex items-center gap-1 px-2.5 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-600" />
              <span>Export CSV</span>
            </button>

            {/* Expand / Collapse All Toggle */}
            <div className="flex items-center bg-slate-100 p-0.5 rounded border border-slate-200 text-xs">
              <button
                onClick={() => handleExpandAll(true)}
                title="Explode all FG BOMs"
                className="px-2 py-0.5 text-slate-700 hover:text-slate-900 rounded font-medium text-[11px] cursor-pointer"
              >
                Expand All
              </button>
              <button
                onClick={() => handleExpandAll(false)}
                title="Collapse all BOMs"
                className="px-2 py-0.5 text-slate-700 hover:text-slate-900 rounded font-medium text-[11px] cursor-pointer"
              >
                Collapse
              </button>
            </div>
          </div>
        </div>

        {/* Next Week Early Warning Radar Banner (Shown only when horizon is active) */}
        {(horizonFilter === 'NEXT_WEEK_AT_RISK' || criticalityFilter === 'NEXT_WEEK_RISK') && (
          <div className="mt-2 bg-amber-50/90 border border-amber-300 rounded-lg p-2.5 flex items-center justify-between text-xs text-amber-900 shadow-2xs">
            <div className="flex items-center gap-2">
              <div className="p-1 bg-amber-200/70 rounded-full text-amber-800">
                <Radio className="w-3.5 h-3.5 animate-pulse" />
              </div>
              <div>
                <span className="font-bold">Next Week (Week {cockpit.selectedWeek.weekNo + 1}) Early Warning Radar:</span>{' '}
                <span>
                  Showing {filteredCockpitItems.length} Finished Goods with impending raw material deficits in Week {cockpit.selectedWeek.weekNo + 1}. Reviewing next week in advance prevents assembly line starvation before it occurs!
                </span>
              </div>
            </div>
            <button
              onClick={() => {
                setHorizonFilter('CURRENT_WEEK');
                setCriticalityFilter('ALL');
              }}
              className="px-2.5 py-1 bg-white border border-amber-300 text-amber-800 rounded font-medium hover:bg-amber-100 whitespace-nowrap cursor-pointer"
            >
              Reset to Current Week
            </button>
          </div>
        )}
      </div>

      {/* 2. Color-Coded Supply Risk Heatmap (Overdue Delivery Schedules Tracker) */}
      {isHeatmapExpanded && (
        <SupplyRiskHeatmap
          vendorDeliverySchedules={vendorDeliverySchedules}
          vendorBuyers={vendorBuyers}
          boms={boms}
          monthlyPlans={monthlyPlans}
          weeks={weeks}
          selectedMonth={selectedMonth}
          selectedWeekId={selectedWeekId}
          stockList={stockList}
          mb51List={mb51List}
          planFreezeList={planFreezeList}
          deliveryScheduleChangeLogs={deliveryScheduleChangeLogs}
          activeVendorFilter={vendorHeatmapFilter}
          onSelectVendorFilter={(vendorNameOrCode) => setVendorHeatmapFilter(vendorNameOrCode)}
          onOpenHistoryDrawer={handleOpenHistoryDrawer}
          onOpenDeliveryModal={handleOpenDeliveryModalFromHeatmap}
          onOpenActionModal={handleOpenActionModalFromHeatmap}
        />
      )}

      {/* 3. Main Tabular Cockpit */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold tracking-tight">
                <th className="py-2.5 px-3 w-8 text-center">BOM</th>
                <th className="py-2.5 px-3 min-w-[130px]">FG Part No.</th>
                <th className="py-2.5 px-3 min-w-[180px]">FG Description</th>
                <th className="py-2.5 px-3 min-w-[140px] w-36">Monthly Plan Completion</th>
                <th className="py-2.5 px-2 text-right w-20">Prior Plan</th>
                <th className="py-2.5 px-2 text-right w-24">Prior Actual (101)</th>
                <th className="py-2.5 px-2 text-right w-24">Prior Backlog</th>
                <th className="py-2.5 px-2 text-right w-20">W{cockpit.selectedWeek.weekNo} Plan</th>
                <th className="py-2.5 px-2 text-right w-24 bg-slate-200/60 font-bold text-slate-900">
                  Gross Target
                </th>
                <th className="py-2.5 px-2 text-right w-20">Net Gap</th>
                <th className="py-2.5 px-2 text-center w-16">W3 Plan</th>
                <th className="py-2.5 px-2 text-center w-16">W4 Plan</th>
                <th className="py-2.5 px-2 text-center w-24">Health</th>
                <th className="py-2.5 px-2 text-center w-20">Freeze</th>
                <th className="py-2.5 px-3 text-right w-36">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredCockpitItems.length === 0 ? (
                <tr>
                  <td colSpan={15} className="py-8 text-center text-slate-400">
                    No Finished Goods matched the selected filters.
                  </td>
                </tr>
              ) : (
                filteredCockpitItems.map((fg) => {
                  const isExpanded = !!expandedFGMap[fg.fgCode];
                  const isFrozen = fg.freezeStatus === 'FROZEN';
                  const netGap = Math.max(0, fg.totalWeekGrossTarget - fg.maxBuildableFGWithDeliveries);

                  // Prior Weeks Plan, Actual 101, and Backlog calculations
                  const priorPlanSum = fg.priorWeeksBreakdown.reduce((sum, pw) => sum + pw.planTarget, 0);
                  const priorActualSum = fg.priorWeeksBreakdown.reduce((sum, pw) => sum + pw.actualProd, 0);
                  const priorBacklogSum = fg.priorBacklog;

                  // Total Month Plan & Cumulative Completed 101 Production
                  const totalMonthlyPlan = fg.monthlyTarget || fg.allWeeksDetail.reduce((sum, w) => sum + w.planTarget, 0) || 1;
                  const totalCompletedActual = priorActualSum + (fg.currentWeekActualProd || 0);
                  const monthlyProgressPercent = Math.min(100, Math.round((totalCompletedActual / totalMonthlyPlan) * 100));
                  const progressExact = ((totalCompletedActual / totalMonthlyPlan) * 100).toFixed(1);
                  const remainingMonthlyTarget = Math.max(0, totalMonthlyPlan - totalCompletedActual);

                  // Future weeks
                  const w3 = fg.allWeeksDetail.find((w) => w.weekNo === 3);
                  const w4 = fg.allWeeksDetail.find((w) => w.weekNo === 4);

                  return (
                    <React.Fragment key={fg.fgCode}>
                      {/* Main FG Row */}
                      <tr
                        className={`hover:bg-slate-50 transition-colors ${
                          isExpanded ? 'bg-slate-50/70 border-b border-slate-200' : ''
                        } ${isFrozen ? 'bg-emerald-50/20' : ''}`}
                      >
                        {/* Expand Button */}
                        <td className="py-2.5 px-3 text-center">
                          <button
                            onClick={() => toggleFGExpand(fg.fgCode)}
                            title={isExpanded ? 'Collapse BOM' : 'Explode BOM & Schedules'}
                            className="p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-200 rounded transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-800" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </td>

                        {/* FG Part Number (Separate Column) */}
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900">
                          <div className="flex items-center gap-1.5">
                            <span>{fg.fgCode}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono font-normal">
                              {fg.line}
                            </span>
                            {fg.customerName && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium truncate max-w-[85px]"
                                title={`Customer: ${fg.customerName}`}
                              >
                                {fg.customerName}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* FG Description (Separate Column) */}
                        <td className="py-2.5 px-3 text-slate-700 font-normal truncate max-w-[200px]" title={fg.fgDescription}>
                          {fg.fgDescription}
                        </td>

                        {/* Monthly Production Plan Completion Progress Bar */}
                        <td className="py-2.5 px-3 min-w-[140px] max-w-[170px]">
                          <div
                            className="flex flex-col gap-1 cursor-help"
                            title={`Monthly Plan Completion Summary for ${fg.fgCode}:\n• Total Monthly Target: ${totalMonthlyPlan.toLocaleString()} units\n• Mvt 101 Completed to Date: ${totalCompletedActual.toLocaleString()} units (${progressExact}%)\n• Remaining to Build: ${remainingMonthlyTarget.toLocaleString()} units\n• Prior Weeks Actual (101): ${priorActualSum.toLocaleString()} units\n• Current Week Actual (101): ${(fg.currentWeekActualProd || 0).toLocaleString()} units\n• Breakdown: ${fg.allWeeksDetail.map((w) => `W${w.weekNo}: ${w.actualProd.toLocaleString()} / ${w.planTarget.toLocaleString()}`).join(' | ')}`}
                          >
                            <div className="flex items-center justify-between text-[10px] font-mono leading-tight">
                              <span className="text-slate-600 font-semibold truncate">
                                {totalCompletedActual.toLocaleString()} / {totalMonthlyPlan.toLocaleString()}
                              </span>
                              <span
                                className={`px-1 py-0.2 rounded font-bold text-[9px] ${
                                  monthlyProgressPercent >= 75
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : monthlyProgressPercent >= 30
                                    ? 'bg-blue-100 text-blue-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {monthlyProgressPercent}%
                              </span>
                            </div>

                            {/* Progress Track & Fill */}
                            <div className="w-full bg-slate-200/90 h-2 rounded-full overflow-hidden flex shadow-inner relative">
                              <div
                                className={`h-full transition-all duration-300 rounded-full ${
                                  monthlyProgressPercent >= 75
                                    ? 'bg-emerald-500'
                                    : monthlyProgressPercent >= 30
                                    ? 'bg-indigo-600'
                                    : 'bg-amber-500'
                                }`}
                                style={{ width: `${Math.min(100, Math.max(0, monthlyProgressPercent))}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Prior Plan */}
                        <td className="py-2.5 px-2 text-right font-mono text-slate-700">
                          <span
                            className="cursor-help"
                            title={
                              fg.priorWeeksBreakdown.length > 0
                                ? fg.priorWeeksBreakdown.map((pw) => `W${pw.weekNo} Plan: ${pw.planTarget.toLocaleString()} units`).join('\n')
                                : 'No prior weeks in current month'
                            }
                          >
                            {priorPlanSum > 0 ? priorPlanSum.toLocaleString() : '-'}
                          </span>
                        </td>

                        {/* Prior Actual (101 Production Movement) */}
                        <td className="py-2.5 px-2 text-right font-mono text-slate-700">
                          <span
                            className="cursor-help font-medium"
                            title={
                              fg.priorWeeksBreakdown.length > 0
                                ? fg.priorWeeksBreakdown
                                    .map((pw) => `W${pw.weekNo} Actual 101 Receipts: ${pw.actualProd.toLocaleString()} units`)
                                    .join('\n')
                                : 'No prior week 101 receipts'
                            }
                          >
                            {priorActualSum > 0 ? priorActualSum.toLocaleString() : '-'}
                          </span>
                        </td>

                        {/* Prior Backlog (Carry Forward) */}
                        <td className="py-2.5 px-2 text-right">
                          <span
                            className={`font-mono font-semibold cursor-help ${
                              priorBacklogSum > 0 ? 'text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded' : 'text-slate-500'
                            }`}
                            title={
                              fg.priorWeeksBreakdown.length > 0
                                ? fg.priorWeeksBreakdown
                                    .map(
                                      (pw) =>
                                        `W${pw.weekNo}: Plan ${pw.planTarget.toLocaleString()} - Actual ${pw.actualProd.toLocaleString()} = Backlog ${pw.backlog.toLocaleString()}`
                                    )
                                    .join('\n')
                                : 'No prior week backlog in current month'
                            }
                          >
                            {priorBacklogSum > 0 ? priorBacklogSum.toLocaleString() : '0'}
                          </span>
                        </td>

                        {/* Selected Week Plan Target */}
                        <td className="py-2.5 px-2 text-right font-mono text-slate-700">
                          {fg.currentWeekPlanTarget.toLocaleString()}
                        </td>

                        {/* Total Gross Target (Week Plan + Prior Backlog) */}
                        <td className="py-2.5 px-2 text-right font-mono font-bold text-slate-900 bg-slate-100/60">
                          {fg.totalWeekGrossTarget.toLocaleString()}
                        </td>

                        {/* Net Shortage Gap */}
                        <td className="py-2.5 px-2 text-right">
                          <span
                            className={`font-mono font-semibold ${
                              netGap > 0 ? 'text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded' : 'text-emerald-700'
                            }`}
                            title={
                              netGap > 0
                                ? `Shortage Gap: Vendor delivery commitments leave an unfulfilled gap of ${netGap.toLocaleString()} units.`
                                : 'No deficit gap: On-hand stock + scheduled inward fully fulfills weekly gross target.'
                            }
                          >
                            {netGap > 0 ? `-${netGap.toLocaleString()}` : '0'}
                          </span>
                        </td>

                        {/* W3 Forward Plan */}
                        <td className="py-2.5 px-2 text-center font-mono text-slate-600" title={`Week 3 Plan: ${w3?.planTarget.toLocaleString()} units`}>
                          <div className="flex flex-col items-center">
                            <span>{w3 ? w3.planTarget.toLocaleString() : '-'}</span>
                            {fg.hasNextWeekRisk && (
                              <span
                                className="text-[9px] px-1 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300 font-sans font-semibold cursor-help mt-0.5"
                                title={`Next Week (W3) Shortage Alert: ${fg.nextWeekCriticalCount} component(s) face deficits next week! Bottleneck: ${fg.nextWeekBottleneckDesc}`}
                              >
                                ⚠️ Deficit
                              </span>
                            )}
                          </div>
                        </td>

                        {/* W4 Forward Plan */}
                        <td className="py-2.5 px-2 text-center font-mono text-slate-600" title={`Week 4 Plan: ${w4?.planTarget.toLocaleString()} units`}>
                          <span>{w4 ? w4.planTarget.toLocaleString() : '-'}</span>
                        </td>

                        {/* Health Badge */}
                        <td className="py-2.5 px-2 text-center">
                          {fg.fgHealthStatus === 'CLEAR_SEAMLESS' && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-help"
                              title="Stock on-hand + confirmed vendor delivery is 100% adequate. Line ready for seamless production."
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Seamless
                            </span>
                          )}
                          {fg.fgHealthStatus === 'SCHEDULE_ON_TRACK' && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200 cursor-help"
                              title="Stock is short, but confirmed vendor inward arrives in time to fulfill 100% of weekly target."
                            >
                              <Truck className="w-3 h-3" />
                              On-Track
                            </span>
                          )}
                          {fg.fgHealthStatus === 'INADEQUATE_SCHEDULE' && (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200 cursor-help"
                              title={`Inadequate Delivery: Shortfall of ${netGap.toLocaleString()} units. Requires immediate Monday review escalation!`}
                            >
                              <AlertTriangle className="w-3 h-3" />
                              Inadequate
                            </span>
                          )}
                        </td>

                        {/* Freeze Status */}
                        <td className="py-2.5 px-2 text-center">
                          {isFrozen ? (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold text-white cursor-help ${
                                fg.frozenBy?.includes('System Auto') ? 'bg-emerald-700' : 'bg-slate-900'
                              }`}
                              title={`Plan Frozen by ${fg.frozenBy || 'Planner'} at ${fg.frozenAt || '08:30'}. Shared BOM components reserved.`}
                            >
                              <Lock className="w-2.5 h-2.5 text-emerald-300" />
                              {fg.frozenBy?.includes('System Auto') ? 'Auto-Frozen' : 'FROZEN'}
                            </span>
                          ) : fg.criticalComponentsCount === 0 && fg.maxBuildableFGWithDeliveries >= fg.totalWeekGrossTarget ? (
                            <button
                              onClick={() => handleAutoFreezeSingleFG(fg)}
                              title="System Rule: 100% components available. 1-click auto freeze without review discussion."
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs cursor-pointer"
                            >
                              <Zap className="w-2.5 h-2.5" />
                              Auto-Freeze
                            </button>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200"
                              title="Plan is in DRAFT review state. Click 'Freeze' to lock."
                            >
                              Draft
                            </span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Discuss / Escalate Button */}
                            <button
                              onClick={() => handleOpenDiscussModal(fg)}
                              title="Record discussion minutes, category buyer actions, or plant escalation"
                              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                            >
                              <MessageSquare className="w-3 h-3 text-slate-600" />
                              <span>Discuss</span>
                            </button>

                            {/* Freeze / Unfreeze Button */}
                            <button
                              onClick={() => handleOpenFreezeModal(fg)}
                              title={isFrozen ? 'Unfreeze this plan' : 'Freeze plan and reserve common parts'}
                              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                                isFrozen
                                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                              }`}
                            >
                              {isFrozen ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                              <span>{isFrozen ? 'Unfreeze' : 'Freeze'}</span>
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Exploded BOM Sub-Table (Expanded View) */}
                      {isExpanded && (() => {
                        const isCompCritical = (comp: ExplodedBOMComponentSummary) =>
                          comp.stockDeficit < 0 ||
                          comp.scheduleHealth === 'INADEQUATE' ||
                          comp.scheduleHealth === 'CRITICAL_NO_DELIVERY' ||
                          !!comp.hasNextWeekRisk;

                        const visibleComponents = hideOkMaterials
                          ? fg.explodedBOM.filter(isCompCritical)
                          : fg.explodedBOM;

                        const hiddenOkCount = fg.explodedBOM.length - visibleComponents.length;

                        return (
                          <tr className="bg-slate-50/50">
                            <td colSpan={15} className="p-3 pl-8 pr-4 bg-slate-50 border-b border-slate-200">
                              <div className="bg-white border border-slate-200 rounded-md shadow-2xs overflow-hidden">
                                {/* Subheader */}
                                <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Layers className="w-4 h-4 text-slate-600" />
                                    <span className="font-semibold text-slate-800 text-xs">
                                      Exploded BOM Component Breakdown for {fg.fgCode} — {fg.fgDescription}
                                    </span>
                                    <span className="text-[11px] text-slate-500 font-mono">
                                      [Gross Target: {fg.totalWeekGrossTarget.toLocaleString()} FGs]
                                    </span>
                                    {hideOkMaterials && (
                                      <span className="bg-rose-100 text-rose-800 border border-rose-200 text-[10px] font-semibold px-2 py-0.5 rounded flex items-center gap-1">
                                        <Zap className="w-2.5 h-2.5 text-rose-600" />
                                        Showing {visibleComponents.length} Critical ({hiddenOkCount} OK Hidden)
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-3">
                                    <span>{fg.criticalComponentsCount} deficit components (W{cockpit.selectedWeek.weekNo})</span>
                                    {fg.hasNextWeekRisk && (
                                      <span className="text-amber-800 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200 text-[10px]">
                                        ⚠️ {fg.nextWeekCriticalCount} Next Week (W{cockpit.selectedWeek.weekNo + 1}) Deficits
                                      </span>
                                    )}
                                    {fg.inadequateScheduleCount > 0 && (
                                      <span className="text-rose-600 font-medium">
                                        • {fg.inadequateScheduleCount} inadequate vendor schedules
                                      </span>
                                    )}
                                    {!isSupplyPlanner && (
                                      <span className="text-slate-400 bg-slate-200/60 px-2 py-0.5 rounded text-[10px]">
                                        Read-Only Mode (Supply Planner role required to edit schedules)
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Exploded Components Tabular Layout with Dropdown Options */}
                                <div className="w-full bg-white">
                                  {visibleComponents.length === 0 ? (
                                    <div className="py-6 text-center text-slate-500 bg-emerald-50/40 border-b border-slate-200 p-4">
                                      <div className="flex flex-col items-center justify-center gap-1.5">
                                        <div className="flex items-center gap-1.5 text-emerald-700 font-semibold text-xs">
                                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                          <span>All {fg.explodedBOM.length} BOM components have 100% adequate stock for Week {cockpit.selectedWeek.weekNo} and Next Week.</span>
                                        </div>
                                        <p className="text-[11px] text-slate-500">
                                          No raw material shortages or delivery deficits found. (OK materials hidden by Critical Materials filter)
                                        </p>
                                        <button
                                          onClick={() => setHideOkMaterials(false)}
                                          className="mt-1 px-2.5 py-1 text-[11px] font-medium bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-50 cursor-pointer"
                                        >
                                          Show All {fg.explodedBOM.length} Materials
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="overflow-x-auto">
                                      {/* Sub-Table Dropdown Toolbar */}
                                      <div className="px-3 py-2 bg-slate-50/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                                        <div className="flex items-center gap-2">
                                          <span className="font-semibold text-slate-700 text-[11px] uppercase tracking-wider">
                                            Component Inventory & Delivery Table ({visibleComponents.length} items)
                                          </span>
                                          {fg.criticalComponentsCount > 0 && (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1">
                                              <AlertTriangle className="w-2.5 h-2.5" />
                                              {fg.criticalComponentsCount} Critical Shortage
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2 flex-wrap">
                                          {/* View Mode Toggle: Table View vs Compact Gantt Matrix View */}
                                          <div className="inline-flex rounded border border-slate-300 p-0.5 bg-white text-[11px] shadow-2xs">
                                            <button
                                              type="button"
                                              onClick={() => setFgViewModeMap((prev) => ({ ...prev, [fg.fgCode]: 'TABLE' }))}
                                              className={`px-2.5 py-0.5 rounded font-semibold cursor-pointer transition-colors ${
                                                (fgViewModeMap[fg.fgCode] || 'TABLE') === 'TABLE'
                                                  ? 'bg-slate-800 text-white'
                                                  : 'text-slate-600 hover:text-slate-900'
                                              }`}
                                            >
                                              📑 Table View
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setFgViewModeMap((prev) => ({ ...prev, [fg.fgCode]: 'GANTT' }))}
                                              className={`px-2.5 py-0.5 rounded font-semibold cursor-pointer transition-colors flex items-center gap-1 ${
                                                fgViewModeMap[fg.fgCode] === 'GANTT'
                                                  ? 'bg-indigo-600 text-white'
                                                  : 'text-slate-600 hover:text-slate-900'
                                              }`}
                                              title="View small, spreadsheet-style multi-component Gantt chart with dates and green/red colors"
                                            >
                                              <BarChart3 className="w-3 h-3" />
                                              <span>📊 Compact Gantt Matrix</span>
                                            </button>
                                          </div>

                                          {fg.criticalComponentsCount > 0 && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const criticalIds = fg.explodedBOM.filter((c) => c.stockDeficit < 0).map((c) => c.id);
                                                criticalIds.forEach((id) => {
                                                  setComponentSubTab(id, 'GANTT');
                                                });
                                                toggleAllCompExpandForFG(criticalIds, true);
                                              }}
                                              className="px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 font-semibold text-[11px] cursor-pointer flex items-center gap-1 shadow-2xs transition-colors"
                                              title="Expand Gantt Chart with daily requirement scale for all critical shortage components"
                                            >
                                              <BarChart3 className="w-3 h-3 text-rose-600" />
                                              <span>Critical Rows ({fg.criticalComponentsCount})</span>
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const allIds = visibleComponents.map((c) => c.id);
                                              const anyOpen = allIds.some((id) => expandedCompIds[id]);
                                              allIds.forEach((id) => {
                                                if (!compExpandedTab[id]) setComponentSubTab(id, 'GANTT');
                                              });
                                              toggleAllCompExpandForFG(allIds, !anyOpen);
                                            }}
                                            className="px-2 py-1 rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-medium text-[11px] cursor-pointer flex items-center gap-1 shadow-2xs"
                                          >
                                            <ChevronDown className="w-3 h-3 text-slate-500" />
                                            <span>
                                              {visibleComponents.some((c) => expandedCompIds[c.id]) ? 'Collapse All' : 'Expand All'}
                                            </span>
                                          </button>
                                          {hideOkMaterials && (
                                            <button
                                              type="button"
                                              onClick={() => setHideOkMaterials(false)}
                                              className="px-2 py-1 rounded bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-medium text-[11px] cursor-pointer"
                                            >
                                              Show All ({fg.explodedBOM.length})
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      {fgViewModeMap[fg.fgCode] === 'GANTT' ? (
                                        <div className="p-2.5 bg-slate-50 border-b border-slate-200">
                                          <MultiComponentMasterGantt
                                            fgCode={fg.fgCode}
                                            fgDescription={fg.fgDescription}
                                            fgTotalGrossTarget={fg.totalWeekGrossTarget}
                                            week={cockpit.selectedWeek}
                                            components={visibleComponents}
                                            deliverySchedules={vendorDeliverySchedules}
                                            onUpdateSchedule={handleUpdateSingleDeliverySchedule}
                                          />
                                        </div>
                                      ) : (
                                        <table className="w-full text-left text-xs border-collapse divide-y divide-slate-200">
                                        <thead>
                                          <tr className="bg-slate-100/90 text-slate-700 font-semibold text-[11px]">
                                            <th className="py-2.5 px-2 w-8 text-center" title="Click chevron to expand/collapse delivery schedules and logs">
                                              <span className="sr-only">Expand</span>
                                            </th>
                                            <th className="py-2.5 px-2.5 min-w-[200px]">Part No & Description</th>
                                            <th className="py-2.5 px-2 text-center w-20">Usage</th>
                                            <th className="py-2.5 px-2.5 min-w-[170px]" title="Total physical stock, reserved stock by frozen plans, and available stock">
                                              MB52 Stock (Tot / Res / Avail)
                                            </th>
                                            <th className="py-2.5 px-2 text-right w-20">Gross Req</th>
                                            <th className="py-2.5 px-2 text-center w-24">Balance</th>
                                            <th className="py-2.5 px-2 text-center min-w-[110px]" title="Next week gross requirement and shortage risk">
                                              Next W{cockpit.selectedWeek.weekNo + 1} Outlook
                                            </th>
                                            <th className="py-2.5 px-2.5 min-w-[180px]">Vendor & Buyer</th>
                                            <th className="py-2.5 px-2.5 min-w-[150px]">Expected Arrival</th>
                                            <th className="py-2.5 px-2 text-center min-w-[110px]">Status</th>
                                            <th className="py-2.5 px-2 text-right w-24">Buildable FGs</th>
                                            <th className="py-2.5 px-3 text-right min-w-[170px]">Actions / Dropdown</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200 bg-white">
                                          {visibleComponents.map((comp) => {
                                            const isExpanded = !!expandedCompIds[comp.id];
                                            const primarySchedule = comp.deliverySchedules[0];
                                            const hasMultipleSchedules = comp.deliverySchedules.length > 1;

                                            return (
                                              <React.Fragment key={comp.id}>
                                                {/* Main Table Row */}
                                                <tr
                                                  className={`transition-colors hover:bg-slate-50/80 ${
                                                    isExpanded ? 'bg-blue-50/20' : ''
                                                  } ${
                                                    comp.stockDeficit < 0
                                                      ? 'bg-rose-50/30'
                                                      : comp.hasNextWeekRisk
                                                      ? 'bg-amber-50/20'
                                                      : ''
                                                  }`}
                                                >
                                                  {/* 1. Expand/Collapse Chevron Dropdown */}
                                                  <td className="py-2 px-2 text-center align-middle">
                                                    <button
                                                      type="button"
                                                      onClick={() => toggleCompExpand(comp.id)}
                                                      className="p-1 rounded hover:bg-slate-200 text-slate-600 cursor-pointer inline-flex items-center justify-center transition-transform"
                                                      title={isExpanded ? 'Collapse schedule details' : 'Dropdown: Expand full delivery schedules & audit trail'}
                                                    >
                                                      {isExpanded ? (
                                                        <ChevronDown className="w-3.5 h-3.5 text-blue-600 font-bold" />
                                                      ) : (
                                                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                                                      )}
                                                    </button>
                                                  </td>

                                                  {/* 2. Part No & Description */}
                                                  <td className="py-2 px-2.5 align-middle">
                                                    <div className="flex flex-col gap-0.5">
                                                      <div className="flex items-center gap-1.5 flex-wrap">
                                                        <span className="font-mono font-bold text-slate-900 text-xs">
                                                          {comp.componentCode}
                                                        </span>
                                                        {comp.isCommonPart && (
                                                          <button
                                                            type="button"
                                                            onClick={() => setIsCommonPartsModalOpen(true)}
                                                            className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 cursor-pointer"
                                                            title={`Common Part shared in ${comp.sharedInFGsCount} FGs. Click to view allocation.`}
                                                          >
                                                            <Share2 className="w-2.5 h-2.5" />
                                                            Shared ({comp.sharedInFGsCount})
                                                          </button>
                                                        )}
                                                      </div>
                                                      <span className="text-[11px] text-slate-700 font-medium line-clamp-1" title={comp.componentDescription}>
                                                        {comp.componentDescription}
                                                      </span>
                                                    </div>
                                                  </td>

                                                  {/* 3. BOM Usage */}
                                                  <td className="py-2 px-2 text-center align-middle font-mono text-[11px] text-slate-600">
                                                    <span className="bg-slate-100 px-1.5 py-0.5 rounded font-medium">
                                                      {comp.bomQty} {comp.uom}
                                                    </span>
                                                  </td>

                                                  {/* 4. MB52 Stock (Total / Reserved / Avail) */}
                                                  <td className="py-2 px-2.5 align-middle font-mono text-xs">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                      <span className="text-slate-500 text-[11px]" title="Total physical stock in MB52">
                                                        {comp.totalPhysicalStock.toLocaleString()}
                                                      </span>
                                                      <span className="text-slate-300">/</span>
                                                      <span
                                                        className={`text-[11px] ${comp.reservedStock > 0 ? 'text-blue-700 font-semibold' : 'text-slate-400'}`}
                                                        title="Reserved stock by frozen production plans"
                                                      >
                                                        {comp.reservedStock.toLocaleString()}
                                                      </span>
                                                      <span className="text-slate-300">/</span>
                                                      <span
                                                        className="px-1.5 py-0.5 rounded font-bold bg-slate-100 text-slate-900 border border-slate-200"
                                                        title="Available unreserved physical stock"
                                                      >
                                                        {comp.currentStock.toLocaleString()}
                                                      </span>
                                                    </div>
                                                  </td>

                                                  {/* 5. Gross Requirement */}
                                                  <td className="py-2 px-2 text-right align-middle font-mono font-semibold text-slate-800 text-xs">
                                                    {comp.totalRequiredForWeekWithBacklog.toLocaleString()}
                                                  </td>

                                                  {/* 6. Balance (Deficit / Surplus) */}
                                                  <td className="py-2 px-2 text-center align-middle font-mono text-xs">
                                                    <span
                                                      className={`inline-block px-1.5 py-0.5 rounded font-bold text-[11px] ${
                                                        comp.stockDeficit < 0
                                                          ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                                          : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                                      }`}
                                                    >
                                                      {comp.stockDeficit > 0 ? `+${comp.stockDeficit.toLocaleString()}` : comp.stockDeficit.toLocaleString()}
                                                    </span>
                                                  </td>

                                                  {/* 7. Next Week Outlook */}
                                                  <td className="py-2 px-2 text-center align-middle text-[11px]">
                                                    {comp.hasNextWeekRisk ? (
                                                      <span
                                                        className="inline-flex items-center gap-1 font-semibold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-200"
                                                        title={`Next Week (W${comp.nextWeekNo}) Deficit: ${comp.nextWeekDeficit?.toLocaleString()} ${comp.uom}`}
                                                      >
                                                        <AlertTriangle className="w-2.5 h-2.5" />
                                                        -{comp.nextWeekDeficit?.toLocaleString()}
                                                      </span>
                                                    ) : comp.nextWeekGrossReq && comp.nextWeekGrossReq > 0 ? (
                                                      <span className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                                        OK (+{comp.nextWeekClosingStock?.toLocaleString()})
                                                      </span>
                                                    ) : (
                                                      <span className="text-slate-400 font-mono">-</span>
                                                    )}
                                                  </td>

                                                  {/* 8. Primary Vendor & Buyer */}
                                                  <td className="py-2 px-2.5 align-middle">
                                                    <div className="flex flex-col gap-0.5 text-xs">
                                                      <span className="font-semibold text-slate-900 truncate max-w-[170px]" title={primarySchedule ? primarySchedule.vendorName : comp.vendorName}>
                                                        {primarySchedule ? primarySchedule.vendorName : comp.vendorName}
                                                      </span>
                                                      <span className="text-[10px] text-blue-700 font-medium flex items-center gap-1">
                                                        <span>Buyer: {primarySchedule?.buyerName || comp.buyerName}</span>
                                                      </span>
                                                    </div>
                                                  </td>

                                                  {/* 9. Expected Arrival & Inward Qty */}
                                                  <td className="py-2 px-2.5 align-middle font-mono text-xs">
                                                    {comp.deliverySchedules.length > 0 ? (
                                                      <div className="flex flex-col gap-0.5">
                                                        <div className="flex items-center gap-1 text-slate-800 font-semibold text-[11px]">
                                                          <Calendar className="w-3 h-3 text-slate-400" />
                                                          <span>{formatDateDisplay(primarySchedule.expectedDeliveryDate)}</span>
                                                        </div>
                                                        <div className="flex items-center gap-1 text-[11px]">
                                                          <span className="text-emerald-700 font-bold">
                                                            +{comp.totalScheduledInward.toLocaleString()} {comp.uom}
                                                          </span>
                                                          {hasMultipleSchedules && (
                                                            <span
                                                              onClick={() => toggleCompExpand(comp.id)}
                                                              className="text-[9px] font-sans font-bold bg-blue-100 text-blue-800 px-1 rounded cursor-pointer"
                                                              title="Multiple split batches. Click to view all."
                                                            >
                                                              {comp.deliverySchedules.length} splits
                                                            </span>
                                                          )}
                                                        </div>
                                                      </div>
                                                    ) : (
                                                      <span className="text-[11px] text-rose-600 font-medium">No Schedule</span>
                                                    )}
                                                  </td>

                                                  {/* 10. Delivery Status */}
                                                  <td className="py-2 px-2 text-center align-middle">
                                                    {primarySchedule ? (
                                                      <span
                                                        className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                                                          primarySchedule.deliveryStatus === 'CONFIRMED_ON_TRACK'
                                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                            : primarySchedule.deliveryStatus === 'IN_TRANSIT'
                                                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                                            : primarySchedule.deliveryStatus === 'PARTIAL_PROMISE'
                                                            ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                                                        }`}
                                                      >
                                                        {primarySchedule.deliveryStatus.replace(/_/g, ' ')}
                                                      </span>
                                                    ) : (
                                                      <span className="text-[10px] text-slate-400 font-medium">Pending PO</span>
                                                    )}
                                                  </td>

                                                  {/* 11. Buildable FGs */}
                                                  <td className="py-2 px-2 text-right align-middle font-mono text-xs">
                                                    <span
                                                      className={`font-bold ${
                                                        comp.projectedCoverageFgUnits < fg.totalWeekGrossTarget
                                                          ? 'text-rose-700'
                                                          : 'text-emerald-700'
                                                      }`}
                                                    >
                                                      {comp.projectedCoverageFgUnits.toLocaleString()}
                                                    </span>
                                                    <span className="text-[10px] text-slate-400 ml-0.5">FG</span>
                                                  </td>

                                                  {/* 12. Actions & Dropdown Option */}
                                                  <td className="py-2 px-3 text-right align-middle">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                      {/* Direct Quick Gantt Timeline Button */}
                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                          if (!isExpanded) toggleCompExpand(comp.id);
                                                          setComponentSubTab(comp.id, 'GANTT');
                                                        }}
                                                        title="Show Date-Scale Daily Production Requirement & Expected Arrival Gantt Chart"
                                                        className={`px-2 py-1 rounded text-[11px] font-semibold shadow-2xs cursor-pointer inline-flex items-center gap-1 transition-colors ${
                                                          comp.stockDeficit < 0
                                                            ? 'bg-rose-600 hover:bg-rose-700 text-white'
                                                            : isExpanded && (compExpandedTab[comp.id] || 'GANTT') === 'GANTT'
                                                            ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                                                            : 'bg-slate-800 hover:bg-slate-900 text-white'
                                                        }`}
                                                      >
                                                        <BarChart3 className="w-3 h-3" />
                                                        <span>Gantt</span>
                                                      </button>

                                                      {/* Direct Quick 1-Click Action Button */}
                                                      <button
                                                        type="button"
                                                        onClick={() => handleOpenDeliveryModal(comp, primarySchedule)}
                                                        title="Edit / Reschedule delivery date & quantity"
                                                        className="px-2 py-1 rounded text-[11px] font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-2xs cursor-pointer inline-flex items-center gap-1 transition-colors"
                                                      >
                                                        <Edit3 className="w-3 h-3" />
                                                        <span>Edit</span>
                                                      </button>

                                                      {/* Dropdown Options Selector for this Row */}
                                                      <div className="relative inline-block">
                                                        <select
                                                          aria-label={`Options for ${comp.componentCode}`}
                                                          value=""
                                                          onChange={(e) => {
                                                            const val = e.target.value;
                                                            if (val === 'gantt') {
                                                              if (!isExpanded) toggleCompExpand(comp.id);
                                                              setComponentSubTab(comp.id, 'GANTT');
                                                            } else if (val === 'edit') {
                                                              handleOpenDeliveryModal(comp, primarySchedule);
                                                            } else if (val === 'add_split') {
                                                              handleOpenDeliveryModal(comp);
                                                            } else if (val === 'cancel') {
                                                              if (primarySchedule) {
                                                                handleDeleteSchedule(primarySchedule.id);
                                                              } else {
                                                                alert('No active delivery commitment to cancel.');
                                                              }
                                                            } else if (val === 'audit') {
                                                              handleOpenHistoryDrawer({
                                                                componentCode: comp.componentCode,
                                                                componentDescription: comp.componentDescription,
                                                                vendorName: comp.vendorName,
                                                                title: `Change History: ${comp.componentCode}`
                                                              });
                                                            } else if (val === 'discuss') {
                                                              handleOpenDiscussModal(fg, comp);
                                                            } else if (val === 'toggle_expand') {
                                                              toggleCompExpand(comp.id);
                                                            }
                                                          }}
                                                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded text-[11px] font-medium py-1 px-1.5 pr-5 cursor-pointer appearance-none outline-none focus:ring-1 focus:ring-blue-500"
                                                        >
                                                          <option value="" disabled>
                                                            Options ▾
                                                          </option>
                                                          <option value="gantt">📊 Show Date-Scale Gantt</option>
                                                          <option value="edit">✏️ Edit Delivery</option>
                                                          <option value="add_split">➕ Add Split Batch</option>
                                                          {primarySchedule && <option value="cancel">🗑️ Cancel Commitment</option>}
                                                          <option value="audit">📜 View Audit Log</option>
                                                          <option value="discuss">💬 Discuss / Action</option>
                                                          <option value="toggle_expand">
                                                            {isExpanded ? '▲ Collapse Details' : '▼ Expand Delivery & Gantt'}
                                                          </option>
                                                        </select>
                                                        <ChevronDown className="w-2.5 h-2.5 text-slate-500 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                                                      </div>
                                                    </div>
                                                  </td>
                                                </tr>

                                                {/* Expanded Details Sub-Row (Dropdown Accordion) */}
                                                {isExpanded && (
                                                  (() => {
                                                    const activeSubTab = compExpandedTab[comp.id] || 'GANTT';
                                                    return (
                                                      <tr className="bg-blue-50/30 border-b border-slate-200">
                                                        <td colSpan={12} className="p-3 pl-8 pr-4 bg-slate-50/90">
                                                          <div className="bg-white rounded-lg border border-slate-200 shadow-2xs p-3.5 space-y-3">
                                                            {/* Sub-Row Header with Tab Switcher */}
                                                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                                                              <div className="flex flex-wrap items-center gap-3">
                                                                <div className="flex items-center gap-1.5">
                                                                  <span className="font-bold text-slate-900 text-xs font-mono">
                                                                    {comp.componentCode}
                                                                  </span>
                                                                  <span className="text-[11px] text-slate-600 font-medium">
                                                                    ({comp.componentDescription})
                                                                  </span>
                                                                  <span className="text-[10px] text-slate-400 font-mono">
                                                                    Usage: {comp.bomQty} {comp.uom}/FG
                                                                  </span>
                                                                </div>

                                                                {/* Sub-Tabs */}
                                                                <div className="inline-flex rounded-md border border-slate-200 p-0.5 bg-slate-100 text-[11px]">
                                                                  <button
                                                                    type="button"
                                                                    onClick={() => setComponentSubTab(comp.id, 'GANTT')}
                                                                    className={`px-2.5 py-1 rounded font-semibold cursor-pointer flex items-center gap-1 transition-all ${
                                                                      activeSubTab === 'GANTT'
                                                                        ? 'bg-white text-indigo-700 shadow-2xs'
                                                                        : 'text-slate-600 hover:text-slate-900'
                                                                    }`}
                                                                  >
                                                                    <BarChart3 className="w-3 h-3" />
                                                                    <span>Daily Production Gantt Scale</span>
                                                                    {comp.stockDeficit < 0 && (
                                                                      <span className="w-2 h-2 rounded-full bg-rose-500 inline-block animate-ping ml-0.5" />
                                                                    )}
                                                                  </button>
                                                                  <button
                                                                    type="button"
                                                                    onClick={() => setComponentSubTab(comp.id, 'SCHEDULES')}
                                                                    className={`px-2.5 py-1 rounded font-semibold cursor-pointer flex items-center gap-1 transition-all ${
                                                                      activeSubTab === 'SCHEDULES'
                                                                        ? 'bg-white text-blue-700 shadow-2xs'
                                                                        : 'text-slate-600 hover:text-slate-900'
                                                                    }`}
                                                                  >
                                                                    <Truck className="w-3 h-3" />
                                                                    <span>Delivery PO Batches ({comp.deliverySchedules.length})</span>
                                                                  </button>
                                                                  <button
                                                                    type="button"
                                                                    onClick={() => setComponentSubTab(comp.id, 'STOCK_EQUATION')}
                                                                    className={`px-2.5 py-1 rounded font-semibold cursor-pointer flex items-center gap-1 transition-all ${
                                                                      activeSubTab === 'STOCK_EQUATION'
                                                                        ? 'bg-white text-slate-800 shadow-2xs'
                                                                        : 'text-slate-600 hover:text-slate-900'
                                                                    }`}
                                                                  >
                                                                    <span>🧮 Stock Balance Equation</span>
                                                                  </button>
                                                                </div>
                                                              </div>

                                                              <div className="flex items-center gap-2">
                                                                <button
                                                                  type="button"
                                                                  onClick={() => handleOpenDeliveryModal(comp)}
                                                                  className="px-2 py-1 rounded text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer inline-flex items-center gap-1 shadow-2xs"
                                                                >
                                                                  <Plus className="w-3 h-3" />
                                                                  <span>+ Add Delivery Batch</span>
                                                                </button>
                                                                <button
                                                                  type="button"
                                                                  onClick={() =>
                                                                    handleOpenHistoryDrawer({
                                                                      componentCode: comp.componentCode,
                                                                      componentDescription: comp.componentDescription,
                                                                      vendorName: comp.vendorName,
                                                                      title: `Change History: ${comp.componentCode}`
                                                                    })
                                                                  }
                                                                  className="px-2 py-1 rounded text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 cursor-pointer inline-flex items-center gap-1"
                                                                >
                                                                  <History className="w-3 h-3 text-slate-500" />
                                                                  <span>Audit History</span>
                                                                </button>
                                                              </div>
                                                            </div>

                                                            {/* TAB 1: Interactive Date-Scale Production & Arrival Gantt Chart */}
                                                            {activeSubTab === 'GANTT' && (
                                                              <div className="pt-1">
                                                                <BOMGanttChart
                                                                  component={comp}
                                                                  fgCode={fg.fgCode}
                                                                  fgDescription={fg.fgDescription}
                                                                  fgTotalGrossTarget={fg.totalWeekGrossTarget}
                                                                  week={cockpit.selectedWeek}
                                                                  deliverySchedules={vendorDeliverySchedules}
                                                                  onUpdateSchedule={handleUpdateSingleDeliverySchedule}
                                                                  onOpenDeliveryModal={(c, s) => handleOpenDeliveryModal(c, s)}
                                                                  onOpenDiscussModal={(c) => handleOpenDiscussModal(fg, c)}
                                                                />
                                                              </div>
                                                            )}

                                                            {/* TAB 2: Delivery Schedules Table */}
                                                            {activeSubTab === 'SCHEDULES' && (
                                                              <div className="space-y-3">
                                                                {comp.deliverySchedules.length > 0 ? (
                                                                  <table className="w-full text-left text-xs border-collapse divide-y divide-slate-200 bg-white border border-slate-200 rounded">
                                                                    <thead>
                                                                      <tr className="bg-slate-100 text-slate-700 font-semibold text-[10px] uppercase tracking-wider">
                                                                        <th className="py-1.5 px-2.5">Schedule Ref</th>
                                                                        <th className="py-1.5 px-2.5">Vendor</th>
                                                                        <th className="py-1.5 px-2">Buyer</th>
                                                                        <th className="py-1.5 px-2">Arrival Date</th>
                                                                        <th className="py-1.5 px-2 text-right">Promised Qty</th>
                                                                        <th className="py-1.5 px-2.5">Carrier / Tracking</th>
                                                                        <th className="py-1.5 px-2 text-center">Status</th>
                                                                        <th className="py-1.5 px-2.5">Planner & Notes</th>
                                                                        <th className="py-1.5 px-2.5 text-right">Actions</th>
                                                                      </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-100 text-[11px]">
                                                                      {comp.deliverySchedules.map((s) => (
                                                                        <tr key={s.id} className="hover:bg-slate-50">
                                                                          <td className="py-2 px-2.5 font-mono text-slate-600 font-semibold">{s.poNumber || s.id}</td>
                                                                          <td className="py-2 px-2.5">
                                                                            <div className="font-semibold text-slate-900">{s.vendorName}</div>
                                                                            <div className="text-[10px] font-mono text-slate-400">{s.vendorCode}</div>
                                                                          </td>
                                                                          <td className="py-2 px-2 text-slate-700">{s.buyerName || comp.buyerName}</td>
                                                                          <td className="py-2 px-2 font-mono font-semibold text-slate-900">
                                                                            {formatDateDisplay(s.expectedDeliveryDate)}
                                                                          </td>
                                                                          <td className="py-2 px-2 text-right font-mono font-bold text-emerald-700">
                                                                            +{s.promisedQty.toLocaleString()} {comp.uom}
                                                                          </td>
                                                                          <td className="py-2 px-2.5 text-slate-600">{s.carrierOrTracking || 'Direct Truck'}</td>
                                                                          <td className="py-2 px-2 text-center">
                                                                            <span
                                                                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                                                                s.deliveryStatus === 'CONFIRMED_ON_TRACK'
                                                                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                                                  : s.deliveryStatus === 'IN_TRANSIT'
                                                                                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                                                                  : s.deliveryStatus === 'PARTIAL_PROMISE'
                                                                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                                                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                                                                              }`}
                                                                            >
                                                                              {s.deliveryStatus.replace(/_/g, ' ')}
                                                                            </span>
                                                                          </td>
                                                                          <td className="py-2 px-2.5 text-slate-600">
                                                                            <div className="font-medium text-slate-800">{s.notes || 'Scheduled Inward'}</div>
                                                                          </td>
                                                                          <td className="py-2 px-2.5 text-right">
                                                                            <div className="flex items-center justify-end gap-1">
                                                                              {/* Inline History Button */}
                                                                              {(() => {
                                                                                const schedLogsCount = deliveryScheduleChangeLogs.filter(
                                                                                  (l) => l.poNumber === s.poNumber || l.scheduleId === s.id
                                                                                ).length;
                                                                                return (
                                                                                  <button
                                                                                    type="button"
                                                                                    onClick={() =>
                                                                                      handleOpenHistoryDrawer({
                                                                                        poNumber: s.poNumber,
                                                                                        componentCode: s.componentCode,
                                                                                        componentDescription: comp.componentDescription,
                                                                                        vendorName: s.vendorName,
                                                                                        title: `Change History: ${s.poNumber || s.id}`
                                                                                      })
                                                                                    }
                                                                                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                                                                                      schedLogsCount > 0
                                                                                        ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100'
                                                                                        : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'
                                                                                    }`}
                                                                                    title={`View timestamped change log and revisions for ${s.poNumber}`}
                                                                                  >
                                                                                    <History className="w-2.5 h-2.5 text-indigo-500" />
                                                                                    <span>History</span>
                                                                                    {schedLogsCount > 0 && (
                                                                                      <span className="px-1 py-0.2 rounded-full bg-indigo-200 text-indigo-900 font-mono text-[9px] font-bold">
                                                                                        {schedLogsCount}
                                                                                      </span>
                                                                                    )}
                                                                                  </button>
                                                                                );
                                                                              })()}

                                                                              <button
                                                                                type="button"
                                                                                onClick={() => handleOpenDeliveryModal(comp, s)}
                                                                                className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 cursor-pointer"
                                                                              >
                                                                                Edit
                                                                              </button>
                                                                              <button
                                                                                type="button"
                                                                                onClick={() => handleDeleteSchedule(s.id)}
                                                                                className="px-2 py-0.5 rounded text-[10px] font-medium bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100 cursor-pointer"
                                                                              >
                                                                                Delete
                                                                              </button>
                                                                            </div>
                                                                          </td>
                                                                        </tr>
                                                                      ))}
                                                                    </tbody>
                                                                  </table>
                                                                ) : (
                                                                  <div className="py-3 px-4 bg-slate-50 rounded border border-dashed border-slate-300 text-center text-slate-500 text-xs">
                                                                    No vendor delivery batches recorded for this component. Click "+ Add Delivery Batch" to schedule.
                                                                  </div>
                                                                )}
                                                              </div>
                                                            )}

                                                            {/* TAB 3: Stock Equation Math */}
                                                            {activeSubTab === 'STOCK_EQUATION' && (
                                                              <div className="space-y-2">
                                                                <div className="bg-slate-50 rounded p-3 border border-slate-200 text-xs space-y-2 font-mono">
                                                                  <div className="font-bold text-slate-800 font-sans text-xs">MRP Component Net Requirements Formula:</div>
                                                                  <div className="flex flex-wrap items-center gap-2 text-slate-700">
                                                                    <span>MB52 Physical Stock: <strong className="text-slate-900">{comp.totalPhysicalStock.toLocaleString()} {comp.uom}</strong></span>
                                                                    <span>-</span>
                                                                    <span>Allocated / Reserved: <strong className="text-amber-700">{comp.reservedStock.toLocaleString()} {comp.uom}</strong></span>
                                                                    <span>+</span>
                                                                    <span>Scheduled Deliveries: <strong className="text-emerald-700">+{comp.totalScheduledInward.toLocaleString()} {comp.uom}</strong></span>
                                                                    <span>-</span>
                                                                    <span>Week Gross Requirement: <strong className="text-slate-900">{comp.totalRequiredForWeekWithBacklog.toLocaleString()} {comp.uom}</strong></span>
                                                                    <span>=</span>
                                                                    <span className="text-sm">
                                                                      Net Balance:{' '}
                                                                      <strong className={comp.stockDeficit < 0 ? 'text-rose-700 font-bold' : 'text-emerald-700 font-bold'}>
                                                                        {comp.stockDeficit > 0 ? `+${comp.stockDeficit.toLocaleString()}` : comp.stockDeficit.toLocaleString()} {comp.uom}
                                                                      </strong>
                                                                    </span>
                                                                  </div>
                                                                  <div className="text-[11px] text-slate-600 font-sans pt-1 border-t border-slate-200">
                                                                    Finished Good Buildable Capacity:{' '}
                                                                    <strong className="text-slate-900 font-bold font-mono">
                                                                      {comp.projectedCoverageFgUnits.toLocaleString()} units
                                                                    </strong>{' '}
                                                                    out of {fg.totalWeekGrossTarget.toLocaleString()} target units ({Math.min(100, Math.round((comp.projectedCoverageFgUnits / (fg.totalWeekGrossTarget || 1)) * 100))}% coverage).
                                                                  </div>
                                                                </div>
                                                              </div>
                                                            )}

                                                            {/* Bottom Stock Equation Bar always visible */}
                                                            <div className="bg-slate-50 rounded p-2.5 border border-slate-200 text-[11px] flex flex-wrap items-center justify-between gap-3 font-mono">
                                                              <div>
                                                                <span className="text-slate-500">Quick Formula: </span>
                                                                <span className="text-slate-700">MB52 ({comp.totalPhysicalStock.toLocaleString()})</span> -{' '}
                                                                <span className="text-slate-700">Reserved ({comp.reservedStock.toLocaleString()})</span> +{' '}
                                                                <span className="text-emerald-700 font-semibold">Deliveries (+{comp.totalScheduledInward.toLocaleString()})</span> -{' '}
                                                                <span className="text-slate-800">Gross Req ({comp.totalRequiredForWeekWithBacklog.toLocaleString()})</span> ={' '}
                                                                <strong className={comp.stockDeficit < 0 ? 'text-rose-700 font-bold' : 'text-emerald-700 font-bold'}>
                                                                  {comp.stockDeficit > 0 ? `+${comp.stockDeficit.toLocaleString()}` : comp.stockDeficit.toLocaleString()} {comp.uom}
                                                                </strong>
                                                              </div>
                                                              <div className="text-slate-600 font-sans text-[11px]">
                                                                Max Finished Goods Supported:{' '}
                                                                <strong className="text-slate-900 font-mono">
                                                                  {comp.projectedCoverageFgUnits.toLocaleString()} units
                                                                </strong>
                                                              </div>
                                                            </div>
                                                          </div>
                                                        </td>
                                                      </tr>
                                                    );
                                                  })()
                                                )}
                                              </React.Fragment>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    )}
                                    </div>
                                  )}
                                </div>

                                {/* Footer of every FG for BOM */}
                                <div className="bg-slate-100/90 border-t border-slate-200 px-3 py-1.5 flex flex-wrap items-center justify-between text-[11px] text-slate-600">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-slate-800">
                                      BOM Breakdown for {fg.fgCode}
                                    </span>
                                    <span className="text-slate-500">
                                      • Tabular format with dropdown details, instant delivery editing, and full audit traceability.
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <button
                                      onClick={() => {
                                        if (visibleComponents.length > 0) {
                                          handleOpenDeliveryModal(visibleComponents[0]);
                                        }
                                      }}
                                      className="text-emerald-700 hover:text-emerald-900 font-semibold underline cursor-pointer"
                                    >
                                      + Schedule Delivery
                                    </button>
                                    <button
                                      onClick={() => toggleFGExpand(fg.fgCode)}
                                      className="text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
                                    >
                                      Collapse Sub-Table ▲
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        );
                      })()}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. MODAL: Discuss & Log Action / Escalation */}
      {isActionModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-lg w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-slate-700" />
                <h3 className="font-semibold text-slate-900 text-sm">
                  Record Monday Review Action & Escalation
                </h3>
              </div>
              <button
                onClick={() => setIsActionModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAction} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">FG Part Number</label>
                  <input
                    type="text"
                    value={actionFormData.fgCode}
                    readOnly
                    className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 font-mono text-slate-800 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Component Code</label>
                  <input
                    type="text"
                    value={actionFormData.componentCode || 'All FG Line Components'}
                    readOnly
                    className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 font-mono text-slate-800"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Issue Type</label>
                <select
                  value={actionFormData.issueType}
                  onChange={(e) =>
                    setActionFormData({ ...actionFormData, issueType: e.target.value as any })
                  }
                  className="w-full border border-slate-200 rounded px-2.5 py-1.5 bg-white text-slate-800 font-medium"
                >
                  <option value="RM_SHORTAGE">Raw Material / Component Shortage</option>
                  <option value="BACKLOG_RECOVERY">Prior Week Backlog Recovery</option>
                  <option value="VENDOR_DELAY">Vendor Dispatch Delay / Logistics</option>
                  <option value="CAPACITY_LINE_SPEED">Assembly Line Speed & Capacity</option>
                  <option value="QUALITY_HOLD">Supplier Quality Hold / Inspection</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Production Impact Summary</label>
                <input
                  type="text"
                  value={actionFormData.impactSummary}
                  onChange={(e) => setActionFormData({ ...actionFormData, impactSummary: e.target.value })}
                  className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-slate-800"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Agreed Recovery Action</label>
                <textarea
                  rows={2}
                  value={actionFormData.agreedAction}
                  onChange={(e) => setActionFormData({ ...actionFormData, agreedAction: e.target.value })}
                  className="w-full border border-slate-200 rounded p-2 text-slate-800 focus:outline-hidden"
                  placeholder="Specify action agreed during Monday review..."
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Assigned Owner (Buyer / Planner)</label>
                  <input
                    type="text"
                    value={actionFormData.assignedOwner}
                    onChange={(e) => setActionFormData({ ...actionFormData, assignedOwner: e.target.value })}
                    className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-slate-800"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Target Resolution Date</label>
                  <input
                    type="date"
                    value={actionFormData.targetResolutionDate}
                    onChange={(e) =>
                      setActionFormData({ ...actionFormData, targetResolutionDate: e.target.value })
                    }
                    className="w-full border border-slate-200 rounded px-2.5 py-1.5 font-mono text-slate-800"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Action Status / Escalation</label>
                  <select
                    value={actionFormData.status}
                    onChange={(e) =>
                      setActionFormData({ ...actionFormData, status: e.target.value as any })
                    }
                    className="w-full border border-slate-200 rounded px-2.5 py-1.5 bg-white text-slate-800 font-medium"
                  >
                    <option value="AMICABLE_SOLUTION_AGREED">Amicable Solution Agreed</option>
                    <option value="ESCALATED_LEVEL_1">Escalated: Level 1 (Plant GM)</option>
                    <option value="ESCALATED_LEVEL_2">Escalated: Level 2 (Head SCM)</option>
                    <option value="ESCALATED_LEVEL_3">Escalated: Level 3 (Operations VP)</option>
                    <option value="RESOLVED">Resolved / Closed</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Escalated To (Optional)</label>
                  <input
                    type="text"
                    value={actionFormData.escalatedTo}
                    onChange={(e) => setActionFormData({ ...actionFormData, escalatedTo: e.target.value })}
                    placeholder="e.g. SCM VP / Plant GM"
                    className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-slate-800"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsActionModalOpen(false)}
                  className="px-3 py-1.5 text-slate-600 hover:text-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-slate-900 text-white rounded font-medium hover:bg-slate-800 transition-colors"
                >
                  Save Action
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. MODAL: Delivery Schedule Reschedule / Commitment with Mandatory Reason & Audit Trail */}
      {isDeliveryModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-blue-600" />
                <h3 className="font-semibold text-slate-900 text-sm">
                  {editingScheduleId ? 'Reschedule / Update Delivery Commitment' : 'Add Vendor Inward Commitment'}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    handleOpenHistoryDrawer({
                      poNumber: editingScheduleId
                        ? vendorDeliverySchedules.find((s) => s.id === editingScheduleId)?.poNumber
                        : undefined,
                      componentCode: deliveryFormData.componentCode,
                      componentDescription: deliveryFormData.componentDescription,
                      vendorName: deliveryFormData.vendorName,
                      title: `History: ${deliveryFormData.componentCode}`
                    })
                  }
                  className="px-2 py-1 text-[11px] font-semibold bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded flex items-center gap-1 cursor-pointer transition-colors"
                  title="View modification history for this component / PO"
                >
                  <History className="w-3 h-3 text-indigo-600" />
                  <span>View History</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsDeliveryModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 cursor-pointer p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveDeliverySchedule} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Component Code</label>
                  <input
                    type="text"
                    value={deliveryFormData.componentCode}
                    readOnly
                    className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 font-mono text-slate-800 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Vendor Name (Multi-Vendor)</label>
                  <input
                    type="text"
                    value={deliveryFormData.vendorName}
                    onChange={(e) => setDeliveryFormData({ ...deliveryFormData, vendorName: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-800 font-medium focus:ring-1 focus:ring-slate-400"
                    placeholder="e.g. SteelTech Solutions Ltd / Apex Metals"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Component Description</label>
                  <input
                    type="text"
                    value={deliveryFormData.componentDescription}
                    readOnly
                    className="w-full bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 text-slate-700 truncate"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Category Buyer Name</label>
                  <input
                    type="text"
                    value={deliveryFormData.buyerName}
                    onChange={(e) => setDeliveryFormData({ ...deliveryFormData, buyerName: e.target.value })}
                    className="w-full bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-800 font-medium focus:ring-1 focus:ring-slate-400"
                    placeholder="e.g. Amit Kumar / R. Deshmukh"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Promised Quantity (Pcs)</label>
                  <input
                    type="number"
                    value={deliveryFormData.promisedQty}
                    onChange={(e) =>
                      setDeliveryFormData({ ...deliveryFormData, promisedQty: Number(e.target.value) })
                    }
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 font-mono text-slate-900 font-bold bg-white focus:ring-1 focus:ring-slate-400"
                    required
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Expected Arrival Date</label>
                  <input
                    type="date"
                    value={deliveryFormData.expectedDeliveryDate}
                    onChange={(e) =>
                      setDeliveryFormData({ ...deliveryFormData, expectedDeliveryDate: e.target.value })
                    }
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 font-mono text-slate-900 font-semibold bg-white focus:ring-1 focus:ring-slate-400"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Delivery Status</label>
                  <select
                    value={deliveryFormData.deliveryStatus}
                    onChange={(e) =>
                      setDeliveryFormData({ ...deliveryFormData, deliveryStatus: e.target.value as any })
                    }
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 bg-white text-slate-800 font-medium focus:ring-1 focus:ring-slate-400"
                  >
                    <option value="CONFIRMED_ON_TRACK">Confirmed On Track</option>
                    <option value="IN_TRANSIT">In Transit</option>
                    <option value="PARTIAL_PROMISE">Partial Promise</option>
                    <option value="DELAYED_AT_RISK">Delayed At Risk</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Carrier / Tracking</label>
                  <input
                    type="text"
                    value={deliveryFormData.carrierOrTracking}
                    onChange={(e) =>
                      setDeliveryFormData({ ...deliveryFormData, carrierOrTracking: e.target.value })
                    }
                    className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-slate-800 focus:ring-1 focus:ring-slate-400"
                    placeholder="e.g. Bluedart Air / Direct Truck"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Planner / Author Name</label>
                <input
                  type="text"
                  value={deliveryFormData.plannerName}
                  onChange={(e) => setDeliveryFormData({ ...deliveryFormData, plannerName: e.target.value })}
                  className="w-full border border-slate-300 rounded px-2.5 py-1.5 text-slate-800 font-medium focus:ring-1 focus:ring-slate-400"
                  required
                />
              </div>

              {/* Mandatory Reason for Change with Audit Log */}
              <div className="bg-amber-50/70 p-2.5 rounded border border-amber-200">
                <label className="block text-amber-950 font-bold mb-1">
                  Reason for Schedule Change / Vendor Commitment Note:
                </label>
                <textarea
                  rows={2}
                  value={deliveryFormData.reasonForChange}
                  onChange={(e) =>
                    setDeliveryFormData({ ...deliveryFormData, reasonForChange: e.target.value })
                  }
                  className="w-full bg-white border border-amber-300 rounded p-2 text-slate-800 focus:outline-hidden text-xs"
                  placeholder="Specify reason for reschedule (e.g. Supplier expedited batch via air express; Tier-2 raw material delay...)"
                  required
                />
                <div className="flex flex-wrap gap-1.5 mt-1.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() =>
                      setDeliveryFormData({
                        ...deliveryFormData,
                        reasonForChange: 'Supplier expedited batch via air express to prevent line stoppage.'
                      })
                    }
                    className="px-2 py-0.5 bg-amber-100/90 hover:bg-amber-200 text-amber-900 rounded font-medium cursor-pointer"
                  >
                    ⚡ Expedited via Air
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDeliveryFormData({
                        ...deliveryFormData,
                        reasonForChange: 'Vendor rescheduled arrival due to Tier-2 raw material shortage.'
                      })
                    }
                    className="px-2 py-0.5 bg-amber-100/90 hover:bg-amber-200 text-amber-900 rounded font-medium cursor-pointer"
                  >
                    ⚠️ Tier-2 Delay
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDeliveryFormData({
                        ...deliveryFormData,
                        reasonForChange: 'Customer pulled in delivery date for urgent dispatch.'
                      })
                    }
                    className="px-2 py-0.5 bg-amber-100/90 hover:bg-amber-200 text-amber-900 rounded font-medium cursor-pointer"
                  >
                    📦 Customer Pull-in
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDeliveryFormData({
                        ...deliveryFormData,
                        reasonForChange: 'Truck breakdown on highway, delivery delayed by 24 hours.'
                      })
                    }
                    className="px-2 py-0.5 bg-amber-100/90 hover:bg-amber-200 text-amber-900 rounded font-medium cursor-pointer"
                  >
                    🚛 Transit Delay
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <div>
                  {editingScheduleId && (
                    <button
                      type="button"
                      onClick={handleCancelDeliveryScheduleInModal}
                      className="px-3 py-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 rounded font-medium transition-colors cursor-pointer"
                      title="Cancel this delivery commitment (sets promised qty to 0 and marks Cancelled in Audit Log)"
                    >
                      Cancel Schedule (0 pcs)
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsDeliveryModalOpen(false)}
                    className="px-3 py-1.5 text-slate-600 hover:text-slate-800 font-medium cursor-pointer"
                  >
                    Discard
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded font-medium bg-slate-900 text-white hover:bg-slate-800 shadow-2xs transition-colors cursor-pointer"
                  >
                    Save & Log Change
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 5. MODAL: Plan Freeze Confirmation & Common Parts Allocation */}
      {isFreezeModalOpen && freezeTargetFG && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                {freezeTargetFG.currentStatus === 'FROZEN' ? (
                  <Unlock className="w-4 h-4 text-amber-600" />
                ) : (
                  <Lock className="w-4 h-4 text-emerald-600" />
                )}
                <h3 className="font-semibold text-slate-900 text-sm">
                  {freezeTargetFG.currentStatus === 'FROZEN'
                    ? `Unfreeze Plan: ${freezeTargetFG.fgCode}`
                    : `Freeze Plan: ${freezeTargetFG.fgCode}`}
                </h3>
              </div>
              <button
                onClick={() => setIsFreezeModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded">
                <div className="font-semibold text-slate-900">{freezeTargetFG.fgDescription}</div>
                <div className="text-slate-600 mt-1">
                  Weekly Gross Target:{' '}
                  <span className="font-mono font-bold text-slate-900">
                    {freezeTargetFG.grossTarget.toLocaleString()} units
                  </span>
                </div>
                {freezeTargetFG.currentStatus !== 'FROZEN' && (
                  <p className="text-[11px] text-slate-500 mt-2">
                    Freezing this plan will reserve all required BOM components and shared common parts in the MB52 unrestricted pool for this FG line.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Supply Planner</label>
                <input
                  type="text"
                  value={freezePlannerName}
                  onChange={(e) => setFreezePlannerName(e.target.value)}
                  className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-slate-800"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Freeze / Release Notes</label>
                <textarea
                  rows={2}
                  value={freezeNotes}
                  onChange={(e) => setFreezeNotes(e.target.value)}
                  className="w-full border border-slate-200 rounded p-2 text-slate-800 focus:outline-hidden"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsFreezeModalOpen(false)}
                  className="px-3 py-1.5 text-slate-600 hover:text-slate-800 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmFreeze}
                  className={`px-4 py-1.5 rounded font-medium text-white transition-colors ${
                    freezeTargetFG.currentStatus === 'FROZEN'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {freezeTargetFG.currentStatus === 'FROZEN' ? 'Confirm Unfreeze' : 'Confirm Freeze Plan'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. INLINE DRAWER: Timestamped Data Point & Vendor Delivery Schedule Change History */}
      <HistoryDrawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => {
          setIsHistoryDrawerOpen(false);
          setHistoryDrawerFilter(null);
        }}
        filter={historyDrawerFilter}
        onClearFilter={() => setHistoryDrawerFilter(null)}
        deliveryScheduleChangeLogs={deliveryScheduleChangeLogs}
        planFreezeList={planFreezeList}
      />

      {/* 7. MODAL: Common Parts Allocation Matrix */}
      {isCommonPartsModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg border border-slate-200 shadow-xl max-w-3xl w-full p-5 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Share2 className="w-4 h-4 text-blue-700" />
                <h3 className="font-semibold text-slate-900 text-sm">
                  Common Shared Parts & Stock Allocation Matrix
                </h3>
              </div>
              <button
                onClick={() => setIsCommonPartsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              When an FG plan is frozen, the required quantity of shared common components is locked and deducted from the unrestricted pool for other lines.
            </p>

            <div className="overflow-y-auto flex-1">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-slate-700 font-semibold">
                    <th className="py-2 px-3">Part Code & Description</th>
                    <th className="py-2 px-2 text-right w-24">Total Stock</th>
                    <th className="py-2 px-3">Shared Across Finished Goods</th>
                    <th className="py-2 px-3">Active Frozen Reservations</th>
                    <th className="py-2 px-2 text-right w-24 bg-slate-200 font-bold">Unreserved Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {commonPartsList.map((cp) => {
                    const totalReserved = cp.reservations.reduce((sum, r) => sum + r.reservedQty, 0);
                    const unreserved = Math.max(0, cp.totalStock - totalReserved);

                    return (
                      <tr key={cp.componentCode} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3">
                          <div className="font-mono font-bold text-slate-900">{cp.componentCode}</div>
                          <div className="text-slate-600 text-[11px]">{cp.componentDescription}</div>
                        </td>

                        <td className="py-2.5 px-2 text-right font-mono text-slate-700">
                          {cp.totalStock.toLocaleString()} {cp.uom}
                        </td>

                        <td className="py-2.5 px-3 text-[11px] text-slate-600">
                          <div className="space-y-0.5">
                            {cp.sharedInFGs.map((fg) => (
                              <div key={fg.fgCode} className="truncate max-w-[200px]" title={fg.fgDescription}>
                                • <span className="font-mono font-semibold">{fg.fgCode}</span> ({fg.usagePerFG} {cp.uom}/FG)
                              </div>
                            ))}
                          </div>
                        </td>

                        <td className="py-2.5 px-3 text-[11px]">
                          {cp.reservations.length === 0 ? (
                            <span className="text-slate-400 italic">No frozen reservations</span>
                          ) : (
                            <div className="space-y-1">
                              {cp.reservations.map((r) => (
                                <div key={r.fgCode} className="bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded text-emerald-900 font-mono">
                                  {r.fgCode}: <span className="font-bold">{r.reservedQty.toLocaleString()} {cp.uom}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>

                        <td className="py-2.5 px-2 text-right font-mono font-bold text-slate-900 bg-slate-100/70">
                          {unreserved.toLocaleString()} {cp.uom}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsCommonPartsModalOpen(false)}
                className="px-4 py-1.5 bg-slate-900 text-white rounded text-xs font-medium hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
