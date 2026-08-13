import type { Invoice } from '../types';
const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';
async function request<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(`${base}${path}`, { ...options, credentials: 'include', headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers } }); if (!response.ok) throw { status: response.status, ...(await response.json().catch(() => ({})) as object) }; return response.json() as Promise<T>; }
const query = (values: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== '') as [string, string][]).toString();
export type ReturnKind = 'sales_return' | 'purchase_return';
export type ReturnInvoice = Invoice & { returnType: ReturnKind; status: 'posted' | 'cancelled'; originalInvoiceId: string; originalInvoiceNumber: string | null; reason: string; returnGrossUSD: number; outstandingAdjustmentUSD: number; createdAt: string; cancelledAt: string | null; cancellationReason: string | null; itemCount?: number };
export type ReturnableLine = { sourceLineId: string; lineNumber: number; lineType: string; inventoryItemId: string | null; inventoryMode: 'individual' | 'aggregate' | null; inventoryRestorable: boolean; availableQuantity?: number; availableNetWeightGrams?: number; itemCode: string | null; itemName: string; category: string; karat: string; pricePerGramUSD: number; laborFeeUSDPerGram: number; originalQuantity: number; originalGrossWeightGrams: number; originalStoneWeightGrams: number; originalNetWeightGrams: number; returnedQuantity: number; returnedNetWeightGrams: number; remainingQuantity: number; remainingNetWeightGrams: number };
export type ReturnableDocument = { invoiceId: string; invoiceNumber: string; type: ReturnKind; status: string; warehouseId: string; partnerId: string; partnerName: string; partnerPhone: string; date: string; exchangeRateSypPerUsd: number; grossTotalUSD: number; discountUSD: number; scrapTotalValueUSD: number; finalTotalUSD: number; alreadyReturnedValueUSD: number; lines: ReturnableLine[] };
export type ReturnInput = { type: ReturnKind; originalInvoiceId: string; partnerId?: string; reason: string; items: { sourceLineId: string; quantity: number; netWeightGrams: number }[]; refundUSD: number; refundSYP: number; exchangeRateSypPerUsd: number; notes?: string; idempotencyKey: string };
export const returnsApi = {
  list: (filters: Record<string, string | number | undefined>) => request<{ items: ReturnInvoice[]; meta: { page: number; limit: number; total: number } }>(`/returns?${query(filters)}`),
  get: (id: string) => request<ReturnInvoice>(`/returns/${id}`),
  returnable: (type: ReturnKind, invoiceId: string) => request<ReturnableDocument>(`/returns/returnable?${query({ type, invoiceId })}`),
  create: (input: ReturnInput) => request<ReturnInvoice>('/returns', { method: 'POST', body: JSON.stringify(input) }),
  cancel: (id: string, reason: string) => request<ReturnInvoice>(`/returns/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
};
