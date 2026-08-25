import React, { useCallback, useEffect, useState } from 'react';
import { Recycle, X, Loader2, AlertTriangle, CheckCircle2, PackagePlus, RotateCcw, History } from 'lucide-react';
import { goldApi, type ScrapHolding, type UsedConversion } from '../services/goldApi';

const grams = (value: number) => `${value.toFixed(3)} غ`;
const dateTime = (value: string) => new Date(value).toLocaleString('ar-SY', { hour12: false });
const CATEGORIES = ['أطقم', 'خواتم ومحابس', 'أساور ومبارم', 'قلائد وسلاسل', 'أقراط', 'سبائك وليرات', 'ذهب كسر', 'متنوع'];
const field = 'h-11 w-full rounded-sm border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-amber-400';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * كسر المقايضة المتاح — barter scrap the shop physically holds, and the manager decision that
 * turns some of it into sellable second-hand stock.
 *
 * The panel only ever renders what the server computed: received, converted and available are
 * never recalculated here, so the browser cannot disagree with the ledger.
 */
export const UsedGoldPanel: React.FC<{ onConverted?: () => void }> = ({ onConverted }) => {
  const [holdings, setHoldings] = useState<ScrapHolding[]>([]);
  const [conversions, setConversions] = useState<UsedConversion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<ScrapHolding | null>(null);
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [scrap, log] = await Promise.all([goldApi.scrapHoldings(), goldApi.usedConversions({ limit: 50 }).catch(() => ({ items: [] }))]);
      setHoldings(scrap.holdings); setConversions(log.items); setError('');
    } catch (reason: any) { setError(reason?.message || 'تعذر تحميل كسر المقايضة.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="grid place-items-center bg-white p-8 text-slate-400 shadow-sm"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (error) return <p role="alert" className="flex items-start gap-2 border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>;
  // على شاشتها المستقلة لم يعد الإخفاء الكامل مقبولاً: الشاشة الفارغة يجب أن تقول لماذا هي فارغة.
  if (!holdings.length && !conversions.length) return (
    <div className="border border-dashed border-slate-300 bg-white p-6 text-center text-xs font-bold text-slate-500 sm:p-8">
      لا يوجد كسر مقايضة مستلم حتى الآن. يظهر هنا الذهب الذي يستلمه المحل من الزبائن ضمن فواتير البيع.
    </div>
  );

  return (
    <div className="bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <b className="flex items-center gap-2 text-sm text-slate-900 sm:text-base">
          <Recycle className="h-4 w-4 shrink-0 text-violet-600" />ذهب الكسر والخاشر المتاح للتحويل
        </b>
        {conversions.length > 0 && (
          <button onClick={() => setShowLog(true)} className="flex items-center gap-1 text-[11px] font-extrabold text-slate-500 underline">
            <History className="h-3.5 w-3.5" />سجل التحويلات ({conversions.length})
          </button>
        )}
      </div>
      <p className="mt-1 text-[11px] font-medium leading-5 text-slate-500">
        يحتفظ هذا الرصيد بكسر المقايضة والخاشر المشتَرى. حوّل فقط ما تقرر أنه صالح للبيع كمستعمل؛ لا ينشئ التحويل أي مبلغ أو استلام ذهب جديد.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {holdings.map(holding => (
          <div key={`${holding.goldAccountId}-${holding.karat}`}
            className={`border-r-4 p-3 ${holding.fullyConverted ? 'border-slate-300 bg-slate-50' : 'border-violet-400 bg-violet-50/40'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <b className="block text-xs text-slate-900">عيار {holding.karat}</b>
                <span className="block truncate text-[10px] text-slate-500">{holding.warehouseName ?? holding.accountName}</span>
              </div>
              {holding.fullyConverted
                ? <span className="shrink-0 rounded-sm bg-slate-200 px-1.5 py-0.5 text-[9px] font-black text-slate-600">محوّل بالكامل</span>
                : <span className="shrink-0 rounded-sm bg-violet-100 px-1.5 py-0.5 text-[9px] font-black text-violet-700">متاح</span>}
            </div>
            {/* History is never hidden: what came in stays visible next to what is left. */}
            <div className="mt-2 space-y-0.5 border-t border-slate-200 pt-2 text-[11px] font-bold">
              <p className="flex justify-between text-slate-500">الرصيد تحت المعالجة<span className="font-mono text-slate-700">{grams(holding.receivedGrams)}</span></p>
              <p className="flex justify-between text-slate-500">محوّل للمخزون<span className="font-mono text-slate-700">{grams(holding.convertedGrams)}</span></p>
              <p className="flex justify-between text-slate-900">المتاح الآن<span className="font-mono text-base font-black text-violet-800">{grams(holding.availableGrams)}</span></p>
            </div>
            {holding.canConvert && (
              <button onClick={() => setTarget(holding)}
                className="mt-2.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-sm bg-slate-900 text-[11px] font-black text-amber-400 transition active:scale-[.98]">
                <PackagePlus className="h-3.5 w-3.5" />إضافة للمخزون كمستعمل
              </button>
            )}
          </div>
        ))}
      </div>

      {target && <ConvertSheet holding={target} onClose={() => setTarget(null)} onDone={async () => { setTarget(null); await load(); onConverted?.(); }} />}
      {showLog && <ConversionLog conversions={conversions} onClose={() => setShowLog(false)} onChanged={async () => { await load(); onConverted?.(); }} />}
    </div>
  );
};

const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
    <div onClick={event => event.stopPropagation()} className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl bg-white sm:max-h-[88vh] sm:max-w-md sm:rounded-sm sm:border-2 sm:border-slate-300">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b-2 border-slate-200 bg-slate-900 px-3 py-3">
        <h3 className="truncate text-sm font-black text-amber-400">{title}</h3>
        <button onClick={onClose} aria-label="إغلاق" className="rounded-sm p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      {children}
    </div>
  </div>
);

const ConvertSheet: React.FC<{ holding: ScrapHolding; onClose: () => void; onDone: () => Promise<void> }> = ({ holding, onClose, onDone }) => {
  const [weightGrams, setWeightGrams] = useState(holding.availableGrams.toFixed(3));
  const [name, setName] = useState('');
  const [category, setCategory] = useState('متنوع');
  const [code, setCode] = useState(`USED-${holding.karat}-${Date.now().toString().slice(-6)}`);
  const [inventoryMode, setInventoryMode] = useState<'individual' | 'aggregate'>('individual');
  const [quantity, setQuantity] = useState('1');
  const [managerNote, setManagerNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const requested = Number(weightGrams || 0);
  const remaining = Number((holding.availableGrams - requested).toFixed(3));
  const invalid = !(requested > 0) || requested > holding.availableGrams + 0.0005 || !name.trim() || !code.trim() || managerNote.trim().length < 3;

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await goldApi.convertToUsedInventory({
        goldAccountId: holding.goldAccountId, karat: holding.karat, weightGrams: requested.toFixed(3),
        name: name.trim(), category, code: code.trim(), inventoryMode,
        quantity: inventoryMode === 'individual' ? String(Math.max(1, Math.round(Number(quantity) || 1))) : (Number(quantity) || 1).toFixed(3),
        managerNote: managerNote.trim(), idempotencyKey: uuid(),
      });
      await onDone();
    } catch (reason: any) { setError(reason?.message || 'تعذر التحويل.'); setBusy(false); }
  };

  return (
    <Sheet title={`تحويل كسر عيار ${holding.karat} إلى مخزون مستعمل`} onClose={onClose}>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="rounded-sm border-2 border-violet-300 bg-violet-50 p-3 text-center">
          <p className="text-[11px] font-bold text-violet-700">المتاح للتحويل</p>
          <p className="mt-0.5 font-mono text-xl font-black text-violet-900">{grams(holding.availableGrams)}</p>
        </div>

        <label className="block text-xs font-extrabold text-slate-700">الوزن المحوَّل
          <input inputMode="decimal" dir="ltr" value={weightGrams} onChange={event => setWeightGrams(event.target.value.replace(/[^\d.]/g, ''))} className={`${field} mt-1.5 text-left font-mono`} />
        </label>
        <p className={`rounded-sm px-3 py-2 text-[11px] font-black ${remaining < 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-600'}`}>
          {remaining < 0 ? 'الوزن المطلوب يتجاوز المتاح.' : <>سيتبقّى كسر متاح: <span className="font-mono">{grams(Math.max(0, remaining))}</span></>}
        </p>

        <label className="block text-xs font-extrabold text-slate-700">اسم القطعة
          <input value={name} onChange={event => setName(event.target.value)} placeholder="مثال: خاتم مستعمل" className={`${field} mt-1.5`} />
        </label>
        <label className="block text-xs font-extrabold text-slate-700">التصنيف
          <select value={category} onChange={event => setCategory(event.target.value)} className={`${field} mt-1.5`}>
            {CATEGORIES.map(entry => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        </label>
        <label className="block text-xs font-extrabold text-slate-700">كود الصنف
          <input value={code} onChange={event => setCode(event.target.value)} dir="ltr" className={`${field} mt-1.5 text-left font-mono`} />
        </label>

        <div className="grid grid-cols-2 gap-2">
          {(['individual', 'aggregate'] as const).map(mode => (
            <button key={mode} onClick={() => setInventoryMode(mode)}
              className={`h-11 rounded-sm border-2 text-[11px] font-extrabold transition ${inventoryMode === mode ? 'border-amber-400 bg-amber-50 text-slate-900' : 'border-slate-200 bg-white text-slate-600'}`}>
              {mode === 'individual' ? 'قطعة مفردة' : 'وزن سائب'}
            </button>
          ))}
        </div>
        <label className="block text-xs font-extrabold text-slate-700">{inventoryMode === 'individual' ? 'عدد القطع' : 'الكمية'}
          <input inputMode="decimal" dir="ltr" value={quantity} onChange={event => setQuantity(event.target.value.replace(/[^\d.]/g, ''))} className={`${field} mt-1.5 text-left font-mono`} />
        </label>

        <label className="block text-xs font-extrabold text-slate-700">ملاحظة المدير <span className="text-rose-600">(إلزامية)</span>
          <textarea value={managerNote} onChange={event => setManagerNote(event.target.value)} rows={2} placeholder="مثال: خاتم مستعمل بحالة جيدة"
            className="mt-1.5 w-full rounded-sm border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800 outline-none transition focus:border-amber-400" />
        </label>
        <p className="rounded-sm bg-slate-50 px-3 py-2 text-[11px] font-bold leading-5 text-slate-600">
          هذا تصنيف لذهب موجود أصلاً: لا سند، لا قيد محاسبي، ولا استلام ذهب جديد. الملاحظة داخلية ولا تُطبع على فاتورة الزبون.
        </p>
        {error && <p role="alert" className="rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700">{error}</p>}
      </div>
      <div className="shrink-0 border-t-2 border-slate-200 p-3">
        <button disabled={busy || invalid} onClick={() => void submit()}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-amber-400 text-xs font-black text-slate-900 transition active:scale-[.98] disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}تأكيد التحويل
        </button>
      </div>
    </Sheet>
  );
};

const ConversionLog: React.FC<{ conversions: UsedConversion[]; onClose: () => void; onChanged: () => Promise<void> }> = ({ conversions, onClose, onChanged }) => {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const reverse = async (conversion: UsedConversion) => {
    const reason = window.prompt(`سبب التراجع عن تحويل ${conversion.inventoryCode}؟`);
    if (!reason || reason.trim().length < 3) return;
    setBusy(conversion.id); setError('');
    try { await goldApi.reverseUsedConversion(conversion.id, reason.trim()); await onChanged(); }
    catch (reason: any) { setError(reason?.message || 'تعذر التراجع.'); }
    finally { setBusy(''); }
  };
  return (
    <Sheet title="سجل تحويلات الكسر إلى مخزون مستعمل" onClose={onClose}>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {error && <p role="alert" className="rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700">{error}</p>}
        {conversions.map(conversion => (
          <div key={conversion.id} className={`border-r-4 p-3 ${conversion.status === 'reversed' ? 'border-slate-300 bg-slate-50 text-slate-400' : 'border-violet-400 bg-white'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <b className="block truncate text-xs text-slate-900">{conversion.inventoryName}</b>
                <span className="block font-mono text-[10px] text-slate-500">{conversion.inventoryCode} · {conversion.goldTransactionNumber}</span>
              </div>
              <span className="shrink-0 font-mono text-sm font-black text-violet-800">{grams(conversion.convertedWeightGrams)}</span>
            </div>
            <p className="mt-1.5 text-[10px] font-bold text-slate-500">
              عيار {conversion.karat} · {conversion.warehouseName} · {conversion.createdBy} · {dateTime(conversion.createdAt)}
            </p>
            <p className="mt-1 rounded-sm bg-slate-50 px-2 py-1.5 text-[11px] font-bold leading-5 text-slate-700">{conversion.managerNote}</p>
            {conversion.status === 'reversed'
              ? <p className="mt-1.5 rounded-sm bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">تم التراجع — {conversion.reversalReason}</p>
              : (
                <button disabled={busy === conversion.id} onClick={() => void reverse(conversion)}
                  className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-sm border-2 border-slate-200 text-[11px] font-extrabold text-slate-600 transition active:scale-95 disabled:opacity-50">
                  {busy === conversion.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}تراجع عن التحويل
                </button>
              )}
          </div>
        ))}
      </div>
    </Sheet>
  );
};
