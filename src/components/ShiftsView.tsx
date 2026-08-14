import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clock3, X, Loader2, AlertTriangle, CheckCircle2, RotateCcw, Search, Store, User, Coins,
  TrendingUp, Wallet, Scale, ArrowDownLeft, ClipboardCheck, History, Radio,
} from 'lucide-react';
import { shiftsApi, type ShiftDetail, type ShiftSummary, type ShiftTotals, type KaratWeight } from '../services/shiftsApi';
import { useLiveRefresh } from '../hooks/useLiveRefresh';

const usd = (value: number) => `$ ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const syp = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 0 })} ل.س`;
const grams = (value: number) => `${value.toFixed(3)} غ`;
const time = (value: string) => new Date(value).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' });
const dateTime = (value: string) => new Date(value).toLocaleString('ar-SY', { hour12: false });

const STATUS: Record<string, { label: string; className: string }> = {
  open: { label: 'مفتوحة', className: 'bg-emerald-600 text-white' },
  closing_requested: { label: 'بانتظار الاعتماد', className: 'bg-amber-400 text-slate-900' },
  closed: { label: 'مغلقة', className: 'bg-slate-200 text-slate-700' },
  cancelled: { label: 'ملغاة', className: 'bg-rose-100 text-rose-700' },
};

type Tab = 'live' | 'requests' | 'history';

export const ShiftsView: React.FC = () => {
  const [tab, setTab] = useState<Tab>('live');
  const [shifts, setShifts] = useState<ShiftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [onlyDifference, setOnlyDifference] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const filters = tab === 'history'
        ? { status: 'closed' as const, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined, hasDifference: onlyDifference || undefined }
        : tab === 'requests' ? { status: 'closing_requested' as const } : { live: true };
      const result = await shiftsApi.list(filters);
      setShifts(result.items); setError('');
    } catch (reason: any) { setError(reason?.message || 'تعذر تحميل الورديات.'); }
    finally { if (!quiet) setLoading(false); }
  }, [tab, dateFrom, dateTo, onlyDifference]);

  useEffect(() => { void load(); }, [load]);
  // Live tabs refresh themselves; history is a deliberate query and stays still.
  useLiveRefresh(() => load(true), 20000, tab !== 'history');

  const pendingCount = useMemo(() => shifts.filter(shift => shift.status === 'closing_requested').length, [shifts]);
  const filtered = useMemo(() => {
    const needle = search.trim();
    if (!needle) return shifts;
    return shifts.filter(shift => shift.sellerName.includes(needle) || shift.shiftNumber.includes(needle) || shift.warehouseName.includes(needle));
  }, [shifts, search]);

  return (
    <div className="space-y-4">
      <div className="bg-white border-2 border-slate-200 rounded-sm p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 bg-slate-900 border-2 border-amber-400 rounded-sm grid place-items-center shrink-0">
            <Clock3 className="w-4.5 h-4.5 text-amber-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-black text-slate-900 leading-tight">الورديات</h2>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5">متابعة مباشرة لعمل البائعين وعُهدتهم النقدية</p>
          </div>
        </div>
        {tab !== 'history' && (
          <span className="inline-flex items-center gap-1.5 self-start rounded-sm border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-extrabold text-emerald-700">
            <Radio className="h-3 w-3 animate-pulse" />تحديث تلقائي
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-sm bg-slate-100 p-1">
        {([['live', 'المفتوحة الآن'], ['requests', `طلبات الإغلاق${pendingCount && tab === 'requests' ? ` (${pendingCount})` : ''}`], ['history', 'سجل الورديات']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id as Tab)}
            className={`rounded-sm px-2 py-2 text-[11px] sm:text-xs font-extrabold transition ${tab === id ? 'bg-amber-400 text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="ابحث بالبائع أو رقم الوردية أو الفرع"
            className="w-full h-10 rounded-sm border-2 border-slate-200 bg-white pr-9 pl-3 text-sm font-bold text-slate-800 outline-none transition focus:border-amber-400" />
        </div>
        {tab === 'history' && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-[10px] font-extrabold text-slate-600">من تاريخ
              <input type="date" value={dateFrom} onChange={event => setDateFrom(event.target.value)} className="mt-1 h-10 w-full rounded-sm border-2 border-slate-200 px-2 text-xs font-bold outline-none focus:border-amber-400" />
            </label>
            <label className="text-[10px] font-extrabold text-slate-600">إلى تاريخ
              <input type="date" value={dateTo} onChange={event => setDateTo(event.target.value)} className="mt-1 h-10 w-full rounded-sm border-2 border-slate-200 px-2 text-xs font-bold outline-none focus:border-amber-400" />
            </label>
            <button onClick={() => setOnlyDifference(value => !value)}
              className={`col-span-2 sm:col-span-1 mt-auto h-10 rounded-sm border-2 px-2 text-[11px] font-extrabold transition ${onlyDifference ? 'border-amber-400 bg-amber-50 text-slate-900' : 'border-slate-200 bg-white text-slate-600'}`}>
              الورديات ذات الفرق فقط
            </button>
            <button onClick={() => { setDateFrom(''); setDateTo(''); setOnlyDifference(false); }}
              className="col-span-2 sm:col-span-1 mt-auto h-10 rounded-sm border-2 border-slate-200 bg-white px-2 text-[11px] font-extrabold text-slate-600">
              مسح الفلاتر
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold leading-5 text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
        </p>
      )}

      {loading ? (
        <div className="grid place-items-center rounded-sm border-2 border-slate-200 bg-white p-10 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : !filtered.length ? (
        <p className="rounded-sm border-2 border-dashed border-slate-300 bg-white p-8 text-center text-xs font-bold text-slate-500">
          {tab === 'live' ? 'لا توجد ورديات مفتوحة الآن.' : tab === 'requests' ? 'لا توجد طلبات إغلاق بانتظار الاعتماد.' : 'لا توجد ورديات مغلقة ضمن هذا النطاق.'}
        </p>
      ) : (
        // Cards on every screen: a shift is a summary, not a spreadsheet row.
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(shift => <ShiftCard key={shift.id} shift={shift} onOpen={() => setSelected(shift.id)} />)}
        </div>
      )}

      {selected && <ShiftDetailSheet shiftId={selected} onClose={() => setSelected(null)} onChanged={() => { void load(true); }} />}
    </div>
  );
};

// ---------------------------------------------------------------- card

const ShiftCard: React.FC<{ shift: ShiftSummary; onOpen: () => void }> = ({ shift, onOpen }) => {
  const totals = shift.totals;
  const badge = STATUS[shift.status] ?? STATUS.open!;
  const hasDifference = (shift.differenceUSD ?? 0) !== 0 || (shift.differenceSYP ?? 0) !== 0;
  return (
    <button onClick={onOpen} className={`w-full rounded-sm border-2 bg-white p-3 text-right transition hover:border-amber-400 active:scale-[.995] ${shift.status === 'closing_requested' ? 'border-amber-400' : 'border-slate-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-slate-900">{shift.sellerName}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[10px] font-bold text-slate-500">
            <Store className="h-3 w-3" /><span className="truncate">{shift.warehouseName}</span>
          </p>
          <p className="mt-0.5 text-[10px] font-medium text-slate-400">وردية {shift.shiftNumber} • بدأت {time(shift.openedAt)}</p>
        </div>
        <span className={`shrink-0 rounded-sm px-2 py-1 text-[10px] font-black ${badge.className}`}>{badge.label}</span>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-1.5 border-t border-slate-200 pt-2.5 text-[11px]">
        <Metric icon={TrendingUp} label="فواتير" value={String(totals?.invoiceCount ?? 0)} />
        <Metric icon={Coins} label="مبيعات" value={usd(totals?.salesGrossUsd ?? 0)} />
        <Metric icon={Wallet} label="مقبوض $" value={usd(totals?.cashReceivedUsd ?? 0)} />
        <Metric icon={Wallet} label="مقبوض ل.س" value={syp(totals?.cashReceivedSyp ?? 0)} />
        {(totals?.outstandingUsd ?? 0) > 0 && <Metric icon={ArrowDownLeft} label="ذمم" value={usd(totals!.outstandingUsd)} tone="amber" />}
        {totals?.soldWeightByKarat?.[0] && <Metric icon={Scale} label={`وزن ${totals.soldWeightByKarat[0].karat}K`} value={grams(totals.soldWeightByKarat[0].weightGrams)} />}
      </div>

      {shift.status !== 'open' && (
        <div className={`mt-2 rounded-sm px-2 py-1.5 text-[10px] font-extrabold ${hasDifference ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {hasDifference
            ? `فرق: ${(shift.differenceUSD ?? 0) !== 0 ? usd(shift.differenceUSD!) : ''} ${(shift.differenceSYP ?? 0) !== 0 ? syp(shift.differenceSYP!) : ''}`
            : 'التسليم مطابق للمتوقع'}
        </div>
      )}
    </button>
  );
};

const Metric: React.FC<{ icon: typeof Coins; label: string; value: string; tone?: 'amber' }> = ({ icon: Icon, label, value, tone }) => (
  <div className={`flex items-center gap-1.5 rounded-sm px-1.5 py-1 ${tone === 'amber' ? 'bg-amber-50' : 'bg-slate-50'}`}>
    <Icon className={`h-3.5 w-3.5 shrink-0 ${tone === 'amber' ? 'text-amber-700' : 'text-slate-400'}`} />
    <span className="min-w-0 flex-1 truncate text-slate-500">{label}</span>
    <b className="shrink-0 font-mono text-slate-900">{value}</b>
  </div>
);

// ---------------------------------------------------------------- detail

const ShiftDetailSheet: React.FC<{ shiftId: string; onClose: () => void; onChanged: () => void }> = ({ shiftId, onClose, onChanged }) => {
  const [shift, setShift] = useState<ShiftDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [managerNote, setManagerNote] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async (quiet = false) => {
    try { setShift(await shiftsApi.detail(shiftId)); if (!quiet) setError(''); }
    catch (reason: any) { setError(reason?.message || 'تعذر تحميل الوردية.'); }
  }, [shiftId]);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(() => load(true), 15000, shift?.status !== 'closed');

  const act = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && !managerNote.trim()) { setError('يجب كتابة سبب الرفض.'); return; }
    setBusy(true); setError('');
    try {
      if (action === 'approve') await shiftsApi.approve(shiftId, managerNote.trim() || undefined);
      else await shiftsApi.reject(shiftId, managerNote.trim());
      await load(); onChanged(); setRejecting(false); setManagerNote('');
    } catch (reason: any) { setError(reason?.message || 'تعذر تنفيذ الإجراء.'); }
    finally { setBusy(false); }
  };

  const totals = shift?.totals;
  const hasDifference = (shift?.differenceUSD ?? 0) !== 0 || (shift?.differenceSYP ?? 0) !== 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div onClick={event => event.stopPropagation()} className="flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl bg-white sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-sm sm:border-2 sm:border-slate-300">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b-2 border-slate-200 bg-slate-900 px-3 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black text-amber-400">{shift ? `وردية ${shift.shiftNumber} — ${shift.sellerName}` : 'جارِ التحميل...'}</h3>
            {shift && <p className="mt-0.5 truncate text-[10px] font-medium text-slate-400">{shift.warehouseName} • {dateTime(shift.openedAt)}</p>}
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="rounded-sm p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3">
          {!shift ? <div className="grid place-items-center py-12 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div> : <>
            {shift.isSnapshot && (
              <p className="rounded-sm border border-slate-300 bg-slate-50 px-3 py-2 text-[10px] font-bold leading-5 text-slate-600">
                هذه أرقام مجمّدة لحظة الاعتماد ولا تتغيّر بأي حركة لاحقة.
              </p>
            )}

            <Section title="ملخّص الوردية" icon={TrendingUp}>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                <Cell label="الفواتير" value={String(totals?.invoiceCount ?? 0)} />
                <Cell label="إجمالي المبيعات" value={usd(totals?.salesGrossUsd ?? 0)} />
                <Cell label="عدد القطع" value={String(totals?.itemCount ?? 0)} />
                <Cell label="مقبوض $" value={usd(totals?.cashReceivedUsd ?? 0)} />
                <Cell label="مقبوض ل.س" value={syp(totals?.cashReceivedSyp ?? 0)} />
                <Cell label="مرتجعات" value={`${totals?.returnCount ?? 0} — ${usd(totals?.returnsTotalUsd ?? 0)}`} />
              </div>
            </Section>

            {(totals?.creditInvoiceCount ?? 0) > 0 && (
              <Section title="الذمم الناتجة عن الوردية" icon={ArrowDownLeft} tone="amber">
                <div className="grid grid-cols-2 gap-1.5">
                  <Cell label="فواتير بالذمّة" value={String(totals!.creditInvoiceCount)} />
                  <Cell label="إجمالي المتبقي" value={usd(totals!.outstandingUsd)} />
                </div>
              </Section>
            )}

            {!!totals?.soldWeightByKarat?.length && (
              <Section title="الوزن المباع حسب العيار" icon={Scale}>
                <KaratRows rows={totals.soldWeightByKarat} />
              </Section>
            )}
            {!!totals?.exchangeGoldByKarat?.length && (
              <Section title="كسر مقايضة مستلم" icon={Coins} tone="amber">
                <KaratRows rows={totals.exchangeGoldByKarat} />
              </Section>
            )}

            <Section title="العُهدة النقدية" icon={Wallet}>
              <div className="space-y-1.5">
                <CustodyRow label="عُهدة الافتتاح" usdValue={shift.openingCustodyUSD} sypValue={shift.openingCustodySYP} />
                <CustodyRow label="المتوقّع تسليمه" usdValue={shift.expectedUSD} sypValue={shift.expectedSYP} strong />
                {shift.actualUSD !== null && <CustodyRow label="المسلَّم فعلياً" usdValue={shift.actualUSD} sypValue={shift.actualSYP ?? 0} />}
                {shift.differenceUSD !== null && (
                  <div className={`rounded-sm px-2.5 py-2 text-xs font-black ${hasDifference ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    <div className="flex items-center justify-between gap-2"><span>الفرق</span>
                      <span className="font-mono">{usd(shift.differenceUSD)} • {syp(shift.differenceSYP ?? 0)}</span>
                    </div>
                  </div>
                )}
              </div>
              {shift.sellerNote && <p className="mt-2 rounded-sm bg-slate-50 px-2.5 py-2 text-[11px] font-bold leading-5 text-slate-700"><b className="text-slate-500">ملاحظة البائع: </b>{shift.sellerNote}</p>}
              {shift.managerNote && <p className="mt-1.5 rounded-sm bg-amber-50 px-2.5 py-2 text-[11px] font-bold leading-5 text-amber-900"><b className="opacity-70">ملاحظة المدير: </b>{shift.managerNote}</p>}
            </Section>

            {!!shift.sales.length && (
              <Section title={`فواتير الوردية (${shift.sales.length})`} icon={TrendingUp}>
                <div className="space-y-1">
                  {shift.sales.map(sale => (
                    <div key={sale.id} className={`flex items-center justify-between gap-2 rounded-sm border-r-4 px-2.5 py-2 text-[11px] ${sale.status === 'cancelled' ? 'border-r-rose-400 bg-rose-50/60 line-through opacity-70' : 'border-r-amber-400 bg-slate-50'}`}>
                      <div className="min-w-0">
                        <p className="truncate font-black text-slate-900">{sale.invoiceNumber} — {sale.customerName}</p>
                        <p className="text-[10px] text-slate-500">{time(sale.createdAt)}{sale.remainingDebtUSD > 0 ? ` • متبقٍ ${usd(sale.remainingDebtUSD)}` : ''}</p>
                      </div>
                      <b className="shrink-0 font-mono text-slate-900">{usd(sale.finalTotalUSD)}</b>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {!!shift.returns.length && (
              <Section title={`مرتجعات الوردية (${shift.returns.length})`} icon={RotateCcw}>
                <div className="space-y-1">
                  {shift.returns.map(entry => (
                    <div key={entry.id} className="flex items-center justify-between gap-2 rounded-sm border-r-4 border-r-rose-400 bg-slate-50 px-2.5 py-2 text-[11px]">
                      <div className="min-w-0"><p className="truncate font-black text-slate-900">{entry.returnNumber} — {entry.partnerName}</p><p className="text-[10px] text-slate-500">{time(entry.createdAt)}</p></div>
                      <b className="shrink-0 font-mono text-slate-900">{usd(entry.finalTotalUSD)}</b>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <Section title="حركة الوردية" icon={History}>
              <ol className="space-y-1.5">
                {shift.timeline.map(entry => (
                  <li key={entry.id} className="flex items-start gap-2 text-[11px]">
                    <span className="mt-0.5 shrink-0 font-mono text-slate-400">{time(entry.occurredAt)}</span>
                    <span className="min-w-0 flex-1 font-bold text-slate-700">{entry.description}</span>
                    {entry.amountUsd !== null && <b className="shrink-0 font-mono text-slate-900">{usd(entry.amountUsd)}</b>}
                  </li>
                ))}
              </ol>
            </Section>

            {error && <p role="alert" className="rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700">{error}</p>}
          </>}
        </div>

        {shift?.status === 'closing_requested' && (
          <div className="shrink-0 space-y-2 border-t-2 border-slate-200 bg-white p-3">
            <input value={managerNote} onChange={event => setManagerNote(event.target.value)} placeholder={rejecting ? 'سبب الرفض (إلزامي)' : 'ملاحظة المدير (اختياري)'}
              className="h-11 w-full rounded-sm border-2 border-slate-200 px-3 text-sm font-bold outline-none transition focus:border-amber-400" />
            <div className="grid grid-cols-2 gap-2">
              <button disabled={busy} onClick={() => { if (rejecting) void act('reject'); else setRejecting(true); }}
                className="flex h-11 items-center justify-center gap-1.5 rounded-sm border-2 border-rose-200 text-xs font-extrabold text-rose-600 transition active:scale-95 disabled:opacity-50">
                <RotateCcw className="h-4 w-4" />{rejecting ? 'تأكيد الرفض' : 'رفض وإعادة فتح'}
              </button>
              <button disabled={busy} onClick={() => void act('approve')}
                className="flex h-11 items-center justify-center gap-1.5 rounded-sm bg-amber-400 text-xs font-black text-slate-900 transition active:scale-95 disabled:opacity-50">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}اعتماد الإغلاق
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; icon: typeof Coins; tone?: 'amber'; children: React.ReactNode }> = ({ title, icon: Icon, tone, children }) => (
  <div className={`rounded-sm border-2 p-2.5 ${tone === 'amber' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'}`}>
    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black text-slate-700"><Icon className="h-3.5 w-3.5 text-slate-400" />{title}</p>
    {children}
  </div>
);

const Cell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-sm bg-slate-50 px-2 py-1.5">
    <p className="text-[10px] font-bold text-slate-500">{label}</p>
    <p className="mt-0.5 font-mono text-xs font-black text-slate-900">{value}</p>
  </div>
);

const KaratRows: React.FC<{ rows: KaratWeight[] }> = ({ rows }) => (
  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
    {rows.map(row => (
      <div key={row.karat} className="rounded-sm bg-white px-2 py-1.5 text-center">
        <p className="text-[10px] font-black text-amber-700">عيار {row.karat}</p>
        <p className="mt-0.5 font-mono text-xs font-black text-slate-900">{grams(row.weightGrams)}</p>
      </div>
    ))}
  </div>
);

const CustodyRow: React.FC<{ label: string; usdValue: number; sypValue: number; strong?: boolean }> = ({ label, usdValue, sypValue, strong }) => (
  <div className={`flex items-center justify-between gap-2 rounded-sm px-2.5 py-2 text-xs ${strong ? 'bg-slate-900 text-amber-400 font-black' : 'bg-slate-50 font-bold text-slate-700'}`}>
    <span>{label}</span>
    <span className="font-mono">{usd(usdValue)} • {syp(sypValue)}</span>
  </div>
);
