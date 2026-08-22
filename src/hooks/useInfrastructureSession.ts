import { useEffect, useState } from 'react';
import { infrastructureApi, type InfrastructureUser, type SessionScope, type WarehouseScope } from '../services/infrastructureApi';

export function useInfrastructureSession() {
  const [user, setUser] = useState<InfrastructureUser | null>(null);
  // The scope the backend computed for this session. Navigation is derived from it, so a
  // browser can no longer grant itself a module by editing local storage.
  const [scope, setScope] = useState<SessionScope | null>(null);
  const [warehouseScope, setWarehouseScope] = useState<WarehouseScope | null>(null);
  const [mode, setMode] = useState<'loading' | 'authenticated' | 'unauthenticated' | 'legacy' | 'unavailable'>('loading');
  const refresh = async () => {
    try {
      const result = await infrastructureApi.currentUser();
      const warehouses = await infrastructureApi.warehouseScope();
      setUser(result.user); setScope(result.scope); setWarehouseScope(warehouses); setMode('authenticated');
    } catch (error: any) {
      setUser(null); setScope(null); setWarehouseScope(null);
      if (error?.status === 401 || error?.status === 403) setMode('unauthenticated');
      else setMode(import.meta.env.PROD ? 'unavailable' : 'legacy');
    }
  };
  useEffect(() => {
    void refresh();
    const endSession = () => infrastructureApi.endBrowserSession();
    window.addEventListener('pagehide', endSession);
    return () => window.removeEventListener('pagehide', endSession);
  }, []);
  return { user, scope, warehouseScope, mode, refresh };
}
