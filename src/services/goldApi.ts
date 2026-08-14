const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';
async function request<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(`${base}${path}`, { ...options, credentials: 'include', headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers } }); if (!response.ok) throw { status: response.status, ...(await response.json().catch(() => ({})) as object) }; return response.json() as Promise<T>; }
const query = (values: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== '') as [string, string][]).toString();

export const GOLD_KARATS = ['24', '22', '21', '18', '14'] as const;
export type GoldKarat = (typeof GOLD_KARATS)[number];

// A balance is always a list, one line per karat — grams of different karats are never
// added together. The pure-gold total is offered beside them, never instead of them.
export type ApiGoldBalance = { karat: string; grams: number; pureGoldGrams: number };
export type ApiGoldAccount = { id: string; kind: 'partner' | 'company'; name: string; systemCode: string | null; partnerId: string | null; partnerType: string | null; warehouseId: string | null; isActive: boolean; balances: ApiGoldBalance[]; pureGoldTotalGrams: number };
export type ApiGoldPartnerBalance = { partner: { id: string; name: string; type: string; phone: string }; accountId: string | null; balances: ApiGoldBalance[]; pureGoldTotalGrams: number };
export type ApiGoldPartnerSummary = { partnerId: string | null; accountId: string; name: string; partnerType: string | null; balances: ApiGoldBalance[]; pureGoldTotalGrams: number };
export type ApiGoldStatementRow = {
  id: string; date: string; occurredAt: string; transactionId: string; transactionNumber: string; transactionType: string; transactionTypeLabel: string;
  status: 'posted' | 'reversed'; sourceType: string; sourceNumber: string | null; description: string; karat: string;
  debitGrams: number; creditGrams: number; pureGoldGrams: number; goldPricePerGramUSD: number | null; valuationUSD: number | null;
  runningBalanceGrams: number; warehouseId: string | null; salesInvoiceId: string | null; returnInvoiceId: string | null; purchaseInvoiceId: string | null;
};
export type ApiGoldStatement = ApiGoldPartnerBalance & { rows: ApiGoldStatementRow[]; meta: { page: number; limit: number; total: number } };
export type ApiGoldTransactionLine = { id: string; lineNumber: number; accountId: string; accountName: string; accountKind: 'partner' | 'company'; karat: string; debitGrams: number; creditGrams: number; pureGoldGrams: number; goldPricePerGramUSD: number | null; valuationUSD: number | null; description: string; warehouseId: string | null };
export type ApiGoldTransaction = {
  id: string; transactionNumber: string; type: string; typeLabel: string; status: 'posted' | 'reversed'; date: string; occurredAt: string;
  partnerId: string | null; warehouseId: string | null; sourceType: string; sourceNumber: string | null; postingEvent: string;
  description: string; userNote: string; reversalOfTransactionId: string | null; reversedByTransactionId: string | null; createdBy: string; createdAt: string;
  lines?: ApiGoldTransactionLine[];
};
export type ApiGoldReconciliation = {
  salesExchanges: { total: number; posted: number; unposted: number; matches: boolean };
  transactions: { total: number; unbalanced: number; unbalancedNumbers: string[]; matches: boolean };
  karats: Array<{ karat: string; totalDebitGrams: number; totalCreditGrams: number; conversionNetGrams: number; netPureGoldGrams: number; balanced: boolean }>;
  karatsBalanced: boolean; netPureGoldGrams: number; pureGoldBalanced: boolean; notes: string[];
};

export const goldApi = {
  accounts: (filters: Record<string, string | undefined> = {}) => request<ApiGoldAccount[]>(`/gold/accounts?${query(filters)}`),
  partnerBalances: (filters: Record<string, string | undefined> = {}) => request<ApiGoldPartnerSummary[]>(`/gold/partners?${query(filters)}`),
  partnerBalance: (partnerId: string) => request<ApiGoldPartnerBalance>(`/gold/partners/${partnerId}`),
  statement: (partnerId: string, filters: Record<string, string | number | undefined> = {}) => request<ApiGoldStatement>(`/gold/partners/${partnerId}/statement?${query(filters)}`),
  transactions: (filters: Record<string, string | number | undefined> = {}) => request<{ items: ApiGoldTransaction[]; meta: { page: number; limit: number; total: number } }>(`/gold/transactions?${query(filters)}`),
  transaction: (id: string) => request<ApiGoldTransaction>(`/gold/transactions/${id}`),
  opening: (input: { partnerId: string; karat: string; weightGrams: string | number; direction: 'partner_owes_shop' | 'shop_owes_partner'; date?: string; note?: string; idempotencyKey: string }) => request<ApiGoldTransaction>('/gold/opening', { method: 'POST', body: JSON.stringify(input) }),
  receipt: (input: { partnerId: string; karat: string; weightGrams: string | number; warehouseId?: string; goldPriceUsdPerGram?: string | number; note?: string; allowReverseBalance?: boolean; idempotencyKey: string }) => request<ApiGoldTransaction>('/gold/receipt', { method: 'POST', body: JSON.stringify(input) }),
  payment: (input: { partnerId: string; karat: string; weightGrams: string | number; warehouseId?: string; goldPriceUsdPerGram?: string | number; note?: string; allowReverseBalance?: boolean; idempotencyKey: string }) => request<ApiGoldTransaction>('/gold/payment', { method: 'POST', body: JSON.stringify(input) }),
  conversion: (input: { partnerId: string; fromKarat: string; toKarat: string; fromWeightGrams: string | number; toWeightGrams: string | number; note?: string; idempotencyKey: string }) => request<ApiGoldTransaction>('/gold/conversion', { method: 'POST', body: JSON.stringify(input) }),
  reverse: (id: string, reason: string) => request<ApiGoldTransaction>(`/gold/transactions/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }),
  reconciliation: () => request<ApiGoldReconciliation>('/gold/reconciliation'),
};

// The equivalent weight at another karat, at the milligram precision the ledger stores.
export const equivalentWeight = (grams: number, fromKarat: string, toKarat: string) => Number(((grams * Number(fromKarat)) / Number(toKarat)).toFixed(3));
export const pureGoldGrams = (grams: number, karat: string) => Number(((grams * Number(karat)) / 24).toFixed(4));
