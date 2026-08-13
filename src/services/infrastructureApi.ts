const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';

export interface InfrastructureUser { id: string; username: string; fullName: string; roles: string[]; permissions: string[]; warehouses: Array<{ id: string; name: string; isManager: boolean }>; }
export interface WarehouseScope { allWarehouses: boolean; warehouses: InfrastructureUser['warehouses']; }

async function rawRequest(path: string, options: RequestInit = {}) {
  return fetch(`${apiBaseUrl}${path}`, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...options.headers } });
}

async function request<T>(path: string, options: RequestInit = {}, allowRenewal = true): Promise<T> {
  let response = await rawRequest(path, options);
  if (response.status === 401 && allowRenewal && !path.startsWith('/auth/')) {
    const renewal = await rawRequest('/auth/refresh', { method: 'POST' });
    if (renewal.ok) response = await rawRequest(path, options);
  }
  if (!response.ok) throw { status: response.status, ...(await response.json().catch(() => ({ message: response.statusText })) as object) };
  return response.json() as Promise<T>;
}

export const infrastructureApi = {
  login: (username: string, password: string) => request<{ user: InfrastructureUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  logoutAll: () => request<{ success: boolean }>('/auth/logout-all', { method: 'POST' }),
  currentUser: () => request<{ user: InfrastructureUser }>('/auth/me'),
  warehouseScope: () => request<WarehouseScope>('/warehouses/scope'),
};
