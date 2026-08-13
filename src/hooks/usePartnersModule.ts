import { useCallback, useEffect, useState } from 'react';
import type { PartnerType } from '../types';
import { partnersApi, type ApiPartner } from '../services/partnersApi';

export function usePartnersModule(filters: { type?: PartnerType; search: string; page: number }) {
  const [partners, setPartners] = useState<ApiPartner[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await partnersApi.list({ type: filters.type, search: filters.search, page: filters.page, limit: 20, sort: 'name', order: 'asc' });
      setPartners(response.items); setTotal(response.meta.total);
    } catch (reason: any) { setError(reason?.message || 'تعذر تحميل العملاء والموردين من الخادم.'); }
    finally { setLoading(false); }
  }, [filters.type, filters.search, filters.page]);

  useEffect(() => { void refresh(); }, [refresh]);
  const mutate = async (action: () => Promise<unknown>) => {
    try { setError(''); await action(); await refresh(); return true; }
    catch (reason: any) { setError(reason?.message || 'تعذر حفظ التغيير.'); return false; }
  };
  return { partners, total, loading, error, refresh, mutate };
}
