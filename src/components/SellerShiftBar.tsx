import React, { useCallback, useEffect, useState } from 'react';
import { Clock3, Loader2, AlertTriangle, PlayCircle, LogOut, Wallet, X, CheckCircle2 } from 'lucide-react';
import { shiftsApi, type ShiftDetail } from '../services/shiftsApi';
import { useLiveRefresh } from '../hooks/useLiveRefresh';

const usd = (value: number) => `$ ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const syp = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 0 })} ل.س`;
const time = (value: string) => new Date(value).toLocaleTimeString('ar-SY', { hour: '2-digit', minute: '2-digit' });
const field = 'h-11 w-full rounded-sm border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-amber-400';

/**
 * The seller's whole shift experience, folded into the top of their sales screen.
 *
 * A seller never navigates a management module: they see one line telling them where they
 * stand, and one button for the only action available to them right now.
 */
export const SellerShiftBar: React.FC<{ onShiftChanged?: () => void }> = ({ onShiftChanged }) => {
  const [shift, setShift] = useState<ShiftDetail | null>(null);
  const [canOpen, setCanOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'none' | 'open' | 'close'>('none');

  const load = useCallback(async (quiet = false) => {
    try {
      const result = await shiftsApi.current();
      setShift(result.shift); setCanOpen(result.canOpen); if (!quiet) setError('');
    } catch (reason: any) { if (!quiet) setError(reason?.message || 'تعذر قراءة حالة الوردية.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(() => load(true), 30000, Boolean(shift));

  const done = async () => { setMode('none'); await load(); onShiftChanged?.(); };

  if (loading) return <div className="flex items-center gap-2 rounded-sm border-2 border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />جارِ قراءة حالة الوردية…</div>;
  // A user who cannot run shifts at all (a manager at the counter) sees nothing here.
  if (!shift && !canOpen) return null;

  if (!shift) {
    return <>
      <div className="rounded-sm border-2 border-amber-400 bg-amber-50 p-3 text-center sm:flex sm:items-center sm:justify-between sm:gap-3 sm:text-right">
        <div className="flex items-center justify-center gap-2 sm:justify-start">
          <Clock3 className="h-5 w-5 shrink-0 text-amber-700" />
          <div>
            <p className="text-sm font-black text-slate-900">لا توجد وردية مفتوحة</p>
            <p className="mt-0.5 text-[11px] font-medium text-slate-600">افتح وردية قبل تسجيل أي فاتورة بيع.</p>
          </div>
        </div>
        <button onClick={() => setMode('open')} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-slate-900 text-xs font-black text-amber-400 transition active:scale-[.98] sm:mt-0 sm:w-auto sm:px-5">
          <PlayCircle className="h-4 w-4" />فتح وردية
        </button>
      </div>
      {mode === 'open' && <OpenShiftSheet onClose={() => setMode('none')} onDone={done} />}
    </>;
  }

  const pending = shift.status === 'closing_requested';
  const totals = shift.totals;
  return <>
    <div className={`rounded-sm border-2 p-3 ${pending ? 'border-amber-400 bg-amber-50' : 'border-emerald-500 bg-emerald-50/60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-black text-slate-900">
            <Clock3 className={`h-4 w-4 shrink-0 ${pending ? 'text-amber-700' : 'text-emerald-700'}`} />
            وردية {shift.shiftNumber}
          </p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-600">بدأت {time(shift.openedAt)} • {shift.warehouseName}</p>
        </div>
        <span className={`shrink-0 rounded-sm px-2 py-1 text-[10px] font-black ${pending ? 'bg-amber-400 text-slate-900' : 'bg-emerald-600 text-white'}`}>
          {pending ? 'بانتظار اعتماد المدير' : 'مفتوحة'}
        </span>
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-1.5 border-t border-slate-200/80 pt-2.5 text-center text-[11px]">
        <div className="rounded-sm bg-white/80 px-1 py-1.5"><p className="text-slate-500">فواتيري</p><b className="font-mono text-slate-900">{totals?.invoiceCount ?? 0}</b></div>
        <div className="rounded-sm bg-white/80 px-1 py-1.5"><p className="text-slate-500">مبيعاتي</p><b className="font-mono text-slate-900">{usd(totals?.salesGrossUsd ?? 0)}</b></div>
        <div className="rounded-sm bg-white/80 px-1 py-1.5"><p className="text-slate-500">المتوقّع $</p><b className="font-mono text-slate-900">{usd(shift.expectedUSD)}</b></div>
      </div>

      {pending ? (
        <p className="mt-2.5 rounded-sm bg-white/80 px-2.5 py-2 text-[11px] font-bold leading-5 text-amber-900">
          طلب الإغلاق مُرسل. لا يمكن تسجيل فواتير جديدة حتى يعتمده المدير أو يعيد فتح الوردية.
        </p>
      ) : (
        <button onClick={() => setMode('close')} className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-sm border-2 border-slate-300 bg-white text-xs font-extrabold text-slate-700 transition active:scale-[.98]">
          <LogOut className="h-4 w-4" />طلب إغلاق الوردية
        </button>
      )}
    </div>
    {error && <p role="alert" className="mt-2 rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</p>}
    {mode === 'close' && <CloseShiftSheet shift={shift} onClose={() => setMode('none')} onDone={done} />}
  </>;
};

// ---------------------------------------------------------------- sheets

const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
    <div onClick={event => event.stopPropagation()} className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl bg-white sm:max-h-[88vh] sm:max-w-md sm:rounded-sm sm:border-2 sm:border-slate-300">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b-2 border-slate-200 bg-slate-900 px-3 py-3">
        <h3 className="truncate text-sm font-black text-amber-400">{title}</h3>
        <button onClick={onClose} aria-label="إغلاق" className="rounded-sm p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      {children}
    </div>
  </div>
);

const OpenShiftSheet: React.FC<{ onClose: () => void; onDone: () => Promise<void> }> = ({ onClose, onDone }) => {
  const [openingUsd, setOpeningUsd] = useState('0');
  const [openingSyp, setOpeningSyp] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try { await shiftsApi.open(Number(openingUsd || 0).toFixed(4), Number(openingSyp || 0).toFixed(2)); await onDone(); }
    catch (reason: any) { setError(reason?.message || 'تعذر فتح الوردية.'); setBusy(false); }
  };
  return (
    <Sheet title="فتح وردية جديدة" onClose={onClose}>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <p className="rounded-sm bg-slate-50 px-3 py-2 text-[11px] font-bold leading-5 text-slate-600">
          سجّل المبلغ النقدي المُسلَّم إليك عند بداية الوردية. إن لم تستلم شيئاً اترك الحقول صفراً.
        </p>
        <label className="block text-xs font-extrabold text-slate-700">عُهدة الافتتاح بالدولار
          <input inputMode="decimal" value={openingUsd} onChange={event => setOpeningUsd(event.target.value.replace(/[^\d.]/g, ''))} className={`${field} mt-1.5 text-left font-mono`} dir="ltr" />
        </label>
        <label className="block text-xs font-extrabold text-slate-700">عُهدة الافتتاح بالليرة السورية
          <input inputMode="decimal" value={openingSyp} onChange={event => setOpeningSyp(event.target.value.replace(/[^\d.]/g, ''))} className={`${field} mt-1.5 text-left font-mono`} dir="ltr" />
        </label>
        {error && <p role="alert" className="rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700">{error}</p>}
      </div>
      <div className="shrink-0 border-t-2 border-slate-200 p-3">
        <button disabled={busy} onClick={() => void submit()} className="flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-amber-400 text-xs font-black text-slate-900 transition active:scale-[.98] disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}فتح الوردية وبدء البيع
        </button>
      </div>
    </Sheet>
  );
};

const CloseShiftSheet: React.FC<{ shift: ShiftDetail; onClose: () => void; onDone: () => Promise<void> }> = ({ shift, onClose, onDone }) => {
  const [actualUsd, setActualUsd] = useState(shift.expectedUSD.toFixed(2));
  const [actualSyp, setActualSyp] = useState(shift.expectedSYP.toFixed(0));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Shown live so the seller sees the gap before they submit, not after.
  const differenceUsd = Number((Number(actualUsd || 0) - shift.expectedUSD).toFixed(2));
  const differenceSyp = Number((Number(actualSyp || 0) - shift.expectedSYP).toFixed(0));
  const hasDifference = differenceUsd !== 0 || differenceSyp !== 0;

  const submit = async () => {
    if (hasDifference && !note.trim()) { setError('يوجد فرق — اكتب ملاحظة توضّح سببه.'); return; }
    setBusy(true); setError('');
    try { await shiftsApi.requestClose(shift.id, Number(actualUsd || 0).toFixed(4), Number(actualSyp || 0).toFixed(2), note.trim() || undefined); await onDone(); }
    catch (reason: any) { setError(reason?.message || 'تعذر إرسال طلب الإغلاق.'); setBusy(false); }
  };

  return (
    <Sheet title={`إغلاق وردية ${shift.shiftNumber}`} onClose={onClose}>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="rounded-sm border-2 border-slate-900 bg-slate-900 p-3 text-amber-400">
          <p className="flex items-center gap-1.5 text-[11px] font-bold opacity-80"><Wallet className="h-3.5 w-3.5" />المتوقّع تسليمه</p>
          <p className="mt-1 font-mono text-lg font-black">{usd(shift.expectedUSD)}</p>
          <p className="font-mono text-sm font-black">{syp(shift.expectedSYP)}</p>
        </div>

        <label className="block text-xs font-extrabold text-slate-700">المُسلَّم فعلياً بالدولار
          <input inputMode="decimal" value={actualUsd} onChange={event => setActualUsd(event.target.value.replace(/[^\d.]/g, ''))} className={`${field} mt-1.5 text-left font-mono`} dir="ltr" />
        </label>
        <label className="block text-xs font-extrabold text-slate-700">المُسلَّم فعلياً بالليرة السورية
          <input inputMode="decimal" value={actualSyp} onChange={event => setActualSyp(event.target.value.replace(/[^\d.]/g, ''))} className={`${field} mt-1.5 text-left font-mono`} dir="ltr" />
        </label>

        <div className={`rounded-sm px-3 py-2.5 text-xs font-black ${hasDifference ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {hasDifference ? <>الفرق: <span className="font-mono">{usd(differenceUsd)} • {syp(differenceSyp)}</span></> : <span className="flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" />مطابق تماماً للمتوقّع</span>}
        </div>

        <label className="block text-xs font-extrabold text-slate-700">
          ملاحظة {hasDifference && <span className="text-rose-600">(إلزامية عند وجود فرق)</span>}
          <textarea value={note} onChange={event => setNote(event.target.value)} rows={2} placeholder="مثال: نقص 20 دولار — فكة زبون"
            className="mt-1.5 w-full rounded-sm border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none transition focus:border-amber-400" />
        </label>

        <p className="rounded-sm bg-slate-50 px-3 py-2 text-[11px] font-bold leading-5 text-slate-600">
          بعد الإرسال لن تتمكّن من تسجيل فواتير جديدة حتى يعتمد المدير الإغلاق.
        </p>
        {error && <p role="alert" className="rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700">{error}</p>}
      </div>
      <div className="shrink-0 border-t-2 border-slate-200 p-3">
        <button disabled={busy} onClick={() => void submit()} className="flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-amber-400 text-xs font-black text-slate-900 transition active:scale-[.98] disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}إرسال طلب الإغلاق
        </button>
      </div>
    </Sheet>
  );
};
