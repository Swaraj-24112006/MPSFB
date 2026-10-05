import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Plus,
  Sparkles,
  CalendarRange,
  Clock,
  Trash2,
  Edit2,
  CheckCircle2,
  AlertCircle,
  Download,
  Upload,
  Layers,
  Loader2,
  RefreshCw,
  XCircle
} from 'lucide-react';
import { WeekDefinition } from '../../types';
import weekService, { dtoToFrontend } from '../../services/weekService';
import { ApiError } from '../../services/api';

interface WeekDefinitionManagerProps {
  weeks: WeekDefinition[];
  onUpdateWeeks: (weeks: WeekDefinition[]) => void;
  selectedMonth: string;
  onSelectMonth: (month: string) => void;
}

export const WeekDefinitionManager: React.FC<WeekDefinitionManagerProps> = ({
  weeks,
  onUpdateWeeks,
  selectedMonth,
  onSelectMonth
}) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingWeek, setEditingWeek] = useState<WeekDefinition | null>(null);

  // API State
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Form state
  const [formMonth, setFormMonth] = useState(selectedMonth);
  const [formWeekNo, setFormWeekNo] = useState<number>(1);
  const [formStartDate, setFormStartDate] = useState('');
  const [formEndDate, setFormEndDate] = useState('');
  const [formHolidayDays, setFormHolidayDays] = useState<number>(0);
  const [formLabel, setFormLabel] = useState('');

  // Auto-dismiss messages
  useEffect(() => {
    if (successMsg) {
      const t = setTimeout(() => setSuccessMsg(null), 4000);
      return () => clearTimeout(t);
    }
  }, [successMsg]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 8000);
      return () => clearTimeout(t);
    }
  }, [error]);

  // Fetch weeks from backend API
  const fetchWeeks = useCallback(async (monthToFetch = selectedMonth) => {
    setLoading(true);
    setError(null);
    try {
      const dtoList = await weekService.list(monthToFetch);
      if (dtoList.length > 0) {
        const mapped = dtoList.map(dtoToFrontend);
        const otherWeeks = weeks.filter((w) => w.month !== monthToFetch);
        onUpdateWeeks([...otherWeeks, ...mapped]);
      }
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      if (apiErr.status === 0 || apiErr.status === undefined) {
        // Backend not reached, keep cached prop data
      } else {
        setError(apiErr.message || 'Failed to fetch week definitions from server');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, weeks, onUpdateWeeks]);

  // Load from backend when month changes
  useEffect(() => {
    fetchWeeks(selectedMonth);
  }, [selectedMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentMonthWeeks = weeks
    .filter((w) => w.month === selectedMonth)
    .sort((a, b) => a.weekNo - b.weekNo);

  const totalDaysInMonthWeeks = currentMonthWeeks.reduce(
    (sum, w) => sum + w.daysCount,
    0
  );

  // Calculate days difference
  const calculateDays = (start: string, end: string): number => {
    if (!start || !end) return 0;
    const s = new Date(start);
    const e = new Date(end);
    const diffTime = e.getTime() - s.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays > 0 ? diffDays : 0;
  };

  const handleOpenAddModal = (existing?: WeekDefinition) => {
    if (existing) {
      setEditingWeek(existing);
      setFormMonth(existing.month);
      setFormWeekNo(existing.weekNo);
      setFormStartDate(existing.startDate);
      setFormEndDate(existing.endDate);
      setFormHolidayDays(existing.holidayDays || 0);
      setFormLabel(existing.weekLabel);
    } else {
      setEditingWeek(null);
      setFormMonth(selectedMonth);
      const nextNo = currentMonthWeeks.length + 1;
      setFormWeekNo(nextNo);
      setFormStartDate(`${selectedMonth}-01`);
      setFormEndDate(`${selectedMonth}-07`);
      setFormHolidayDays(0);
      setFormLabel(`Week ${nextNo}`);
    }
    setIsAddModalOpen(true);
  };

  const handleSaveWeek = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formStartDate || !formEndDate) {
      setError('Please enter start and end dates');
      return;
    }

    const daysCount = calculateDays(formStartDate, formEndDate);
    if (daysCount <= 0) {
      setError('End date must be on or after start date');
      return;
    }

    const label =
      formLabel.trim() ||
      `Week ${formWeekNo} (${formStartDate.slice(8)}-${formEndDate.slice(8)} ${new Date(
        formStartDate
      ).toLocaleString('default', { month: 'short' })})`;

    setSaving(true);
    setError(null);
    try {
      if (editingWeek) {
        await weekService.update(editingWeek.id, {
          month: formMonth,
          week_no: formWeekNo,
          week_label: label,
          start_date: formStartDate,
          end_date: formEndDate,
          holiday_days: formHolidayDays,
        });
        setSuccessMsg(`Week ${formWeekNo} updated successfully.`);
      } else {
        await weekService.create({
          month: formMonth,
          week_no: formWeekNo,
          week_label: label,
          start_date: formStartDate,
          end_date: formEndDate,
          holiday_days: formHolidayDays,
        });
        setSuccessMsg(`Week ${formWeekNo} created successfully.`);
      }
      setIsAddModalOpen(false);
      await fetchWeeks(formMonth);
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      setError(apiErr.message || 'Failed to save week definition');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteWeek = async (id: string) => {
    if (!window.confirm('Delete this week definition?')) return;
    setSaving(true);
    setError(null);
    try {
      await weekService.delete(id);
      setSuccessMsg('Week definition deleted successfully.');
      await fetchWeeks(selectedMonth);
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      setError(apiErr.message || 'Failed to delete week definition');
    } finally {
      setSaving(false);
    }
  };

  // Generate prompt sample: (01-09 Aug Week 1 [9d], 10-16 Aug Week 2 [7d], 17-23 Aug Week 3 [7d], 24-31 Aug Week 4 [8d])
  const handleGeneratePromptStandard = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await weekService.autoGenerate({ month: selectedMonth, overwrite: true });
      const mapped = res.results.map(dtoToFrontend);
      const otherWeeks = weeks.filter((w) => w.month !== selectedMonth);
      onUpdateWeeks([...otherWeeks, ...mapped]);
      setSuccessMsg(`Standard 4-week split auto-generated for ${selectedMonth}.`);
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      setError(apiErr.message || 'Failed to auto-generate standard weeks');
    } finally {
      setLoading(false);
    }
  };

  // Generate for entire year (e.g. 2026)
  const handleGenerateFullYear = async () => {
    const year = selectedMonth.split('-')[0] || '2026';
    if (!window.confirm(`Auto-generate standard 4-week splits for all 12 months of year ${year}?`)) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await weekService.autoGenerate({ year, overwrite: true });
      const mapped = res.results.map(dtoToFrontend);
      onUpdateWeeks(mapped);
      setSuccessMsg(`Successfully generated 48 week buckets for full year ${year}!`);
    } catch (err: unknown) {
      const apiErr = err as ApiError;
      setError(apiErr.message || 'Failed to auto-generate full year weeks');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = async () => {
    try {
      await weekService.downloadWeeksCSV(selectedMonth);
      return;
    } catch (err) {
      console.warn('Backend weeks CSV export failed, falling back to client CSV generation:', err);
    }

    const headers = [
      'Month',
      'Week Number',
      'Week Label',
      'Start Date',
      'End Date',
      'Days Count',
      'Working Days',
      'Month Weight %'
    ];
    const rows = weeks.map((w) => {
      const monthWeeks = weeks.filter((mw) => mw.month === w.month);
      const totalMonthWorkingDays = monthWeeks.reduce((sum, mw) => sum + (mw.workingDays ?? mw.daysCount), 0);
      const mWeight = w.monthWeight !== undefined && w.monthWeight !== null
        ? w.monthWeight
        : totalMonthWorkingDays > 0
        ? Math.round(((w.workingDays ?? w.daysCount) / totalMonthWorkingDays) * 1000) / 10
        : 0;

      return [
        `"${w.month}"`,
        w.weekNo,
        `"${w.weekLabel}"`,
        `"${w.startDate}"`,
        `"${w.endDate}"`,
        w.daysCount,
        w.workingDays || w.daysCount,
        mWeight
      ];
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Week_Definitions_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Toast Messages */}
      {successMsg && (
        <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 animate-in fade-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 animate-in fade-in">
          <XCircle className="w-4 h-4 text-red-500 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600"><XCircle className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600">
            <CalendarRange className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Define Week Calendar (Week No.)</h1>
            <p className="text-sm text-slate-500">
              Define monthly week date boundaries & days count to accurately prorate and consolidate monthly FG plans
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => fetchWeeks(selectedMonth)}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50"
            title="Refresh from server"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-600' : ''}`} />
            Refresh
          </button>
          <button
            onClick={handleGenerateFullYear}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-50"
            title="Generate standard week buckets for all 12 months"
          >
            <Sparkles className="w-4 h-4 text-indigo-600" />
            Define Full Year
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
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Custom Week
          </button>
        </div>
      </div>

      {/* Month Selection and Quick Template Bar */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full md:w-auto">
          <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5 whitespace-nowrap">
            <Calendar className="w-4 h-4 text-indigo-600" />
            Active Planning Month:
          </label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => onSelectMonth(e.target.value)}
            className="px-3.5 py-2 text-sm font-bold border border-slate-300 rounded-lg bg-slate-50 text-slate-900 focus:ring-2 focus:ring-indigo-500 font-mono"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-end">
          <button
            onClick={handleGeneratePromptStandard}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-200 transition-colors"
          >
            <Layers className="w-3.5 h-3.5 text-indigo-600" />
            Auto-Apply Month Pattern (01-09 W1, 10-16 W2, 17-23 W3, 24-31 W4)
          </button>
        </div>
      </div>

      {/* Week Definition Cards & Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Defined Weeks</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">
            {currentMonthWeeks.length} Weeks
          </div>
          <div className="text-xs text-indigo-600 font-semibold mt-1">
            For {new Date(`${selectedMonth}-01`).toLocaleString('default', { month: 'long', year: 'numeric' })}
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Total Days Covered</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
            {totalDaysInMonthWeeks} Days
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Used for MRP daily prorate distribution
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-xs text-slate-500 font-medium">Total Working Days</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
            {currentMonthWeeks.reduce((sum, w) => sum + (w.workingDays || w.daysCount), 0)} Days
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Shop floor operational shifts
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 font-medium">Calendar Status</div>
            <div className="text-sm font-bold text-emerald-700 mt-1 flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Calendar Configured
            </div>
            <div className="text-xs text-slate-500 mt-1">Ready for Monthly Plan</div>
          </div>
        </div>
      </div>

      {/* Weeks Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-bold text-slate-900 text-sm">
            Defined Week Buckets for {selectedMonth}
          </h2>
          <span className="text-xs font-semibold text-slate-500">
            {currentMonthWeeks.length} active buckets
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-xs uppercase tracking-wider font-semibold">
                <th className="py-3.5 px-4">Week No</th>
                <th className="py-3.5 px-4">Week Label & Range</th>
                <th className="py-3.5 px-4">Start Date</th>
                <th className="py-3.5 px-4">End Date</th>
                <th className="py-3.5 px-4 text-center">Days Count</th>
                <th className="py-3.5 px-4 text-center">% Month Weight</th>
                <th className="py-3.5 px-4 text-center">Working Days</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {currentMonthWeeks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    No week definitions configured for {selectedMonth}. Click "Auto-Apply Month Pattern" or "Add Custom Week".
                  </td>
                </tr>
              ) : (
                currentMonthWeeks.map((week) => {
                  const totalWorkingDaysInMonth = currentMonthWeeks.reduce(
                    (sum, w) => sum + (w.workingDays ?? w.daysCount),
                    0
                  );
                  const weightPct =
                    week.monthWeight !== undefined && week.monthWeight !== null
                      ? week.monthWeight
                      : totalWorkingDaysInMonth > 0
                      ? Math.round(((week.workingDays ?? week.daysCount) / totalWorkingDaysInMonth) * 1000) / 10
                      : 0;

                  return (
                    <tr key={week.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900">
                        <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-800 font-mono text-xs flex items-center justify-center font-bold">
                          W{week.weekNo}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {week.weekLabel}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 text-xs">
                        {week.startDate}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700 text-xs">
                        {week.endDate}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-900 font-mono">
                          {week.daysCount} Days
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-indigo-600 h-2 rounded-full"
                              style={{ width: `${weightPct}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono font-semibold text-slate-600">
                            {weightPct}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center font-mono font-medium text-slate-600">
                        {week.workingDays || week.daysCount}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenAddModal(week)}
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                            title="Edit Week"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteWeek(week.id)}
                            className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="Delete Week"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <CalendarRange className="w-5 h-5 text-indigo-600" />
              {editingWeek ? 'Edit Week Definition' : 'Add Custom Week Definition'}
            </h2>

            <form onSubmit={handleSaveWeek} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Planning Month *
                  </label>
                  <input
                    type="month"
                    required
                    value={formMonth}
                    onChange={(e) => setFormMonth(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Week Number *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="53"
                    required
                    value={formWeekNo}
                    onChange={(e) => setFormWeekNo(parseInt(e.target.value) || 1)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formStartDate}
                    onChange={(e) => setFormStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    End Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formEndDate}
                    onChange={(e) => setFormEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono"
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Holiday/Off Days *
                </label>
                <input
                  type="number"
                  min="0"
                  required
                  value={formHolidayDays}
                  onChange={(e) => setFormHolidayDays(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Week Label (Optional)
                </label>
                <input
                  type="text"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                  placeholder="e.g. Week 1 (01-09 Aug)"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {formStartDate && formEndDate && (
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-700 flex items-center justify-between">
                  <span>Calculated Duration:</span>
                  <span className="font-bold text-slate-900 font-mono">
                    {calculateDays(formStartDate, formEndDate)} Total Days
                  </span>
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
                  className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm transition-colors"
                >
                  {editingWeek ? 'Save Changes' : 'Add Week Bucket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
