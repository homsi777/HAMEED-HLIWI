const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';
async function request<T>(path: string, options: RequestInit = {}): Promise<T> { const response = await fetch(`${base}${path}`, { ...options, credentials: 'include', headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers } }); if (!response.ok) throw { status: response.status, ...(await response.json().catch(() => ({})) as object) }; return response.json() as Promise<T>; }
const query = (values: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== '') as [string, string][]).toString();

export type AccountClass = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type ApiAccount = { id: string; code: string; nameAr: string; nameEn: string | null; parentAccountId: string | null; accountClass: AccountClass; normalBalance: 'debit' | 'credit'; allowsPosting: boolean; isSystem: boolean; systemKey: string | null; isActive: boolean; warehouseId: string | null; currency: 'USD' | 'SYP' | null; notes: string; version: number; totalDebitUSD: number; totalCreditUSD: number; balanceUSD: number };
export type ApiJournalLine = { id: string; lineNumber: number; accountId: string; accountCode: string; accountName: string; debitUSD: number; creditUSD: number; currency: 'USD' | 'SYP'; originalAmount: number; exchangeRate: number; partnerId: string | null; cashboxId: string | null; warehouseId: string | null; memo: string; salesInvoiceId: string | null; purchaseInvoiceId: string | null; returnInvoiceId: string | null; voucherId: string | null };
export type ApiJournal = { id: string; journalNumber: string; date: string; entryDate: string; status: 'posted' | 'reversed'; sourceType: string; sourceId: string | null; sourceNumber: string | null; postingEvent: string; description: string; warehouseId: string | null; partnerId: string | null; totalDebitUSD: number; totalCreditUSD: number; reversalOfJournalId: string | null; reversedByJournalId: string | null; createdBy: string; createdAt: string; lineCount: number; lines?: ApiJournalLine[] };
export type ApiLedgerRow = { id: string; date: string; journalId: string; journalNumber: string; status: string; description: string; sourceType: string; sourceNumber: string | null; debitUSD: number; creditUSD: number; currency: 'USD' | 'SYP'; originalAmount: number; exchangeRate: number; partnerId: string | null; warehouseId: string | null; runningBalanceUSD: number };
export type ApiTrialBalanceRow = { accountId: string; code: string; nameAr: string; accountClass: AccountClass; normalBalance: 'debit' | 'credit'; openingBalanceUSD: number; periodDebitUSD: number; periodCreditUSD: number; closingBalanceUSD: number };
export type ApiReconciliation = {
  cash: Array<{ cashboxId: string; name: string; currency: 'USD' | 'SYP'; financeBalance: number; accountingBalance: number; differenceUSD: number; matches: boolean }>;
  cashBalanced: boolean;
  receivable: { accountingUSD: number; operationalUSD: number; differenceUSD: number; manualAdjustmentUSD: number; unexplainedUSD: number; matches: boolean };
  payable: { accountingUSD: number; operationalUSD: number; differenceUSD: number; manualAdjustmentUSD: number; unexplainedUSD: number; matches: boolean };
  notes: string[];
};

export const accountingApi = {
  accounts: (filters: Record<string, string | undefined> = {}) => request<ApiAccount[]>(`/accounting/accounts?${query(filters)}`),
  createAccount: (input: Record<string, unknown>) => request<ApiAccount>('/accounting/accounts', { method: 'POST', body: JSON.stringify(input) }),
  updateAccount: (id: string, input: Record<string, unknown>) => request<ApiAccount>(`/accounting/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  mappings: () => request<Array<{ id: string; mappingKey: string; description: string; accountId: string; accountCode: string; accountName: string }>>('/accounting/mappings'),
  setMapping: (input: { mappingKey: string; accountId: string; description?: string }) => request<unknown>('/accounting/mappings', { method: 'POST', body: JSON.stringify(input) }),
  journals: (filters: Record<string, string | number | undefined> = {}) => request<{ items: ApiJournal[]; meta: { page: number; limit: number; total: number } }>(`/accounting/journals?${query(filters)}`),
  journal: (id: string) => request<ApiJournal>(`/accounting/journals/${id}`),
  journalsBySource: (filters: Record<string, string | undefined>) => request<ApiJournal[]>(`/accounting/journals/by-source?${query(filters)}`),
  createJournal: (input: { description: string; date?: string; exchangeRateSypPerUsd: string | number; warehouseId?: string; lines: Array<{ accountId: string; debitUSD?: string | number; creditUSD?: string | number; partnerId?: string; memo?: string }> }) => request<ApiJournal>('/accounting/journals', { method: 'POST', body: JSON.stringify(input) }),
  reverseJournal: (id: string, reason: string) => request<ApiJournal>(`/accounting/journals/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }),
  generalLedger: (filters: Record<string, string | number | undefined>) => request<{ account: { id: string; code: string; nameAr: string; accountClass: AccountClass; normalBalance: 'debit' | 'credit' }; openingBalanceUSD: number; closingBalanceUSD: number; items: ApiLedgerRow[]; meta: { page: number; limit: number; total: number } }>(`/accounting/general-ledger?${query(filters)}`),
  trialBalance: (filters: Record<string, string | undefined> = {}) => request<{ rows: ApiTrialBalanceRow[]; totalDebitUSD: number; totalCreditUSD: number; balanced: boolean; dateFrom: string | null; dateTo: string | null }>(`/accounting/trial-balance?${query(filters)}`),
  reconciliation: () => request<ApiReconciliation>('/accounting/reconciliation'),
};
