import { api } from './api';
import { MonthlyPlanItem } from '../types';

export interface BackendMonthlyPlan {
  id: number | string;
  fg_code: string;
  fg_description: string;
  customer_name?: string;
  month: string;
  monthly_target: number;
  uom: string;
  weekly_breakdown: Record<string, number>;
  custom_notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface MonthlyPlanPayload {
  fg_code: string;
  month: string;
  monthly_target: number;
  uom?: string;
  customer_name?: string;
  custom_notes?: string;
}

export function mapBackendPlanToFrontend(plan: BackendMonthlyPlan): MonthlyPlanItem {
  return {
    id: String(plan.id),
    fgCode: plan.fg_code,
    fgDescription: plan.fg_description || '',
    customerName: plan.customer_name || '',
    month: plan.month,
    monthlyTarget: Number(plan.monthly_target) || 0,
    uom: plan.uom || 'PC',
    weeklyBreakdown: plan.weekly_breakdown || {},
    customNotes: plan.custom_notes || ''
  };
}

export interface MonthlyPlanUploadResponse {
  message: string;
  batch_id: number;
  month: string;
  total_rows: number;
  imported_rows: number;
  error_rows: number;
  errors: Array<{ row_index: number; fg_code: string; reason: string }>;
  results: BackendMonthlyPlan[];
}

export const monthlyPlanService = {
  /**
   * Fetch all monthly plans, optionally filtered by month and search string
   */
  async getMonthlyPlans(month?: string, search?: string): Promise<MonthlyPlanItem[]> {
    const params: Record<string, string> = { paginate: 'false' };
    if (month) params.month = month;
    if (search) params.search = search;

    const data = await api.get<BackendMonthlyPlan[] | { results: BackendMonthlyPlan[] }>('monthly-plans/', params);
    const list = Array.isArray(data) ? data : (data.results || []);
    return list.map(mapBackendPlanToFrontend);
  },

  /**
   * Create a new monthly plan (server auto-prorates weekly_breakdown)
   */
  async createMonthlyPlan(payload: MonthlyPlanPayload): Promise<MonthlyPlanItem> {
    const res = await api.post<BackendMonthlyPlan>('monthly-plans/', payload);
    return mapBackendPlanToFrontend(res);
  },

  /**
   * Update an existing monthly plan (server re-prorates if target changed)
   */
  async updateMonthlyPlan(id: string | number, payload: Partial<MonthlyPlanPayload>): Promise<MonthlyPlanItem> {
    const res = await api.patch<BackendMonthlyPlan>(`monthly-plans/${id}/`, payload);
    return mapBackendPlanToFrontend(res);
  },

  /**
   * Delete a monthly plan
   */
  async deleteMonthlyPlan(id: string | number): Promise<void> {
    await api.del(`monthly-plans/${id}/`);
  },

  /**
   * Bulk upload monthly plan from CSV/Excel file or pasted text
   */
  async uploadMonthlyPlan(month: string, fileOrText: File | string): Promise<MonthlyPlanUploadResponse> {
    if (typeof fileOrText === 'string') {
      return api.post<MonthlyPlanUploadResponse>('uploads/monthly-plan/', {
        month,
        pasted_text: fileOrText,
      });
    }

    const formData = new FormData();
    formData.append('file', fileOrText);
    formData.append('month', month);

    return api.upload<MonthlyPlanUploadResponse>('uploads/monthly-plan/', formData);
  },

  /**
   * Trigger backend cascade recalculation of weekly breakdowns for all plans in a month.
   */
  async recalculateProrated(month: string): Promise<{ message: string; month: string; updated_count: number }> {
    return api.post<{ message: string; month: string; updated_count: number }>('monthly-plans/recalculate/', { month });
  },

  /**
   * Export monthly plans as CSV directly from the backend
   */
  async downloadMonthlyPlanCSV(month: string): Promise<void> {
    const blob = await api.downloadBlob('exports/monthly-plan-csv/', { month });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Monthly_Plan_Export_${month}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
};

