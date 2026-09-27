import React, { useState, useEffect } from 'react';
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
  VendorDeliveryScheduleChangeLog,
  UserRole
} from './types';
import {
  INITIAL_BOM_MASTER,
  INITIAL_VENDOR_BUYER_MASTER,
  INITIAL_WEEK_DEFINITIONS,
  INITIAL_MONTHLY_PLANS,
  INITIAL_MB51_TRANSACTIONS,
  INITIAL_STOCK_REPORT,
  INITIAL_VENDOR_DELIVERY_SCHEDULES,
  INITIAL_MONDAY_REVIEW_ACTIONS,
  INITIAL_PLAN_FREEZE_ITEMS,
  INITIAL_DELIVERY_CHANGE_LOGS
} from './data/sapInitialData';

// Layout Components
import { Header } from './components/Header';
import { Sidebar, SubViewTab } from './components/Sidebar';

// Master Data Components
import { BOMMasterManager } from './components/MasterData/BOMMasterManager';
import { FGHeaderManager } from './components/MasterData/FGHeaderManager';
import { ComponentManager } from './components/MasterData/ComponentManager';
import { CommonComponentsDashboard } from './components/MasterData/CommonComponentsDashboard';
import { VendorBuyerManager } from './components/MasterData/VendorBuyerManager';
import bomService from './services/bomService';
import vendorBuyerService from './services/vendorBuyerService';
import { weekService, dtoToFrontend } from './services/weekService';
import { monthlyPlanService } from './services/monthlyPlanService';
import { mb51Service } from './services/mb51Service';
import { stockService } from './services/stockService';

// Monthly Upload Components
import { WeekDefinitionManager } from './components/MonthlyUpload/WeekDefinitionManager';
import { MonthlyPlanManager } from './components/MonthlyUpload/MonthlyPlanManager';

// Monday Upload Components
import { MB51ReportManager } from './components/MondayUpload/MB51ReportManager';
import { StockReportManager } from './components/MondayUpload/StockReportManager';

// Weekly MRP & Supply Views
import { MondayReviewCockpit } from './components/WeeklyMRP/MondayReviewCockpit';
import { ManagementProductionLossReport } from './components/Analytics/ManagementProductionLossReport';
import { PerformanceDashboard } from './components/Analytics/PerformanceDashboard';
import { VendorScheduleManager } from './components/WeeklyMRP/VendorScheduleManager';
import { WeeklyFGSupplyView } from './components/WeeklyMRP/WeeklyFGSupplyView';
import { WeeklyRMSupplyView } from './components/WeeklyMRP/WeeklyRMSupplyView';
import { AuditLogView } from './components/WeeklyMRP/AuditLogView';
import { computeRMWeeklyRequirements } from './utils/weeklyMrpEngine';

export default function App() {
  // Navigation State - Default to Monday Review Cockpit with collapsed sidebar for full-screen view
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sap_sidebar_collapsed');
    return saved !== null ? saved === 'true' : true;
  });
  const [activeSubView, setActiveSubView] = useState<SubViewTab>(() => {
    const saved = localStorage.getItem('sap_active_subview');
    if (saved === 'master_exploded_bom') return 'master_bom';
    return (saved as SubViewTab) || 'monday_review_cockpit';
  });

  const [currentRole, setCurrentRole] = useState<UserRole>(() => {
    const saved = localStorage.getItem('sap_current_role');
    return (saved as UserRole) || 'demand_planner';
  });

  const [selectedMonth, setSelectedMonth] = useState<string>('2026-08');

  // Core Data State (Persisted in localStorage)
  const [boms, setBoms] = useState<BOMItem[]>(() => {
    const saved = localStorage.getItem('sap_boms');
    return saved ? JSON.parse(saved) : INITIAL_BOM_MASTER;
  });

  const [vendorBuyers, setVendorBuyers] = useState<VendorBuyerItem[]>(() => {
    const saved = localStorage.getItem('sap_vendor_buyers');
    return saved ? JSON.parse(saved) : INITIAL_VENDOR_BUYER_MASTER;
  });

  const [weeks, setWeeks] = useState<WeekDefinition[]>(() => {
    const saved = localStorage.getItem('sap_weeks');
    return saved ? JSON.parse(saved) : INITIAL_WEEK_DEFINITIONS;
  });

  const [monthlyPlans, setMonthlyPlans] = useState<MonthlyPlanItem[]>(() => {
    const saved = localStorage.getItem('sap_monthly_plans');
    return saved ? JSON.parse(saved) : INITIAL_MONTHLY_PLANS;
  });

  const [mb51List, setMb51List] = useState<MB51TransactionItem[]>(() => {
    const saved = localStorage.getItem('sap_mb51');
    return saved ? JSON.parse(saved) : INITIAL_MB51_TRANSACTIONS;
  });

  const [stockList, setStockList] = useState<StockReportItem[]>(() => {
    const saved = localStorage.getItem('sap_stock');
    return saved ? JSON.parse(saved) : INITIAL_STOCK_REPORT;
  });

  const [vendorDeliverySchedules, setVendorDeliverySchedules] = useState<VendorDeliverySchedule[]>(() => {
    const saved = localStorage.getItem('sap_vendor_delivery_schedules');
    return saved ? JSON.parse(saved) : INITIAL_VENDOR_DELIVERY_SCHEDULES;
  });

  const [mondayReviewActions, setMondayReviewActions] = useState<MondayReviewActionItem[]>(() => {
    const saved = localStorage.getItem('sap_monday_review_actions');
    return saved ? JSON.parse(saved) : INITIAL_MONDAY_REVIEW_ACTIONS;
  });

  const [planFreezeList, setPlanFreezeList] = useState<FGPlanFreezeItem[]>(() => {
    const saved = localStorage.getItem('sap_plan_freeze');
    return saved ? JSON.parse(saved) : INITIAL_PLAN_FREEZE_ITEMS;
  });

  const [deliveryScheduleChangeLogs, setDeliveryScheduleChangeLogs] = useState<VendorDeliveryScheduleChangeLog[]>(() => {
    const saved = localStorage.getItem('sap_delivery_change_logs');
    return saved ? JSON.parse(saved) : INITIAL_DELIVERY_CHANGE_LOGS;
  });

  // LocalStorage sync effects
  useEffect(() => {
    localStorage.setItem('sap_sidebar_collapsed', String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem('sap_active_subview', activeSubView);
  }, [activeSubView]);

  useEffect(() => {
    localStorage.setItem('sap_current_role', currentRole);
  }, [currentRole]);

  useEffect(() => {
    localStorage.setItem('sap_boms', JSON.stringify(boms));
  }, [boms]);

  useEffect(() => {
    localStorage.setItem('sap_vendor_buyers', JSON.stringify(vendorBuyers));
  }, [vendorBuyers]);

  useEffect(() => {
    localStorage.setItem('sap_weeks', JSON.stringify(weeks));
  }, [weeks]);

  useEffect(() => {
    localStorage.setItem('sap_monthly_plans', JSON.stringify(monthlyPlans));
  }, [monthlyPlans]);

  useEffect(() => {
    localStorage.setItem('sap_mb51', JSON.stringify(mb51List));
  }, [mb51List]);

  useEffect(() => {
    localStorage.setItem('sap_stock', JSON.stringify(stockList));
  }, [stockList]);

  useEffect(() => {
    localStorage.setItem('sap_vendor_delivery_schedules', JSON.stringify(vendorDeliverySchedules));
  }, [vendorDeliverySchedules]);

  useEffect(() => {
    localStorage.setItem('sap_monday_review_actions', JSON.stringify(mondayReviewActions));
  }, [mondayReviewActions]);

  useEffect(() => {
    localStorage.setItem('sap_plan_freeze', JSON.stringify(planFreezeList));
  }, [planFreezeList]);

  useEffect(() => {
    localStorage.setItem('sap_delivery_change_logs', JSON.stringify(deliveryScheduleChangeLogs));
  }, [deliveryScheduleChangeLogs]);

  // Hydrate master data from backend PostgreSQL API on mount
  useEffect(() => {
    bomService.listAll()
      .then((items) => {
        if (Array.isArray(items)) {
          setBoms(
            items.map((dto) => ({
              id: String(dto.id),
              fgCode: dto.fg_code,
              fgDescription: dto.fg_description,
              componentCode: dto.component_code,
              componentDescription: dto.component_description,
              qty: dto.qty,
              uom: dto.uom,
              category: dto.category as 'RM' | 'PM',
            }))
          );
        }
      })
      .catch(() => {
        /* Non-fatal: fallback to existing localStorage or seed data */
      });

    vendorBuyerService.listAll()
      .then((items) => {
        if (Array.isArray(items)) {
          setVendorBuyers(
            items.map((dto) => ({
              id: String(dto.id),
              vendorCode: dto.vendor_code,
              vendorName: dto.vendor_name,
              buyerName: dto.buyer_name,
              buyerEmail: dto.buyer_email || '',
              buyerPhone: dto.buyer_phone || '',
              category: dto.category || 'RM',
              suppliedComponents: dto.supplied_components || [],
              leadTimeDays: dto.lead_time_days || 7,
              city: dto.city || '',
              gstNo: dto.gst_no || '',
            }))
          );
        }
      })
      .catch(() => {
        /* Non-fatal */
      });

    // Hydrate weeks from API
    weekService.list()
      .then((items) => {
        if (Array.isArray(items)) {
          setWeeks(items.map(dtoToFrontend));
        }
      })
      .catch(() => {});

    // Hydrate monthly plans from API
    monthlyPlanService.getMonthlyPlans()
      .then((plans) => {
        if (Array.isArray(plans)) {
          setMonthlyPlans(plans);
        }
      })
      .catch(() => {});

    // Hydrate MB51 transactions from API
    mb51Service.getTransactions()
      .then((txs) => {
        if (Array.isArray(txs)) {
          setMb51List(txs);
        }
      })
      .catch(() => {});

    // Hydrate stock report from API
    stockService.getStockReport()
      .then((items) => {
        if (Array.isArray(items)) {
          setStockList(items);
        }
      })
      .catch(() => {});
  }, []);

  // Compute Critical RM Shortages Count for Badges
  const rmSummaries = computeRMWeeklyRequirements(
    selectedMonth,
    monthlyPlans,
    weeks,
    boms,
    vendorBuyers,
    mb51List,
    stockList
  );
  const criticalShortagesCount = rmSummaries.filter((s) => s.overallStatus === 'SHORTAGE').length;

  const handleResetData = () => {
    if (
      window.confirm(
        'Reset all Master Data, Monthly Plans, Week Definitions, MB51 Transactions, Stock balances, Delivery Schedules and Action items to initial state?'
      )
    ) {
      setBoms(INITIAL_BOM_MASTER);
      setVendorBuyers(INITIAL_VENDOR_BUYER_MASTER);
      setWeeks(INITIAL_WEEK_DEFINITIONS);
      setMonthlyPlans(INITIAL_MONTHLY_PLANS);
      setMb51List(INITIAL_MB51_TRANSACTIONS);
      setStockList(INITIAL_STOCK_REPORT);
      setVendorDeliverySchedules(INITIAL_VENDOR_DELIVERY_SCHEDULES);
      setMondayReviewActions(INITIAL_MONDAY_REVIEW_ACTIONS);
      setPlanFreezeList(INITIAL_PLAN_FREEZE_ITEMS);
      setDeliveryScheduleChangeLogs(INITIAL_DELIVERY_CHANGE_LOGS);
      localStorage.clear();
      window.location.reload();
    }
  };

  const getActiveViewTitle = () => {
    switch (activeSubView) {
      case 'monday_review_cockpit':
        return 'Monday Review & Seamless Production Cockpit';
      case 'management_loss_report':
        return 'Executive Management Report: Critical Items & Weekly Production Loss Matrix';
      case 'performance_dashboard':
        return 'Performance Dashboard: Monthly Fulfillment, RM Trends & Stock Accuracy';
      case 'update_delivery_schedule':
        return 'Vendor Delivery Schedule Updation & Consolidated RM Matrix (Supply/Buyer)';
      case 'weekly_rm_matrix':
        return 'Weekly RM/PM MRP & Shortage Matrix';
      case 'weekly_fg_matrix':
        return 'Weekly FG Supply & Dispatch Matrix';
      case 'monthly_define_weeks':
        return 'Monthly Calendar: Define Week No.';
      case 'monthly_plan_upload':
        return 'Monthly Upload: FG Plan & Prorating';
      case 'monday_mb51_report':
        return 'Monday Upload: SAP MB51 Movement Report';
      case 'monday_stock_report':
        return 'Monday Upload: Stock Report (MB52)';
      case 'master_bom':
        return 'Master Data: BOM Master';
      case 'master_vendor_buyer':
        return 'Master Data: Vendor & Buyer Relationship';
      case 'audit_log':
        return 'System Audit Log';
      default:
        return 'Weekly MRP & Supply Operations';
    }
  };

  const handleSelectRole = (role: UserRole) => {
    setCurrentRole(role);
    if (role === 'management' && activeSubView !== 'management_loss_report' && activeSubView !== 'performance_dashboard') {
      setActiveSubView('management_loss_report');
    }
  };

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900 font-sans overflow-hidden">
      {/* 1. Collapsible Sidebar */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        currentRole={currentRole}
        onSelectRole={handleSelectRole}
        activeSubView={activeSubView}
        onSelectSubView={setActiveSubView}
        criticalShortagesCount={criticalShortagesCount}
        onResetData={handleResetData}
      />

      {/* 2. Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <Header
          currentRole={currentRole}
          setCurrentRole={handleSelectRole}
          selectedMonth={selectedMonth}
          setSelectedMonth={setSelectedMonth}
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onResetData={handleResetData}
          criticalShortageCount={criticalShortagesCount}
          activeViewTitle={getActiveViewTitle()}
        />

        {/* Scrollable View Container - Full Width Dynamic Layout */}
        <main className="flex-1 overflow-y-auto p-2 sm:p-3 md:p-3.5 bg-slate-100">
          <div className="w-full space-y-3 max-w-[100vw]">
            {/* View 0: Monday Review Cockpit (Single Unified Screen) */}
            {activeSubView === 'monday_review_cockpit' && (
              <MondayReviewCockpit
                monthlyPlans={monthlyPlans}
                weeks={weeks}
                boms={boms}
                vendorBuyers={vendorBuyers}
                mb51List={mb51List}
                stockList={stockList}
                vendorDeliverySchedules={vendorDeliverySchedules}
                onUpdateVendorDeliverySchedules={setVendorDeliverySchedules}
                mondayReviewActions={mondayReviewActions}
                onUpdateMondayReviewActions={setMondayReviewActions}
                planFreezeList={planFreezeList}
                onUpdatePlanFreezeList={setPlanFreezeList}
                deliveryScheduleChangeLogs={deliveryScheduleChangeLogs}
                onUpdateDeliveryScheduleChangeLogs={setDeliveryScheduleChangeLogs}
                selectedMonth={selectedMonth}
                onSelectMonth={setSelectedMonth}
                currentRole={currentRole}
                onSelectRole={setCurrentRole}
                isSidebarCollapsed={isSidebarCollapsed}
                onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              />
            )}

            {/* View 0.15: Executive Management Critical Items & Production Loss Matrix */}
            {activeSubView === 'management_loss_report' && (
              <ManagementProductionLossReport
                selectedMonth={selectedMonth}
                setSelectedMonth={setSelectedMonth}
                weeks={weeks}
                monthlyPlans={monthlyPlans}
                boms={boms}
                vendorBuyers={vendorBuyers}
                mb51List={mb51List}
                stockList={stockList}
                vendorDeliverySchedules={vendorDeliverySchedules}
                planFreezeList={planFreezeList}
                onNavigateToCockpit={(weekId, fgCode) => {
                  setActiveSubView('monday_review_cockpit');
                }}
                onNavigateToVendorSchedule={(compCode) => {
                  setActiveSubView('update_delivery_schedule');
                }}
              />
            )}

            {/* View 0.2: Executive Performance Dashboard (Fulfillment Rates, RM Availability Trends & Stock Accuracy) */}
            {activeSubView === 'performance_dashboard' && (
              <PerformanceDashboard
                monthlyPlans={monthlyPlans}
                weeks={weeks}
                boms={boms}
                vendorBuyers={vendorBuyers}
                mb51List={mb51List}
                stockList={stockList}
                vendorDeliverySchedules={vendorDeliverySchedules}
                selectedMonth={selectedMonth}
                onSelectMonth={setSelectedMonth}
                currentRole={currentRole}
                onNavigateToCockpit={() => setActiveSubView('monday_review_cockpit')}
                onNavigateToRMSupply={() => setActiveSubView('weekly_rm_matrix')}
              />
            )}

            {/* View 0.5: Vendor Delivery Schedule Updation & Consolidated RM Matrix (Supply / Buyer Role) */}
            {activeSubView === 'update_delivery_schedule' && (
              <VendorScheduleManager
                monthlyPlans={monthlyPlans}
                weeks={weeks}
                boms={boms}
                vendorBuyers={vendorBuyers}
                mb51List={mb51List}
                stockList={stockList}
                vendorDeliverySchedules={vendorDeliverySchedules}
                onUpdateVendorDeliverySchedules={setVendorDeliverySchedules}
                deliveryScheduleChangeLogs={deliveryScheduleChangeLogs}
                onUpdateDeliveryScheduleChangeLogs={setDeliveryScheduleChangeLogs}
                selectedMonth={selectedMonth}
                onSelectMonth={setSelectedMonth}
                currentRole={currentRole}
                onSelectRole={setCurrentRole}
              />
            )}

            {/* View 1: Weekly RM/PM MRP & Shortages */}
            {activeSubView === 'weekly_rm_matrix' && (
              <WeeklyRMSupplyView
                monthlyPlans={monthlyPlans}
                weeks={weeks}
                boms={boms}
                vendorBuyers={vendorBuyers}
                mb51List={mb51List}
                stockList={stockList}
                selectedMonth={selectedMonth}
                onSelectMonth={setSelectedMonth}
              />
            )}

            {/* View 2: Weekly FG Supply Matrix */}
            {activeSubView === 'weekly_fg_matrix' && (
              <WeeklyFGSupplyView
                monthlyPlans={monthlyPlans}
                weeks={weeks}
                mb51List={mb51List}
                stockList={stockList}
                selectedMonth={selectedMonth}
                onSelectMonth={setSelectedMonth}
              />
            )}

            {/* View 3: Monthly - Define Week No. */}
            {activeSubView === 'monthly_define_weeks' && (
              <WeekDefinitionManager
                weeks={weeks}
                onUpdateWeeks={setWeeks}
                selectedMonth={selectedMonth}
                onSelectMonth={setSelectedMonth}
              />
            )}

            {/* View 4: Monthly - Upload Monthly Plan */}
            {activeSubView === 'monthly_plan_upload' && (
              <MonthlyPlanManager
                monthlyPlans={monthlyPlans}
                onUpdateMonthlyPlans={setMonthlyPlans}
                weeks={weeks}
                boms={boms}
                selectedMonth={selectedMonth}
                onSelectMonth={setSelectedMonth}
              />
            )}

            {/* View 5: Monday - SAP MB51 Report */}
            {activeSubView === 'monday_mb51_report' && (
              <MB51ReportManager
                mb51List={mb51List}
                onUpdateMB51={setMb51List}
                weeks={weeks}
                selectedMonth={selectedMonth}
              />
            )}

            {/* View 6: Monday - Stock Report */}
            {activeSubView === 'monday_stock_report' && (
              <StockReportManager
                stockList={stockList}
                onUpdateStock={setStockList}
              />
            )}

            {/* View 7: Master Data - BOM Master Lines */}
            {activeSubView === 'master_bom' && (
              <BOMMasterManager
                boms={boms}
                onUpdateBoms={setBoms}
              />
            )}

            {/* View 7b: Master Data - Finished Goods Headers */}
            {activeSubView === 'master_fg_headers' && (
              <FGHeaderManager />
            )}

            {/* View 7c: Master Data - RM/PM Components Master */}
            {activeSubView === 'master_components' && (
              <ComponentManager />
            )}

            {/* View 7d: Master Data - Common Components Matrix */}
            {activeSubView === 'master_common_components' && (
              <CommonComponentsDashboard />
            )}

            {/* View 8: Master Data - Vendor & Buyer Relationship */}
            {activeSubView === 'master_vendor_buyer' && (
              <VendorBuyerManager
                vendorBuyers={vendorBuyers}
                onUpdateVendorBuyers={setVendorBuyers}
              />
            )}

            {/* View 9: Audit Log */}
            {activeSubView === 'audit_log' && (
              <AuditLogView
                deliveryScheduleChangeLogs={deliveryScheduleChangeLogs}
                planFreezeList={planFreezeList}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
