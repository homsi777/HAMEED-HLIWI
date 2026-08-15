const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';

export type DocumentType = 'sale' | 'sales_return' | 'all';
export type PaymentState = 'paid' | 'partial' | 'credit' | 'cancelled';

export interface HistoryInvoice {
  id: string; invoiceNumber: string; type: 'sale' | 'sales_return'; date: string;
  status: 'posted' | 'cancelled'; paymentState: PaymentState;
  partnerId: string; partnerName: string;
  finalTotalUSD: number; paidUSD: number; paidSYP: number; remainingDebtUSD: number; paymentMethod: string;
  warehouseId: string; warehouseName: string;
  sellerId: string; sellerName: string;
  shiftId: string | null; shiftNumber: string | null;
  itemCount: number; lineCount: number; manualLineCount: number;
}

export interface SoldWeightLine {
  lineId: string; invoiceId: string; invoiceNumber: string; soldAt: string; status: 'posted' | 'cancelled';
  itemName: string; itemCode: string | null; category: string; karat: string;
  source: 'stock' | 'manual';
  quantity: number; grossWeightGrams: number; netWeightGrams: number;
  returnedQuantity: number; returnedWeightGrams: number; netAfterReturnsGrams: number;
  pricePerGramUSD: number; lineTotalUSD: number;
  customerName: string; sellerId: string; sellerName: string;
  warehouseId: string; warehouseName: string; shiftId: string | null; shiftNumber: string | null;
}

export interface KaratSummaryRow {
  karat: string; lineCount: number; quantity: number;
  soldWeightGrams: number; returnedWeightGrams: number; cancelledWeightGrams: number; netWeightGrams: number;
}
export interface SoldWeightSummary { byKarat: KaratSummaryRow[]; lineCount: number; pieceCount: number; }
export interface HistoryFilterOptions {
  warehouses: Array<{ id: string; name: string }>;
  sellers: Array<{ id: string; name: string }>;
  canFilterBySeller: boolean;
  karats: string[];
}

/** Every field is optional; the server applies scope regardless of what is sent. */
export interface HistoryFilters {
  page?: number; limit?: number;
  type?: DocumentType; status?: 'posted' | 'cancelled'; paymentState?: PaymentState;
  dateFrom?: string; dateTo?: string;
  invoiceNumber?: string; customerId?: string; customerName?: string;
  sellerId?: string; warehouseId?: string; shiftId?: string;
  karat?: string; itemName?: string; itemCode?: string; source?: 'stock' | 'manual';
}

async function rawRequest(path: string, options: RequestInit = {}) {
  return fetch(`${apiBaseUrl}${path}`, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...options.headers } });
}
async function request<T>(path: string): Promise<T> {
  let response = await rawRequest(path);
  if (response.status === 401) {
    const renewal = await rawRequest('/auth/refresh', { method: 'POST' });
    if (renewal.ok) response = await rawRequest(path);
  }
  if (!response.ok) throw { status: response.status, ...(await response.json().catch(() => ({ message: response.statusText })) as object) };
  return response.json() as Promise<T>;
}

const toQuery = (filters: HistoryFilters) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
};

export const historyApi = {
  invoices: (filters: HistoryFilters = {}) => request<{ items: HistoryInvoice[]; meta: { page: number; limit: number; total: number } }>(`/history/invoices${toQuery(filters)}`),
  soldWeights: (filters: HistoryFilters = {}) => request<{ items: SoldWeightLine[]; meta: { page: number; limit: number; total: number } }>(`/history/sold-weights${toQuery(filters)}`),
  soldWeightSummary: (filters: HistoryFilters = {}) => request<SoldWeightSummary>(`/history/sold-weights/summary${toQuery(filters)}`),
  filterOptions: () => request<HistoryFilterOptions>('/history/filters'),
};
