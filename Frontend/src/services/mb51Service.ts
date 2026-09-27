import { api } from './api';
import { MB51TransactionItem, MB51Classification } from '../types';

export interface BackendMB51Transaction {
  id: number;
  material_document: string;
  posting_date: string;
  movement_type: string;
  part_number: string;
  material_description: string;
  quantity: string | number;
  uom: string;
  storage_location: string;
  plant: string;
  vendor_customer: string;
  po_order_number: string;
  classification: MB51Classification;
  week_code?: string;
  upload_batch_id?: number;
  created_at?: string;
  updated_at?: string;
  // CamelCase aliases from serializer
  materialDocument?: string;
  postingDate?: string;
  movementType?: string;
  partNumber?: string;
  materialDescription?: string;
  storageLocation?: string;
  vendorOrCustomer?: string;
  poOrOrderNumber?: string;
  weekId?: string;
}

export interface MB51CreatePayload {
  materialDocument: string;
  postingDate: string;
  movementType: '101' | '601';
  partNumber: string;
  materialDescription?: string;
  quantity: number;
  uom?: string;
  storageLocation?: string;
  plant?: string;
  vendorOrCustomer?: string;
  poOrOrderNumber?: string;
}

export interface MB51UploadResponse {
  message: string;
  batch_id: number;
  total_rows: number;
  imported_rows: number;
  error_rows: number;
  warnings: string[];
  skipped_rows: Array<{ row_index: number; material_document: string; reason: string }>;
}

export function mapBackendMB51ToFrontend(item: BackendMB51Transaction): MB51TransactionItem {
  return {
    id: String(item.id),
    materialDocument: item.materialDocument || item.material_document || '',
    postingDate: item.postingDate || item.posting_date || '',
    movementType: item.movementType || item.movement_type || '101',
    partNumber: item.partNumber || item.part_number || '',
    materialDescription: item.materialDescription || item.material_description || '',
    quantity: Number(item.quantity) || 0,
    uom: item.uom || 'PC',
    storageLocation: item.storageLocation || item.storage_location || 'SL01',
    plant: item.plant || '1001',
    vendorOrCustomer: item.vendorOrCustomer || item.vendor_customer || '',
    poOrOrderNumber: item.poOrOrderNumber || item.po_order_number || '',
    classification: item.classification || 'OTHER',
    weekId: item.weekId || item.week_code || ''
  };
}

export const mb51Service = {
  /**
   * Fetch all MB51 transactions with optional filtering and unpaginated option
   */
  async getTransactions(params?: {
    month?: string;
    week_code?: string;
    movement_type?: string;
    part_number?: string;
    classification?: string;
    date_from?: string;
    date_to?: string;
    search?: string;
    paginate?: boolean;
  }): Promise<MB51TransactionItem[]> {
    const query: Record<string, string> = {};
    if (params?.paginate === false || params?.paginate === undefined) {
      query.paginate = 'false';
    } else {
      query.paginate = 'true';
    }
    if (params?.month) query.month = params.month;
    if (params?.week_code) query.week_code = params.week_code;
    if (params?.movement_type) query.movement_type = params.movement_type;
    if (params?.part_number) query.part_number = params.part_number;
    if (params?.classification) query.classification = params.classification;
    if (params?.date_from) query.date_from = params.date_from;
    if (params?.date_to) query.date_to = params.date_to;
    if (params?.search) query.search = params.search;

    const data = await api.get<any>('/mb51/', query);
    const results = Array.isArray(data) ? data : (data?.results || []);
    return results.map(mapBackendMB51ToFrontend);
  },

  /**
   * Create a single MB51 transaction record
   */
  async createTransaction(payload: MB51CreatePayload): Promise<MB51TransactionItem> {
    const data = await api.post<BackendMB51Transaction>('/mb51/', payload);
    return mapBackendMB51ToFrontend(data);
  },

  /**
   * Delete a single MB51 transaction by ID
   */
  async deleteTransaction(id: number | string): Promise<{ message: string }> {
    return api.del<{ message: string }>(`/mb51/${id}/`);
  },

  /**
   * Bulk upload MB51 transactions via file or pasted CSV/Excel text
   */
  async bulkUpload(
    content: { file?: File; csv_text?: string; month?: string }
  ): Promise<MB51UploadResponse> {
    if (content.file) {
      const formData = new FormData();
      formData.append('file', content.file);
      if (content.month) formData.append('month', content.month);
      return api.upload<MB51UploadResponse>('/uploads/mb51/', formData);
    } else {
      return api.post<MB51UploadResponse>('/uploads/mb51/', {
        csv_text: content.csv_text || '',
        month: content.month || ''
      });
    }
  },

  /**
   * Export filtered MB51 transactions as CSV download
   */
  getExportUrl(params?: { month?: string; week_code?: string; classification?: string }): string {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.set('month', params.month);
    if (params?.week_code) searchParams.set('week_code', params.week_code);
    if (params?.classification) searchParams.set('classification', params.classification);
    return `/api/exports/mb51-csv/?${searchParams.toString()}`;
  }
};
