/**
 * Centralized API client for MPS Backend.
 * All HTTP requests flow through this module.
 *
 * - Base URL defaults to http://localhost:8000/api/ for local dev.
 * - JWT Bearer token is attached from localStorage (set by parent Cockpit SSO).
 * - Provides typed helper methods (get, post, patch, del) with error handling.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/';

/**
 * Retrieve the JWT access token from the parent Cockpit session.
 * During development with DEBUG=True, the backend uses AllowAny so this can be empty.
 */
function getAuthToken(): string | null {
  return localStorage.getItem('access_token') || null;
}

/**
 * Standard error structure returned by our Django backend.
 */
export interface ApiError {
  status: number;
  message: string;
  detail?: Record<string, string[]> | string;
}

/**
 * Paginated response shape from StandardResultsSetPagination.
 */
export interface PaginatedResponse<T> {
  count: number;
  total_pages: number;
  current_page: number;
  results: T[];
}

/**
 * Build request headers with optional JWT auth.
 */
function buildHeaders(): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Process the fetch response. Throws ApiError on non-2xx status.
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    // 204 No Content
    if (response.status === 204) {
      return undefined as unknown as T;
    }
    return response.json();
  }

  // Parse error body
  let detail: Record<string, string[]> | string | undefined;
  let message = `Request failed with status ${response.status}`;
  try {
    const body = await response.json();
    if (body.error) {
      message = body.error;
    } else if (body.detail) {
      message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
      detail = body.detail;
    } else {
      // DRF validation errors are { field: [errors] }
      detail = body;
      const firstField = Object.keys(body)[0];
      if (firstField && Array.isArray(body[firstField])) {
        message = `${firstField}: ${body[firstField][0]}`;
      }
    }
  } catch {
    // Response body isn't JSON
  }

  const error: ApiError = {
    status: response.status,
    message,
    detail,
  };
  throw error;
}

function getUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const base = API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`;
  return `${base}${cleanPath}`;
}

/**
 * Core request function.
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  queryParams?: Record<string, string>
): Promise<T> {
  let url = getUrl(path);
  if (queryParams) {
    const params = new URLSearchParams();
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, value);
      }
    });
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const headers = buildHeaders() as Record<string, string>;
  if (isFormData) {
    delete headers['Content-Type'];
  }

  const options: RequestInit = {
    method,
    headers,
  };
  if (body !== undefined) {
    options.body = isFormData ? (body as FormData) : JSON.stringify(body);
  }

  const response = await fetch(url, options);
  return handleResponse<T>(response);
}

// ---------- Public API helpers ----------

export const api = {
  get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return request<T>('GET', path, undefined, params);
  },

  post<T>(path: string, body: unknown): Promise<T> {
    return request<T>('POST', path, body);
  },

  patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>('PATCH', path, body);
  },

  del<T>(path: string): Promise<T> {
    return request<T>('DELETE', path);
  },

  delete<T>(path: string): Promise<T> {
    return request<T>('DELETE', path);
  },

  async upload<T>(path: string, formData: FormData): Promise<T> {
    const url = getUrl(path);
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    const token = getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });
    return handleResponse<T>(response);
  },

  async downloadBlob(path: string, params?: Record<string, string>): Promise<Blob> {
    let url = getUrl(path);
    if (params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
          searchParams.append(k, v);
        }
      });
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }
    const headers = buildHeaders();
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }
    return response.blob();
  },

  getBaseUrl(): string {
    return API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`;
  },
};

export default api;
