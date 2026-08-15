import type { GeneralSettings, GoldPriceSetting } from '../types';

const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';

// Fastify refuses an empty body when the JSON content type is set, so the header rides only with
// an actual body — the TASK 16A lesson, kept consistent across every client.
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...options,
    credentials: 'include',
    headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
  });
  if (!response.ok) throw { status: response.status, ...(await response.json().catch(() => ({})) as object) };
  return response.json() as Promise<T>;
}

/**
 * TASK 18: the shop's operating parameters, read from the server rather than from this browser.
 *
 * `isProvisional` is true while the values are the ones the migration derived from past documents
 * rather than ones a human confirmed. `version` guards against two managers saving over each other.
 */
export type ServerSettings = GeneralSettings & {
  isProvisional: boolean;
  version: number;
  updatedAt: string;
  goldPrices: (GoldPriceSetting & { version: number })[];
};

export type SettingsHistoryEntry = {
  id: string; scope: 'general' | 'gold_price'; karat: string | null;
  field: string; oldValue: string | null; newValue: string;
  actorUserId: string; occurredAt: string;
};

export const settingsApi = {
  get: () => request<ServerSettings>('/settings'),
  update: (input: Partial<GeneralSettings> & { version: number }) =>
    request<ServerSettings>('/settings', { method: 'PATCH', body: JSON.stringify(input) }),
  updateGoldPrices: (goldPrices: Array<Partial<GoldPriceSetting> & { karat: string; version?: number }>) =>
    request<ServerSettings>('/settings/gold-prices', { method: 'PUT', body: JSON.stringify({ goldPrices }) }),
  history: (limit = 50) => request<SettingsHistoryEntry[]>(`/settings/history?limit=${limit}`),
};
