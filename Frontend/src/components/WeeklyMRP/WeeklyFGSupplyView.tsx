import React, { useState } from 'react';
import {
  Factory,
  TrendingUp,
  Calendar,
  Download,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  Truck,
  Layers,
  PackageCheck
} from 'lucide-react';
import {
  MonthlyPlanItem,
  WeekDefinition,
  MB51TransactionItem,
  StockReportItem
} from '../../types';
import { computeFGWeeklyCoverage } from '../../utils/weeklyMrpEngine';

interface WeeklyFGSupplyViewProps {
  monthlyPlans: MonthlyPlanItem[];
  weeks: WeekDefinition[];
  mb51List: MB51TransactionItem[];
  stockList: StockReportItem[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
  openingStockDate?: string;
}

export const WeeklyFGSupplyView: React.FC<WeeklyFGSupplyViewProps> = ({
  monthlyPlans,
  weeks,
  mb51List,
  stockList,
  selectedMonth,
  onSelectMonth,
  openingStockDate
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFG, setSelectedFG] = useState<string>('ALL');

  const monthWeeks = weeks
    .filter((w) => w.month === selectedMonth)
    .sort((a, b) => a.weekNo - b.weekNo);

  const coverageSummaries = computeFGWeeklyCoverage(
    selectedMonth,
    monthlyPlans,
    weeks,
    mb51List,
    stockList,
    openingStockDate
  );

  const uniqueFGs = Array.from(
    new Map(
      coverageSummaries.map((s) => [s.fgCode, { fgCode: s.fgCode, fgDescription: s.fgDescription }])
    ).values()
  );

  const filteredSummaries = coverageSummaries.filter((s) => {
    const matchesSearch =
      s.fgCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.fgDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.customerName || '').toLowerCase().includes(searchTerm.toLowerCase());

    const matchesFG = selectedFG === 'ALL' || s.fgCode === selectedFG;

    return matchesSearch && matchesFG;
  });

  // KPI Calculations
  const totalPlannedTarget = filteredSummaries.reduce(
    (sum, s) => sum + s.monthlyPlanTarget,
    0
  );
  const totalActualProduced = filteredSummaries.reduce(
    (sum, s) => sum + s.totalActualProduction,
    0
  );
  const totalActualDispatched = filteredSummaries.reduce(
    (sum, s) => sum + s.totalActualDispatch,
    0
  );
  const overallAvgAchievement =
    totalPlannedTarget > 0 ? (totalActualProduced / totalPlannedTarget) * 100 : 0;

  const handleExportCSV = () => {
    const headers = [
      'FG Code',
      'FG Description',
      'Customer',
      'Starting Stock',
      'Monthly Target',
      ...monthWeeks.flatMap((w) => [
        `${w.weekLabel} Plan`,
        `${w.weekLabel} 101 Prod`,
        `${w.weekLabel} 601 Disp`,
        `${w.weekLabel} Closing`
      ]),
      'Total 101 Prod',
      'Total 601 Disp',
      'Plan Achievement %'
    ];

    const rows = filteredSummaries.map((s) => {
      const weekCols = s.weeks.flatMap((w) => [
        w.planTarget,
        w.actualProductionReceipt,
        w.actualDispatch,
        w.closingStock
      ]);

      return [
        `"${s.fgCode}"`,
        `"${s.fgDescription}"`,
        `"${s.customerName || ''}"`,
        s.startingStock,
        s.monthlyPlanTarget,
        ...weekCols,
        s.totalActualProduction,
        s.totalActualDispatch,
        `${s.overallAchievementRate}%`
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Weekly_FG_Supply_Coverage_${selectedMonth}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <Factory className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Weekly Finished Goods (FG) Supply Matrix</h1>
            <p className="text-sm text-slate-500">
              Prorated weekly plan vs MB51 actual production receipts (101 prefix 7), dispatches (601) & stock balance
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Export Coverage Matrix
          </button>
        </div>
      </div>

      {/* Month & Stats Banner */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5 whitespace-nowrap">
            <Calendar className="w-4 h-4 text-blue-600" />
            Planning Month:
          </label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => onSelectMonth(e.target.value)}
            className="px-3.5 py-2 text-sm font-bold border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-blue-500 font-mono"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
          <span className="text-slate-500">Defined Calendar Buckets:</span>
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
          <div className="text-xs text-slate-500 font-medium">Total Planned Target</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
            {totalPlannedTarget.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Units</span>
          </div>
          <div className="text-xs text-blue-600 font-semibold mt-1">
            Across {filteredSummaries.length} Finished Good variants
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Actual Production (MB51 101)</div>
          <div className="text-2xl font-bold text-emerald-700 mt-1 font-mono">
            {totalActualProduced.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Units</span>
          </div>
          <div className="text-xs text-emerald-600 font-medium mt-1">
            Finished Goods received from lines
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Actual Dispatches (MB51 601)</div>
          <div className="text-2xl font-bold text-purple-700 mt-1 font-mono">
            {totalActualDispatched.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Units</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Delivered to OEM assembly lines
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Plan Fulfillment Rate</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono flex items-center gap-2">
            {Math.round(overallAvgAchievement * 10) / 10}%
            {overallAvgAchievement >= 90 ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            )}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            MB51 101 production vs monthly prorated plan
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="relative min-w-[260px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search FG code, name, customer OEM..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={selectedFG}
            onChange={(e) => setSelectedFG(e.target.value)}
            className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white text-slate-700 font-medium focus:ring-2 focus:ring-blue-500"
          >
            <option value="ALL">All Finished Goods ({uniqueFGs.length})</option>
            {uniqueFGs.map((fg) => (
              <option key={fg.fgCode} value={fg.fgCode}>
                {fg.fgCode} — {fg.fgDescription}
              </option>
            ))}
          </select>

          {(searchTerm || selectedFG !== 'ALL') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setSelectedFG('ALL');
              }}
              className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Reset Filters
            </button>
          )}
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing <span className="font-bold text-slate-900">{filteredSummaries.length}</span> Finished Goods
        </div>
      </div>

      {/* Main Weekly FG Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase tracking-wider font-semibold">
                <th className="py-3 px-3">Finished Good (Part No)</th>
                <th className="py-3 px-3">OEM Customer</th>
                <th className="py-3 px-3 text-right">Start Stock</th>
                <th className="py-3 px-3 text-right bg-blue-50/50 text-blue-900">Month Plan</th>
                {monthWeeks.map((w) => (
                  <th
                    key={w.id}
                    colSpan={4}
                    className="py-2 px-3 text-center border-l border-slate-200 font-bold bg-slate-100/70"
                  >
                    <div className="text-slate-900 font-bold">{w.weekLabel}</div>
                    <div className="text-[10px] text-slate-500 font-normal lowercase">
                      {w.daysCount} Days
                    </div>
                  </th>
                ))}
                <th className="py-3 px-3 text-right border-l border-slate-200">Total 101 Prod</th>
                <th className="py-3 px-3 text-right">Total 601 Disp</th>
                <th className="py-3 px-3 text-center min-w-[130px] w-36">Plan Progress</th>
              </tr>
              <tr className="bg-slate-100/50 border-b border-slate-200 text-slate-500 text-[10px] font-semibold">
                <th colSpan={4}></th>
                {monthWeeks.map((w) => (
                  <React.Fragment key={w.id}>
                    <th className="py-1.5 px-2 text-right border-l border-slate-200 text-slate-600">
                      Plan
                    </th>
                    <th className="py-1.5 px-2 text-right text-emerald-700 font-bold">101 Prod</th>
                    <th className="py-1.5 px-2 text-right text-purple-700">601 Disp</th>
                    <th className="py-1.5 px-2 text-right text-slate-600">Stock</th>
                  </React.Fragment>
                ))}
                <th colSpan={3} className="border-l border-slate-200"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredSummaries.length === 0 ? (
                <tr>
                  <td colSpan={6 + monthWeeks.length * 4} className="py-8 text-center text-slate-400">
                    No Finished Good monthly plan data found for {selectedMonth}.
                  </td>
                </tr>
              ) : (
                filteredSummaries.map((s) => (
                  <tr key={s.fgCode} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3">
                      <div className="font-bold text-slate-900 font-mono text-xs flex items-center gap-1">
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200">
                          {s.fgCode}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{s.fgDescription}</div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 font-medium">
                      {s.customerName || 'Standard'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-700">
                      {s.startingStock.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-blue-900 bg-blue-50/30">
                      {s.monthlyPlanTarget.toLocaleString()}
                    </td>

                    {/* Week Sub-columns */}
                    {s.weeks.map((w) => (
                      <React.Fragment key={w.weekId}>
                        <td className="py-2.5 px-2 text-right font-mono text-slate-700 border-l border-slate-200">
                          {w.planTarget.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono font-bold text-emerald-700 bg-emerald-50/20">
                          {w.actualProductionReceipt.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono text-purple-700">
                          {w.actualDispatch.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono font-semibold text-slate-900">
                          {w.closingStock.toLocaleString()}
                        </td>
                      </React.Fragment>
                    ))}

                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-800 border-l border-slate-200">
                      {s.totalActualProduction.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono font-semibold text-purple-800">
                      {s.totalActualDispatch.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 min-w-[130px] max-w-[160px]">
                      <div
                        className="flex flex-col gap-1 cursor-help"
                        title={`Monthly Plan Fulfillment for ${s.fgCode}:\n• Total Plan Target: ${s.monthlyPlanTarget.toLocaleString()} units\n• Produced to Date (101): ${s.totalActualProduction.toLocaleString()} units (${s.overallAchievementRate}%)\n• Dispatched (601): ${s.totalActualDispatch.toLocaleString()} units\n• Remaining Target: ${Math.max(0, s.monthlyPlanTarget - s.totalActualProduction).toLocaleString()} units`}
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono leading-tight">
                          <span className="text-slate-600 font-semibold truncate">
                            {s.totalActualProduction.toLocaleString()} / {s.monthlyPlanTarget.toLocaleString()}
                          </span>
                          <span
                            className={`px-1 py-0.2 rounded font-mono font-bold text-[9px] ${
                              s.overallAchievementRate >= 90
                                ? 'bg-emerald-100 text-emerald-800'
                                : s.overallAchievementRate >= 70
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {s.overallAchievementRate}%
                          </span>
                        </div>

                        {/* Visual Progress Bar Track & Fill */}
                        <div className="w-full bg-slate-200/90 h-2 rounded-full overflow-hidden flex shadow-inner relative">
                          <div
                            className={`h-full transition-all duration-300 rounded-full ${
                              s.overallAchievementRate >= 90
                                ? 'bg-emerald-500'
                                : s.overallAchievementRate >= 70
                                ? 'bg-indigo-600'
                                : 'bg-amber-500'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, s.overallAchievementRate))}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
