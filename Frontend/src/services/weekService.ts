import api, { PaginatedResponse } from './api';
import { WeekDefinition } from '../types';

export interface WeekDTO {
  id: number;
  month: string;
  week_no: number;
  week_code: string;
  week_label: string;
  start_date: string;
  end_date: string;
  days_count: number;
  holiday_days: number;
  working_days: number;
  created_at?: string;
  updated_at?: string;
}

export interface WeekCreatePayload {
  month: string;
  week_no: number;
  week_label?: string;
  start_date: string;
  end_date: string;
  holiday_days?: number;
}

export interface WeekUpdatePayload {
  month?: string;
  week_no?: number;
  week_label?: string;
  start_date?: string;
  end_date?: string;
  holiday_days?: number;
}

export interface WeekAutoGeneratePayload {
  month?: string;
  year?: string;
  overwrite?: boolean;
}

export interface WeekAutoGenerateResponse {
  message: string;
  count: number;
  results: WeekDTO[];
}

/**
 * Convert backend WeekDTO to the frontend WeekDefinition shape.
 */
export function dtoToFrontend(dto: WeekDTO): WeekDefinition {
  return {
    id: dto.week_code,
    month: dto.month,
    weekNo: dto.week_no,
    weekLabel: dto.week_label,
    startDate: dto.start_date,
    endDate: dto.end_date,
    daysCount: dto.days_count,
    holidayDays: dto.holiday_days,
    workingDays: dto.working_days,
  };
}

export const weekService = {
  /**
   * List week definitions, optionally filtered by month (e.g. '2026-08').
   * Uses ?paginate=false to retrieve all items for clean calendar rendering.
   */
  async list(month?: string): Promise<WeekDTO[]> {
    const params = new URLSearchParams();
    params.set('paginate', 'false');
    if (month) {
      params.set('month', month.trim());
    }
    const res = await api.get<WeekDTO[] | PaginatedResponse<WeekDTO>>(`weeks/?${params.toString()}`);
    if (Array.isArray(res)) {
      return res;
    }
    return res.results || [];
  },

  /**
   * Create a single week definition.
   */
  async create(payload: WeekCreatePayload): Promise<WeekDTO> {
    return api.post<WeekDTO>('weeks/', payload);
  },

  /**
   * Update a week definition (recalculates days and triggers cascade proration).
   */
  async update(id: string | number, payload: WeekUpdatePayload): Promise<WeekDTO> {
    return api.patch<WeekDTO>(`weeks/${id}/`, payload);
  },

  /**
   * Delete a week definition.
   */
  async delete(id: string | number): Promise<void> {
    return api.del<void>(`weeks/${id}/`);
  },

  /**
   * Auto-generate standard 4-week split for a month or full year.
   */
  async autoGenerate(payload: WeekAutoGeneratePayload): Promise<WeekAutoGenerateResponse> {
    return api.post<WeekAutoGenerateResponse>('weeks/auto-generate/', payload);
  },

  /**
   * Export weeks CSV directly from the backend.
   */
  async downloadWeeksCSV(month?: string): Promise<void> {
    const params: Record<string, string> = {};
    if (month) params.month = month;
    const blob = await api.downloadBlob('exports/weeks-csv/', params);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Weeks_Export_${month || 'all'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },
};

export default weekService;
