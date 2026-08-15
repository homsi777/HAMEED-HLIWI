const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';

export type ShiftStatus = 'open' | 'closing_requested' | 'closed' | 'cancelled';
export interface KaratWeight { karat: string; weightGrams: number; }

export interface ShiftTotals {
  invoiceCount: number; salesGrossUsd: number; itemCount: number;
  cashReceivedUsd: number; cashReceivedSyp: number;
  creditInvoiceCount: number; creditCreatedUsd: number; outstandingUsd: number;
  returnCount: number; returnsTotalUsd: number;
  cashRefundedUsd: number; cashRefundedSyp: number;
  netCashUsd: number; netCashSyp: number; manualSaleLineCount: number;
  soldWeightByKarat: KaratWeight[]; exchangeGoldByKarat: KaratWeight[];
}

export interface ShiftSummary {
  id: string; shiftNumber: string; status: ShiftStatus;
  sellerId: string; sellerName: string; warehouseId: string; warehouseName: string;
  openedAt: string; closingRequestedAt: string | null; closedAt: string | null; approvedAt: string | null;
  openingCustodyUSD: number; openingCustodySYP: number;
  expectedUSD: number; expectedSYP: number;
  actualUSD: number | null; actualSYP: number | null;
  differenceUSD: number | null; differenceSYP: number | null;
  sellerNote: string; managerNote: string;
  totals?: ShiftTotals; isSnapshot: boolean;
}

export interface ShiftTimelineEntry {
  id: string; type: string; occurredAt: string; actor: string; description: string;
  referenceNumber: string | null; amountUsd: number | null;
  salesInvoiceId: string | null; returnInvoiceId: string | null;
}
export interface ShiftSaleLine { id: string; invoiceNumber: string; status: string; customerName: string; finalTotalUSD: number; remainingDebtUSD: number; createdAt: string; }
export interface ShiftReturnLine { id: string; returnNumber: string; status: string; partnerName: string; finalTotalUSD: number; createdAt: string; }
export interface ShiftDetail extends ShiftSummary { timeline: ShiftTimelineEntry[]; sales: ShiftSaleLine[]; returns: ShiftReturnLine[]; }

// Fastify refuses an empty body when the JSON content type is set, so the header is sent only
// when there is actually a body. A body-less POST — logout, logout-all, refresh — would
// otherwise be rejected with 400 before it ever reached the route.
async function rawRequest(path: string, options: RequestInit = {}) {
  return fetch(`${apiBaseUrl}${path}`, { ...options, credentials: 'include', headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response = await rawRequest(path, options);
  if (response.status === 401) {
    const renewal = await rawRequest('/auth/refresh', { method: 'POST' });
    if (renewal.ok) response = await rawRequest(path, options);
  }
  if (!response.ok) throw { status: response.status, ...(await response.json().catch(() => ({ message: response.statusText })) as object) };
  return response.json() as Promise<T>;
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export interface ShiftFilters { live?: boolean; status?: ShiftStatus; warehouseId?: string; sellerId?: string; dateFrom?: string; dateTo?: string; hasDifference?: boolean; }

export const shiftsApi = {
  list: (filters: ShiftFilters = {}) => {
    const query = new URLSearchParams();
    if (filters.live) query.set('live', 'true');
    if (filters.status) query.set('status', filters.status);
    if (filters.warehouseId) query.set('warehouseId', filters.warehouseId);
    if (filters.sellerId) query.set('sellerId', filters.sellerId);
    if (filters.dateFrom) query.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) query.set('dateTo', filters.dateTo);
    if (filters.hasDifference) query.set('hasDifference', 'true');
    const suffix = query.toString();
    return request<{ items: ShiftSummary[] }>(`/shifts${suffix ? `?${suffix}` : ''}`);
  },
  current: () => request<{ shift: ShiftDetail | null; canOpen: boolean }>('/shifts/current'),
  detail: (id: string) => request<ShiftDetail>(`/shifts/${id}`),
  // The idempotency key makes a double tap or a retried request safe.
  open: (openingCustodyUSD: string, openingCustodySYP: string, note?: string) =>
    request<ShiftDetail>('/shifts', { method: 'POST', body: JSON.stringify({ openingCustodyUSD, openingCustodySYP, note, idempotencyKey: uuid() }) }),
  requestClose: (id: string, actualUSD: string, actualSYP: string, note?: string) =>
    request<ShiftDetail>(`/shifts/${id}/closing-request`, { method: 'POST', body: JSON.stringify({ actualUSD, actualSYP, note }) }),
  approve: (id: string, managerNote?: string) => request<ShiftDetail>(`/shifts/${id}/approve`, { method: 'POST', body: JSON.stringify({ managerNote }) }),
  reject: (id: string, managerNote: string) => request<ShiftDetail>(`/shifts/${id}/reject`, { method: 'POST', body: JSON.stringify({ managerNote }) }),
};
