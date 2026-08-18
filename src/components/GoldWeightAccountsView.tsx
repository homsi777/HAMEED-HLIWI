import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Loader2, Package, PencilLine, Plus, Recycle, Scale, Trash2, X } from 'lucide-react';
import { goldApi, GOLD_KARATS, type ApiGoldHoldings, type ApiGoldHoldingMovement } from '../services/goldApi';
import { partnersApi, type ApiPartner } from '../services/partnersApi';
import { inventoryApi } from '../services/inventoryApi';
import type { Warehouse } from '../types';

/**
 * شاشة القسم (ذمم الأوزان) — لوحة دخول لا دفتر.
 *
 * تعرض ثلاثة أشياء فقط: كم ذهباً يملك المحل الآن، ما تحرّك اليوم، ومدخلَي الشاشتين
 * المستقلتين. كل تفصيل آخر يعيش في شاشته.
 *
 * A weight is only meaningful together with its karat, so grams of different karats are
 * never added together: the headline is the fine-gold equivalent, and each karat keeps its
 * own line beneath it.
 *
 * ملاحظة لمن يقرأ هذا لاحقاً: كان في هذه الشاشة قسمٌ لأوزان الأطراف التجارية (استلام/تسليم/
 * تحويل عيار/رصيد افتتاحي، بطاقات أرصدة الأطراف، كشف الحساب وطباعته، ولوحة مطابقة الأوزان).
 * أُزيل بقرار صريح من المدير لأنه بدا له تكراراً لشاشة «ذمم أوزان»، ثم أُعيد منه «رصيد
 * افتتاحي» وحده بطلبه. الخادم لم يُمسّ في الحالتين: حركات الذهب عن فواتير البيع والمرتجعات
 * ما زالت تُرحَّل كما هي، وما زال بالإمكان قراءة أرصدة الأطراف من `/gold/partners` ومن
 * `/gold/partners/:id/statement` — بلا واجهة تستدعيها. بقية الأزرار في تاريخ git.
 */
const KARAT_ORDER = (a: { karat: string }, b: { karat: string }) => Number(b.karat) - Number(a.karat);
/** أكثر من 95% من ذهب المحل عيار 21، فيتصدّر البطاقات مهما كان ترتيبه العددي. */
const LEAD_KARAT = '21';

type Props = {
  /** فتح شاشة «ذمم أوزان» — ليست في القائمة الجانبية، تُفتح من هنا فقط. */
  onOpenCustody: () => void;
  /** فتح شاشة «كسر المقايضة». */
  onOpenUsedGold: () => void;
  /** فتح سجل الأرصدة الافتتاحية وحركات تعديل وزن المحل. */
  onOpenOpenings: () => void;
  /** صلاحية gold_accounts.adjust — تُظهر زر التعديل اليدوي على إجمالي ذهب الشركة. */
  canAdjust?: boolean;
};

export const GoldWeightAccountsView: React.FC<Props> = ({ onOpenCustody, onOpenUsedGold, onOpenOpenings, canAdjust = false }) => {
  const [holdings, setHoldings] = useState<ApiGoldHoldings | null>(null);
  const [showAllMovements, setShowAllMovements] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [error, setError] = useState('');

  // رصيد الأوزان الافتتاحي — حركة على طرف تجاري، بنفس نقطة النهاية ونفس الحقول التي كانت.
  const [showOpening, setShowOpening] = useState(false);
  const [partners, setPartners] = useState<ApiPartner[]>([]);
  const [openingPartnerId, setOpeningPartnerId] = useState('');
  const [openingKarat, setOpeningKarat] = useState('21');
  const [openingWeight, setOpeningWeight] = useState('');
  const [openingDirection, setOpeningDirection] = useState<'partner_owes_shop' | 'shop_owes_partner'>('partner_owes_shop');
  const [openingNote, setOpeningNote] = useState('');
  const [busy, setBusy] = useState(false);

  // التعديل اليدوي على ذهب المحل — عدة عيارات في حركة واحدة، ولكل سطر ملاحظة نصية حرة.
  const [adjustDirection, setAdjustDirection] = useState<'increase' | 'decrease'>('increase');
  const [adjustLines, setAdjustLines] = useState<Array<{ karat: string; weightGrams: string; note: string }>>([{ karat: '21', weightGrams: '', note: '' }]);
  const [adjustNote, setAdjustNote] = useState('');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [adjustWarehouseId, setAdjustWarehouseId] = useState('');

  const refresh = async () => {
    try { setHoldings(await goldApi.holdings({ limit: 50 })); }
    catch (reason: any) { setError(reason?.message || 'تعذر تحميل أوزان الذهب من الخادم.'); }
  };
  useEffect(() => { void refresh(); }, []);
  // The partner list is only fetched when the sheet is actually opened: the screen itself
  // no longer shows partners, so loading 500 of them on every visit would be waste.
  useEffect(() => {
    if (!showOpening || partners.length) return;
    void partnersApi.list({ page: 1, limit: 500 }).then(result => setPartners(result.items)).catch(() => undefined);
  }, [showOpening, partners.length]);

  useEffect(() => {
    if (!showAdjust || warehouses.length) return;
    void inventoryApi.warehouses().then(rows => { setWarehouses(rows); setAdjustWarehouseId(current => current || rows[0]?.id || ''); }).catch(() => undefined);
  }, [showAdjust, warehouses.length]);

  const setLine = (index: number, patch: Partial<{ karat: string; weightGrams: string; note: string }>) =>
    setAdjustLines(current => current.map((line, position) => (position === index ? { ...line, ...patch } : line)));

  const submitAdjustment = async () => {
    const lines = adjustLines.filter(line => Number(line.weightGrams) > 0);
    if (!lines.length) { setError('أدخل وزناً واحداً على الأقل.'); return; }
    if (new Set(lines.map(line => line.karat)).size !== lines.length) { setError('لا تكرر العيار نفسه في أكثر من سطر.'); return; }
    setBusy(true); setError('');
    try {
      await goldApi.companyAdjustment({
        direction: adjustDirection,
        warehouseId: adjustWarehouseId || undefined,
        note: adjustNote || undefined,
        lines: lines.map(line => ({ karat: line.karat, weightGrams: Number(line.weightGrams).toFixed(3), note: line.note || undefined })),
        idempotencyKey: crypto.randomUUID(),
      });
      await refresh();
      setShowAdjust(false); setAdjustLines([{ karat: '21', weightGrams: '', note: '' }]); setAdjustNote('');
    } catch (reason: any) { setError(reason?.message || 'تعذر تسجيل التعديل.'); }
    finally { setBusy(false); }
  };

  const submitOpening = async () => {
    if (!openingPartnerId) { setError('اختر الطرف أولاً.'); return; }
    if (!(Number(openingWeight) > 0)) { setError('أدخل وزناً أكبر من صفر.'); return; }
    setBusy(true); setError('');
    try {
      await goldApi.opening({
        partnerId: openingPartnerId, karat: openingKarat, weightGrams: openingWeight,
        direction: openingDirection, note: openingNote || undefined, idempotencyKey: crypto.randomUUID(),
      });
      await refresh();
      setShowOpening(false); setOpeningWeight(''); setOpeningNote('');
    } catch (reason: any) { setError(reason?.message || 'تعذر تسجيل الرصيد الافتتاحي.'); }
    finally { setBusy(false); }
  };

  // The row date is the UTC day the server derived from occurredAt, so «اليوم» is compared
  // against the same UTC day rather than a locally formatted one.
  const today = new Date().toISOString().slice(0, 10);
  const movements = useMemo(() => holdings?.movements ?? [], [holdings]);
  const todayMovements = useMemo(() => movements.filter(row => row.date === today), [movements, today]);
  const shownMovements = showAllMovements ? movements : todayMovements;
  // الرقم المعروض هو ذهب المحل بعد استبعاد كسر المقايضة — الكسر له شاشته، ولا يُخلط هنا.
  // عيار 21 أولاً بطلب المدير، ثم البقية من الأعلى إلى الأدنى.
  const karats = useMemo(() => [...(holdings?.totalsExcludingScrap ?? [])].sort(KARAT_ORDER)
    .sort((left, right) => (left.karat === LEAD_KARAT ? -1 : right.karat === LEAD_KARAT ? 1 : 0)), [holdings]);
  // لم يعد يُعرض رقم مكافئ عيار 24؛ يبقى لحساب حصة الكسر المستبعدة وحدها.
  const headlineGrams = holdings?.pureGoldTotalExcludingScrapGrams ?? 0;
  const scrapPureGrams = Number(((holdings?.pureGoldTotalGrams ?? 0) - headlineGrams).toFixed(3));

  const sourceBadge = (row: ApiGoldHoldingMovement) => (row.source === 'scrap_exchange'
    ? <span className="rounded-sm bg-amber-200 px-1.5 py-0.5 text-[10px] font-black text-amber-900">كسر مقايضة</span>
    : <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">حركة يدوية</span>);

  const entryCard = (onClick: () => void, icon: React.ReactNode, title: string, desc: string) => (
    <button onClick={onClick} className="flex w-full items-center gap-3 bg-white p-3.5 text-right shadow-sm transition active:scale-[.99] sm:p-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-sm bg-slate-900">{icon}</span>
      <span className="min-w-0 flex-1">
        <b className="block text-sm text-slate-900">{title}</b>
        <span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{desc}</span>
      </span>
      <ChevronLeft className="h-5 w-5 shrink-0 text-slate-400" />
    </button>
  );

  return <div className="space-y-4">
    {error && <div className="border-r-4 border-rose-500 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div>}

    {/* ------------------------------------------------------- وزن الذهب في الشركة */}
    <div className="bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <b className="flex items-center gap-2 text-sm text-slate-900 sm:text-base"><Package className="h-4 w-4 shrink-0 text-amber-600" />وزن الذهب في الشركة</b>
        {canAdjust && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => { setShowOpening(true); setError(''); }} className="flex items-center gap-1.5 rounded-sm border-2 border-slate-200 px-2.5 py-1.5 text-[11px] font-black text-slate-700 transition active:scale-95">
              <Plus className="h-3.5 w-3.5 text-amber-600" />رصيد افتتاحي
            </button>
            <button onClick={() => setShowAdjust(true)} className="flex items-center gap-1.5 rounded-sm border-2 border-slate-200 px-2.5 py-1.5 text-[11px] font-black text-slate-700 transition active:scale-95">
              <PencilLine className="h-3.5 w-3.5 text-amber-600" />إضافة / تعديل وزن يدوي
            </button>
          </div>
        )}
      </div>

      {/* بطاقة لكل عيار، بلا رقم مكافئ عيار 24 إطلاقاً.
          الغرامات هنا هي ما أُدخل فعلاً بذلك العيار — لا تحويل ولا جمع بين عيارين. وعيار 21
          أولاً وأكبر لأنه أكثر من 95% مما يملكه المحل، فالعين تقع عليه أولاً. */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {karats.map((row, index) => {
          const lead = index === 0;
          return (
            <button key={row.karat} onClick={onOpenOpenings}
              className={`rounded-sm bg-slate-900 p-4 text-right transition active:scale-[.99] ${lead ? 'sm:col-span-2' : ''}`}>
              <span className={`block font-black text-white ${lead ? 'text-lg' : 'text-sm'}`}>عيار {row.karat}</span>
              <span className={`mt-1 block font-mono font-black leading-none text-amber-400 ${lead ? 'text-4xl' : 'text-2xl'}`}>
                {row.grams.toFixed(3)}<span className="mr-2 text-xs font-bold text-slate-400">غ</span>
              </span>
            </button>
          );
        })}
        {!karats.length && (
          <p className="border border-dashed border-slate-300 p-6 text-center text-xs font-bold text-slate-500 sm:col-span-2">
            لا يوجد ذهب مسجّل في خزنة المحل بعد. استعمل «إضافة / تعديل وزن يدوي» لتسجيل الرصيد الافتتاحي.
          </p>
        )}
      </div>

      {Math.abs(scrapPureGrams) > 0.0005 && (
        <p className="mt-2 text-[11px] font-bold leading-5 text-slate-500">
          هذه الأوزان لا تشمل كسر المقايضة ({scrapPureGrams.toFixed(3)} غ صافٍ) — له شاشته المستقلة.
        </p>
      )}
    </div>

    {/* حركة أوزان اليوم — القراءة اليومية، والسجل الأحدث خلف زر واحد. */}
    <div className="bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <b className="text-sm text-slate-900 sm:text-base">{showAllMovements ? 'آخر حركات الأوزان' : 'حركة أوزان اليوم'}</b>
        {movements.length > todayMovements.length && (
          <button onClick={() => setShowAllMovements(current => !current)} className="text-[11px] font-extrabold text-amber-700 underline">
            {showAllMovements ? 'اليوم فقط' : `عرض آخر ${movements.length} حركة`}
          </button>
        )}
      </div>

      {!shownMovements.length ? (
        <p className="mt-3 border border-dashed border-slate-300 p-6 text-center text-xs font-bold text-slate-500">لا توجد حركات أوزان اليوم.</p>
      ) : <>
        {/* Phone: one card per movement. Desktop: the table. */}
        <div className="mt-3 space-y-2 sm:hidden">
          {shownMovements.map(row => <div key={row.id} className={`border-r-4 p-2.5 ${row.status === 'reversed' ? 'border-slate-300 bg-slate-50 text-slate-400 line-through' : row.source === 'scrap_exchange' ? 'border-amber-400 bg-amber-50/50' : 'border-slate-300 bg-slate-50'}`}>
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">{sourceBadge(row)}{row.sourceNumber && <span className="font-mono text-[10px] text-slate-500">{row.sourceNumber}</span>}</div>
              <span className="text-[10px] text-slate-400">{row.date}</span>
            </div>
            <p className="mt-1.5 text-[11px] leading-4 text-slate-700">{row.description}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs font-black">
              <span className="text-slate-500">عيار {row.karat}</span>
              {row.inGrams > 0 && <span className="text-emerald-700">وارد {row.inGrams.toFixed(3)} غ</span>}
              {row.outGrams > 0 && <span className="text-rose-700">صادر {row.outGrams.toFixed(3)} غ</span>}
            </div>
          </div>)}
        </div>
        <div className="mt-3 hidden overflow-x-auto sm:block">
          <table className="w-full text-right text-xs">
            <thead><tr className="bg-amber-50 text-slate-700"><th className="p-2">التاريخ</th><th className="p-2">المصدر</th><th className="p-2">البيان</th><th className="p-2">العيار</th><th className="p-2">وارد</th><th className="p-2">صادر</th></tr></thead>
            <tbody>{shownMovements.map(row => <tr key={row.id} className={row.status === 'reversed' ? 'border-b text-slate-400 line-through' : row.source === 'scrap_exchange' ? 'border-b bg-amber-50/40' : 'border-b'}>
              <td className="whitespace-nowrap p-2">{row.date}</td>
              <td className="p-2">{sourceBadge(row)}{row.sourceNumber && <span className="mr-1 font-mono text-[10px] text-slate-500">{row.sourceNumber}</span>}</td>
              <td className="p-2">{row.description}</td>
              <td className="p-2">{row.karat}</td>
              <td className="p-2 font-bold text-emerald-700">{row.inGrams ? row.inGrams.toFixed(3) : '—'}</td>
              <td className="p-2 font-bold text-rose-700">{row.outGrams ? row.outGrams.toFixed(3) : '—'}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
    </div>

    {/* مدخلا الشاشتين المستقلتين — ليستا في القائمة الجانبية، فهذه هي الطريقة الوحيدة لفتحهما. */}
    <div className="grid gap-2 sm:grid-cols-2">
      {entryCard(onOpenCustody, <Scale className="h-5 w-5 text-amber-400" />, 'ذمم أوزان', 'وزن لنا أو علينا عند صائغ أو ملمّع أو عامل، مع كشف لكل شخص.')}
      {entryCard(onOpenUsedGold, <Recycle className="h-5 w-5 text-violet-400" />, 'كسر المقايضة', 'الذهب المستلم مقايضةً وتحويل ما يصلح منه إلى مخزون مستعمل.')}
    </div>

    {/* رصيد أوزان افتتاحي — نفس نقطة النهاية ونفس الحقول التي كانت قبل تبسيط الشاشة.
        الملاحظة داخل الورقة مقصودة: هذه الحركة تقيّد الوزن على طرف تجاري ولا تحرّك الرقم
        المعروض في الأعلى، وهي أكثر نقطة يسهل فيها سوء الفهم. */}
    {showOpening && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div className="max-h-[92dvh] w-full overflow-y-auto bg-white p-4 sm:max-w-sm sm:p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900 sm:text-base">رصيد أوزان افتتاحي</h3>
          <button onClick={() => { setShowOpening(false); setError(''); }} aria-label="إغلاق" className="p-1 text-slate-500"><X className="h-5 w-5" /></button>
        </div>

        <p className="mt-3 border-r-4 border-slate-300 bg-slate-50 p-2.5 text-[11px] font-bold leading-5 text-slate-600">
          يُسجَّل هذا الرصيد على <b className="text-slate-900">طرف تجاري</b> (عميل أو مورّد): وزن له علينا أو علينا له عند بدء العمل بالنظام. لا يزيد «الوزن الإجمالي» المعروض في الأعلى ولا ينقصه.
        </p>

        <select value={openingPartnerId} onChange={event => setOpeningPartnerId(event.target.value)} className="mt-3 w-full border p-2.5 text-sm">
          <option value="">اختر الطرف</option>
          {partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
        </select>
        {!partners.length && <p className="mt-1 text-[10px] font-bold text-slate-400">جارِ تحميل الأطراف…</p>}

        <select value={openingKarat} onChange={event => setOpeningKarat(event.target.value)} className="mt-2 w-full border p-2.5 text-sm">
          {GOLD_KARATS.map(value => <option key={value} value={value}>عيار {value}</option>)}
        </select>

        <input value={openingWeight} onChange={event => setOpeningWeight(event.target.value)} type="number" inputMode="decimal" step="0.001" placeholder="الوزن بالغرام" className="mt-2 w-full border p-2.5 text-sm" />

        <select value={openingDirection} onChange={event => setOpeningDirection(event.target.value as typeof openingDirection)} className="mt-2 w-full border p-2.5 text-sm">
          <option value="partner_owes_shop">عليه لنا (مدين بالوزن)</option>
          <option value="shop_owes_partner">لنا عليه (المحل مدين بالوزن)</option>
        </select>

        <input value={openingNote} onChange={event => setOpeningNote(event.target.value)} placeholder="ملاحظة (اختياري)" className="mt-2 w-full border p-2.5 text-sm" />

        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={() => void submitOpening()} className="flex flex-1 items-center justify-center gap-2 bg-amber-400 px-4 py-2.5 text-sm font-black text-slate-900 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}حفظ
          </button>
          <button onClick={() => { setShowOpening(false); setError(''); }} className="flex-1 bg-slate-100 px-4 py-2.5 text-sm font-bold">إلغاء</button>
        </div>
      </div>
    </div>}

    {/* التعديل اليدوي على ذهب المحل — صار حقيقياً بعد إضافة نقطة النهاية على مستوى الشركة.
        عدة عيارات في حركة واحدة لأن الإضافة الواقعية تأتي مختلطة، ولكل سطر ملاحظة نصية حرة
        هي توثيق فقط: لا تُنشئ شخصاً ولا عهدة ولا التزاماً على أحد. */}
    {showAdjust && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full flex-col bg-white sm:max-w-md">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 p-4">
          <h3 className="text-sm font-black text-slate-900 sm:text-base">إضافة / تعديل وزن يدوي</h3>
          <button onClick={() => { setShowAdjust(false); setError(''); }} aria-label="إغلاق" className="p-1 text-slate-500"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2">
            {([['increase', 'إضافة وزن'], ['decrease', 'خصم وزن']] as const).map(([value, label]) => (
              <button key={value} onClick={() => setAdjustDirection(value)}
                className={`h-11 rounded-sm border-2 text-xs font-black transition ${adjustDirection === value ? 'border-amber-400 bg-amber-50 text-slate-900' : 'border-slate-200 bg-white text-slate-600'}`}>
                {label}
              </button>
            ))}
          </div>

          {warehouses.length > 1 && (
            <select value={adjustWarehouseId} onChange={event => setAdjustWarehouseId(event.target.value)} className="mt-3 w-full border p-2.5 text-sm">
              {warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
            </select>
          )}

          {/* سطر لكل عيار — العيارات لا تُجمع في رقم واحد هنا كما لا تُجمع في أي مكان آخر. */}
          <div className="mt-3 space-y-2">
            {adjustLines.map((line, index) => (
              <div key={index} className="border-r-4 border-amber-400 bg-slate-50 p-2.5">
                <div className="flex items-center gap-2">
                  <select value={line.karat} onChange={event => setLine(index, { karat: event.target.value })} className="h-10 w-24 shrink-0 border bg-white px-2 text-sm font-bold">
                    {GOLD_KARATS.map(value => <option key={value} value={value}>عيار {value}</option>)}
                  </select>
                  <input value={line.weightGrams} onChange={event => setLine(index, { weightGrams: event.target.value.replace(/[^\d.]/g, '') })}
                    inputMode="decimal" dir="ltr" placeholder="0.000" className="h-10 min-w-0 flex-1 border bg-white px-2 text-left font-mono text-sm" />
                  {adjustLines.length > 1 && (
                    <button onClick={() => setAdjustLines(current => current.filter((_, position) => position !== index))} aria-label="حذف السطر" className="shrink-0 p-2 text-slate-400">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <input value={line.note} onChange={event => setLine(index, { note: event.target.value })}
                  placeholder="ملاحظة لهذا السطر (اختياري)" className="mt-2 h-10 w-full border bg-white px-2 text-sm" />
              </div>
            ))}
          </div>

          <button onClick={() => setAdjustLines(current => [...current, { karat: '21', weightGrams: '', note: '' }])}
            className="mt-2 flex items-center gap-1.5 text-xs font-extrabold text-amber-700">
            <Plus className="h-3.5 w-3.5" />إضافة عيار آخر
          </button>

          <input value={adjustNote} onChange={event => setAdjustNote(event.target.value)} placeholder="ملاحظة عامة (اختياري)" className="mt-3 h-11 w-full border px-3 text-sm" />

          <p className="mt-3 rounded-sm bg-slate-50 px-3 py-2 text-[11px] font-bold leading-5 text-slate-600">
            هذا تصحيح على ذهب المحل نفسه، بلا طرف تجاري. الملاحظات نصّ توثيقي فقط — لا تُنشئ عهدة ولا ذمّة على أحد. الحركة تُسجَّل كاملة ويمكن عكسها لاحقاً، ولا تُحذف.
          </p>
          {error && <p role="alert" className="mt-2 border-r-4 border-rose-500 bg-rose-50 p-2.5 text-xs font-bold text-rose-700">{error}</p>}
        </div>

        <div className="shrink-0 border-t border-slate-200 p-4">
          <button disabled={busy} onClick={() => void submitAdjustment()}
            className="flex h-11 w-full items-center justify-center gap-2 bg-amber-400 text-sm font-black text-slate-900 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{adjustDirection === 'increase' ? 'تأكيد الإضافة' : 'تأكيد الخصم'}
          </button>
        </div>
      </div>
    </div>}
  </div>;
};
