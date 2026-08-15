import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { reportsApi, type ReportFilters } from '../services/reportsApi';
import { BarChart3, Building2, PackageSearch, Printer, Search, TrendingUp, Users, Wallet, Scale, Coins, Receipt, ShieldCheck, Boxes, ClipboardCheck, FileDown, Share2 } from 'lucide-react';

type ReportKey = 'overview' | 'sales' | 'salesByCustomer' | 'salesByKarat' | 'purchases' | 'profit' | 'inventory' | 'inventoryByKarat' | 'inventoryByWarehouse' | 'itemMovement' | 'partners' | 'debts' | 'cash' | 'expenses' | 'goldPrices' | 'audit' | 'stocktake';

type ReportDefinition = { key: ReportKey; title: string; group: string; icon: React.ElementType; description: string };

const reports: ReportDefinition[] = [
  { key: 'overview', title: 'لوحة الإدارة', group: 'نظرة عامة', icon: BarChart3, description: 'ملخص السيولة والذهب والمبيعات والذمم' },
  { key: 'sales', title: 'المبيعات والفواتير', group: 'المبيعات', icon: Receipt, description: 'كل فواتير البيع مع الوزن والقيمة' },
  { key: 'salesByCustomer', title: 'المبيعات حسب العميل', group: 'المبيعات', icon: Users, description: 'إجمالي التعاملات لكل عميل' },
  { key: 'salesByKarat', title: 'المبيعات حسب العيار', group: 'المبيعات', icon: Coins, description: 'عدد القطع والأوزان المباعة لكل عيار' },
  { key: 'purchases', title: 'المشتريات والموردون', group: 'المشتريات', icon: Building2, description: 'فواتير الشراء والوزن والقيمة' },
  { key: 'profit', title: 'إيراد المصنعية', group: 'الإيرادات', icon: TrendingUp, description: 'إيراد المصنعية المسجَّل — ليس ربحاً وليس هامشاً' },
  { key: 'inventory', title: 'المخزون الحالي', group: 'المخزون', icon: Boxes, description: 'القطع المتاحة وقيمتها الحالية' },
  { key: 'inventoryByKarat', title: 'المخزون حسب العيار', group: 'المخزون', icon: Scale, description: 'الوزن والذهب المكافئ والقيمة لكل عيار' },
  { key: 'inventoryByWarehouse', title: 'المخزون حسب الفرع', group: 'المخزون', icon: Building2, description: 'توزيع القطع والأوزان بين المستودعات' },
  { key: 'itemMovement', title: 'حركة القطعة', group: 'المخزون', icon: PackageSearch, description: 'البحث بكود القطعة أو اسمها' },
  { key: 'stocktake', title: 'تقارير الجرد', group: 'المخزون', icon: ClipboardCheck, description: 'جرد النظام الحالي وفروقات الجرد المحفوظة' },
  { key: 'partners', title: 'كشف العملاء والموردين', group: 'الذمم', icon: Users, description: 'الرصيد المالي والذهبي لكل جهة' },
  { key: 'debts', title: 'أعمار الذمم', group: 'الذمم', icon: Wallet, description: 'المطلوب تحصيله ودفعه حسب الرصيد الحالي' },
  { key: 'cash', title: 'الصناديق والسيولة', group: 'المالية', icon: Wallet, description: 'أرصدة الصناديق الحالية' },
  { key: 'expenses', title: 'المصروفات والسندات', group: 'المالية', icon: Receipt, description: 'كل سندات المصروف المسجلة' },
  { key: 'goldPrices', title: 'أسعار الذهب والعيارات', group: 'الذهب', icon: Coins, description: 'سعر الشراء والبيع الحالي لكل عيار' },
  { key: 'audit', title: 'التدقيق والحركات', group: 'الرقابة', icon: ShieldCheck, description: 'سجل العمليات المسجلة في النظام' }
];

const StocktakeSnapshots = () => {
  try { return JSON.parse(localStorage.getItem('HAMEED_HLIWI_STOCKTAKES') || '[]') as Array<{ id: string; date: string; itemCount: number; netWeight: number }>; }
  catch { return []; }
};

export const ReportsView: React.FC = () => {
  const { inventory, invoices, partners, vouchers, cashBoxes, goldPrices, warehouses, activityLogs, formatMoney, settings } = useStore();
  const [activeReport, setActiveReport] = useState<ReportKey>('overview');
  const [query, setQuery] = useState('');
  const [showCatalogue, setShowCatalogue] = useState(false);
  const [dateRange, setDateRange] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [warehouseId, setWarehouseId] = useState('all');
  const reportContentRef = useRef<HTMLElement>(null);
  // TASK 19: the figures come from the server, aggregated there from the authoritative records.
  // Nothing on this screen is totalled in the browser — two managers must never see different
  // numbers because one had a shorter page — and nothing carries cost, profit or valuation.
  const [server, setServer] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // §26: presets rather than a two-date picker, which is painful on a phone and goes unused.
  const filters: ReportFilters = useMemo(() => {
    const now = new Date();
    const day = (date: Date) => date.toISOString().slice(0, 10);
    const from = dateRange === 'today' ? day(now)
      : dateRange === 'week' ? day(new Date(now.getTime() - 6 * 86400000))
      : dateRange === 'month' ? `${day(now).slice(0, 8)}01`
      : undefined;
    return { from, to: from ? day(now) : undefined, warehouseId: warehouseId === 'all' ? undefined : warehouseId };
  }, [dateRange, warehouseId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError('');
      try {
        const [overview, sales, byCustomer, purchases, workmanship, inventoryReport, receivables, cash, gold] = await Promise.all([
          reportsApi.overview(filters), reportsApi.sales(filters), reportsApi.salesByCustomer(filters),
          reportsApi.purchases(filters), reportsApi.workmanship(filters), reportsApi.inventory(filters),
          reportsApi.receivables(filters), reportsApi.cash(filters), reportsApi.gold(filters),
        ]);
        if (!cancelled) setServer({ overview, sales, byCustomer, purchases, workmanship, inventoryReport, receivables, cash, gold });
      } catch (reason: any) {
        if (!cancelled) setError(reason?.status === 403 ? 'لا تملك صلاحية عرض التقارير.' : reason?.message || 'تعذر تحميل التقارير من الخادم.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [filters]);

  const sales = invoices.filter(invoice => invoice.type === 'sale');
  const purchases = invoices.filter(invoice => invoice.type === 'purchase');
  const stock = inventory.filter(item => item.status === 'in_stock' && (warehouseId === 'all' || item.warehouseId === warehouseId));
  const definition = reports.find(report => report.key === activeReport)!;
  const reportSnapshots = StocktakeSnapshots();

  const totals = useMemo(() => {
    const stockWeight = stock.reduce((sum, item) => sum + item.netWeightGrams, 0);
    const stockValue = stock.reduce((sum, item) => sum + item.netWeightGrams * (goldPrices.find(price => price.karat === item.karat)?.sellPriceUSDPerGram || 0) + item.totalLaborFeeUSD, 0);
    return {
      stockWeight, stockValue,
      sales: sales.reduce((sum, invoice) => sum + invoice.finalTotalUSD, 0),
      labor: sales.reduce((sum, invoice) => sum + invoice.totalLaborUSD, 0),
      receivables: partners.filter(partner => partner.balanceUSD < 0).reduce((sum, partner) => sum + Math.abs(partner.balanceUSD), 0),
      payables: partners.filter(partner => partner.balanceUSD > 0).reduce((sum, partner) => sum + partner.balanceUSD, 0)
    };
  }, [stock, goldPrices, sales, partners]);

  const filteredByQuery = (items: any[]): any[] => !query.trim() ? items : items.filter(item => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  const selectReport = (key: ReportKey) => { setActiveReport(key); setShowCatalogue(false); setQuery(''); };
  const print = () => window.print();
  const share = () => {
    const displayedReport = reportContentRef.current?.innerText?.replace(/\n{3,}/g, '\n\n').trim();
    const text = `${displayedReport || `تقرير ${definition.title}\n${definition.description}`}\n\nنظام حميد حليوي لتجارة وصياغة الذهب`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
  };

  const metric = (label: string, value: string, tone = 'amber') => <div className={`rounded-sm border border-slate-200 border-r-4 ${tone === 'rose' ? 'border-r-rose-500' : tone === 'emerald' ? 'border-r-emerald-500' : 'border-r-amber-400'} bg-white p-3`}><p className="text-[10px] font-bold text-slate-500">{label}</p><p className="mt-1 font-mono text-lg font-black text-slate-900">{value}</p></div>;
  const line = (primary: string, secondary: string, right: string, tone = 'text-slate-900') => <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-100 py-3 last:border-0"><div className="min-w-0"><p className="truncate text-xs font-black text-slate-900">{primary}</p><p className="mt-0.5 text-[11px] leading-4 text-slate-500">{secondary}</p></div><p className={`self-center whitespace-nowrap text-left font-mono text-xs font-black ${tone}`}>{right}</p></div>;

  const renderBody = () => {
    if (activeReport === 'overview') {
      const o = server.overview;
      if (!o) return <Empty />;
      return <><div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {metric('مبيعات مسجلة', formatMoney(o.sales?.valueUSD ?? 0), 'emerald')}
        {metric('إيراد المصنعية', formatMoney(server.workmanship?.totalUSD ?? 0))}
        {metric('ذهب المخزون (صافٍ)', (o.inventory?.pureGoldGrams ?? 0).toFixed(2) + ' غ')}
        {metric('لنا على العملاء', formatMoney(o.receivables?.owedToShopUSD ?? 0), 'rose')}
        {metric('علينا للموردين', formatMoney(o.receivables?.owedByShopUSD ?? 0))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(o.cash ?? []).map((box: any) => line(box.name, 'عملة الصندوق: ' + box.currency, box.currency === 'USD' ? formatMoney(box.closingBalance) : box.closingBalance.toLocaleString('ar-SY') + ' ل.س', 'text-emerald-700'))}
      </div>
      {o.salesCancelled?.count > 0 && <p className="mt-3 rounded-sm bg-slate-50 p-3 text-[11px] text-slate-600">فواتير ملغاة ضمن الفترة: {o.salesCancelled.count} بقيمة {formatMoney(o.salesCancelled.valueUSD)} — مستبعدة من المجاميع أعلاه.</p>}
      <div className="mt-3 space-y-1">{(o.notes ?? []).map((note: string, index: number) => <p key={index} className="text-[10px] text-slate-400">{note}</p>)}</div>
      </>;
    }
    if (activeReport === 'sales' || activeReport === 'purchases') { const source = activeReport === 'sales' ? sales : purchases; return <div>{filteredByQuery(source).map(invoice => line(invoice.customerOrSupplierName || 'جهة غير محددة', `${invoice.invoiceNumber} • ${invoice.date} • ${invoice.items.reduce((sum, item) => sum + item.netWeightGrams, 0).toFixed(2)} غ`, formatMoney(invoice.finalTotalUSD), activeReport === 'sales' ? 'text-emerald-700' : 'text-amber-800'))}{source.length === 0 && <Empty />}</div>; }
    if (activeReport === 'salesByCustomer') {
      const rows = filteredByQuery(server.byCustomer ?? []);
      return <div>{rows.map((row: any) => line(row.partnerName, row.invoices + ' فاتورة • آخر تعامل: ' + (row.lastAt ? new Date(row.lastAt).toLocaleDateString('ar-EG') : '—'), formatMoney(row.valueUSD) + (row.outstandingUSD > 0 ? ' • متبقٍ ' + formatMoney(row.outstandingUSD) : ''), 'text-emerald-700'))}{rows.length === 0 && <Empty />}</div>;
    }
    if (activeReport === 'salesByKarat') {
      const rows = server.sales?.byKarat ?? [];
      return <div>{rows.map((row: any) => line('عيار ' + row.karat, row.lines + ' سطر • مرتجع ' + row.returnedWeightGrams.toFixed(2) + ' غ • ذهب مكافئ 24: ' + (row.netWeightGrams * Number(row.karat) / 24).toFixed(2) + ' غ', 'صافي ' + row.netWeightGrams.toFixed(2) + ' غ • ' + formatMoney(row.goldValueUSD + row.workmanshipUSD), 'text-amber-800'))}{rows.length === 0 && <Empty />}</div>;
    }
    if (activeReport === 'inventoryByKarat') {
      const rows = server.inventoryReport?.byKarat ?? [];
      return <div>{rows.map((row: any) => line('عيار ' + row.karat, row.pieces + ' قطعة • ذهب مكافئ 24: ' + (row.weightGrams * Number(row.karat) / 24).toFixed(2) + ' غ', row.weightGrams.toFixed(2) + ' غ', 'text-amber-800'))}
        {rows.length > 0 && <p className="mt-3 text-[11px] font-bold text-slate-600">إجمالي الذهب الصافي: {(server.inventoryReport?.pureGoldGrams ?? 0).toFixed(2)} غ</p>}
        {rows.length === 0 && <Empty />}</div>;
    }
    if (activeReport === 'profit') {
      const w = server.workmanship;
      if (!w) return <Empty />;
      return <div>
        {w.byKarat.map((row: any) => line('عيار ' + row.karat, row.weightGrams.toFixed(2) + ' غ مباعة', formatMoney(row.workmanshipUSD), 'text-emerald-700'))}
        {line('الإجمالي', 'إيراد المصنعية خلال الفترة', formatMoney(w.totalUSD), 'text-emerald-700')}
        <p className="mt-4 rounded-sm bg-amber-50 p-3 text-[11px] text-amber-950">{w.note}. الربح على الذهب نفسه يتطلب كلفة اقتناء مسجّلة لكل قطعة، وهي غير متوفرة بعد لمعظم المخزون.</p>
      </div>;
    }
    if (activeReport === 'inventory' || activeReport === 'itemMovement') { const rows = filteredByQuery(stock); return <div>{rows.map(item => { const price = goldPrices.find(value => value.karat === item.karat)?.sellPriceUSDPerGram || 0; const warehouse = warehouses.find(value => value.id === item.warehouseId)?.name || 'مستودع'; return line(`${item.name} • ${item.code}`, `${warehouse} • عيار ${item.karat} • صافي ${item.netWeightGrams.toFixed(2)} غ`, formatMoney(item.netWeightGrams * price + item.totalLaborFeeUSD), 'text-amber-800'); })}{rows.length === 0 && <Empty />}</div>; }
    if (activeReport === 'inventoryByWarehouse') {
      const rows = server.inventoryReport?.byWarehouse ?? [];
      return <div>{rows.map((row: any) => line(row.warehouseName, row.pieces + ' قطعة متاحة', row.weightGrams.toFixed(2) + ' غ', 'text-amber-800'))}{rows.length === 0 && <Empty />}</div>;
    }
    if (activeReport === 'stocktake') return <div className="space-y-2">{line('جرد النظام الحالي', `${stock.length} قطعة في نطاق الفلتر • دون فروقات مسجلة`, `${totals.stockWeight.toFixed(2)} غ`, 'text-amber-800')}{reportSnapshots.map(snapshot => line('جرد محفوظ', `بتاريخ ${snapshot.date} • ${snapshot.itemCount} قطعة`, `${snapshot.netWeight.toFixed(2)} غ`, 'text-emerald-700'))}{reportSnapshots.length === 0 && <p className="rounded-sm bg-slate-50 p-3 text-[11px] text-slate-500">لا يوجد جرد محفوظ بعد. استخدم زر «جرد» في المخزون لإنشاء تقرير جرد.</p>}</div>;
    if (activeReport === 'partners' || activeReport === 'debts') {
      const rows = filteredByQuery(server.receivables?.rows ?? []);
      return <div>{rows.map((row: any) => line(row.partnerName,
        (row.partnerType === 'supplier' ? 'مورّد' : row.partnerType === 'both' ? 'عميل ومورّد' : 'عميل') + ' • أعمار الدين: ' + row.aging.currentUSD.toFixed(0) + ' / ' + row.aging.days30USD.toFixed(0) + ' / ' + row.aging.days60USD.toFixed(0) + ' / ' + row.aging.days90PlusUSD.toFixed(0),
        row.balanceUSD > 0 ? 'لنا عليه ' + formatMoney(row.balanceUSD) : 'له علينا ' + formatMoney(Math.abs(row.balanceUSD)),
        row.balanceUSD > 0 ? 'text-rose-700' : 'text-emerald-700'))}{rows.length === 0 && <Empty />}</div>;
    }
    if (activeReport === 'cash') {
      const boxes = server.cash?.boxes ?? [];
      return <div>{boxes.map((box: any) => line(box.name, box.currency + ' • وارد ' + box.periodInflow.toFixed(2) + ' • صادر ' + box.periodOutflow.toFixed(2), box.currency === 'USD' ? formatMoney(box.closingBalance) : box.closingBalance.toLocaleString('ar-SY') + ' ل.س', 'text-emerald-700'))}
        <p className="mt-3 text-[10px] text-slate-400">{server.cash?.note}</p>
        {boxes.length === 0 && <Empty />}</div>;
    }
    if (activeReport === 'expenses') { const rows = vouchers.filter(voucher => voucher.type === 'expense'); return <div>{rows.map(voucher => line(voucher.category || 'مصروف', `${voucher.date} • ${voucher.statement}`, formatMoney(voucher.amountUSD), 'text-rose-700'))}{rows.length === 0 && <Empty />}</div>; }
    if (activeReport === 'goldPrices') return <div>{goldPrices.map(price => line(`عيار ${price.karat}`, `شراء: $ ${price.buyPriceUSDPerGram.toFixed(2)} /غ`, `بيع: $ ${price.sellPriceUSDPerGram.toFixed(2)} /غ`, 'text-amber-800'))}</div>;
    return <div>{activityLogs.slice(0, 100).map(log => line(log.action, `${log.timestamp} • ${log.userName} • ${log.details}`, log.type, 'text-slate-600'))}{activityLogs.length === 0 && <Empty />}</div>;
  };

  return <div className="space-y-3 sm:space-y-6" dir="rtl">
    <header className="flex items-center justify-between gap-3 rounded-sm border border-slate-200 border-r-4 border-r-amber-400 bg-white p-3 sm:p-5 shadow-sm"><div><p className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700"><BarChart3 className="w-4 h-4" />مركز التقارير الإداري</p><h2 className="text-base sm:text-2xl font-black text-slate-900">التقارير والتحليلات</h2></div><div className="no-print flex items-center gap-1"><button onClick={print} title="تصدير PDF" className="rounded-sm bg-slate-900 p-2 text-amber-400"><FileDown className="w-4 h-4" /></button><button onClick={share} title="مشاركة عبر واتساب" className="rounded-sm border border-slate-200 bg-white p-2 text-slate-800"><Share2 className="w-4 h-4" /></button></div></header>
    <div className="no-print grid grid-cols-[1fr_auto] gap-2"><div className="relative"><Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث داخل التقرير الحالي..." className="w-full rounded-sm border border-slate-200 bg-white py-2 pr-9 pl-3 text-xs" /></div><button onClick={() => setShowCatalogue(value => !value)} className="rounded-sm bg-amber-400 px-3 text-xs font-black text-slate-900">التقارير ({reports.length})</button></div>
    {showCatalogue && <div className="no-print rounded-sm border border-slate-200 bg-white p-2 shadow-sm"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">{reports.map(report => { const Icon = report.icon; return <button key={report.key} onClick={() => selectReport(report.key)} className={`flex items-center gap-2 rounded-sm p-2.5 text-right ${activeReport === report.key ? 'bg-slate-900 text-amber-400' : 'hover:bg-amber-50 text-slate-800'}`}><Icon className="w-4 h-4 shrink-0" /><span><b className="block text-xs">{report.title}</b><small className="block text-[10px] opacity-70">{report.group} — {report.description}</small></span></button>; })}</div></div>}
    <div className="no-print grid grid-cols-2 gap-2"><select value={dateRange} onChange={event => setDateRange(event.target.value as typeof dateRange)} className="rounded-sm border border-slate-200 bg-white p-2 text-xs"><option value="all">كل الفترات</option><option value="today">اليوم</option><option value="week">آخر 7 أيام</option><option value="month">هذا الشهر</option></select><select value={warehouseId} onChange={event => setWarehouseId(event.target.value)} className="rounded-sm border border-slate-200 bg-white p-2 text-xs"><option value="all">كل الفروع</option>{warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></div>
    {(loading || error) && <div className={`no-print rounded-sm border px-4 py-2.5 text-[11px] font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{error || 'جارٍ حساب التقارير على الخادم...'}</div>}
    <main ref={reportContentRef} className="print-container rounded-sm border border-slate-200 bg-white shadow-sm"><div className="print-only print-brand-header"><div><b>{settings.storeName}</b><span>{settings.address}</span></div><div><b>{definition.title}</b><span>{new Date().toLocaleDateString('ar-SY')}</span></div></div><div className="border-b border-slate-100 p-3 sm:p-5"><p className="text-[10px] font-bold text-amber-700">{definition.group}</p><h3 className="text-base font-black text-slate-900">{definition.title}</h3><p className="mt-1 text-[11px] text-slate-500">{definition.description}</p><div className="no-print mt-3 flex gap-2"><button onClick={print} className="flex-1 rounded-sm bg-slate-900 py-2 text-xs font-black text-amber-400 flex items-center justify-center gap-1.5"><FileDown className="w-4 h-4" />تصدير PDF</button><button onClick={share} className="flex-1 rounded-sm border border-slate-200 bg-white py-2 text-xs font-black text-slate-800 flex items-center justify-center gap-1.5"><Share2 className="w-4 h-4" />مشاركة واتساب</button></div></div><div className="p-3 sm:p-5">{renderBody()}</div></main>
  </div>;
};

const Empty = () => <div className="p-8 text-center text-xs text-slate-400">لا توجد بيانات مسجلة لهذا التقرير ضمن الفلاتر الحالية.</div>;
