import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive, Scale, Search, SlidersHorizontal, X, Loader2, AlertTriangle, ChevronRight, ChevronLeft,
  Store, User, Clock3, RotateCcw, Ban, Package, PenLine, PencilLine, Calendar,
} from 'lucide-react';
import {
  historyApi, type HistoryFilterOptions, type HistoryFilters, type HistoryInvoice,
  type SoldWeightLine, type SoldWeightSummary,
} from '../services/historyApi';

const usd = (value: number) => `$ ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const grams = (value: number) => `${value.toFixed(3)} غ`;
const dateOf = (value: string) => new Date(value).toLocaleDateString('ar-SY');
const timeOf = (value: string) => new Date(value).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' });

const PAYMENT: Record<string, { label: string; className: string }> = {
  paid: { label: 'مدفوعة', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  partial: { label: 'مدفوعة جزئياً', className: 'bg-amber-50 text-amber-800 border-amber-300' },
  credit: { label: 'بالذمّة', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  cancelled: { label: 'ملغاة', className: 'bg-slate-100 text-slate-500 border-slate-300' },
};

/** Quick period presets — operational convenience, not a report designer. */
const periods = () => {
  const now = new Date();
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const startOfDay = (offset: number) => { const date = new Date(now); date.setDate(date.getDate() - offset); return iso(date); };
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return [
    { id: 'today', label: 'اليوم', from: iso(now), to: iso(now) },
    { id: 'yesterday', label: 'أمس', from: startOfDay(1), to: startOfDay(1) },
    { id: 'week', label: 'هذا الأسبوع', from: iso(weekStart), to: iso(now) },
    { id: 'month', label: 'هذا الشهر', from: iso(monthStart), to: iso(now) },
  ];
};

type Tab = 'invoices' | 'weights';

export const HistoryView: React.FC<{ initialFilters?: HistoryFilters; initialTab?: Tab; onOpenInvoiceNumber?: (invoiceNumber: string) => void; onOpenShift?: (shiftId: string) => void; onOpenGoldOpenings?: () => void }> = ({ initialFilters, initialTab, onOpenInvoiceNumber, onOpenShift, onOpenGoldOpenings }) => {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'invoices');
  const [filters, setFilters] = useState<HistoryFilters>({ page: 1, limit: 30, ...initialFilters });
  const [options, setOptions] = useState<HistoryFilterOptions | null>(null);
  const [invoices, setInvoices] = useState<HistoryInvoice[]>([]);
  const [lines, setLines] = useState<SoldWeightLine[]>([]);
  const [summary, setSummary] = useState<SoldWeightSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');

  useEffect(() => { void historyApi.filterOptions().then(setOptions).catch(() => undefined); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      if (tab === 'invoices') {
        const result = await historyApi.invoices(filters);
        setInvoices(result.items); setTotal(result.meta.total);
      } else {
        // The summary covers the whole filtered set, so it is fetched beside the page.
        const [result, totals] = await Promise.all([historyApi.soldWeights(filters), historyApi.soldWeightSummary(filters)]);
        setLines(result.items); setTotal(result.meta.total); setSummary(totals);
      }
    } catch (reason: any) { setError(reason?.message || 'تعذر تحميل السجل.'); }
    finally { setLoading(false); }
  }, [tab, filters]);
  useEffect(() => { void load(); }, [load]);

  const set = (patch: Partial<HistoryFilters>) => setFilters(previous => ({ ...previous, ...patch, page: patch.page ?? 1 }));
  const submitSearch = (event: React.FormEvent) => { event.preventDefault(); set({ invoiceNumber: quickSearch.trim() || undefined }); };

  const chips = useMemo(() => {
    const active: Array<{ label: string; clear: () => void }> = [];
    if (filters.dateFrom || filters.dateTo) active.push({ label: `${filters.dateFrom || '…'} → ${filters.dateTo || '…'}`, clear: () => set({ dateFrom: undefined, dateTo: undefined }) });
    if (filters.invoiceNumber) active.push({ label: `رقم: ${filters.invoiceNumber}`, clear: () => { setQuickSearch(''); set({ invoiceNumber: undefined }); } });
    if (filters.sellerId) active.push({ label: `البائع: ${options?.sellers.find(s => s.id === filters.sellerId)?.name ?? '—'}`, clear: () => set({ sellerId: undefined }) });
    if (filters.warehouseId) active.push({ label: `الفرع: ${options?.warehouses.find(w => w.id === filters.warehouseId)?.name ?? '—'}`, clear: () => set({ warehouseId: undefined }) });
    if (filters.karat) active.push({ label: `عيار ${filters.karat}`, clear: () => set({ karat: undefined }) });
    if (filters.source) active.push({ label: filters.source === 'stock' ? 'مخزون' : 'بيع يدوي', clear: () => set({ source: undefined }) });
    if (filters.paymentState) active.push({ label: PAYMENT[filters.paymentState]!.label, clear: () => set({ paymentState: undefined }) });
    if (filters.itemName) active.push({ label: `الصنف: ${filters.itemName}`, clear: () => set({ itemName: undefined }) });
    if (filters.shiftId) active.push({ label: 'وردية محددة', clear: () => set({ shiftId: undefined }) });
    if (filters.type && filters.type !== 'sale') active.push({ label: filters.type === 'all' ? 'بيع + مرتجع' : 'مرتجعات فقط', clear: () => set({ type: undefined }) });
    return active;
  }, [filters, options]);

  const pages = Math.max(1, Math.ceil(total / (filters.limit ?? 30)));
  const page = filters.page ?? 1;

  return (
    <div className="space-y-4">
      <div className="bg-white border-2 border-slate-200 rounded-sm p-3 sm:p-4 flex items-center gap-2.5">
        <div className="w-9 h-9 bg-slate-900 border-2 border-amber-400 rounded-sm grid place-items-center shrink-0">
          <Archive className="w-4.5 h-4.5 text-amber-400" />
        </div>
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-black text-slate-900 leading-tight">السجلات</h2>
          <p className="text-[11px] text-slate-500 font-medium mt-0.5">أرشيف دائم للفواتير والأوزان المباعة، مستقل عن الورديات</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-sm bg-slate-100 p-1">
        {([['invoices', 'سجل الفواتير'], ['weights', 'سجل الأوزان المباعة']] as const).map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); setFilters(previous => ({ ...previous, page: 1 })); }}
            className={`rounded-sm px-2 py-2 text-[11px] sm:text-xs font-extrabold transition ${tab === id ? 'bg-amber-400 text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* A shop moving off paper asked to flip straight to a page, not to configure filters.
          Shown in both tabs, and only to someone who may actually open it. */}
      {onOpenGoldOpenings && (
        <button onClick={onOpenGoldOpenings}
          className="flex w-full items-center gap-2.5 rounded-sm border-2 border-amber-300 bg-amber-50 p-3 text-right transition active:scale-[.99]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-sm bg-slate-900">
            <PencilLine className="h-4 w-4 text-amber-400" />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-xs text-slate-900">سجل الأرصدة الافتتاحية</b>
            <span className="mt-0.5 block text-[10px] leading-4 text-slate-500">تعديلات وزن ذهب المحل والأرصدة الافتتاحية على الأطراف</span>
          </span>
          <ChevronLeft className="h-5 w-5 shrink-0 text-amber-700" />
        </button>
      )}

      {/* Search + one filter button. Ten controls do not belong across a phone. */}
      <div className="flex gap-2">
        <form onSubmit={submitSearch} className="relative flex-1">
          <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
          <input value={quickSearch} onChange={event => setQuickSearch(event.target.value)} inputMode="numeric"
            placeholder={tab === 'invoices' ? 'رقم الفاتورة' : 'رقم الفاتورة أو الصنف'}
            className="h-11 w-full rounded-sm border-2 border-slate-200 bg-white pr-9 pl-3 text-sm font-bold text-slate-800 outline-none transition focus:border-amber-400" />
        </form>
        <button onClick={() => setShowFilters(true)}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-sm border-2 border-slate-200 bg-white px-3 text-xs font-extrabold text-slate-700 transition active:scale-95">
          <SlidersHorizontal className="h-4 w-4" />تصفية{chips.length > 0 && <span className="rounded-sm bg-amber-400 px-1.5 text-[10px] text-slate-900">{chips.length}</span>}
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {periods().map(period => {
          const active = filters.dateFrom === period.from && filters.dateTo === period.to;
          return (
            <button key={period.id} onClick={() => set(active ? { dateFrom: undefined, dateTo: undefined } : { dateFrom: period.from, dateTo: period.to })}
              className={`rounded-sm border px-2.5 py-1.5 text-[11px] font-extrabold transition ${active ? 'border-amber-400 bg-amber-50 text-slate-900' : 'border-slate-200 bg-white text-slate-600'}`}>
              {period.label}
            </button>
          );
        })}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip, index) => (
            <span key={index} className="inline-flex items-center gap-1 rounded-sm border border-slate-300 bg-white px-2 py-1 text-[10px] font-extrabold text-slate-700">
              {chip.label}
              <button onClick={chip.clear} aria-label="إزالة" className="text-slate-400 transition hover:text-rose-600"><X className="h-3 w-3" /></button>
            </span>
          ))}
          <button onClick={() => { setQuickSearch(''); setFilters({ page: 1, limit: 30 }); }} className="text-[10px] font-extrabold text-rose-600 underline">مسح الكل</button>
        </div>
      )}

      {tab === 'weights' && summary && <WeightSummary summary={summary} />}

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold leading-5 text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
        </p>
      )}

      {loading ? (
        <div className="grid place-items-center rounded-sm border-2 border-slate-200 bg-white p-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : tab === 'invoices' ? (
        invoices.length === 0
          ? <Empty message="لا توجد فواتير ضمن الفترة المحددة" />
          : <InvoiceList invoices={invoices} onOpenInvoice={onOpenInvoiceNumber} onOpenShift={onOpenShift} />
      ) : (
        lines.length === 0
          ? <Empty message="لا توجد أوزان مباعة مطابقة للفلاتر" />
          : <WeightList lines={lines} showSeller={options?.canFilterBySeller ?? false} onOpenInvoice={onOpenInvoiceNumber} />
      )}

      {total > (filters.limit ?? 30) && (
        <div className="flex items-center justify-center gap-3 text-xs font-bold text-slate-600">
          <button disabled={page <= 1} onClick={() => setFilters(previous => ({ ...previous, page: page - 1 }))}
            className="flex items-center gap-1 rounded-sm border-2 border-slate-200 bg-white px-3 py-2 disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" />السابق</button>
          <span className="font-mono">{page} / {pages} · {total}</span>
          <button disabled={page >= pages} onClick={() => setFilters(previous => ({ ...previous, page: page + 1 }))}
            className="flex items-center gap-1 rounded-sm border-2 border-slate-200 bg-white px-3 py-2 disabled:opacity-40">التالي<ChevronLeft className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {showFilters && options && (
        <FilterSheet tab={tab} filters={filters} options={options} onApply={next => { setFilters({ ...next, page: 1 }); setShowFilters(false); }} onClose={() => setShowFilters(false)} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------- pieces

const Empty: React.FC<{ message: string }> = ({ message }) => (
  <p className="rounded-sm border-2 border-dashed border-slate-300 bg-white p-8 text-center text-xs font-bold text-slate-500">{message}</p>
);

const WeightSummary: React.FC<{ summary: SoldWeightSummary }> = ({ summary }) => (
  <div className="rounded-sm border-2 border-slate-900 bg-slate-900 p-3">
    <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-400/80"><Scale className="h-3.5 w-3.5" />إجمالي النتائج المفلترة</p>
    <p className="mt-1 text-xs font-black text-white">عدد القطع: <span className="font-mono text-amber-400">{summary.pieceCount}</span> · عدد السطور: <span className="font-mono text-amber-400">{summary.lineCount}</span></p>
    {/* Karats are listed separately on purpose: they are different facts, never one total. */}
    <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {summary.byKarat.map(row => (
        <div key={row.karat} className="rounded-sm bg-slate-800 px-2 py-1.5">
          <p className="text-[10px] font-black text-amber-400">عيار {row.karat}</p>
          <p className="mt-0.5 font-mono text-xs font-black text-white">{grams(row.netWeightGrams)}</p>
          {(row.returnedWeightGrams > 0 || row.cancelledWeightGrams > 0) && (
            <p className="mt-0.5 font-mono text-[9px] text-slate-400">
              مباع {row.soldWeightGrams.toFixed(3)}
              {row.returnedWeightGrams > 0 && ` · مرتجع ${row.returnedWeightGrams.toFixed(3)}`}
              {row.cancelledWeightGrams > 0 && ` · ملغى ${row.cancelledWeightGrams.toFixed(3)}`}
            </p>
          )}
        </div>
      ))}
      {!summary.byKarat.length && <p className="col-span-full py-2 text-center text-[11px] font-bold text-slate-400">لا توجد أوزان ضمن الفلاتر.</p>}
    </div>
  </div>
);

const InvoiceList: React.FC<{ invoices: HistoryInvoice[]; onOpenInvoice?: (invoiceNumber: string) => void; onOpenShift?: (id: string) => void }> = ({ invoices, onOpenInvoice, onOpenShift }) => (
  <>
    {/* Cards on phones */}
    <div className="space-y-2 md:hidden">
      {invoices.map(invoice => {
        const badge = PAYMENT[invoice.paymentState]!;
        return (
          <button key={invoice.id} onClick={() => onOpenInvoice?.(invoice.invoiceNumber)}
            className={`w-full rounded-sm border-2 bg-white p-3 text-right transition active:scale-[.995] ${invoice.status === 'cancelled' ? 'border-slate-200 opacity-70' : 'border-slate-200 hover:border-amber-400'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="selectable font-mono text-sm font-black text-slate-900">
                  {invoice.invoiceNumber}
                  {invoice.type === 'sales_return' && <span className="mr-1.5 rounded-sm bg-rose-100 px-1.5 py-0.5 text-[9px] font-black text-rose-700">مرتجع</span>}
                </p>
                <p className="mt-0.5 text-[10px] font-medium text-slate-500">{dateOf(invoice.date)} · {timeOf(invoice.date)}</p>
              </div>
              <span className={`shrink-0 rounded-sm border px-2 py-1 text-[10px] font-extrabold ${badge.className}`}>{badge.label}</span>
            </div>
            <div className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-[11px] font-bold text-slate-600">
              <p className="truncate">العميل: <span className="text-slate-900">{invoice.partnerName}</span></p>
              <p className="truncate">البائع: <span className="text-slate-900">{invoice.sellerName}</span> · {invoice.warehouseName}</p>
              <p>{invoice.itemCount} قطعة{invoice.manualLineCount > 0 ? ` · ${invoice.manualLineCount} يدوي` : ''} · وردية {invoice.shiftNumber ?? '—'}</p>
            </div>
            <p className="mt-1.5 font-mono text-base font-black text-slate-900">{usd(invoice.finalTotalUSD)}</p>
          </button>
        );
      })}
    </div>

    {/* A table earns its place on a desktop */}
    <div className="hidden md:block rounded-sm border-2 border-slate-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-900 text-amber-400">
            <tr>
              {['الرقم', 'التاريخ', 'العميل', 'البائع', 'الفرع', 'الوردية', 'القطع', 'الإجمالي', 'الحالة'].map(head => <th key={head} className="px-3 py-2.5 font-extrabold whitespace-nowrap">{head}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map(invoice => {
              const badge = PAYMENT[invoice.paymentState]!;
              return (
                <tr key={invoice.id} onClick={() => onOpenInvoice?.(invoice.invoiceNumber)}
                  className={`cursor-pointer transition hover:bg-amber-50/60 ${invoice.status === 'cancelled' ? 'text-slate-400' : ''}`}>
                  <td className="selectable px-3 py-2.5 font-mono font-black text-slate-900 whitespace-nowrap">
                    {invoice.invoiceNumber}
                    {invoice.type === 'sales_return' && <span className="mr-1.5 rounded-sm bg-rose-100 px-1.5 py-0.5 text-[9px] font-black text-rose-700">مرتجع</span>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{dateOf(invoice.date)}<span className="mr-1 text-[10px] text-slate-400">{timeOf(invoice.date)}</span></td>
                  <td className="px-3 py-2.5 font-bold">{invoice.partnerName}</td>
                  <td className="px-3 py-2.5 font-bold">{invoice.sellerName}</td>
                  <td className="px-3 py-2.5">{invoice.warehouseName}</td>
                  <td className="px-3 py-2.5 font-mono">
                    {invoice.shiftId
                      ? <button onClick={event => { event.stopPropagation(); onOpenShift?.(invoice.shiftId!); }} className="font-black text-amber-700 underline">{invoice.shiftNumber}</button>
                      : <span className="text-[10px] text-slate-400">قبل نظام الورديات</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono">{invoice.itemCount}</td>
                  <td className="px-3 py-2.5 font-mono font-black text-slate-900 whitespace-nowrap">{usd(invoice.finalTotalUSD)}</td>
                  <td className="px-3 py-2.5"><span className={`rounded-sm border px-2 py-1 text-[10px] font-extrabold whitespace-nowrap ${badge.className}`}>{badge.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  </>
);

const WeightList: React.FC<{ lines: SoldWeightLine[]; showSeller: boolean; onOpenInvoice?: (invoiceNumber: string) => void }> = ({ lines, showSeller, onOpenInvoice }) => (
  <>
    <div className="space-y-2 md:hidden">
      {lines.map(line => (
        <button key={line.lineId} onClick={() => onOpenInvoice?.(line.invoiceNumber)}
          className={`w-full rounded-sm border-2 border-slate-200 bg-white p-3 text-right transition active:scale-[.995] ${line.status === 'cancelled' ? 'opacity-70' : ''}`}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-black text-slate-900">{line.itemName}</p>
              <p className="mt-0.5 text-[10px] font-medium text-slate-500">{dateOf(line.soldAt)} · {line.itemCode ?? '—'}</p>
            </div>
            <SourceBadge source={line.source} cancelled={line.status === 'cancelled'} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-200 pt-2">
            <span className="rounded-sm bg-amber-50 px-2 py-1 text-[10px] font-black text-amber-800">عيار {line.karat}</span>
            <span className="rounded-sm bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-700">{line.quantity} قطعة</span>
            <span className="rounded-sm bg-slate-900 px-2 py-1 font-mono text-[11px] font-black text-amber-400">{grams(line.netWeightGrams)}</span>
            {line.returnedWeightGrams > 0 && (
              <span className="rounded-sm bg-rose-50 px-2 py-1 font-mono text-[10px] font-black text-rose-700">مرتجع {grams(line.returnedWeightGrams)} · صافي {grams(line.netAfterReturnsGrams)}</span>
            )}
          </div>
          <p className="mt-1.5 text-[10px] font-bold text-slate-500">
            {showSeller && <>البائع: <span className="text-slate-800">{line.sellerName}</span> · </>}
            {line.warehouseName} · فاتورة <span className="font-mono">{line.invoiceNumber}</span>
          </p>
        </button>
      ))}
    </div>

    <div className="hidden md:block rounded-sm border-2 border-slate-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-right text-xs">
          <thead className="bg-slate-900 text-amber-400">
            <tr>
              {['التاريخ', 'الصنف', 'العيار', 'الكمية', 'الوزن', 'المصدر', ...(showSeller ? ['البائع'] : []), 'الفرع', 'الفاتورة'].map(head => <th key={head} className="px-3 py-2.5 font-extrabold whitespace-nowrap">{head}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map(line => (
              <tr key={line.lineId} onClick={() => onOpenInvoice?.(line.invoiceNumber)}
                className={`cursor-pointer transition hover:bg-amber-50/60 ${line.status === 'cancelled' ? 'text-slate-400 line-through' : ''}`}>
                <td className="px-3 py-2.5 whitespace-nowrap">{dateOf(line.soldAt)}</td>
                <td className="px-3 py-2.5 font-bold text-slate-900">{line.itemName}<span className="block text-[10px] font-normal text-slate-400">{line.itemCode ?? '—'}</span></td>
                <td className="px-3 py-2.5 font-black text-amber-700">{line.karat}</td>
                <td className="px-3 py-2.5 font-mono">{line.quantity}</td>
                <td className="px-3 py-2.5 font-mono font-black text-slate-900 whitespace-nowrap">
                  {grams(line.netWeightGrams)}
                  {line.returnedWeightGrams > 0 && <span className="block text-[10px] font-normal text-rose-600">مرتجع {line.returnedWeightGrams.toFixed(3)} · صافي {line.netAfterReturnsGrams.toFixed(3)}</span>}
                </td>
                <td className="px-3 py-2.5"><SourceBadge source={line.source} cancelled={line.status === 'cancelled'} /></td>
                {showSeller && <td className="px-3 py-2.5 font-bold">{line.sellerName}</td>}
                <td className="px-3 py-2.5">{line.warehouseName}</td>
                <td className="px-3 py-2.5 font-mono">{line.invoiceNumber}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  </>
);

const SourceBadge: React.FC<{ source: 'stock' | 'manual'; cancelled: boolean }> = ({ source, cancelled }) => (
  <span className={`inline-flex shrink-0 items-center gap-1 rounded-sm border px-2 py-1 text-[10px] font-extrabold whitespace-nowrap ${
    cancelled ? 'border-slate-300 bg-slate-100 text-slate-500'
      : source === 'stock' ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-violet-200 bg-violet-50 text-violet-700'}`}>
    {cancelled ? <><Ban className="h-3 w-3" />ملغاة</> : source === 'stock' ? <><Package className="h-3 w-3" />مخزون</> : <><PenLine className="h-3 w-3" />بيع يدوي</>}
  </span>
);

// ---------------------------------------------------------------- filter sheet

const FilterSheet: React.FC<{ tab: Tab; filters: HistoryFilters; options: HistoryFilterOptions; onApply: (filters: HistoryFilters) => void; onClose: () => void }> = ({ tab, filters, options, onApply, onClose }) => {
  const [draft, setDraft] = useState<HistoryFilters>(filters);
  const set = <K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) => setDraft(previous => ({ ...previous, [key]: value || undefined }));
  const field = 'h-11 w-full rounded-sm border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-amber-400';
  const label = 'block text-xs font-extrabold text-slate-700';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={event => event.stopPropagation()} className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl bg-white sm:max-h-[88vh] sm:max-w-md sm:rounded-sm sm:border-2 sm:border-slate-300">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b-2 border-slate-200 bg-slate-900 px-3 py-3">
          <h3 className="text-sm font-black text-amber-400">تصفية النتائج</h3>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-sm p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>من تاريخ<input type="date" value={draft.dateFrom ?? ''} onChange={event => set('dateFrom', event.target.value)} className={`${field} mt-1.5`} /></label>
            <label className={label}>إلى تاريخ<input type="date" value={draft.dateTo ?? ''} onChange={event => set('dateTo', event.target.value)} className={`${field} mt-1.5`} /></label>
          </div>

          <label className={label}>رقم الفاتورة<input value={draft.invoiceNumber ?? ''} onChange={event => set('invoiceNumber', event.target.value)} inputMode="numeric" dir="ltr" className={`${field} mt-1.5 text-left font-mono`} /></label>

          {options.canFilterBySeller && (
            <label className={label}>البائع
              <select value={draft.sellerId ?? ''} onChange={event => set('sellerId', event.target.value)} className={`${field} mt-1.5`}>
                <option value="">كل البائعين</option>
                {options.sellers.map(seller => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
              </select>
            </label>
          )}

          <label className={label}>الفرع
            <select value={draft.warehouseId ?? ''} onChange={event => set('warehouseId', event.target.value)} className={`${field} mt-1.5`}>
              <option value="">كل الفروع المسموحة</option>
              {options.warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
            </select>
          </label>

          {tab === 'invoices' ? (
            <>
              <label className={label}>اسم العميل<input value={draft.customerName ?? ''} onChange={event => set('customerName', event.target.value)} className={`${field} mt-1.5`} /></label>
              <label className={label}>نوع المستند
                <select value={draft.type ?? 'sale'} onChange={event => set('type', event.target.value as HistoryFilters['type'])} className={`${field} mt-1.5`}>
                  <option value="sale">فواتير البيع</option>
                  <option value="sales_return">مرتجعات البيع</option>
                  <option value="all">البيع والمرتجعات معاً</option>
                </select>
              </label>
              <label className={label}>حالة السداد
                <select value={draft.paymentState ?? ''} onChange={event => set('paymentState', event.target.value as HistoryFilters['paymentState'])} className={`${field} mt-1.5`}>
                  <option value="">كل الحالات</option>
                  <option value="paid">مدفوعة</option>
                  <option value="partial">مدفوعة جزئياً</option>
                  <option value="credit">بالذمّة</option>
                  <option value="cancelled">ملغاة</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label className={label}>العيار
                <select value={draft.karat ?? ''} onChange={event => set('karat', event.target.value)} className={`${field} mt-1.5`}>
                  <option value="">كل العيارات</option>
                  {options.karats.map(karat => <option key={karat} value={karat}>عيار {karat}</option>)}
                </select>
              </label>
              <label className={label}>اسم الصنف<input value={draft.itemName ?? ''} onChange={event => set('itemName', event.target.value)} className={`${field} mt-1.5`} /></label>
              <label className={label}>كود الصنف<input value={draft.itemCode ?? ''} onChange={event => set('itemCode', event.target.value)} dir="ltr" className={`${field} mt-1.5 text-left font-mono`} /></label>
              <label className={label}>المصدر
                <select value={draft.source ?? ''} onChange={event => set('source', event.target.value as HistoryFilters['source'])} className={`${field} mt-1.5`}>
                  <option value="">مخزون وبيع يدوي</option>
                  <option value="stock">مخزون فقط</option>
                  <option value="manual">بيع يدوي / تاريخي فقط</option>
                </select>
              </label>
            </>
          )}
        </div>

        <div className="shrink-0 grid grid-cols-2 gap-2 border-t-2 border-slate-200 p-3">
          <button onClick={() => onApply({ page: 1, limit: filters.limit })} className="h-11 rounded-sm border-2 border-slate-200 text-xs font-extrabold text-slate-600 transition active:scale-95">مسح الفلاتر</button>
          <button onClick={() => onApply(draft)} className="h-11 rounded-sm bg-amber-400 text-xs font-black text-slate-900 transition active:scale-95">تطبيق</button>
        </div>
      </div>
    </div>
  );
};
