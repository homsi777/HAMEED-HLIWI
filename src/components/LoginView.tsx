import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { BarChart3, Building2, ChevronDown, Eye, EyeOff, Gem, LockKeyhole, LogIn, ShieldCheck, UserRound } from 'lucide-react';
import { infrastructureApi, type LoginWarehouse } from '../services/infrastructureApi';

export function LoginView({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [warehouses, setWarehouses] = useState<LoginWarehouse[]>([]);
  const [warehouseLoading, setWarehouseLoading] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [lockedSeconds, setLockedSeconds] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (lockedSeconds <= 0) return;
    const timer = window.setInterval(() => setLockedSeconds(value => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [lockedSeconds > 0]);

  useEffect(() => {
    void infrastructureApi.loginWarehouses()
      .then(setWarehouses)
      .catch(() => setError('تعذر تحميل قائمة المستودعات. تحقق من اتصال الخادم.'))
      .finally(() => setWarehouseLoading(false));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!warehouseId) { setError('اختر المستودع أولاً.'); return; }
    if (lockedSeconds > 0) return;
    setLoading(true); setError('');
    try { await infrastructureApi.login(username.trim(), password, warehouseId); await onLoggedIn(); }
    catch (reason: any) {
      const retryAfter = Number(reason?.retryAfterSeconds);
      if (Number.isFinite(retryAfter) && retryAfter > 0) setLockedSeconds(Math.ceil(retryAfter));
      setError(reason?.message || 'تعذر تسجيل الدخول. تحقق من البيانات والمستودع وحاول مجدداً.');
    }
    finally { setLoading(false); }
  };

  const bootstrapOnly = !warehouseLoading && warehouses.length === 0;
  const fieldClass = 'h-12 w-full rounded-lg border border-slate-200 bg-white px-11 text-right text-sm font-semibold text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-500 focus:ring-4 focus:ring-amber-100 disabled:cursor-wait disabled:opacity-60';

  return <main dir="rtl" className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#111827] px-4 py-6 font-sans sm:px-8">
    <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[42%] bg-[radial-gradient(ellipse_at_top,rgba(193,145,59,.28),transparent_65%)]" />
    <div aria-hidden="true" className="absolute -right-24 -top-24 h-80 w-80 rounded-full border border-amber-300/15" />
    <div aria-hidden="true" className="absolute -bottom-40 -left-32 h-[30rem] w-[30rem] rounded-full border-[34px] border-white/[.035]" />

    <section className="relative grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-amber-200/20 bg-[#fcfbf7] shadow-[0_30px_80px_rgba(0,0,0,.42)] md:min-h-[620px] md:grid-cols-[1fr_.92fr]">
      <div className="flex items-center px-6 py-8 sm:px-12 md:col-start-1 md:px-14 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 text-right">
            <div className="mb-7 border-b border-amber-200/80 pb-5 text-center md:hidden">
              <BrandLogo />
              <p className="mt-1 text-[11px] font-bold tracking-[.18em] text-amber-700">نظام إدارة تجارة الذهب والمجوهرات</p>
            </div>
            <div className="mb-4 hidden h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-800 md:flex"><LockKeyhole className="h-5 w-5" /></div>
            <p className="mb-2 text-[11px] font-black tracking-[.16em] text-amber-700">بوابة العمل الآمنة</p>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">تسجيل الدخول</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">أدخل بياناتك واختر المستودع للوصول إلى مساحة العمل الخاصة بك.</p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {lockedSeconds > 0 && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-center text-xs font-bold text-rose-700">تم حظر الدخول مؤقتاً. حاول مجدداً بعد {Math.floor(lockedSeconds / 60)}:{String(lockedSeconds % 60).padStart(2, '0')}</p>}
            <label className="block text-xs font-extrabold text-slate-700">المستودع / الفرع <span className="text-amber-600">*</span>
              <span className="relative mt-2 block"><Building2 className="pointer-events-none absolute right-4 top-3.5 h-5 w-5 text-amber-700" /><ChevronDown className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-slate-400" />
                <select required disabled={warehouseLoading} value={warehouseId} onChange={event => setWarehouseId(event.target.value)} className={`${fieldClass} appearance-none`}>
                  <option value="">{warehouseLoading ? 'جارِ تحميل المستودعات...' : 'اختر المستودع'}</option>
                  {warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
                  {bootstrapOnly && <option value="system">إدارة النظام — إعداد أولي</option>}
                </select>
              </span>
              {bootstrapOnly && <span className="mt-2 block rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-5 text-amber-800">لا يوجد مستودع مفعّل بعد. هذا الخيار مخصّص للمدير العام لإتمام الإعداد الأولي فقط.</span>}
            </label>

            <label className="block text-xs font-extrabold text-slate-700">اسم المستخدم
              <span className="relative mt-2 block"><UserRound className="pointer-events-none absolute right-4 top-3.5 h-5 w-5 text-slate-400" /><input required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} placeholder="أدخل اسم المستخدم" className={fieldClass} /></span>
            </label>

            <label className="block text-xs font-extrabold text-slate-700">كلمة المرور
              <span className="relative mt-2 block"><LockKeyhole className="pointer-events-none absolute right-4 top-3.5 h-5 w-5 text-slate-400" /><input required type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} placeholder="أدخل كلمة المرور" className={fieldClass} /><button type="button" onClick={() => setShowPassword(value => !value)} className="absolute left-3 top-2.5 rounded-lg p-1.5 text-slate-400 transition hover:bg-amber-50 hover:text-amber-800" aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span>
            </label>

            {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold leading-5 text-rose-700">{error}</p>}

            <button disabled={loading || warehouseLoading} className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-amber-400 text-sm font-black text-slate-950 shadow-[0_12px_24px_rgba(173,124,36,.22)] transition hover:bg-amber-300 active:scale-[.99] disabled:cursor-wait disabled:opacity-60"><LogIn className="h-4 w-4" />{loading ? 'جارِ التحقق...' : 'تسجيل الدخول'}</button>
          </form>
          <p className="mt-6 text-center text-[11px] font-medium text-slate-400">دخول آمن ومراقب لحماية بيانات التجارة والمستودعات.</p>
        </div>
      </div>

      <aside className="relative hidden overflow-hidden bg-[#172032] px-10 py-12 text-white md:col-start-2 md:flex md:flex-col md:items-center md:justify-center lg:px-16">
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-2 bg-amber-400" />
        <div aria-hidden="true" className="absolute -left-24 bottom-[-8rem] h-80 w-80 rounded-full border-[28px] border-amber-300/[.06]" />
        <div aria-hidden="true" className="absolute -right-28 top-[-7rem] h-80 w-80 rounded-full border-[32px] border-white/[.05]" />
        <div className="relative w-full max-w-md text-right">
          <div className="mb-9 border-b border-amber-200/20 pb-5"><BrandLogo desktop /></div>
          <span className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-300/30 bg-amber-300/10 text-amber-300"><Gem className="h-7 w-7" /></span>
          <h2 className="text-4xl font-black leading-tight tracking-tight">أهلاً بعودتك</h2>
          <p className="mt-4 max-w-sm text-base font-medium leading-8 text-slate-300">منصة حميد حليوي لإدارة تجارة الذهب والمجوهرات، ومتابعة المخزون والعملاء بوضوح وأمان.</p>
          <ul className="mt-9 space-y-4 text-sm font-bold text-slate-200">
            <Feature icon={BarChart3}>متابعة دقيقة للمبيعات والمخزون</Feature>
            <Feature icon={Gem}>إدارة متكاملة للذهب والمجوهرات</Feature>
            <Feature icon={Building2}>عمل منظم بحسب المستودع المختار</Feature>
            <Feature icon={ShieldCheck}>منصة آمنة بصلاحيات واضحة</Feature>
          </ul>
        </div>
      </aside>
    </section>
  </main>;
}

function BrandLogo({ desktop = false }: { desktop?: boolean }) {
  return <div className={`mx-auto overflow-hidden ${desktop ? 'h-[166px] w-[360px] max-w-full' : 'h-[148px] w-80 max-w-full'}`}>
    <img src="/logo-transparent.png" alt="شعار مجوهرات حليوي" className={`max-w-none ${desktop ? 'w-[360px] -translate-y-[88px]' : 'w-80 -translate-y-[78px]'}`} />
  </div>;
}

function Feature({ icon: Icon, children }: { icon: typeof BarChart3; children: ReactNode }) {
  return <li className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-300/15 text-amber-300"><Icon className="h-4 w-4" /></span><span>{children}</span></li>;
}
