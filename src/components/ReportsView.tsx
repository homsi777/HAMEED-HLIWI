import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Building2, Boxes, Coins, FileDown, Receipt, Scale, Search, Share2, TrendingUp, Users, Wallet } from 'lucide-react';
import { reportsApi, type ReportFilters } from '../services/reportsApi';

// Do not use StoreContext here: its browser cache can outlive a login. Each row is fetched
// from the server, which applies the authenticated user's warehouse scope.
type ReportKey = 'overview' | 'sales' | 'salesByCustomer' | 'salesByKarat' | 'purchases' | 'workmanship' | 'inventory' | 'inventoryByKarat' | 'inventoryByWarehouse' | 'partners' | 'cash';
type Definition = { key: ReportKey; title: string; group: string; icon: React.ElementType; description: string };
const reports: Definition[] = [
  { key: 'overview', title: 'لوحة الإدارة', group: 'نظرة عامة', icon: BarChart3, description: 'ملخص الحركات المسموحة لهذا الحساب' },
  { key: 'sales', title: 'ملخص المبيعات', group: 'المبيعات', icon: Receipt, description: 'مبيعات المستودع خلال الفترة' },
  { key: 'salesByCustomer', title: 'المبيعات حسب العميل', group: 'المبيعات', icon: Users, description: 'عملاء نطاق المستودع فقط' },
  { key: 'salesByKarat', title: 'المبيعات حسب العيار', group: 'المبيعات', icon: Coins, description: 'الأوزان والقيم المسجلة ضمن النطاق' },
  { key: 'purchases', title: 'ملخص المشتريات', group: 'المشتريات', icon: Building2, description: 'مشتريات الموردين التابعة للمستودع' },
  { key: 'workmanship', title: 'إيراد المصنعية', group: 'الإيرادات', icon: TrendingUp, description: 'إيراد المصنعية وليس ربح الذهب' },
  { key: 'inventory', title: 'ملخص المخزون', group: 'المخزون', icon: Boxes, description: 'أرصدة المخزون المحسوبة من الخادم' },
  { key: 'inventoryByKarat', title: 'المخزون حسب العيار', group: 'المخزون', icon: Scale, description: 'الوزن لكل عيار' },
  { key: 'inventoryByWarehouse', title: 'المخزون حسب المستودع', group: 'المخزون', icon: Building2, description: 'المستودعات المصرح بها للحساب فقط' },
  { key: 'partners', title: 'كشف العملاء والموردين', group: 'الذمم', icon: Users, description: 'ذمم جهات المستودع فقط' },
  { key: 'cash', title: 'الصناديق والسيولة', group: 'المالية', icon: Wallet, description: 'صناديق المستودع وحركاتها فقط' },
];
const n = (value: unknown) => Number(value ?? 0);
const money = (value: unknown) => `$ ${n(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const Empty = () => <div className="p-8 text-center text-xs text-slate-400">لا توجد بيانات مسجلة ضمن الفترة الحالية.</div>;

export const ReportsView: React.FC = () => {
  const [active, setActive] = useState<ReportKey>('overview');
  const [search, setSearch] = useState('');
  const [catalogue, setCatalogue] = useState(false);
  const [period, setPeriod] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const content = useRef<HTMLElement>(null);
  const definition = reports.find(report => report.key === active)!;
  const filters: ReportFilters = useMemo(() => {
    const now = new Date(); const day = (date: Date) => date.toISOString().slice(0, 10);
    const from = period === 'today' ? day(now) : period === 'week' ? day(new Date(now.getTime() - 6 * 86400000)) : period === 'month' ? `${day(now).slice(0, 8)}01` : undefined;
    return { from, to: from ? day(now) : undefined };
  }, [period]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError('');
      try {
        const [overview, sales, byCustomer, purchases, workmanship, inventory, receivables, cash] = await Promise.all([
          reportsApi.overview(filters), reportsApi.sales(filters), reportsApi.salesByCustomer(filters), reportsApi.purchases(filters), reportsApi.workmanship(filters), reportsApi.inventory(filters), reportsApi.receivables(filters), reportsApi.cash(filters),
        ]);
        if (!cancelled) setData({ overview, sales, byCustomer, purchases, workmanship, inventory, receivables, cash });
      } catch (reason: any) { if (!cancelled) setError(reason?.status === 403 ? 'لا تملك صلاحية عرض التقارير.' : reason?.message || 'تعذر تحميل التقارير من الخادم.'); }
      finally { if (!cancelled) setLoading(false); }
    };
    void load(); return () => { cancelled = true; };
  }, [filters]);
  useEffect(() => {
    const activate = () => { document.body.classList.add('generic-print-active'); };
    const clear = () => document.body.classList.remove('generic-print-active');
    window.addEventListener('beforeprint', activate);
    window.addEventListener('afterprint', clear);
    return () => { window.removeEventListener('beforeprint', activate); window.removeEventListener('afterprint', clear); clear(); };
  }, []);
  const rows = (items: any[]) => !search.trim() ? items : items.filter(item => JSON.stringify(item).toLowerCase().includes(search.toLowerCase()));
  const line = (title: string, subtitle: string, value: string, tone = 'text-slate-900') => <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-100 py-3 last:border-0"><div className="min-w-0"><p className="truncate text-xs font-black text-slate-900">{title}</p><p className="mt-0.5 text-[11px] leading-4 text-slate-500">{subtitle}</p></div><p className={`self-center whitespace-nowrap text-left font-mono text-xs font-black ${tone}`}>{value}</p></div>;
  const card = (label: string, value: string, tone = 'amber') => <div className={`rounded-sm border border-slate-200 border-r-4 ${tone === 'rose' ? 'border-r-rose-500' : tone === 'emerald' ? 'border-r-emerald-500' : 'border-r-amber-400'} bg-white p-3`}><p className="text-[10px] font-bold text-slate-500">{label}</p><p className="mt-1 font-mono text-lg font-black text-slate-900">{value}</p></div>;
  const body = () => {
    if (active === 'overview') { const o = data.overview; return !o ? <Empty /> : <><div className="grid grid-cols-2 lg:grid-cols-5 gap-2">{card('مبيعات مسجلة', money(o.sales?.valueUSD), 'emerald')}{card('إيراد المصنعية', money(data.workmanship?.totalUSD))}{card('ذهب المخزون الصافي', `${n(o.inventory?.pureGoldGrams).toFixed(2)} غ`)}{card('لنا على العملاء', money(o.receivables?.owedToShopUSD), 'rose')}{card('علينا للموردين', money(o.receivables?.owedByShopUSD))}</div><div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">{(o.cash ?? []).map((box: any) => line(box.name, `عملة الصندوق: ${box.currency}`, box.currency === 'USD' ? money(box.closingBalance) : `${n(box.closingBalance).toLocaleString('ar-SY')} ل.س`, 'text-emerald-700'))}</div></>; }
    if (active === 'sales') { const t = data.sales?.totals; return !t ? <Empty /> : <div>{line('إجمالي المبيعات', `${n(t.invoices)} فاتورة ضمن الفترة`, money(t.valueUSD), 'text-emerald-700')}{line('المدفوع', 'المبالغ المسددة', money(t.paidUSD), 'text-emerald-700')}{line('المتبقي', 'ذمم مبيعات المستودع', money(t.outstandingUSD), 'text-rose-700')}</div>; }
    if (active === 'salesByCustomer') { const list = rows(data.byCustomer ?? []); return <>{list.map((x: any) => line(x.partnerName, `${n(x.invoices)} فاتورة • آخر تعامل: ${x.lastAt ? new Date(x.lastAt).toLocaleDateString('ar-EG') : '—'}`, `${money(x.valueUSD)}${n(x.outstandingUSD) > 0 ? ` • متبقٍ ${money(x.outstandingUSD)}` : ''}`, 'text-emerald-700'))}{!list.length && <Empty />}</>; }
    if (active === 'salesByKarat') { const list = data.sales?.byKarat ?? []; return <>{list.map((x: any) => line(`عيار ${x.karat}`, `${n(x.lines)} سطر • صافي ${n(x.netWeightGrams).toFixed(2)} غ`, money(n(x.goldValueUSD) + n(x.workmanshipUSD)), 'text-amber-800'))}{!list.length && <Empty />}</>; }
    if (active === 'purchases') { const p = data.purchases; const list = rows(p?.byPartner ?? []); return <>{p?.totals && line('إجمالي المشتريات', `${n(p.totals.invoices)} فاتورة ضمن الفترة`, money(p.totals.valueUSD), 'text-amber-800')}{list.map((x: any) => line(x.partnerName, `${n(x.invoices)} فاتورة`, money(x.valueUSD), 'text-amber-800'))}{!p?.totals && !list.length && <Empty />}</>; }
    if (active === 'workmanship') { const w = data.workmanship; return !w ? <Empty /> : <>{(w.byKarat ?? []).map((x: any) => line(`عيار ${x.karat}`, `${n(x.weightGrams).toFixed(2)} غ مباعة`, money(x.workmanshipUSD), 'text-emerald-700'))}{line('الإجمالي', 'إيراد المصنعية خلال الفترة', money(w.totalUSD), 'text-emerald-700')}</>; }
    if (active === 'inventory' || active === 'inventoryByKarat') { const i = data.inventory; const list = i?.byKarat ?? []; return <>{list.map((x: any) => line(`عيار ${x.karat}`, `${n(x.pieces)} قطعة • ذهب مكافئ 24: ${(n(x.weightGrams) * n(x.karat) / 24).toFixed(2)} غ`, `${n(x.weightGrams).toFixed(2)} غ`, 'text-amber-800'))}{list.length > 0 && <p className="mt-3 text-[11px] font-bold text-slate-600">إجمالي الذهب الصافي: {n(i.pureGoldGrams).toFixed(2)} غ</p>}{!list.length && <Empty />}</>; }
    if (active === 'inventoryByWarehouse') { const list = data.inventory?.byWarehouse ?? []; return <>{list.map((x: any) => line(x.warehouseName, `${n(x.pieces)} قطعة متاحة`, `${n(x.weightGrams).toFixed(2)} غ`, 'text-amber-800'))}{!list.length && <Empty />}</>; }
    if (active === 'partners') { const list = rows(data.receivables?.rows ?? []); return <>{list.map((x: any) => line(x.partnerName, `${x.partnerType === 'supplier' ? 'مورّد' : x.partnerType === 'both' ? 'عميل ومورّد' : 'عميل'} • أعمار الدين: ${n(x.aging?.currentUSD).toFixed(0)} / ${n(x.aging?.days30USD).toFixed(0)} / ${n(x.aging?.days60USD).toFixed(0)} / ${n(x.aging?.days90PlusUSD).toFixed(0)}`, n(x.balanceUSD) > 0 ? `لنا عليه ${money(x.balanceUSD)}` : `له علينا ${money(Math.abs(n(x.balanceUSD)))}`, n(x.balanceUSD) > 0 ? 'text-rose-700' : 'text-emerald-700'))}{!list.length && <Empty />}</>; }
    const list = data.cash?.boxes ?? []; return <>{list.map((x: any) => line(x.name, `${x.currency} • وارد ${n(x.periodInflow).toFixed(2)} • صادر ${n(x.periodOutflow).toFixed(2)}`, x.currency === 'USD' ? money(x.closingBalance) : `${n(x.closingBalance).toLocaleString('ar-SY')} ل.س`, 'text-emerald-700'))}{!list.length && <Empty />}</>;
  };
  const share = () => window.open(`https://wa.me/?text=${encodeURIComponent(`${content.current?.innerText || `تقرير ${definition.title}`}\n\nنظام حميد حليوي`)}`, '_blank', 'noopener,noreferrer');
  return <div className="space-y-3 sm:space-y-6" dir="rtl"><header className="flex items-center justify-between gap-3 rounded-sm border border-slate-200 border-r-4 border-r-amber-400 bg-white p-3 sm:p-5 shadow-sm"><div><p className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700"><BarChart3 className="w-4 h-4" />مركز التقارير الإداري</p><h2 className="text-base sm:text-2xl font-black text-slate-900">التقارير والتحليلات</h2></div><div className="no-print flex gap-1"><button onClick={() => window.print()} className="rounded-sm bg-slate-900 p-2 text-amber-400"><FileDown className="w-4 h-4" /></button><button onClick={share} className="rounded-sm border border-slate-200 bg-white p-2"><Share2 className="w-4 h-4" /></button></div></header><div className="no-print grid grid-cols-[1fr_auto] gap-2"><div className="relative"><Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث داخل التقرير الحالي..." className="w-full rounded-sm border border-slate-200 bg-white py-2 pr-9 pl-3 text-xs" /></div><button onClick={() => setCatalogue(value => !value)} className="rounded-sm bg-amber-400 px-3 text-xs font-black text-slate-900">التقارير ({reports.length})</button></div>{catalogue && <div className="no-print rounded-sm border border-slate-200 bg-white p-2 shadow-sm"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">{reports.map(report => { const Icon = report.icon; return <button key={report.key} onClick={() => { setActive(report.key); setCatalogue(false); setSearch(''); }} className={`flex items-center gap-2 rounded-sm p-2.5 text-right ${active === report.key ? 'bg-slate-900 text-amber-400' : 'hover:bg-amber-50 text-slate-800'}`}><Icon className="w-4 h-4 shrink-0" /><span><b className="block text-xs">{report.title}</b><small className="block text-[10px] opacity-70">{report.group} — {report.description}</small></span></button>; })}</div></div>}<select value={period} onChange={e => setPeriod(e.target.value as typeof period)} className="no-print w-full rounded-sm border border-slate-200 bg-white p-2 text-xs"><option value="all">كل الفترات</option><option value="today">اليوم</option><option value="week">آخر 7 أيام</option><option value="month">هذا الشهر</option></select>{(loading || error) && <div className={`no-print rounded-sm border px-4 py-2.5 text-[11px] font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{error || 'جارٍ حساب التقارير على الخادم...'}</div>}<main ref={content} className="print-container rounded-sm border border-slate-200 bg-white shadow-sm"><div className="print-only print-brand-header"><div><b>نظام حميد حليوي</b><span>تقرير المستودع</span></div><div><b>{definition.title}</b><span>{new Date().toLocaleDateString('ar-SY')}</span></div></div><div className="border-b border-slate-100 p-3 sm:p-5"><p className="text-[10px] font-bold text-amber-700">{definition.group}</p><h3 className="text-base font-black text-slate-900">{definition.title}</h3><p className="mt-1 text-[11px] text-slate-500">{definition.description}</p></div><div className="p-3 sm:p-5">{body()}</div></main></div>;
};
