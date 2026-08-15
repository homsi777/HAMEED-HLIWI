import type { Partner, PartnerType } from '../types';

const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...options,
    credentials: 'include',
    headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
  });
  if (!response.ok) throw { status: response.status, ...(await response.json().catch(() => ({})) as object) };
  return response.json() as Promise<T>;
}

// `balanceUSD` is the authoritative subledger position (TASK 17 §21), not a stored column;
// `openingBalanceUSD` is the editable opening figure it starts from, and `lastActivityAt` is the
// date of the partner's most recent posted movement — null when they have never transacted.
export type ApiPartner = Partner & { version: number; isActive: boolean; archivedAt: string | null; updatedAt: string; taxNumber: string; openingBalanceUSD: number; lastActivityAt: string | null };
export type PartnerList = { items: ApiPartner[]; meta: { page: number; limit: number; total: number } };
export type PartnerInput = { name: string; type: PartnerType; phone?: string; address?: string; notes?: string; taxNumber?: string; openingBalanceUSD?: number; openingGoldBalance21kGrams?: number };

const query = (values: Record<string, string | number | undefined>) => new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== '') as [string, string][]).toString();

export const partnersApi = {
  list: (filters: Record<string, string | number | undefined>) => request<PartnerList>(`/partners?${query(filters)}`),
  create: (input: PartnerInput) => request<ApiPartner>('/partners', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: PartnerInput & { version: number }) => request<ApiPartner>(`/partners/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  archive: (id: string, version: number) => request<{ success: true }>(`/partners/${id}`, { method: 'DELETE', body: JSON.stringify({ version }) }),
  reactivate: (id: string, version: number) => request<ApiPartner>(`/partners/${id}/reactivate`, { method: 'POST', body: JSON.stringify({ version }) }),
};
