import React, { useState } from 'react';
import {
  Layers,
  AlertTriangle,
  CheckCircle2,
  Download,
  Search,
  Filter,
  Users,
  Building2,
  Calendar,
  Package,
  Phone,
  Mail,
  Clock,
  ArrowDownLeft,
  Share2,
  FileSpreadsheet,
  AlertCircle,
  Truck,
  RotateCcw,
  ExternalLink,
  Send
} from 'lucide-react';
import {
  MonthlyPlanItem,
  WeekDefinition,
  BOMItem,
  VendorBuyerItem,
  MB51TransactionItem,
  StockReportItem,
  VendorDeliverySchedule,
  RMWeeklyRequirementSummary
} from '../../types';
import { computeRMWeeklyRequirements } from '../../utils/weeklyMrpEngine';

interface WeeklyRMSupplyViewProps {
  monthlyPlans: MonthlyPlanItem[];
  weeks: WeekDefinition[];
  boms: BOMItem[];
  vendorBuyers: VendorBuyerItem[];
  mb51List: MB51TransactionItem[];
  stockList: StockReportItem[];
  vendorDeliverySchedules?: VendorDeliverySchedule[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  onNavigateToDeliverySchedule?: () => void;
  openingStockDate?: string;
}

export const WeeklyRMSupplyView: React.FC<WeeklyRMSupplyViewProps> = ({
  monthlyPlans,
  weeks,
  boms,
  vendorBuyers,
  mb51List,
  stockList,
  vendorDeliverySchedules = [],
  selectedMonth,
  onSelectMonth,
  onNavigateToDeliverySchedule,
  openingStockDate
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [buyerFilter, setBuyerFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | 'RM' | 'PM'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'SHORTAGE' | 'WARNING' | 'OK'>('ALL');
  const [selectedCompForDetail, setSelectedCompForDetail] = useState<RMWeeklyRequirementSummary | null>(null);

  const monthWeeks = weeks
    .filter((w) => w.month === selectedMonth)
    .sort((a, b) => a.weekNo - b.weekNo);

  const summaries = computeRMWeeklyRequirements(
    selectedMonth,
    monthlyPlans,
    weeks,
    boms,
    vendorBuyers,
    mb51List,
    stockList,
    vendorDeliverySchedules,
    openingStockDate
  );

  const uniqueBuyers = Array.from(new Set(summaries.map((s) => s.buyerName))).filter(Boolean);

  const filteredSummaries = summaries.filter((s) => {
    const matchesSearch =
      s.componentCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.componentDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.vendorName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.buyerName.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesBuyer = buyerFilter === 'ALL' || s.buyerName === buyerFilter;
    const matchesCategory = categoryFilter === 'ALL' || s.category === categoryFilter;
    const matchesStatus = statusFilter === 'ALL' || s.overallStatus === statusFilter;

    return matchesSearch && matchesBuyer && matchesCategory && matchesStatus;
  });

  // KPI Calculations
  const totalRMComponents = summaries.length;
  const criticalShortageCount = summaries.filter((s) => s.overallStatus === 'SHORTAGE').length;
  const warningCount = summaries.filter((s) => s.overallStatus === 'WARNING').length;
  const totalGrossReq = filteredSummaries.reduce((sum, s) => sum + s.totalGrossRequirement, 0);

  const handleExportCSV = () => {
    const headers = [
      'Component Code',
      'Component Description',
      'Category',
      'Buyer Name',
      'Vendor Name',
      'Vendor Code',
      'Lead Time (Days)',
      'Current Stock',
      'Safety Stock',
      ...monthWeeks.flatMap((w) => [
        `${w.weekLabel} Gross Req`,
        `${w.weekLabel} MB51 101 Inward`,
        `${w.weekLabel} Sched Delivery`,
        `${w.weekLabel} Total Inward Supply`,
        `${w.weekLabel} Projected Stock`,
        `${w.weekLabel} Status`
      ]),
      'Total Gross Req',
      'Total MB51 Inward',
      'Total Sched Delivery',
      'Overall Status'
    ];

    const rows = filteredSummaries.map((s) => {
      const weekCols = s.weeks.flatMap((w) => [
        w.grossRequirement,
        w.actualInwardReceipt,
        w.scheduledDeliveryQty || 0,
        w.totalInwardSupply || (w.actualInwardReceipt + (w.scheduledDeliveryQty || 0)),
        w.projectedStock,
        w.status
      ]);

      return [
        `"${s.componentCode}"`,
        `"${s.componentDescription}"`,
        `"${s.category}"`,
        `"${s.buyerName}"`,
        `"${s.vendorName}"`,
        `"${s.vendorCode}"`,
        s.leadTimeDays,
        s.currentStock,
        s.safetyStock,
        ...weekCols,
        s.totalGrossRequirement,
        s.totalInwardReceived,
        s.totalScheduledDelivery || 0,
        `"${s.overallStatus}"`
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Weekly_RM_MRP_Consolidated_${selectedMonth}.csv`;
    link.click();
  };

  const handleExportSingleComponentCSV = (comp: RMWeeklyRequirementSummary) => {
    const headers = [
      'Week Bucket',
      'Gross Requirement',
      'Actual 101 Inward (MB51)',
      'Promised Schedule (Commitments)',
      'Total Inward Supply',
      'Projected Stock',
      'Deficit',
      'Status'
    ];

    const rows = comp.weeks.map((w) => [
      `"${w.weekLabel}"`,
      w.grossRequirement,
      w.actualInwardReceipt,
      w.scheduledDeliveryQty || 0,
      w.totalInwardSupply || (w.actualInwardReceipt + (w.scheduledDeliveryQty || 0)),
      w.projectedStock,
      w.deficit,
      `"${w.status}"`
    ]);

    const csvContent = [
      `"Component Code","${comp.componentCode}"`,
      `"Description","${comp.componentDescription}"`,
      `"Category","${comp.category}"`,
      `"Current Stock","${comp.currentStock}"`,
      `"Safety Stock","${comp.safetyStock}"`,
      `"Buyer","${comp.buyerName}"`,
      `"Supplier","${comp.vendorName} (${comp.vendorCode})"`,
      '',
      headers.join(','),
      ...rows.map((r) => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Shortage_Report_${comp.componentCode}_${selectedMonth}.csv`;
    link.click();
  };

  const isAnyFilterActive =
    Boolean(searchTerm) ||
    buyerFilter !== 'ALL' ||
    categoryFilter !== 'ALL' ||
    statusFilter !== 'ALL';

  // Find buyer details for active modal
  const activeBuyerInfo = selectedCompForDetail
    ? vendorBuyers.find(
        (vb) =>
          vb.suppliedComponents &&
          vb.suppliedComponents.includes(selectedCompForDetail.componentCode)
      )
    : null;

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Weekly RM/PM MRP & Supply Shortage Matrix</h1>
            <p className="text-sm text-slate-500">
              Consolidated BOM gross requirements vs current stock vs inward supply (MB51 GRNs + delivery commitments) by Buyer & Vendor
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Export MRP Matrix
          </button>
        </div>
      </div>

      {/* Month Selection and Quick Statistics */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5 whitespace-nowrap">
            <Calendar className="w-4 h-4 text-amber-600" />
            Planning Month:
          </label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => onSelectMonth(e.target.value)}
            className="px-3.5 py-2 text-sm font-bold border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-amber-500 font-mono"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
          <span className="text-slate-500">BOM Explosion Source:</span>
          <span className="px-2.5 py-1 bg-white border border-slate-200 rounded text-slate-800 font-mono">
            {monthlyPlans.filter((p) => p.month === selectedMonth).length} Active FG Plans
          </span>
          <span className="text-slate-400">|</span>
          <span className="text-slate-500">Calendar Buckets:</span>
          {monthWeeks.map((w) => (
            <span
              key={w.id}
              className="px-2.5 py-1 bg-white border border-slate-200 rounded text-slate-800 font-mono"
            >
              {w.weekLabel} ({w.daysCount}d)
            </span>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Total Tracked Materials</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
            {totalRMComponents.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Parts</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">Exploded across active month BOMs</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Critical Shortages</div>
          <div className="text-2xl font-bold text-red-600 mt-1 font-mono flex items-center gap-2">
            {criticalShortageCount}
            {criticalShortageCount > 0 && <AlertTriangle className="w-5 h-5 text-red-500" />}
          </div>
          <div className="text-xs text-red-700 font-semibold mt-1">
            Projected negative stock balance
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Low Stock Warnings</div>
          <div className="text-2xl font-bold text-amber-600 mt-1 font-mono flex items-center gap-2">
            {warningCount}
            {warningCount > 0 && <AlertCircle className="w-5 h-5 text-amber-500" />}
          </div>
          <div className="text-xs text-slate-500 mt-1">Stock falls below safety threshold</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Assigned Buyers</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
            {uniqueBuyers.length} Buyers
          </div>
          <div className="text-xs text-slate-500 mt-1">From Vendor-Buyer relationship master</div>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          {/* Search Input */}
          <div className="relative min-w-[220px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search component, description, vendor, buyer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500"
            />
          </div>

          {/* Buyer Filter */}
          <select
            value={buyerFilter}
            onChange={(e) => setBuyerFilter(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 font-medium focus:ring-2 focus:ring-amber-500"
          >
            <option value="ALL">All Buyers ({uniqueBuyers.length})</option>
            {uniqueBuyers.map((buyer) => (
              <option key={buyer} value={buyer}>
                {buyer}
              </option>
            ))}
          </select>

          {/* Category Filter Toggle (RM vs PM) */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setCategoryFilter('ALL')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                categoryFilter === 'ALL'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Types
            </button>
            <button
              onClick={() => setCategoryFilter('RM')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                categoryFilter === 'RM'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-emerald-700'
              }`}
            >
              RM Only
            </button>
            <button
              onClick={() => setCategoryFilter('PM')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                categoryFilter === 'PM'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-purple-700'
              }`}
            >
              PM Only
            </button>
          </div>

          {/* Status Filter Toggle */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
            <button
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                statusFilter === 'ALL'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Status
            </button>
            <button
              onClick={() => setStatusFilter('SHORTAGE')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                statusFilter === 'SHORTAGE'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-red-700'
              }`}
            >
              Shortage ({criticalShortageCount})
            </button>
            <button
              onClick={() => setStatusFilter('WARNING')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                statusFilter === 'WARNING'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-amber-700'
              }`}
            >
              Warning ({warningCount})
            </button>
          </div>

          {/* 1-Click Reset Filters Button */}
          {isAnyFilterActive && (
            <button
              onClick={() => {
                setSearchTerm('');
                setBuyerFilter('ALL');
                setCategoryFilter('ALL');
                setStatusFilter('ALL');
              }}
              className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1"
              title="Reset all search terms and filters"
            >
              <RotateCcw className="w-3 h-3 text-slate-500" />
              Reset
            </button>
          )}
        </div>

        <div className="text-xs text-slate-500 font-medium whitespace-nowrap">
          Showing <span className="font-bold text-slate-900">{filteredSummaries.length}</span> Materials
        </div>
      </div>

      {/* Main MRP Consolidated Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase tracking-wider font-semibold">
                <th className="py-3 px-3">Component Part</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3">Assigned Buyer & Vendor</th>
                <th className="py-3 px-3 text-right">Current Stock</th>
                <th className="py-3 px-3 text-right">Safety Stock</th>
                {monthWeeks.map((w) => (
                  <th
                    key={w.id}
                    colSpan={3}
                    className="py-2 px-3 text-center border-l border-slate-200 font-bold bg-slate-100/70"
                  >
                    <div className="text-slate-900 font-bold">{w.weekLabel}</div>
                    <div className="text-[10px] text-slate-500 font-normal lowercase">
                      {w.daysCount} Days
                    </div>
                  </th>
                ))}
                <th className="py-3 px-3 text-center border-l border-slate-200">Overall Status</th>
              </tr>
              <tr className="bg-slate-100/50 border-b border-slate-200 text-slate-500 text-[10px] font-semibold">
                <th colSpan={5}></th>
                {monthWeeks.map((w) => (
                  <React.Fragment key={w.id}>
                    <th className="py-1.5 px-2 text-right border-l border-slate-200 text-slate-700">
                      Gross Req
                    </th>
                    <th className="py-1.5 px-2 text-right text-emerald-700 font-bold" title="Inward Supply: MB51 GRNs + Promised Delivery Commitments">
                      Inward Supply
                    </th>
                    <th className="py-1.5 px-2 text-right text-slate-900 font-bold">Proj Stock</th>
                  </React.Fragment>
                ))}
                <th className="border-l border-slate-200"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredSummaries.length === 0 ? (
                <tr>
                  <td colSpan={6 + monthWeeks.length * 3} className="py-8 text-center text-slate-400">
                    No components found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredSummaries.map((s) => {
                  return (
                    <tr
                      key={s.componentCode}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                      onClick={() => setSelectedCompForDetail(s)}
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 font-mono text-xs flex items-center gap-1">
                          <span className="px-1.5 py-0.5 bg-slate-100 text-slate-800 rounded border border-slate-200">
                            {s.componentCode}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 mt-0.5 font-medium">
                          {s.componentDescription}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            s.category === 'PM'
                              ? 'bg-purple-100 text-purple-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {s.category}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900 text-xs flex items-center gap-1">
                          <Users className="w-3 h-3 text-amber-600" />
                          {s.buyerName}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                          <Building2 className="w-3 h-3 text-slate-400" />
                          {s.vendorName} ({s.leadTimeDays}d LT)
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        {s.currentStock.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                        {s.safetyStock.toLocaleString()}
                      </td>

                      {/* Weekly Sub Columns */}
                      {s.weeks.map((w) => {
                        const isShortage = w.status === 'SHORTAGE';
                        const isWarn = w.status === 'WARNING';
                        const totalInward =
                          w.totalInwardSupply ??
                          (w.actualInwardReceipt + (w.scheduledDeliveryQty || 0));
                        const hasScheduledOnly =
                          w.actualInwardReceipt === 0 && (w.scheduledDeliveryQty || 0) > 0;

                        return (
                          <React.Fragment key={w.weekId}>
                            <td className="py-2.5 px-2 text-right font-mono text-slate-700 border-l border-slate-200">
                              {w.grossRequirement.toLocaleString()}
                            </td>
                            <td className="py-2.5 px-2 text-right font-mono bg-emerald-50/20">
                              <div className="flex flex-col items-end leading-tight">
                                <span
                                  className={
                                    w.actualInwardReceipt > 0
                                      ? 'text-emerald-700 font-bold'
                                      : hasScheduledOnly
                                      ? 'text-blue-700 font-semibold flex items-center gap-0.5'
                                      : 'text-slate-400 font-normal'
                                  }
                                >
                                  {hasScheduledOnly && <Truck className="w-2.5 h-2.5 text-blue-500 inline mr-0.5" />}
                                  {totalInward.toLocaleString()}
                                </span>
                                {(w.scheduledDeliveryQty || 0) > 0 && w.actualInwardReceipt > 0 && (
                                  <span className="text-[8px] text-slate-500 font-normal">
                                    {w.actualInwardReceipt} rec + {w.scheduledDeliveryQty} sch
                                  </span>
                                )}
                              </div>
                            </td>
                            <td
                              className={`py-2.5 px-2 text-right font-mono font-bold ${
                                isShortage
                                  ? 'text-red-700 bg-red-50/60'
                                  : isWarn
                                  ? 'text-amber-700 bg-amber-50/40'
                                  : 'text-slate-900'
                              }`}
                            >
                              {w.projectedStock.toLocaleString()}
                            </td>
                          </React.Fragment>
                        );
                      })}

                      <td className="py-2.5 px-3 text-center border-l border-slate-200">
                        {s.overallStatus === 'SHORTAGE' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-800 rounded font-bold text-[11px]">
                            <AlertTriangle className="w-3 h-3 text-red-600" />
                            Deficit (-{s.maxShortageQty.toLocaleString()})
                          </span>
                        )}
                        {s.overallStatus === 'WARNING' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded font-bold text-[11px]">
                            <AlertCircle className="w-3 h-3 text-amber-600" />
                            Low Stock
                          </span>
                        )}
                        {s.overallStatus === 'OK' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded font-bold text-[11px]">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Balanced
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Component Detail & Expediting Modal */}
      {selectedCompForDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-slate-200 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-900 rounded font-mono font-bold text-sm border border-slate-200">
                    {selectedCompForDetail.componentCode}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      selectedCompForDetail.category === 'PM'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {selectedCompForDetail.category}
                  </span>
                  {selectedCompForDetail.overallStatus === 'SHORTAGE' && (
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700 border border-red-200 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Critical Shortage
                    </span>
                  )}
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-1">
                  {selectedCompForDetail.componentDescription}
                </h3>
              </div>
              <button
                onClick={() => setSelectedCompForDetail(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg p-1"
              >
                ✕
              </button>
            </div>

            {/* Buyer and Vendor Relationship Card */}
            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
              <div>
                <div className="font-semibold text-slate-500 mb-1 flex items-center gap-1">
                  <Users className="w-3.5 h-3.5 text-amber-600" />
                  Assigned Supply Buyer:
                </div>
                <div className="font-bold text-slate-900 text-sm">
                  {selectedCompForDetail.buyerName}
                </div>
                {activeBuyerInfo?.buyerEmail && (
                  <div className="text-slate-600 mt-1 flex items-center gap-1">
                    <Mail className="w-3 h-3 text-slate-400" />
                    <a
                      href={`mailto:${activeBuyerInfo.buyerEmail}`}
                      className="text-blue-600 hover:underline"
                    >
                      {activeBuyerInfo.buyerEmail}
                    </a>
                  </div>
                )}
                {activeBuyerInfo?.buyerPhone && (
                  <div className="text-slate-600 mt-0.5 flex items-center gap-1">
                    <Phone className="w-3 h-3 text-slate-400" />
                    <a href={`tel:${activeBuyerInfo.buyerPhone}`} className="hover:underline">
                      {activeBuyerInfo.buyerPhone}
                    </a>
                  </div>
                )}
              </div>

              <div>
                <div className="font-semibold text-slate-500 mb-1 flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                  Supplier / Vendor:
                </div>
                <div className="font-bold text-slate-900 text-sm">
                  {selectedCompForDetail.vendorName} ({selectedCompForDetail.vendorCode})
                </div>
                <div className="text-slate-500 mt-0.5">
                  Procurement Lead Time: <strong>{selectedCompForDetail.leadTimeDays} Days</strong>
                </div>
                <div className="text-slate-500 mt-0.5">
                  Stock on Hand: <strong>{selectedCompForDetail.currentStock.toLocaleString()}</strong> | Safety: <strong>{selectedCompForDetail.safetyStock.toLocaleString()}</strong>
                </div>
              </div>
            </div>

            {/* Used in FGs BOM breakdown */}
            <div>
              <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">
                Parent Finished Goods (BOM Multipliers)
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {selectedCompForDetail.usedInFGs.map((fg) => (
                  <div
                    key={fg.fgCode}
                    className="p-2.5 bg-white rounded-lg border border-slate-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-blue-700">{fg.fgCode}</span>
                      <div className="text-[11px] text-slate-500">{fg.fgDescription}</div>
                    </div>
                    <span className="font-bold text-slate-900 font-mono">
                      {fg.usagePerFG} / unit
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Weekly Flow Table */}
            <div>
              <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">
                Weekly Requirements vs Inward Schedule
              </h4>
              <table className="w-full text-xs text-left border border-slate-200 rounded-lg overflow-hidden">
                <thead className="bg-slate-100 text-slate-600 font-semibold">
                  <tr>
                    <th className="p-2">Week Bucket</th>
                    <th className="p-2 text-right">Gross Req</th>
                    <th className="p-2 text-right">MB51 (GRN)</th>
                    <th className="p-2 text-right">Sched Delivery</th>
                    <th className="p-2 text-right">Proj Stock</th>
                    <th className="p-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {selectedCompForDetail.weeks.map((w) => (
                    <tr key={w.weekId}>
                      <td className="p-2 font-semibold text-slate-900">{w.weekLabel}</td>
                      <td className="p-2 text-right font-mono">{w.grossRequirement.toLocaleString()}</td>
                      <td className="p-2 text-right font-mono font-bold text-emerald-700">
                        {w.actualInwardReceipt.toLocaleString()}
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-blue-700">
                        {(w.scheduledDeliveryQty || 0).toLocaleString()}
                      </td>
                      <td
                        className={`p-2 text-right font-mono font-bold ${
                          w.status === 'SHORTAGE' ? 'text-red-600' : 'text-slate-900'
                        }`}
                      >
                        {w.projectedStock.toLocaleString()}
                      </td>
                      <td className="p-2 text-center">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            w.status === 'SHORTAGE'
                              ? 'bg-red-100 text-red-800'
                              : w.status === 'WARNING'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {w.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Expediting & Communication Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
              <div className="flex items-center gap-2">
                {/* Email Buyer Button */}
                <button
                  onClick={() => {
                    const recipient = activeBuyerInfo?.buyerEmail || 'buyer@kspg.internal';
                    const subject = encodeURIComponent(
                      `[URGENT] RM Shortage Alert: ${selectedCompForDetail.componentCode} - ${selectedCompForDetail.componentDescription}`
                    );
                    const body = encodeURIComponent(
                      `Dear ${selectedCompForDetail.buyerName},\n\n` +
                        `Please note an operational supply shortage for component ${selectedCompForDetail.componentCode} (${selectedCompForDetail.componentDescription}).\n\n` +
                        `Month: ${selectedMonth}\n` +
                        `Current Stock: ${selectedCompForDetail.currentStock.toLocaleString()}\n` +
                        `Safety Stock: ${selectedCompForDetail.safetyStock.toLocaleString()}\n` +
                        `Maximum Shortage Deficit: -${selectedCompForDetail.maxShortageQty.toLocaleString()} units\n` +
                        `Assigned Supplier: ${selectedCompForDetail.vendorName} (${selectedCompForDetail.vendorCode})\n` +
                        `Lead Time: ${selectedCompForDetail.leadTimeDays} days\n\n` +
                        `Please expedite vendor delivery commitments to prevent production stoppage.\n\n` +
                        `Generated from KSPG Cockpit MRP Operations.`
                    );
                    window.open(`mailto:${recipient}?subject=${subject}&body=${body}`, '_blank');
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Email Buyer
                </button>

                {/* Export Single Component CSV */}
                <button
                  onClick={() => handleExportSingleComponentCSV(selectedCompForDetail)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
                  Export Part CSV
                </button>

                {/* Shortcut to Update Delivery Schedule */}
                {onNavigateToDeliverySchedule && (
                  <button
                    onClick={() => {
                      setSelectedCompForDetail(null);
                      onNavigateToDeliverySchedule();
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-amber-600" />
                    Update Delivery Schedule
                  </button>
                )}
              </div>

              <button
                onClick={() => setSelectedCompForDetail(null)}
                className="px-4 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
