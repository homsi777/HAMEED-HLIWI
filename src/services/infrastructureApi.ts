const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';

export interface InfrastructureUser { id: string; username: string; fullName: string; roles: string[]; permissions: string[]; warehouses: Array<{ id: string; name: string; isManager: boolean }>; }
export interface WarehouseScope { allWarehouses: boolean; warehouses: InfrastructureUser['warehouses']; }
export interface LoginWarehouse { id: string; name: string; }

export type DataScope = 'global' | 'warehouses' | 'own';
/** What the authenticated session may reach. The server decides this; the browser only renders it. */
export interface SessionScope {
  type: DataScope;
  allWarehouses: boolean;
  ownDataOnly: boolean;
  warehouses: InfrastructureUser['warehouses'];
  warehouseIds: string[];
  managedWarehouseIds: string[];
  modules: string[];
}

export interface ManagedUser {
  id: string; username: string; fullName: string; isActive: boolean;
  roles: Array<{ name: string; displayName: string; isSystem: boolean }>;
  permissions: string[]; scope: DataScope; modules: string[];
  warehouses: Array<{ id: string; name: string; isManager: boolean }>;
  createdAt: string; updatedAt: string;
}
export interface RolePreset { name: string; displayName: string; description: string; scope: DataScope; warehouseSelection: 'none' | 'single' | 'multiple'; permissions: string[]; }
export interface UsersCatalog { presets: RolePreset[]; permissions: string[]; warehouses: LoginWarehouse[]; actor: { id: string; scope: DataScope; canGrantGlobal: boolean }; }

// Fastify refuses an empty body when the JSON content type is set, so the header is sent only
// when there is actually a body. A body-less POST — logout, logout-all, refresh — would
// otherwise be rejected with 400 before it ever reached the route.
async function rawRequest(path: string, options: RequestInit = {}) {
  return fetch(`${apiBaseUrl}${path}`, { ...options, credentials: 'include', headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
}

// Renewal is skipped only where retrying would be wrong or would loop: obtaining a session,
// renewing one, and the public warehouse list. Everything else — including `/auth/logout` and
// `/auth/me` — may renew, because the 15-minute access cookie expires long before the session
// does, and a live session must not be treated as a dead one.
const NO_RENEWAL = ['/auth/login', '/auth/refresh', '/auth/login-warehouses'];

async function request<T>(path: string, options: RequestInit = {}, allowRenewal = true): Promise<T> {
  let response = await rawRequest(path, options);
  if (response.status === 401 && allowRenewal && !NO_RENEWAL.some(entry => path.startsWith(entry))) {
    const renewal = await rawRequest('/auth/refresh', { method: 'POST' });
    if (renewal.ok) response = await rawRequest(path, options);
  }
  if (!response.ok) throw { status: response.status, ...(await response.json().catch(() => ({ message: response.statusText })) as object) };
  return response.json() as Promise<T>;
}

export const infrastructureApi = {
  login: (username: string, password: string, warehouseId: string) => request<{ user: InfrastructureUser }>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password, warehouseId }) }),
  loginWarehouses: () => request<LoginWarehouse[]>('/auth/login-warehouses', {}, false),
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  heartbeat: () => request<{ success: boolean }>('/auth/heartbeat', { method: 'POST' }),
  logoutAll: () => request<{ success: boolean }>('/auth/logout-all', { method: 'POST' }),
  endBrowserSession: () => { void rawRequest('/auth/logout', { method: 'POST', keepalive: true }).catch(() => undefined); },
  currentUser: () => request<{ user: InfrastructureUser; scope: SessionScope }>('/auth/me'),
  warehouseScope: () => request<WarehouseScope>('/warehouses/scope'),
};

export const usersApi = {
  list: () => request<ManagedUser[]>('/users'),
  catalog: () => request<UsersCatalog>('/users/catalog'),
  create: (body: { username: string; fullName: string; password: string; roleName: string; warehouseIds: string[]; permissions?: string[] }) =>
    request<ManagedUser>('/users', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: { fullName?: string; roleName?: string; warehouseIds?: string[]; permissions?: string[] }) =>
    request<ManagedUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  setStatus: (id: string, isActive: boolean) => request<ManagedUser>(`/users/${id}/status`, { method: 'POST', body: JSON.stringify({ isActive }) }),
  resetPassword: (id: string, password: string) => request<{ id: string; username: string; passwordReset: boolean }>(`/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) }),
};
