import React, { useMemo, useRef, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { BarChart3, Building2, PackageSearch, Printer, Search, TrendingUp, Users, Wallet, Scale, Coins, Receipt, ShieldCheck, Boxes, ClipboardCheck, FileDown, Share2 } from 'lucide-react';

type ReportKey = 'overview' | 'sales' | 'salesByCustomer' | 'salesByKarat' | 'purchases' | 'profit' | 'inventory' | 'inventoryByKarat' | 'inventoryByWarehouse' | 'itemMovement' | 'partners' | 'debts' | 'cash' | 'expenses' | 'goldPrices' | 'audit' | 'stocktake';

type ReportDefinition = { key: ReportKey; title: string; group: string; icon: React.ElementType; description: string };

const reports: ReportDefinition[] = [
  { key: 'overview', title: 'لوحة الإدارة', group: 'نظرة عامة', icon: BarChart3, description: 'ملخص السيولة والذهب والمبيعات والذمم' },
  { key: 'sales', title: 'المبيعات والفواتير', group: 'المبيعات', icon: Receipt, description: 'كل فواتير البيع مع الوزن والقيمة' },
  { key: 'salesByCustomer', title: 'المبيعات حسب العميل', group: 'المبيعات', icon: Users, description: 'إجمالي التعاملات لكل عميل' },
  { key: 'salesByKarat', title: 'المبيعات حسب العيار', group: 'المبيعات', icon: Coins, description: 'عدد القطع والأوزان المباعة لكل عيار' },
  { key: 'purchases', title: 'المشتريات والموردون', group: 'المشتريات', icon: Building2, description: 'فواتير الشراء والوزن والقيمة' },
  { key: 'profit', title: 'أرباح المصنعية', group: 'الأرباح', icon: TrendingUp, description: 'إيراد المصنعية المسجّل في المبيعات' },
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
  const [dateRange, setDateRange] = useState<'all' | 'today' | 'month'>('all');
  const [warehouseId, setWarehouseId] = useState('all');
  const reportContentRef = useRef<HTMLElement>(null);

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
    if (activeReport === 'overview') return <><div className="grid grid-cols-2 lg:grid-cols-5 gap-2">{metric('مبيعات مسجلة', formatMoney(totals.sales), 'emerald')}{metric('أرباح المصنعية', formatMoney(totals.labor))}{metric('قيمة المخزون', formatMoney(totals.stockValue))}{metric('ذمم العملاء', formatMoney(totals.receivables), 'rose')}{metric('ذمم الموردين', formatMoney(totals.payables))}</div><div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{line('وزن المخزون المتاح', `${stock.length} قطعة في المستودعات المختارة`, `${totals.stockWeight.toFixed(2)} غ`, 'text-amber-800')}{line('سيولة الصناديق', `${cashBoxes.length} صناديق نشطة`, formatMoney(cashBoxes.filter(box => box.currency === 'USD').reduce((sum, box) => sum + box.balanceAmount, 0)), 'text-emerald-700')}</div></>;
    if (activeReport === 'sales' || activeReport === 'purchases') { const source = activeReport === 'sales' ? sales : purchases; return <div>{filteredByQuery(source).map(invoice => line(invoice.customerOrSupplierName || 'جهة غير محددة', `${invoice.invoiceNumber} • ${invoice.date} • ${invoice.items.reduce((sum, item) => sum + item.netWeightGrams, 0).toFixed(2)} غ`, formatMoney(invoice.finalTotalUSD), activeReport === 'sales' ? 'text-emerald-700' : 'text-amber-800'))}{source.length === 0 && <Empty />}</div>; }
    if (activeReport === 'salesByCustomer') { const rows = partners.map(partner => ({ partner, total: sales.filter(invoice => invoice.customerOrSupplierId === partner.id).reduce((sum, invoice) => sum + invoice.finalTotalUSD, 0) })).filter(row => row.total > 0); return <div>{rows.map(row => line(row.partner.name, `رصيد حالي: ${formatMoney(row.partner.balanceUSD)}`, formatMoney(row.total), 'text-emerald-700'))}{rows.length === 0 && <Empty />}</div>; }
    if (activeReport === 'salesByKarat' || activeReport === 'inventoryByKarat') { const source = activeReport === 'salesByKarat' ? sales.flatMap(invoice => invoice.items) : stock; const rows = ['24','22','21','18','14'].map(karat => { const items = source.filter(item => item.karat === karat); const weight = items.reduce((sum, item) => sum + item.netWeightGrams, 0); const value = items.reduce((sum, item) => sum + (item.totalPriceUSD || item.netWeightGrams * (goldPrices.find(price => price.karat === item.karat)?.sellPriceUSDPerGram || 0)), 0); return { karat, count: items.length, weight, value }; }); return <div>{rows.map(row => line(`عيار ${row.karat}`, `${row.count} قطعة • ذهب مكافئ 24: ${(row.weight * Number(row.karat) / 24).toFixed(2)} غ`, `${row.weight.toFixed(2)} غ • ${formatMoney(row.value)}`, 'text-amber-800'))}</div>; }
    if (activeReport === 'profit') return <div>{line('إيراد المصنعية المسجل', `${sales.length} فاتورة بيع`, formatMoney(totals.labor), 'text-emerald-700')}<p className="mt-4 rounded-sm bg-amber-50 p-3 text-[11px] text-amber-950">الربح الصافي لكل قطعة يتطلب تسجيل تكلفة شراء القطعة بشكل مستقل. النظام يعرض حالياً الربح الموثق من المصنعية فقط.</p></div>;
    if (activeReport === 'inventory' || activeReport === 'itemMovement') { const rows = filteredByQuery(stock); return <div>{rows.map(item => { const price = goldPrices.find(value => value.karat === item.karat)?.sellPriceUSDPerGram || 0; const warehouse = warehouses.find(value => value.id === item.warehouseId)?.name || 'مستودع'; return line(`${item.name} • ${item.code}`, `${warehouse} • عيار ${item.karat} • صافي ${item.netWeightGrams.toFixed(2)} غ`, formatMoney(item.netWeightGrams * price + item.totalLaborFeeUSD), 'text-amber-800'); })}{rows.length === 0 && <Empty />}</div>; }
    if (activeReport === 'inventoryByWarehouse') return <div>{warehouses.map(warehouse => { const items = stock.filter(item => item.warehouseId === warehouse.id); return line(warehouse.name, `${items.length} قطعة متاحة`, `${items.reduce((sum, item) => sum + item.netWeightGrams, 0).toFixed(2)} غ`, 'text-amber-800'); })}</div>;
    if (activeReport === 'stocktake') return <div className="space-y-2">{line('جرد النظام الحالي', `${stock.length} قطعة في نطاق الفلتر • دون فروقات مسجلة`, `${totals.stockWeight.toFixed(2)} غ`, 'text-amber-800')}{reportSnapshots.map(snapshot => line('جرد محفوظ', `بتاريخ ${snapshot.date} • ${snapshot.itemCount} قطعة`, `${snapshot.netWeight.toFixed(2)} غ`, 'text-emerald-700'))}{reportSnapshots.length === 0 && <p className="rounded-sm bg-slate-50 p-3 text-[11px] text-slate-500">لا يوجد جرد محفوظ بعد. استخدم زر «جرد» في المخزون لإنشاء تقرير جرد.</p>}</div>;
    if (activeReport === 'partners' || activeReport === 'debts') { const rows = filteredByQuery(partners).filter(partner => activeReport === 'partners' || partner.balanceUSD !== 0); return <div>{rows.map(partner => line(partner.name, `${partner.type === 'supplier' ? 'مورّد' : 'عميل'} • ذهب 21: ${partner.goldBalance21kGrams} غ`, partner.balanceUSD < 0 ? `مطلوب منه ${formatMoney(Math.abs(partner.balanceUSD))}` : partner.balanceUSD > 0 ? `له ${formatMoney(partner.balanceUSD)}` : 'خالص', partner.balanceUSD < 0 ? 'text-rose-700' : 'text-emerald-700'))}{rows.length === 0 && <Empty />}</div>; }
    if (activeReport === 'cash') return <div>{cashBoxes.map(box => line(box.name, `عملة الصندوق: ${box.currency}`, box.currency === 'USD' ? formatMoney(box.balanceAmount) : `${box.balanceAmount.toLocaleString('ar-SY')} ل.س`, 'text-emerald-700'))}</div>;
    if (activeReport === 'expenses') { const rows = vouchers.filter(voucher => voucher.type === 'expense'); return <div>{rows.map(voucher => line(voucher.category || 'مصروف', `${voucher.date} • ${voucher.statement}`, formatMoney(voucher.amountUSD), 'text-rose-700'))}{rows.length === 0 && <Empty />}</div>; }
    if (activeReport === 'goldPrices') return <div>{goldPrices.map(price => line(`عيار ${price.karat}`, `شراء: $ ${price.buyPriceUSDPerGram.toFixed(2)} /غ`, `بيع: $ ${price.sellPriceUSDPerGram.toFixed(2)} /غ`, 'text-amber-800'))}</div>;
    return <div>{activityLogs.slice(0, 100).map(log => line(log.action, `${log.timestamp} • ${log.userName} • ${log.details}`, log.type, 'text-slate-600'))}{activityLogs.length === 0 && <Empty />}</div>;
  };

  return <div className="space-y-3 sm:space-y-6" dir="rtl">
    <header className="flex items-center justify-between gap-3 rounded-sm border border-slate-200 border-r-4 border-r-amber-400 bg-white p-3 sm:p-5 shadow-sm"><div><p className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700"><BarChart3 className="w-4 h-4" />مركز التقارير الإداري</p><h2 className="text-base sm:text-2xl font-black text-slate-900">التقارير والتحليلات</h2></div><div className="no-print flex items-center gap-1"><button onClick={print} title="تصدير PDF" className="rounded-sm bg-slate-900 p-2 text-amber-400"><FileDown className="w-4 h-4" /></button><button onClick={share} title="مشاركة عبر واتساب" className="rounded-sm border border-slate-200 bg-white p-2 text-slate-800"><Share2 className="w-4 h-4" /></button></div></header>
    <div className="no-print grid grid-cols-[1fr_auto] gap-2"><div className="relative"><Search className="absolute right-3 top-2.5 w-4 h-4 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث داخل التقرير الحالي..." className="w-full rounded-sm border border-slate-200 bg-white py-2 pr-9 pl-3 text-xs" /></div><button onClick={() => setShowCatalogue(value => !value)} className="rounded-sm bg-amber-400 px-3 text-xs font-black text-slate-900">التقارير ({reports.length})</button></div>
    {showCatalogue && <div className="no-print rounded-sm border border-slate-200 bg-white p-2 shadow-sm"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">{reports.map(report => { const Icon = report.icon; return <button key={report.key} onClick={() => selectReport(report.key)} className={`flex items-center gap-2 rounded-sm p-2.5 text-right ${activeReport === report.key ? 'bg-slate-900 text-amber-400' : 'hover:bg-amber-50 text-slate-800'}`}><Icon className="w-4 h-4 shrink-0" /><span><b className="block text-xs">{report.title}</b><small className="block text-[10px] opacity-70">{report.group} — {report.description}</small></span></button>; })}</div></div>}
    <div className="no-print grid grid-cols-2 gap-2"><select value={dateRange} onChange={event => setDateRange(event.target.value as typeof dateRange)} className="rounded-sm border border-slate-200 bg-white p-2 text-xs"><option value="all">كل الفترات</option><option value="today">اليوم</option><option value="month">هذا الشهر</option></select><select value={warehouseId} onChange={event => setWarehouseId(event.target.value)} className="rounded-sm border border-slate-200 bg-white p-2 text-xs"><option value="all">كل الفروع</option>{warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></div>
    <main ref={reportContentRef} className="print-container rounded-sm border border-slate-200 bg-white shadow-sm"><div className="print-only print-brand-header"><div><b>{settings.storeName}</b><span>{settings.address}</span></div><div><b>{definition.title}</b><span>{new Date().toLocaleDateString('ar-SY')}</span></div></div><div className="border-b border-slate-100 p-3 sm:p-5"><p className="text-[10px] font-bold text-amber-700">{definition.group}</p><h3 className="text-base font-black text-slate-900">{definition.title}</h3><p className="mt-1 text-[11px] text-slate-500">{definition.description}</p><div className="no-print mt-3 flex gap-2"><button onClick={print} className="flex-1 rounded-sm bg-slate-900 py-2 text-xs font-black text-amber-400 flex items-center justify-center gap-1.5"><FileDown className="w-4 h-4" />تصدير PDF</button><button onClick={share} className="flex-1 rounded-sm border border-slate-200 bg-white py-2 text-xs font-black text-slate-800 flex items-center justify-center gap-1.5"><Share2 className="w-4 h-4" />مشاركة واتساب</button></div></div><div className="p-3 sm:p-5">{renderBody()}</div></main>
  </div>;
};

const Empty = () => <div className="p-8 text-center text-xs text-slate-400">لا توجد بيانات مسجلة لهذا التقرير ضمن الفلاتر الحالية.</div>;
