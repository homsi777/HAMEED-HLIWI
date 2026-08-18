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

// The metal the shop physically holds, and the movements that put it there.
export type ApiGoldHoldingBalance = ApiGoldBalance & { scrapGrams: number };
export type ApiGoldHoldingMovement = {
  id: string; date: string; accountId: string; accountName: string; transactionNumber: string; transactionType: string;
  status: 'posted' | 'reversed'; source: string; sourceNumber: string | null; partnerId: string | null; warehouseId: string | null;
  karat: string; inGrams: number; outGrams: number; pureGoldGrams: number; goldPricePerGramUSD: number | null; valuationUSD: number | null;
  salesInvoiceId: string | null; salesGoldExchangeId: string | null; description: string;
};
export type ApiGoldHoldings = {
  accounts: Array<{ id: string; name: string; warehouseId: string | null; balances: ApiGoldHoldingBalance[]; pureGoldTotalGrams: number }>;
  totals: ApiGoldHoldingBalance[]; pureGoldTotalGrams: number; movements: ApiGoldHoldingMovement[];
  /** The same totals with the barter-scrap share removed. Scrap is real metal and stays in
   *  `totals`; these are offered beside them for the screen that reads the headline as
   *  "gold the shop bought and owns". Neither figure redefines the other. */
  totalsExcludingScrap: ApiGoldHoldingBalance[]; pureGoldTotalExcludingScrapGrams: number;
};
/** A manual correction to the shop's own metal — no partner, one line per karat, notes free text. */
export interface CompanyAdjustmentInput {
  direction: 'increase' | 'decrease';
  warehouseId?: string;
  note?: string;
  lines: Array<{ karat: string; weightGrams: string; note?: string }>;
  idempotencyKey: string;
}

export const goldApi = {
  holdings: (filters: Record<string, string | number | undefined> = {}) => request<ApiGoldHoldings>(`/gold/holdings?${query(filters)}`),
  // Barter scrap still available to reclassify, plus the manager decision that reclassifies it.
  scrapHoldings: () => request<{ holdings: ScrapHolding[] }>('/gold/holdings/scrap'),
  usedConversions: (filters: Record<string, string | number | undefined> = {}) => request<{ items: UsedConversion[] }>(`/gold/used-conversions?${query(filters)}`),
  convertToUsedInventory: (body: ConvertToUsedInput) => request<UsedConversion>('/gold/used-conversions', { method: 'POST', body: JSON.stringify(body) }),
  reverseUsedConversion: (id: string, reason: string) => request<UsedConversion>(`/gold/used-conversions/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }),
  accounts: (filters: Record<string, string | undefined> = {}) => request<ApiGoldAccount[]>(`/gold/accounts?${query(filters)}`),
  partnerBalances: (filters: Record<string, string | undefined> = {}) => request<ApiGoldPartnerSummary[]>(`/gold/partners?${query(filters)}`),
  // ذمم الأوزان: a custody recipient may be a custody person, an existing partner of any role,
  // or simply a name typed on the spot. None of them requires a commercial Customer.
  custodySearch: (search: string) => request<CustodySearchResult>(`/gold/custody/people?search=${encodeURIComponent(search)}`),
  custodyBalances: (filters: Record<string, string | undefined> = {}) => request<{ people: CustodyCard[]; canManage: boolean }>(`/gold/custody/balances?${query(filters)}`),
  custodyPerson: (personId: string) => request<CustodyPersonDetail>(`/gold/custody/people/${personId}`),
  custodyHandOut: (input: CustodyMovementInput) => request<CustodyMovement>('/gold/custody/hand-out', { method: 'POST', body: JSON.stringify(input) }),
  custodyReceive: (input: CustodyMovementInput) => request<CustodyMovement>('/gold/custody/receive', { method: 'POST', body: JSON.stringify(input) }),
  partnerBalance: (partnerId: string) => request<ApiGoldPartnerBalance>(`/gold/partners/${partnerId}`),
  statement: (partnerId: string, filters: Record<string, string | number | undefined> = {}) => request<ApiGoldStatement>(`/gold/partners/${partnerId}/statement?${query(filters)}`),
  transactions: (filters: Record<string, string | number | undefined> = {}) => request<{ items: ApiGoldTransaction[]; meta: { page: number; limit: number; total: number } }>(`/gold/transactions?${query(filters)}`),
  transaction: (id: string) => request<ApiGoldTransaction>(`/gold/transactions/${id}`),
  opening: (input: { partnerId: string; karat: string; weightGrams: string | number; direction: 'partner_owes_shop' | 'shop_owes_partner'; date?: string; note?: string; idempotencyKey: string }) => request<ApiGoldTransaction>('/gold/opening', { method: 'POST', body: JSON.stringify(input) }),
  receipt: (input: { partnerId: string; karat: string; weightGrams: string | number; warehouseId?: string; goldPriceUsdPerGram?: string | number; note?: string; allowReverseBalance?: boolean; idempotencyKey: string }) => request<ApiGoldTransaction>('/gold/receipt', { method: 'POST', body: JSON.stringify(input) }),
  payment: (input: { partnerId: string; karat: string; weightGrams: string | number; warehouseId?: string; goldPriceUsdPerGram?: string | number; note?: string; allowReverseBalance?: boolean; idempotencyKey: string }) => request<ApiGoldTransaction>('/gold/payment', { method: 'POST', body: JSON.stringify(input) }),
  conversion: (input: { partnerId: string; fromKarat: string; toKarat: string; fromWeightGrams: string | number; toWeightGrams: string | number; note?: string; idempotencyKey: string }) => request<ApiGoldTransaction>('/gold/conversion', { method: 'POST', body: JSON.stringify(input) }),
  reverse: (id: string, reason: string) => request<ApiGoldTransaction>(`/gold/transactions/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }),
  companyAdjustment: (input: CompanyAdjustmentInput) => request<ApiGoldTransaction>('/gold/company-adjustment', { method: 'POST', body: JSON.stringify(input) }),
  reconciliation: () => request<ApiGoldReconciliation>('/gold/reconciliation'),
};

// The equivalent weight at another karat, at the milligram precision the ledger stores.
export const equivalentWeight = (grams: number, fromKarat: string, toKarat: string) => Number(((grams * Number(fromKarat)) / Number(toKarat)).toFixed(3));
export const pureGoldGrams = (grams: number, karat: string) => Number(((grams * Number(karat)) / 24).toFixed(4));

export interface ScrapHolding {
  goldAccountId: string; accountName: string;
  warehouseId: string | null; warehouseName: string | null;
  karat: string;
  receivedGrams: number; convertedGrams: number; availableGrams: number;
  conversionCount: number; fullyConverted: boolean;
  lastReceivedAt: string | null; canConvert: boolean;
}
export interface UsedConversion {
  id: string; goldAccountId: string; warehouseId: string; warehouseName: string; karat: string;
  convertedWeightGrams: number; quantity: number;
  inventoryItemId: string; inventoryCode: string; inventoryName: string; inventoryStatus: string;
  inventoryMode: string; inventoryRemainingWeightGrams: number; inventoryRemainingQuantity: number;
  goldTransactionId: string; goldTransactionNumber: string;
  managerNote: string; status: 'posted' | 'reversed';
  reversedAt: string | null; reversalReason: string | null;
  createdBy: string; createdAt: string;
}
export interface ConvertToUsedInput {
  goldAccountId: string; karat: string; weightGrams: string;
  name: string; category: string; code: string;
  inventoryMode: 'individual' | 'aggregate'; quantity: string;
  managerNote: string; idempotencyKey: string;
}

export interface CustodyPersonRef { id: string; name: string; phone: string | null; note?: string | null; partnerId?: string | null; partnerName?: string | null; partnerType?: string | null; kind: 'custody_person' | 'partner'; }
export interface CustodySearchResult { people: CustodyPersonRef[]; partners: CustodyPersonRef[]; canCreate: boolean; }
export interface CustodyKaratBalance { karat: string; handedOutGrams: number; receivedBackGrams: number; outstandingGrams: number; }
export interface CustodyCard { personId: string; name: string; phone: string | null; note: string | null; partnerId: string | null; balances: CustodyKaratBalance[]; settled: boolean; }
export interface CustodyMovementRow {
  id: string; transactionId: string; transactionNumber: string;
  type: 'handed_out' | 'received_back'; karat: string; weightGrams: number;
  occurredAt: string; status: string; warehouseId: string | null; warehouseName: string | null;
  actor: string; note: string; description: string;
}
export interface CustodyPersonDetail {
  id: string; name: string; phone: string | null; note: string | null; partnerId: string | null;
  partnerName?: string | null; partnerType?: string | null;
  balances: CustodyKaratBalance[]; settled: boolean; movements: CustodyMovementRow[];
}
export interface CustodyMovement { transactionId: string; transactionNumber: string; description: string; person: { id: string; name: string } | null; }
/** `person` accepts exactly one of: custodyPersonId, partnerId, or a typed name. */
export interface CustodyMovementInput {
  person: { custodyPersonId?: string; partnerId?: string; name?: string };
  karat: string; weightGrams: string; warehouseId?: string; note?: string;
  allowReverseBalance?: boolean; idempotencyKey: string;
}
