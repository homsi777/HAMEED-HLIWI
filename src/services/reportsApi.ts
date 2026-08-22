const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${base}${path}`, { credentials: 'include' });
  if (!response.ok) throw { status: response.status, ...(await response.json().catch(() => ({})) as object) };
  return response.json() as Promise<T>;
}

const query = (filters: Record<string, string | undefined>) =>
  new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '') as [string, string][]).toString();

export type ReportFilters = { from?: string; to?: string; warehouseId?: string; karat?: string; sellerId?: string };

/**
 * TASK 19: every figure here is aggregated on the server from the authoritative records.
 *
 * Nothing is totalled in the browser — two clients must never disagree because one had a shorter
 * page — and nothing carries cost, profit or valuation, because TASK 16 is deferred and almost no
 * item in production has an acquisition cost behind it.
 */
export type SalesReport = {
  totals: { invoices: number; valueUSD: number; valueSYP: number; paidUSD: number; paidSYP: number; outstandingUSD: number } | null;
  byKarat: Array<{ karat: string; lines: number; pieces: number; returnedPieces: number; soldWeightGrams: number; returnedWeightGrams: number; netWeightGrams: number; goldValueUSD: number; workmanshipUSD: number }>;
  cancelled: { count: number; valueUSD: number };
};
export type InventoryReport = {
  byKarat: Array<{ karat: string; pieces: number; grossWeightGrams: number; weightGrams: number }>;
  byWarehouse: Array<{ warehouseId: string; warehouseName: string; pieces: number; weightGrams: number }>;
  byOrigin: Array<{ origin: 'purchase' | 'direct' | 'historical' | 'used_gold'; items: number; weightGrams: number }>;
  pureGoldGrams: number; totalGrossWeightGrams: number; estimatedSellValueUSD: number;
};
export type ReceivablesReport = {
  totalOwedToShopUSD: number; totalOwedByShopUSD: number;
  rows: Array<{ partnerId: string; partnerName: string; partnerType: string; balanceUSD: number; owedToShopUSD: number; owedByShopUSD: number;
    aging: { currentUSD: number; days30USD: number; days60USD: number; days90PlusUSD: number } }>;
};
export type CashReport = { note: string; boxes: Array<{ cashboxId: string; name: string; currency: 'USD' | 'SYP'; openingBalance: number; periodInflow: number; periodOutflow: number; closingBalance: number }> };
export type GoldReport = { note: string; physicalByKarat: Array<{ karat: string; grams: number }>; custody: Array<{ personId: string; name: string; partnerId: string | null; balances: Array<{ karat: string; outstandingGrams: number }> }>; partnerOwedToShopByKarat: Array<{ karat: string; grams: number }> };
export type WorkmanshipReport = { note: string; totalUSD: number; byKarat: Array<{ karat: string; weightGrams: number; workmanshipUSD: number }> };
export type DashboardActivity = { id: string; action: string; module: string; actorName: string; warehouseName: string | null; createdAt: string };

export const reportsApi = {
  overview: (filters: ReportFilters = {}) => request<any>(`/reports/overview?${query(filters)}`),
  sales: (filters: ReportFilters = {}) => request<SalesReport>(`/reports/sales?${query(filters)}`),
  salesByCustomer: (filters: ReportFilters = {}) => request<Array<{ partnerId: string; partnerName: string; partnerType: string; invoices: number; valueUSD: number; paidUSD: number; outstandingUSD: number; lastAt: string | null }>>(`/reports/sales-by-customer?${query(filters)}`),
  purchases: (filters: ReportFilters = {}) => request<any>(`/reports/purchases?${query(filters)}`),
  workmanship: (filters: ReportFilters = {}) => request<WorkmanshipReport>(`/reports/workmanship?${query(filters)}`),
  inventory: (filters: ReportFilters = {}) => request<InventoryReport>(`/reports/inventory?${query(filters)}`),
  receivables: (filters: ReportFilters = {}) => request<ReceivablesReport>(`/reports/receivables?${query(filters)}`),
  cash: (filters: ReportFilters = {}) => request<CashReport>(`/reports/cash?${query(filters)}`),
  gold: (filters: ReportFilters = {}) => request<GoldReport>(`/reports/gold?${query(filters)}`),
  activity: (limit = 5) => request<DashboardActivity[]>(`/reports/activity?${query({ limit: String(limit) })}`),
  /** A real daily series. The dashboard used to draw a hardcoded week with one real point. */
  salesTimeline: (days = 14, filters: ReportFilters = {}) => request<Array<{ date: string; salesUSD: number; purchasesUSD: number; invoices: number }>>(`/reports/sales-timeline?${query({ ...filters, days: String(days) })}`),
  shifts: (filters: ReportFilters = {}) => request<any[]>(`/reports/shifts?${query(filters)}`),
};
