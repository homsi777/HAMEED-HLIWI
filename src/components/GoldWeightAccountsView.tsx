import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, Loader2, Package, PencilLine, Plus, Recycle, Scale, X } from 'lucide-react';
import { goldApi, GOLD_KARATS, type ApiGoldHoldings, type ApiGoldHoldingMovement } from '../services/goldApi';
import { partnersApi, type ApiPartner } from '../services/partnersApi';

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

type Props = {
  /** فتح شاشة «ذمم أوزان» — ليست في القائمة الجانبية، تُفتح من هنا فقط. */
  onOpenCustody: () => void;
  /** فتح شاشة «كسر المقايضة». */
  onOpenUsedGold: () => void;
  /** صلاحية gold_accounts.adjust — تُظهر زر التعديل اليدوي على إجمالي ذهب الشركة. */
  canAdjust?: boolean;
};

export const GoldWeightAccountsView: React.FC<Props> = ({ onOpenCustody, onOpenUsedGold, canAdjust = false }) => {
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
  const karats = useMemo(() => [...(holdings?.totals ?? [])].sort(KARAT_ORDER), [holdings]);

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

      {/* بطاقة واحدة: الإجمالي بخط كبير، وتحته مباشرة سطر لكل عيار — لا شيء غير ذلك. */}
      <div className="mt-3 rounded-sm bg-slate-900 p-4">
        <p className="text-center text-[11px] font-bold text-amber-400/80">الوزن الإجمالي</p>
        <p className="mt-1 text-center font-mono text-4xl font-black leading-none text-amber-400">{(holdings?.pureGoldTotalGrams ?? 0).toFixed(3)}</p>
        <p className="mt-1.5 text-center text-[11px] font-bold text-slate-400">غرام ذهب صافٍ (مكافئ عيار 24)</p>

        <div className="mt-4 border-t border-slate-700">
          {karats.map(row => (
            <div key={row.karat} className="flex items-center justify-between gap-3 border-b border-slate-800 py-3 last:border-b-0">
              <b className="text-base font-black text-white">عيار {row.karat}</b>
              <span className="shrink-0 font-mono text-xl font-black text-amber-400">
                {row.grams.toFixed(3)}<span className="mr-1.5 text-xs font-bold text-slate-400">غ</span>
              </span>
            </div>
          ))}
          {!karats.length && <p className="py-4 text-center text-xs font-bold text-slate-400">لا يوجد ذهب مسجّل في خزنة المحل بعد.</p>}
        </div>
      </div>
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

    {/* التعديل اليدوي على إجمالي ذهب الشركة: لا توجد بعد آلية خادم آمنة له. */}
    {showAdjust && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div className="max-h-[92dvh] w-full overflow-y-auto bg-white p-4 sm:max-w-md sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-black text-slate-900 sm:text-base">إضافة / تعديل وزن يدوي</h3>
          <button onClick={() => setShowAdjust(false)} aria-label="إغلاق" className="shrink-0 p-1 text-slate-500"><X className="h-5 w-5" /></button>
        </div>
        <p className="mt-3 flex items-start gap-2 border-r-4 border-amber-400 bg-amber-50 p-3 text-[11px] font-bold leading-5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          هذه الميزة غير مفعّلة بعد: لا توجد في الخادم حتى الآن حركة تعديل على إجمالي ذهب الشركة دون ربطها بطرف تجاري.
        </p>
        <div className="mt-3 space-y-2 text-[11px] font-bold leading-5 text-slate-600">
          <p>ما ينقص لتفعيل هذا الزر (مهمّة خادم مستقلة):</p>
          <ul className="mr-4 list-disc space-y-1">
            <li>حركة تعديل على حساب المحل نفسه (kind = company) بلا طرف، تقبل وزناً إجمالياً وأسطر ملاحظات نصية فقط.</li>
            <li>ربط فواتير الشراء بدفتر الذهب، لأن إجمالي ذهب الشركة اليوم لا يزيد بالشراء إطلاقاً.</li>
          </ul>
        </div>
        <button onClick={() => setShowAdjust(false)} className="mt-4 h-11 w-full bg-slate-100 text-sm font-black text-slate-700">إغلاق</button>
      </div>
    </div>}
  </div>;
};
