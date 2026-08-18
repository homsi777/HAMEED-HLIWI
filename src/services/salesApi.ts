import type { Invoice, InvoiceItem, PaymentMethod, ScrapGoldItem } from '../types';
const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';
async function request<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(`${base}${path}`, { ...options, credentials: 'include', headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers } }); if (!response.ok) throw { status: response.status, ...(await response.json().catch(() => ({})) as object) }; return response.json() as Promise<T>; }
const query = (values: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== '') as [string, string][]).toString();
// `returnedState` is derived from the return documents that point at the invoice — a posted
// invoice is never rewritten, so this is the only honest way for the screen to say a sale
// has come back. `remainingDebtUSD` already has the returned share taken off it.
export type SalesInvoice = Invoice & { status: 'posted' | 'cancelled'; createdAt: string; cancelledAt: string | null; cancellationReason: string | null; payments?: unknown[]; itemCount?: number; customerOutstandingUSD?: number; returnedState?: 'none' | 'partial' | 'full'; returnedValueUSD?: number; returnCount?: number; };
export type SaleInput = { warehouseId: string; customerId: string; items: InvoiceItem[]; scrapGoldItems: ScrapGoldItem[]; discountUSD: number; paidUSD: number; paidSYP: number; paymentMethod: PaymentMethod; exchangeRateSypPerUsd: number; notes?: string; itemPhotoUrl?: string; idempotencyKey: string; };
/**
 * The invoice screen works with `itemId`, the API with `inventoryItemId`. Mapping it here
 * explicitly — rather than spreading the UI object — is what makes a stock sale actually
 * deduct stock instead of being recorded as a manual line.
 */
const saleLine = (item: InvoiceItem) => ({
  ...(item.itemId ? { inventoryItemId: item.itemId, soldWeightGrams: item.netWeightGrams, quantity: item.quantity ?? 1 } : {}),
  itemName: item.itemName, category: item.category, karat: item.karat,
  grossWeightGrams: item.grossWeightGrams, stoneWeightGrams: item.stoneWeightGrams,
  pricePerGramUSD: item.pricePerGramUSD, laborFeeUSDPerGram: item.laborFeeUSDPerGram,
});

// TASK 17 §3: the stock a seller may sell, reachable with `sales.create` alone. It deliberately
// carries none of the management fields `/inventory` returns — selling stock is not managing it.
export type SellableItem = { id: string; code: string; name: string; category: string; karat: string; inventoryMode: 'individual' | 'aggregate'; condition: string; source: string | null; quantity: number; availableWeightGrams: number; grossWeightGrams: number; stoneWeightGrams: number; laborFeeUSDPerGram: number; imageUrl?: string; warehouseId: string; warehouseName: string };

export const salesApi = { availableItems: (filters: Record<string, string | number | undefined> = {}) => request<{ items: SellableItem[]; meta: { page: number; limit: number; total: number } }>(`/sales/available-items?${query(filters)}`),
  list: (filters: Record<string, string | number | undefined>) => request<{ items: SalesInvoice[]; meta: { page: number; limit: number; total: number } }>(`/sales?${query(filters)}`), get: (id: string) => request<SalesInvoice>(`/sales/${id}`), create: (input: SaleInput) => request<SalesInvoice>('/sales', { method: 'POST', body: JSON.stringify({ ...input, items: input.items.map(saleLine) }) }), cancel: (id: string, reason: string) => request<SalesInvoice>(`/sales/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }) };
