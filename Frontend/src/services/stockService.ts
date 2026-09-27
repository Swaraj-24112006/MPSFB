import { api } from './api';
import { StockReportItem } from '../types';

export interface BackendStockItem {
  id: number;
  part_number: string;
  material_description: string;
  material_type: 'FG' | 'RM' | 'PM';
  unrestricted_stock: string | number;
  in_quality_insp: string | number;
  blocked: string | number;
  storage_location: string;
  uom: string;
  safety_stock: string | number;
  plant: string;
  total_stock?: string | number;
  is_below_safety_stock?: boolean;
  upload_batch_id?: number;
  created_at?: string;
  updated_at?: string;
  // CamelCase aliases from serializer
  partNumber?: string;
  materialDescription?: string;
  materialType?: 'FG' | 'RM' | 'PM';
  unrestrictedStock?: number;
  inQualityInsp?: number;
  storageLocation?: string;
  safetyStock?: number;
  lastUpdated?: string;
}

export interface StockUploadResponse {
  message: string;
  batch_id: number;
  total_rows: number;
  imported_rows: number;
  error_rows: number;
  mode: string;
  warnings: string[];
  skipped_rows: Array<{ row_index: number; part_number?: string; reason: string }>;
}

export function mapBackendStockToFrontend(item: BackendStockItem): StockReportItem {
  return {
    id: String(item.id),
    partNumber: item.partNumber || item.part_number || '',
    materialDescription: item.materialDescription || item.material_description || '',
    materialType: (item.materialType || item.material_type || 'RM') as 'FG' | 'RM' | 'PM',
    unrestrictedStock: Number(item.unrestrictedStock ?? item.unrestricted_stock) || 0,
    inQualityInsp: Number(item.inQualityInsp ?? item.in_quality_insp) || 0,
    blocked: Number(item.blocked) || 0,
    storageLocation: item.storageLocation || item.storage_location || 'SL01',
    uom: item.uom || 'PC',
    safetyStock: Number(item.safetyStock ?? item.safety_stock) || 0,
    plant: item.plant || '1001',
    lastUpdated: item.lastUpdated || (item.updated_at ? item.updated_at.slice(0, 10) : new Date().toISOString().slice(0, 10))
  };
}

export const stockService = {
  /**
   * Fetch stock records with optional filtering (defaults unpaginated)
   */
  async getStockReport(params?: {
    material_type?: string;
    part_number?: string;
    storage_location?: string;
    below_safety_stock?: boolean;
    search?: string;
    paginate?: boolean;
  }): Promise<StockReportItem[]> {
    const query: Record<string, string> = {};
    if (params?.paginate === false || params?.paginate === undefined) {
      query.paginate = 'false';
    } else {
      query.paginate = 'true';
    }
    if (params?.material_type) query.material_type = params.material_type;
    if (params?.part_number) query.part_number = params.part_number;
    if (params?.storage_location) query.storage_location = params.storage_location;
    if (params?.below_safety_stock) query.below_safety_stock = 'true';
    if (params?.search) query.search = params.search;

    const data = await api.get<any>('/stock/', query);
    const results = Array.isArray(data) ? data : (data?.results || []);
    return results.map(mapBackendStockToFrontend);
  },

  /**
   * Create a single stock item
   */
  async createStockItem(payload: Partial<StockReportItem>): Promise<StockReportItem> {
    const data = await api.post<BackendStockItem>('/stock/', payload);
    return mapBackendStockToFrontend(data);
  },

  /**
   * Update an existing stock item
   */
  async updateStockItem(id: number | string, payload: Partial<StockReportItem>): Promise<StockReportItem> {
    const data = await api.patch<BackendStockItem>(`/stock/${id}/`, payload);
    return mapBackendStockToFrontend(data);
  },

  /**
   * Delete a stock item by ID
   */
  async deleteStockItem(id: number | string): Promise<{ message: string }> {
    return api.del<{ message: string }>(`/stock/${id}/`);
  },

  /**
   * Bulk upload stock report via file (.csv, .xlsx) or pasted text
   */
  async bulkUpload(content: {
    file?: File;
    csv_text?: string;
    mode?: 'replace' | 'append';
  }): Promise<StockUploadResponse> {
    const mode = content.mode || 'replace';
    if (content.file) {
      const formData = new FormData();
      formData.append('file', content.file);
      formData.append('mode', mode);
      return api.upload<StockUploadResponse>('/uploads/stock-report/', formData);
    } else {
      return api.post<StockUploadResponse>('/uploads/stock-report/', {
        csv_text: content.csv_text || '',
        mode
      });
    }
  },

  /**
   * Get direct URL to download filtered stock export
   */
  getExportUrl(params?: { material_type?: string; search?: string }): string {
    const searchParams = new URLSearchParams();
    if (params?.material_type) searchParams.set('material_type', params.material_type);
    if (params?.search) searchParams.set('search', params.search);
    return `/api/exports/stock-csv/?${searchParams.toString()}`;
  }
};
