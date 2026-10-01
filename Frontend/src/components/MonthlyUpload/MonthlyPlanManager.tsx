import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Upload,
  Plus,
  Download,
  Calendar,
  Layers,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  SlidersHorizontal,
  Info
} from 'lucide-react';
import { MonthlyPlanItem, WeekDefinition, BOMItem } from '../../types';
import { calculateProratedWeeklyBreakdown } from '../../data/sapInitialData';
import { monthlyPlanService } from '../../services/monthlyPlanService';

interface MonthlyPlanManagerProps {
  monthlyPlans: MonthlyPlanItem[];
  onUpdateMonthlyPlans: (plans: MonthlyPlanItem[]) => void;
  weeks: WeekDefinition[];
  boms: BOMItem[];
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
}

export const MonthlyPlanManager: React.FC<MonthlyPlanManagerProps> = ({
  monthlyPlans,
  onUpdateMonthlyPlans,
  weeks,
  boms,
  selectedMonth,
  onSelectMonth
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<MonthlyPlanItem | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Form State
  const [formData, setFormData] = useState<Partial<MonthlyPlanItem>>({
    fgCode: '',
    fgDescription: '',
    customerName: '',
    monthlyTarget: 5000,
    uom: 'PC',
    customNotes: ''
  });

  const [csvInput, setCsvInput] = useState('');

  // Active weeks for this month
  const monthWeeks = weeks
    .filter((w) => w.month === selectedMonth)
    .sort((a, b) => a.weekNo - b.weekNo);

  const totalMonthDays = monthWeeks.reduce((sum, w) => sum + w.daysCount, 0);

  // Unique FGs from BOM
  const fgOptions: { code: string; desc: string }[] = Array.from(
    new Map<string, { code: string; desc: string }>(
      boms.map((b) => [b.fgCode, { code: b.fgCode, desc: b.fgDescription }])
    ).values()
  );

  // Hydrate plans from backend on month change
  React.useEffect(() => {
    let isMounted = true;
    monthlyPlanService.getMonthlyPlans(selectedMonth)
      .then((plans) => {
        if (isMounted && plans.length > 0) {
          const otherMonths = monthlyPlans.filter((p) => p.month !== selectedMonth);
          onUpdateMonthlyPlans([...otherMonths, ...plans]);
        }
      })
      .catch((err) => {
        console.warn('Could not fetch monthly plans from backend:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedMonth]);

  const currentMonthPlans = monthlyPlans.filter((p) => p.month === selectedMonth);

  const filteredPlans = currentMonthPlans.filter((p) => {
    return (
      p.fgCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.fgDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.customerName || '').toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  // Calculate totals
  const totalMonthlyDemand = filteredPlans.reduce((sum, p) => sum + p.monthlyTarget, 0);
  const weeklyConsolidatedTotals: Record<string, number> = {};
  monthWeeks.forEach((w) => {
    weeklyConsolidatedTotals[w.id] = filteredPlans.reduce(
      (sum, p) => sum + (p.weeklyBreakdown[w.id] || 0),
      0
    );
  });

  const handleOpenAddModal = (existing?: MonthlyPlanItem) => {
    if (existing) {
      setEditingPlan(existing);
      setFormData(existing);
    } else {
      setEditingPlan(null);
      const firstFG = fgOptions[0] || { code: '7.06496.03.0', desc: 'Vacuum Pump Panther 2.0L' };
      setFormData({
        fgCode: firstFG.code,
        fgDescription: firstFG.desc,
        customerName: '',
        monthlyTarget: 5000,
        uom: 'PC',
        customNotes: ''
      });
    }
    setIsAddModalOpen(true);
  };

  const handleFGSelectChange = (code: string) => {
    const found = fgOptions.find((f) => f.code === code);
    setFormData({
      ...formData,
      fgCode: code,
      fgDescription: found ? found.desc : formData.fgDescription
    });
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fgCode || !formData.monthlyTarget) {
      alert('Please select FG code and enter monthly target.');
      return;
    }

    const targetQty = Number(formData.monthlyTarget) || 0;
    setIsSaving(true);

    try {
      if (editingPlan) {
        let savedPlan: MonthlyPlanItem;
        try {
          savedPlan = await monthlyPlanService.updateMonthlyPlan(editingPlan.id, {
            monthly_target: targetQty,
            customer_name: formData.customerName,
            custom_notes: formData.customNotes,
            uom: formData.uom,
          });
        } catch {
          // Fallback to local calculation if offline
          const weeklyBreakdown = calculateProratedWeeklyBreakdown(targetQty, monthWeeks);
          savedPlan = {
            ...editingPlan,
            ...formData,
            monthlyTarget: targetQty,
            weeklyBreakdown
          } as MonthlyPlanItem;
        }

        const updated = monthlyPlans.map((p) =>
          p.id === editingPlan.id ? savedPlan : p
        );
        onUpdateMonthlyPlans(updated);
      } else {
        let newPlan: MonthlyPlanItem;
        try {
          newPlan = await monthlyPlanService.createMonthlyPlan({
            fg_code: formData.fgCode,
            month: selectedMonth,
            monthly_target: targetQty,
            customer_name: formData.customerName,
            custom_notes: formData.customNotes,
            uom: formData.uom || 'PC'
          });
        } catch (apiErr: any) {
          const msg = apiErr?.message || 'Failed to save monthly plan on server';
          alert(msg);
          setIsSaving(false);
          return;
        }

        onUpdateMonthlyPlans([...monthlyPlans, newPlan]);
      }
      setIsAddModalOpen(false);
    } catch (err: any) {
      alert(err?.message || 'Error saving monthly plan');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRecalculateAllProrated = async () => {
    setIsSaving(true);
    try {
      const res = await monthlyPlanService.recalculateProrated(selectedMonth);
      const refreshed = await monthlyPlanService.getMonthlyPlans(selectedMonth);
      if (refreshed.length > 0) {
        const otherMonths = monthlyPlans.filter((p) => p.month !== selectedMonth);
        onUpdateMonthlyPlans([...otherMonths, ...refreshed]);
      }
      alert(`Successfully recalculated ${res.updated_count} plan(s) for ${selectedMonth} based on active week weights.`);
      return;
    } catch (err: any) {
      console.warn('Backend recalculate failed, falling back to client-side:', err);
    } finally {
      setIsSaving(false);
    }

    if (monthWeeks.length === 0) {
      alert('Please define weeks for this month first under "Define Week No."');
      return;
    }
    const updated = monthlyPlans.map((p) => {
      if (p.month === selectedMonth) {
        return {
          ...p,
          weeklyBreakdown: calculateProratedWeeklyBreakdown(p.monthlyTarget, monthWeeks)
        };
      }
      return p;
    });
    onUpdateMonthlyPlans(updated);
  };

  const handleDeletePlan = async (id: string) => {
    if (window.confirm('Delete this FG monthly plan?')) {
      try {
        await monthlyPlanService.deleteMonthlyPlan(id).catch(() => {});
      } finally {
        onUpdateMonthlyPlans(monthlyPlans.filter((p) => p.id !== id));
      }
    }
  };

  const handleDownloadTemplate = () => {
    const csvContent =
      'FG Code,FG Description,Customer Name,Monthly Target,UOM,Notes\n' +
      '7.06496.03.0,Vacuum Pump Panther 2.0L,Tata Motors PV & EV,10000,PC,Harrier & Safari schedule\n' +
      '7.09629.01.0,FAM B Tandem Vacuum Pump,Mahindra & Mahindra Auto,8000,PC,Scorpio-N / XUV700 ramp-up\n' +
      '7.02551.11.0,Variable Flow Oil Pump (Gen 3),Hyundai Motor India,6200,PC,1.5L Turbo TGDi program\n';

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Monthly_Plan_Template_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCSVUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile && !csvInput.trim()) {
      alert('Please select a file (.csv, .xlsx, .txt) or paste data into the text box.');
      return;
    }

    if (monthWeeks.length === 0) {
      alert(`No week definitions exist for ${selectedMonth}. Please generate weeks under "Define Week No." first.`);
      return;
    }

    setIsUploading(true);
    try {
      const payload = selectedFile || csvInput;
      const resp = await monthlyPlanService.uploadMonthlyPlan(selectedMonth, payload);

      // Hydrate newly updated plans from server
      const refreshedPlans = await monthlyPlanService.getMonthlyPlans(selectedMonth);
      if (refreshedPlans.length > 0) {
        const otherMonths = monthlyPlans.filter((p) => p.month !== selectedMonth);
        onUpdateMonthlyPlans([...otherMonths, ...refreshedPlans]);
      }

      alert(
        `Monthly Plan upload complete for ${selectedMonth}!\n` +
        `• Successfully Imported: ${resp.imported_rows} plan(s)\n` +
        `• Skipped / Errors: ${resp.error_rows}` +
        (resp.errors && resp.errors.length > 0
          ? `\n\nDetails:\n` + resp.errors.map(err => `Row ${err.row_index}: ${err.reason}`).slice(0, 5).join('\n')
          : '')
      );
      setIsUploadModalOpen(false);
      setSelectedFile(null);
      setCsvInput('');
    } catch (err: any) {
      alert(err?.message || 'Failed to upload monthly plan.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleExportCSV = async () => {
    try {
      await monthlyPlanService.downloadMonthlyPlanCSV(selectedMonth);
      return;
    } catch (err) {
      console.warn('Backend CSV export failed, falling back to client CSV generation:', err);
    }

    const headers = [
      'FG Code',
      'FG Description',
      'Customer Name',
      'Month',
      'Monthly Target',
      ...monthWeeks.map((w) => `${w.weekLabel} (${w.daysCount}d)`),
      'UOM'
    ];

    const rows = filteredPlans.map((p) => [
      `"${p.fgCode}"`,
      `"${p.fgDescription}"`,
      `"${p.customerName || ''}"`,
      `"${p.month}"`,
      p.monthlyTarget,
      ...monthWeeks.map((w) => p.weeklyBreakdown[w.id] || 0),
      `"${p.uom}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Monthly_Plan_Weekly_Consolidation_${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Upload Monthly Plan & Weekly Distribution</h1>
            <p className="text-sm text-slate-500">
              Uploads monthly customer FG plan and auto-divides quantities based on the number of days in each defined week
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleRecalculateAllProrated}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
            title="Recalculate weekly breakdown based on active week definitions"
          >
            <RefreshCw className="w-4 h-4 text-slate-500" />
            Recalculate Weeks
          </button>
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
          >
            <Upload className="w-4 h-4 text-emerald-600" />
            Upload Plan CSV / Excel
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <Download className="w-4 h-4 text-slate-500" />
            Export CSV
          </button>
          <button
            onClick={() => handleOpenAddModal()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add FG Plan
          </button>
        </div>
      </div>

      {/* Month & Calendar Days Notification Banner */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5 whitespace-nowrap">
            <Calendar className="w-4 h-4 text-emerald-600" />
            Planning Month:
          </label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => onSelectMonth(e.target.value)}
            className="px-3.5 py-2 text-sm font-bold border border-slate-300 rounded-lg bg-white text-slate-900 focus:ring-2 focus:ring-emerald-500 font-mono"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
          <span className="text-slate-500">Active Week Weights ({totalMonthDays} Total Days):</span>
          {monthWeeks.map((w) => (
            <span
              key={w.id}
              className="px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-800 font-mono shadow-xs"
            >
              <strong className="text-emerald-700">{w.weekLabel}</strong>: {w.daysCount}d ({Math.round((w.daysCount / (totalMonthDays || 1)) * 100)}%)
            </span>
          ))}
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Monthly FG Plan Volume</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
            {totalMonthlyDemand.toLocaleString()} <span className="text-xs text-slate-500 font-normal">Units</span>
          </div>
          <div className="text-xs text-emerald-700 font-semibold mt-1">
            Across {filteredPlans.length} Finished Good variants
          </div>
        </div>

        {monthWeeks.slice(0, 3).map((w) => (
          <div key={w.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="text-xs text-slate-500 font-medium">{w.weekLabel} ({w.daysCount} Days)</div>
            <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
              {(weeklyConsolidatedTotals[w.id] || 0).toLocaleString()} <span className="text-xs text-slate-500 font-normal">Units</span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              Consolidated weekly requirement
            </div>
          </div>
        ))}
      </div>

      {/* Main Consolidated Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-900 text-sm">
              Monthly FG Plan vs Prorated Weekly Consolidated Requirements
            </h2>
            <p className="text-xs text-slate-500">
              Each row displays the monthly target and its automatic proportional distribution across weeks by days count
            </p>
          </div>

          <div className="relative min-w-[240px]">
            <input
              type="text"
              placeholder="Search FG code, name, customer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-3 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Finished Good (Part No)</th>
                <th className="py-3.5 px-4">Customer / OEM</th>
                <th className="py-3.5 px-4 text-right bg-emerald-50/50 text-emerald-950 font-bold">
                  Monthly Target
                </th>
                {monthWeeks.map((w) => (
                  <th key={w.id} className="py-3.5 px-4 text-right font-bold text-slate-700">
                    <div>{w.weekLabel}</div>
                    <div className="text-[10px] text-slate-400 font-normal lowercase">
                      {w.daysCount} days weight
                    </div>
                  </th>
                ))}
                <th className="py-3.5 px-4 text-center">UOM</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredPlans.length === 0 ? (
                <tr>
                  <td colSpan={5 + monthWeeks.length} className="py-8 text-center text-slate-400">
                    No monthly plans for {selectedMonth}. Click "Add FG Plan" or "Upload Plan CSV".
                  </td>
                </tr>
              ) : (
                filteredPlans.map((plan) => (
                  <tr key={plan.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 font-mono text-xs flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded border border-blue-200">
                          {plan.fgCode}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">{plan.fgDescription}</div>
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold text-slate-700">
                      {plan.customerName || 'Standard Production'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-emerald-800 bg-emerald-50/30">
                      {plan.monthlyTarget.toLocaleString()}
                    </td>
                    {monthWeeks.map((w) => (
                      <td key={w.id} className="py-3 px-4 text-right font-mono text-slate-800 font-semibold">
                        {(plan.weeklyBreakdown[w.id] || 0).toLocaleString()}
                      </td>
                    ))}
                    <td className="py-3 px-4 text-center text-xs font-medium text-slate-500">
                      {plan.uom}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenAddModal(plan)}
                          className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors"
                          title="Edit plan"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeletePlan(plan.id)}
                          className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete plan"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {filteredPlans.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900">
                  <td className="py-3.5 px-4" colSpan={2}>
                    Total Consolidated Requirement
                  </td>
                  <td className="py-3.5 px-4 text-right font-mono text-emerald-800 bg-emerald-100/50">
                    {totalMonthlyDemand.toLocaleString()}
                  </td>
                  {monthWeeks.map((w) => (
                    <td key={w.id} className="py-3.5 px-4 text-right font-mono text-slate-900">
                      {(weeklyConsolidatedTotals[w.id] || 0).toLocaleString()}
                    </td>
                  ))}
                  <td className="py-3.5 px-4 text-center text-xs text-slate-500">PC</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Add / Edit FG Plan Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-emerald-600" />
              {editingPlan ? 'Edit Finished Good Plan' : 'Add Monthly FG Plan'}
            </h2>

            <form onSubmit={handleSavePlan} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Finished Good (FG Part Number) *
                </label>
                <select
                  value={formData.fgCode || ''}
                  onChange={(e) => handleFGSelectChange(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white font-mono"
                >
                  {fgOptions.map((fg) => (
                    <option key={fg.code} value={fg.code}>
                      {fg.code} - {fg.desc}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  FG Description
                </label>
                <input
                  type="text"
                  value={formData.fgDescription || ''}
                  onChange={(e) => setFormData({ ...formData, fgDescription: e.target.value })}
                  placeholder="e.g. Vacuum Pump Panther 2.0L"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Customer / OEM Program
                  </label>
                  <input
                    type="text"
                    value={formData.customerName || ''}
                    onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                    placeholder="e.g. Tata Motors PV"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Total Monthly Target Qty *
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={formData.monthlyTarget ?? 5000}
                    onChange={(e) =>
                      setFormData({ ...formData, monthlyTarget: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 font-mono font-bold"
                  />
                </div>
              </div>

              {/* Live Preview of Weekly Prorated calculation */}
              {formData.monthlyTarget && formData.monthlyTarget > 0 && (
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 text-emerald-600" />
                    Auto-Prorated Weekly Quantities ({totalMonthDays} Days Total):
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    {monthWeeks.map((w, idx) => {
                      const computed = calculateProratedWeeklyBreakdown(
                        Number(formData.monthlyTarget) || 0,
                        monthWeeks
                      )[w.id];
                      return (
                        <div key={w.id} className="bg-white p-2 rounded border border-slate-200">
                          <div className="text-slate-500 text-[11px]">W{w.weekNo} ({w.daysCount}d)</div>
                          <div className="font-bold text-slate-900 font-mono mt-0.5">
                            {computed?.toLocaleString()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors"
                >
                  {editingPlan ? 'Save Changes' : 'Add Monthly Plan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload CSV / Excel Modal */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-xl w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Upload className="w-5 h-5 text-emerald-600" />
                Upload Monthly Plan for {selectedMonth}
              </h2>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Download Template
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Upload a <strong>.csv</strong> or <strong>.xlsx</strong> file, or paste table text below. The server will automatically validate codes, store the file, and compute working-day prorated breakdowns.
            </p>

            <form onSubmit={handleCSVUpload} className="space-y-4">
              {/* File Upload Section */}
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center hover:border-emerald-500 transition-colors bg-slate-50/50">
                <input
                  type="file"
                  id="monthly-plan-file-input"
                  accept=".csv, .xlsx, .xlsm, .txt"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setSelectedFile(e.target.files[0]);
                    }
                  }}
                />
                <label
                  htmlFor="monthly-plan-file-input"
                  className="cursor-pointer flex flex-col items-center justify-center gap-1"
                >
                  <FileSpreadsheet className="w-8 h-8 text-emerald-600 mb-1" />
                  <span className="text-xs font-semibold text-slate-700">
                    {selectedFile ? selectedFile.name : 'Click to select CSV or Excel file (.csv, .xlsx)'}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : 'Or drag and drop your file here'}
                  </span>
                </label>
                {selectedFile && (
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="mt-2 text-[11px] text-rose-600 hover:underline"
                  >
                    Clear selected file
                  </button>
                )}
              </div>

              {/* Paste Text Section */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Or Paste CSV / Tab-Separated Data
                </label>
                <textarea
                  rows={5}
                  value={csvInput}
                  onChange={(e) => setCsvInput(e.target.value)}
                  placeholder={`FG Code,FG Description,Customer,Monthly Target\n7.06496.03.0,Vacuum Pump Panther 2.0L,Tata Motors,10000\n7.09629.01.0,FAM B Tandem Pump,Mahindra Auto,8000`}
                  className="w-full p-3 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 font-mono"
                  disabled={selectedFile !== null}
                />
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-blue-600" />
                  Ingestion Rules:
                </div>
                <ul className="list-disc list-inside text-[11px] text-blue-800 space-y-0.5">
                  <li>FG code must start with <strong>7</strong> (SAP Finished Goods rule).</li>
                  <li>Monthly target must be greater than 0.</li>
                  <li>Original file is stored and audited with batch ID.</li>
                  <li>Weekly proration is calculated server-side based on working days.</li>
                </ul>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setIsUploadModalOpen(false);
                    setSelectedFile(null);
                    setCsvInput('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                  disabled={isUploading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUploading}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Uploading & Prorating...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Import & Prorate
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
