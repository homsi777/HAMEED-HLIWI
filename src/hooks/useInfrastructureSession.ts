import { useEffect, useState } from 'react';
import { infrastructureApi, type InfrastructureUser, type WarehouseScope } from '../services/infrastructureApi';

export function useInfrastructureSession() {
  const [user, setUser] = useState<InfrastructureUser | null>(null);
  const [warehouseScope, setWarehouseScope] = useState<WarehouseScope | null>(null);
  const [mode, setMode] = useState<'loading' | 'authenticated' | 'unauthenticated' | 'legacy' | 'unavailable'>('loading');
  const refresh = async () => {
    try {
      const result = await infrastructureApi.currentUser();
      const scope = await infrastructureApi.warehouseScope();
      setUser(result.user); setWarehouseScope(scope); setMode('authenticated');
    } catch (error: any) {
      setUser(null); setWarehouseScope(null);
      if (error?.status === 401 || error?.status === 403) setMode('unauthenticated');
      else setMode(import.meta.env.PROD ? 'unavailable' : 'legacy');
    }
  };
  useEffect(() => { void refresh(); }, []);
  return { user, warehouseScope, mode, refresh };
}
