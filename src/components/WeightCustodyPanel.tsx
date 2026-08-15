import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Scale, Search, X, Loader2, AlertTriangle, UserPlus, ArrowUpRight, ArrowDownLeft, CheckCircle2, Users } from 'lucide-react';
import { goldApi, type CustodyCard, type CustodyPersonDetail, type CustodyPersonRef } from '../services/goldApi';

const grams = (value: number) => `${value.toFixed(3)} غ`;
const dateTime = (value: string) => new Date(value).toLocaleString('ar-SY', { hour12: false });
const field = 'h-11 w-full rounded-sm border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none transition focus:border-amber-400';
const KARATS = ['24', '22', '21', '18', '14'];
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

type PersonChoice = { custodyPersonId?: string; partnerId?: string; name?: string; label: string; hint?: string };

/**
 * ذمم الأوزان — the weight the shop entrusted to someone and expects back.
 *
 * The person may be an existing custody person, an existing partner of any role, or a name
 * typed on the spot. Nothing here creates a Customer, and every total comes from the server.
 */
export const WeightCustodyPanel: React.FC<{ warehouseId?: string }> = ({ warehouseId }) => {
  const [cards, setCards] = useState<CustodyCard[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [includeSettled, setIncludeSettled] = useState(false);
  const [form, setForm] = useState<'hand_out' | 'receive' | null>(null);
  const [openPerson, setOpenPerson] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const result = await goldApi.custodyBalances(includeSettled ? { includeSettled: 'true' } : {}); setCards(result.people); setCanManage(result.canManage); setError(''); }
    catch (reason: any) { setError(reason?.message || 'تعذر تحميل ذمم الأوزان.'); }
    finally { setLoading(false); }
  }, [includeSettled]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <b className="flex items-center gap-2 text-sm text-slate-900 sm:text-base">
          <Scale className="h-4 w-4 shrink-0 text-amber-600" />ذمم الأوزان — عهدة لدى أشخاص
        </b>
        <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
          <input type="checkbox" checked={includeSettled} onChange={event => setIncludeSettled(event.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
          إظهار المسدّدة
        </label>
      </div>
      <p className="mt-1 text-[11px] font-medium leading-5 text-slate-500">
        وزن سلّمته لصائغ أو ملمّع أو عامل ليعيده لاحقاً. الشخص هنا ليس زبوناً — اكتب اسمه مباشرة دون إنشاء عميل.
      </p>

      {canManage && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => setForm('hand_out')} className="flex h-11 items-center justify-center gap-1.5 rounded-sm bg-slate-900 text-xs font-black text-amber-400 transition active:scale-[.98]">
            <ArrowUpRight className="h-4 w-4" />تسليم وزن
          </button>
          <button onClick={() => setForm('receive')} className="flex h-11 items-center justify-center gap-1.5 rounded-sm border-2 border-slate-300 bg-white text-xs font-extrabold text-slate-700 transition active:scale-[.98]">
            <ArrowDownLeft className="h-4 w-4" />استلام وزن
          </button>
        </div>
      )}

      {error && <p role="alert" className="mt-2 flex items-start gap-2 rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}

      {loading ? (
        <div className="mt-3 grid place-items-center p-6 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : !cards.length ? (
        <p className="mt-3 border border-dashed border-slate-300 p-6 text-center text-xs font-bold text-slate-500">
          {includeSettled ? 'لا توجد ذمم أوزان مسجّلة بعد.' : 'لا توجد أوزان لدى أشخاص حالياً.'}
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(card => (
            <button key={card.personId} onClick={() => setOpenPerson(card.personId)}
              className={`border-r-4 p-3 text-right transition active:scale-[.995] ${card.settled ? 'border-slate-300 bg-slate-50' : 'border-amber-400 bg-amber-50/40'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <b className="block truncate text-xs text-slate-900">{card.name}</b>
                  {card.phone && <span className="block font-mono text-[10px] text-slate-500">{card.phone}</span>}
                </div>
                {card.settled
                  ? <span className="shrink-0 rounded-sm bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black text-emerald-700">مسدّدة</span>
                  : <span className="shrink-0 rounded-sm bg-amber-100 px-1.5 py-0.5 text-[9px] font-black text-amber-800">عهدة قائمة</span>}
              </div>
              {/* Each karat is its own physical obligation and is never merged into one figure. */}
              <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
                {card.balances.map(row => (
                  <div key={row.karat} className="text-[11px] font-bold">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">عيار {row.karat}</span>
                      <span className={`font-mono text-sm font-black ${Math.abs(row.outstandingGrams) < 0.0005 ? 'text-slate-400' : 'text-amber-800'}`}>{grams(row.outstandingGrams)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-medium text-slate-400">
                      <span>سلمنا له {row.handedOutGrams.toFixed(3)}</span>
                      <span>استلمنا منه {row.receivedBackGrams.toFixed(3)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] font-black text-slate-500">المتبقي لنا</p>
            </button>
          ))}
        </div>
      )}

      {form && <MovementSheet kind={form} warehouseId={warehouseId} onClose={() => setForm(null)} onDone={async () => { setForm(null); await load(); }} />}
      {openPerson && <PersonSheet personId={openPerson} onClose={() => setOpenPerson(null)} />}
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

/** Type to search; if nothing matches, one tap turns what you typed into the person. */
const PersonPicker: React.FC<{ value: PersonChoice | null; onChange: (choice: PersonChoice | null) => void }> = ({ value, onChange }) => {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<{ people: CustodyPersonRef[]; partners: CustodyPersonRef[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (value) return;
    if (timer.current) clearTimeout(timer.current);
    const needle = term.trim();
    if (needle.length < 2) { setResults(null); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try { const found = await goldApi.custodySearch(needle); setResults({ people: found.people, partners: found.partners }); }
      catch { setResults({ people: [], partners: [] }); }
      finally { setSearching(false); }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [term, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-sm border-2 border-amber-400 bg-amber-50 px-3 py-2.5">
        <div className="min-w-0">
          <b className="block truncate text-sm text-slate-900">{value.label}</b>
          {value.hint && <span className="block text-[10px] font-bold text-slate-500">{value.hint}</span>}
        </div>
        <button onClick={() => { onChange(null); setTerm(''); setResults(null); }} className="shrink-0 rounded-sm p-1.5 text-slate-400 transition hover:text-rose-600" aria-label="تغيير الشخص"><X className="h-4 w-4" /></button>
      </div>
    );
  }

  const exact = results && [...results.people, ...results.partners].some(row => row.name.trim() === term.trim());
  return (
    <div>
      <span className="relative block">
        <Search className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
        <input autoFocus value={term} onChange={event => setTerm(event.target.value)} placeholder="ابحث عن شخص أو اكتب اسماً جديداً..."
          className={`${field} pr-9`} />
        {searching && <Loader2 className="absolute left-3 top-3.5 h-4 w-4 animate-spin text-slate-300" />}
      </span>

      {results && (
        <div className="mt-1.5 max-h-56 overflow-y-auto rounded-sm border-2 border-slate-200">
          {results.people.map(row => (
            <button key={`p-${row.id}`} onClick={() => onChange({ custodyPersonId: row.id, label: row.name, hint: row.partnerName ? `مرتبط بـ ${row.partnerName}` : 'شخص ذمم أوزان' })}
              className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 text-right transition hover:bg-amber-50">
              <span className="min-w-0"><b className="block truncate text-sm text-slate-900">{row.name}</b><span className="text-[10px] font-bold text-slate-500">شخص ذمم أوزان</span></span>
              <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </button>
          ))}
          {results.partners.map(row => (
            <button key={`c-${row.id}`} onClick={() => onChange({ partnerId: row.id, label: row.name, hint: row.partnerType === 'supplier' ? 'مورّد موجود' : row.partnerType === 'both' ? 'عميل ومورّد' : 'عميل موجود' })}
              className="flex w-full items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 text-right transition hover:bg-amber-50">
              <span className="min-w-0"><b className="block truncate text-sm text-slate-900">{row.name}</b><span className="text-[10px] font-bold text-slate-500">{row.partnerType === 'supplier' ? 'مورّد موجود' : 'عميل موجود'}</span></span>
              <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </button>
          ))}
          {/* One tap, no wizard: what was typed becomes the person. */}
          {term.trim().length >= 2 && !exact && (
            <button onClick={() => onChange({ name: term.trim(), label: term.trim(), hint: 'شخص جديد' })}
              className="flex w-full items-center gap-2 bg-slate-50 px-3 py-3 text-right font-extrabold text-slate-900 transition hover:bg-amber-50">
              <UserPlus className="h-4 w-4 shrink-0 text-amber-600" />
              <span className="truncate text-xs">استخدام «{term.trim()}» كشخص جديد</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const MovementSheet: React.FC<{ kind: 'hand_out' | 'receive'; warehouseId?: string; onClose: () => void; onDone: () => Promise<void> }> = ({ kind, warehouseId, onClose, onDone }) => {
  const [person, setPerson] = useState<PersonChoice | null>(null);
  const [karat, setKarat] = useState('21');
  const [weightGrams, setWeightGrams] = useState('');
  const [note, setNote] = useState('');
  const [allowReverse, setAllowReverse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const invalid = !person || !(Number(weightGrams) > 0);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const input = {
        person: { custodyPersonId: person!.custodyPersonId, partnerId: person!.partnerId, name: person!.name },
        karat, weightGrams: Number(weightGrams).toFixed(3), warehouseId, note: note.trim() || undefined,
        allowReverseBalance: allowReverse || undefined, idempotencyKey: uuid(),
      };
      if (kind === 'hand_out') await goldApi.custodyHandOut(input); else await goldApi.custodyReceive(input);
      await onDone();
    } catch (reason: any) { setError(reason?.message || 'تعذر تسجيل الحركة.'); setBusy(false); }
  };

  return (
    <Sheet title={kind === 'hand_out' ? 'تسليم وزن لشخص' : 'استلام وزن من شخص'} onClose={onClose}>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <label className="block text-xs font-extrabold text-slate-700">الشخص
          <div className="mt-1.5"><PersonPicker value={person} onChange={setPerson} /></div>
        </label>

        <label className="block text-xs font-extrabold text-slate-700">العيار
          <div className="mt-1.5 grid grid-cols-5 gap-1">
            {KARATS.map(entry => (
              <button key={entry} onClick={() => setKarat(entry)}
                className={`h-10 rounded-sm border-2 text-[11px] font-black transition ${karat === entry ? 'border-amber-400 bg-amber-50 text-slate-900' : 'border-slate-200 bg-white text-slate-500'}`}>
                {entry}
              </button>
            ))}
          </div>
        </label>

        <label className="block text-xs font-extrabold text-slate-700">الوزن بالغرام
          <input inputMode="decimal" dir="ltr" value={weightGrams} onChange={event => setWeightGrams(event.target.value.replace(/[^\d.]/g, ''))}
            placeholder="0.000" className={`${field} mt-1.5 text-left font-mono`} />
        </label>

        <label className="block text-xs font-extrabold text-slate-700">ملاحظة (اختياري)
          <input value={note} onChange={event => setNote(event.target.value)} placeholder="مثال: تلميع أساور" className={`${field} mt-1.5`} />
        </label>

        {kind === 'receive' && (
          <label className="flex items-center gap-2 rounded-sm bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-600">
            <input type="checkbox" checked={allowReverse} onChange={event => setAllowReverse(event.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
            السماح باستلام أكثر من العهدة القائمة
          </label>
        )}

        <p className="rounded-sm bg-slate-50 px-3 py-2 text-[11px] font-bold leading-5 text-slate-600">
          هذه عهدة وزن فقط: لا سند ولا قيد مالي ولا محاسبي، ولا يُنشأ عميل تجاري.
        </p>
        {error && <p role="alert" className="rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700">{error}</p>}
      </div>
      <div className="shrink-0 border-t-2 border-slate-200 p-3">
        <button disabled={busy || invalid} onClick={() => void submit()}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-sm bg-amber-400 text-xs font-black text-slate-900 transition active:scale-[.98] disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {kind === 'hand_out' ? 'تأكيد التسليم' : 'تأكيد الاستلام'}
        </button>
      </div>
    </Sheet>
  );
};

const PersonSheet: React.FC<{ personId: string; onClose: () => void }> = ({ personId, onClose }) => {
  const [detail, setDetail] = useState<CustodyPersonDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void goldApi.custodyPerson(personId).then(setDetail).catch((reason: any) => setError(reason?.message || 'تعذر تحميل الشخص.')); }, [personId]);

  return (
    <Sheet title={detail?.name ?? 'جارِ التحميل...'} onClose={onClose}>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {error && <p role="alert" className="rounded-sm border-2 border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-700">{error}</p>}
        {!detail ? <div className="grid place-items-center py-10 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div> : <>
          {(detail.phone || detail.note || detail.partnerName) && (
            <div className="rounded-sm bg-slate-50 px-3 py-2 text-[11px] font-bold leading-5 text-slate-600">
              {detail.phone && <p className="font-mono">{detail.phone}</p>}
              {detail.partnerName && <p>مرتبط بسجل تجاري: {detail.partnerName}</p>}
              {detail.note && <p>{detail.note}</p>}
            </div>
          )}

          <div className="rounded-sm border-2 border-slate-900 bg-slate-900 p-3">
            <p className="text-[11px] font-bold text-amber-400/80">المتبقي لنا</p>
            <div className="mt-1.5 space-y-1">
              {detail.balances.map(row => (
                <div key={row.karat} className="flex items-center justify-between text-xs font-black text-white">
                  <span>عيار {row.karat}</span>
                  <span className="font-mono text-amber-400">{grams(row.outstandingGrams)}</span>
                </div>
              ))}
              {!detail.balances.length && <p className="text-[11px] font-bold text-slate-400">لا توجد حركات ضمن نطاقك.</p>}
            </div>
            {detail.settled && <p className="mt-2 rounded-sm bg-emerald-500/20 px-2 py-1 text-center text-[10px] font-black text-emerald-300">مسدّدة بالكامل</p>}
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-black text-slate-700">حركة العهدة</p>
            <div className="space-y-1">
              {detail.movements.map(row => (
                <div key={row.id} className={`flex items-center justify-between gap-2 border-r-4 px-2.5 py-2 text-[11px] ${row.status === 'reversed' ? 'border-slate-300 bg-slate-50 text-slate-400 line-through' : row.type === 'handed_out' ? 'border-amber-400 bg-amber-50/50' : 'border-emerald-400 bg-emerald-50/50'}`}>
                  <div className="min-w-0">
                    <b className="block text-slate-900">{row.type === 'handed_out' ? 'سلمنا له' : 'استلمنا منه'} — عيار {row.karat}</b>
                    <span className="block text-[10px] text-slate-500">{dateTime(row.occurredAt)} · {row.warehouseName ?? '—'} · {row.actor}</span>
                    {row.note && <span className="block text-[10px] text-slate-500">{row.note}</span>}
                  </div>
                  <span className="shrink-0 font-mono text-sm font-black text-slate-900">{grams(row.weightGrams)}</span>
                </div>
              ))}
              {!detail.movements.length && <p className="border border-dashed border-slate-300 p-4 text-center text-[11px] font-bold text-slate-500">لا توجد حركات ضمن نطاقك.</p>}
            </div>
          </div>
        </>}
      </div>
    </Sheet>
  );
};
