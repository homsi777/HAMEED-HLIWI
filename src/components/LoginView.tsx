import { useEffect, useState, type FormEvent } from 'react';
import { Building2, LockKeyhole, LogIn } from 'lucide-react';
import { infrastructureApi, type LoginWarehouse } from '../services/infrastructureApi';

export function LoginView({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [warehouses, setWarehouses] = useState<LoginWarehouse[]>([]);
  const [warehouseLoading, setWarehouseLoading] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { void infrastructureApi.loginWarehouses().then(setWarehouses).catch(() => setError('تعذر تحميل قائمة المستودعات. تحقق من اتصال الخادم.')).finally(() => setWarehouseLoading(false)); }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!warehouseId) { setError('اختر المستودع أولاً.'); return; }
    setLoading(true); setError('');
    try { await infrastructureApi.login(username.trim(), password, warehouseId); await onLoggedIn(); }
    catch (reason: any) { setError(reason?.message || 'تعذر تسجيل الدخول. تحقق من البيانات والمستودع وحاول مجدداً.'); }
    finally { setLoading(false); }
  };

  const bootstrapOnly = !warehouseLoading && warehouses.length === 0;
  return <main dir="rtl" className="min-h-screen bg-slate-950 px-4 py-10 flex items-center justify-center font-sans"><section className="w-full max-w-sm border border-slate-700 bg-slate-900 p-6 shadow-2xl"><div className="mb-6 text-center"><img src="/logo.png" alt="Hliwi Jewelry" className="mx-auto mb-3 h-24 w-24 rounded-sm border border-amber-300 bg-white object-contain p-1" /><div className="mx-auto mb-2 grid h-8 w-8 place-items-center border border-amber-400 text-amber-400"><LockKeyhole className="h-4 w-4" /></div><h1 className="text-xl font-black text-amber-400">حميد حليوي للمجوهرات</h1><p className="mt-1 text-xs text-slate-400">تسجيل الدخول إلى النظام</p></div><form onSubmit={submit} className="space-y-4"><label className="block text-xs font-bold text-slate-300">المستودع / الفرع *<span className="relative mt-1.5 block"><Building2 className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-amber-400" /><select required disabled={warehouseLoading} value={warehouseId} onChange={event => setWarehouseId(event.target.value)} className="w-full appearance-none border border-slate-600 bg-slate-800 py-3 pr-9 pl-3 text-right text-sm text-white outline-none focus:border-amber-400 disabled:opacity-60"><option value="">{warehouseLoading ? 'جارٍ تحميل المستودعات...' : 'اختر المستودع'}</option>{warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}{bootstrapOnly && <option value="system">إدارة النظام — إعداد أولي</option>}</select></span>{bootstrapOnly && <span className="mt-1 block text-[10px] font-normal leading-4 text-amber-200">لا يوجد مستودع مفعّل بعد. خيار الإعداد الأولي مخصص للمدير العام فقط.</span>}</label><label className="block text-xs font-bold text-slate-300">اسم المستخدم<input required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} className="mt-1.5 w-full border border-slate-600 bg-slate-800 p-3 text-right text-sm text-white outline-none focus:border-amber-400" /></label><label className="block text-xs font-bold text-slate-300">كلمة المرور<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 w-full border border-slate-600 bg-slate-800 p-3 text-right text-sm text-white outline-none focus:border-amber-400" /></label>{error && <p className="border-r-2 border-rose-500 bg-rose-950/40 p-2 text-xs text-rose-200">{error}</p>}<button disabled={loading || warehouseLoading} className="flex w-full items-center justify-center gap-2 bg-amber-400 py-3 text-sm font-black text-slate-950 disabled:opacity-60"><LogIn className="h-4 w-4" />{loading ? 'جارٍ التحقق...' : 'دخول'}</button></form></section></main>;
}
