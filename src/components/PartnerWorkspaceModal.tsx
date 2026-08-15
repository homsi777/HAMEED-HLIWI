import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { partnersApi, type ApiPartner, type PartnerWorkspace } from '../services/partnersApi';
import type { ApiGoldBalance } from '../services/goldApi';

// TASK 17 §31–§38: what opens when a manager taps a customer card.
//
// §32 draws the boundary: this is a workspace, not TASK 18 Reports. It shows the authoritative
// balance, the outstanding weight custody, and the most recent handful of documents — enough to
// understand an account in seconds. No analytics, no profit, no cost.
//
// §26 keeps the existing visual identity: the same slate/amber palette, the same rounded-sm
// surfaces and RTL edge indicators used across the app. Nothing here is a new design language.

const money = (value: number) => `$ ${Math.abs(value).toFixed(2)}`;
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('ar-EG') : '—';

// §24: positive means the partner owes the shop, matching the subledger the balance comes from.
const balanceTone = (balance: number) => balance > 0 ? 'text-rose-700' : balance < 0 ? 'text-emerald-700' : 'text-slate-400';
const balanceWords = (balance: number) => balance > 0 ? `لنا عليه ${money(balance)}` : balance < 0 ? `له علينا ${money(balance)}` : 'خالص';

const Section = ({ title, count, children }: { title: string; count: number; children: React.ReactNode }) => (
  <section className="space-y-1.5">
    <h4 className="flex items-center justify-between text-[11px] font-black text-slate-700">
      <span>{title}</span>
      <span className="font-mono text-[10px] font-bold text-slate-400">{count}</span>
    </h4>
    {count === 0 ? <p className="rounded-sm bg-slate-50 px-2.5 py-2 text-[11px] font-bold text-slate-400">لا توجد حركات</p> : children}
  </section>
);

// A document row. The edge colour is the same vocabulary the rest of the app uses, and red stays
// reserved for money still owed — never for provenance or decoration.
const Row = ({ edge, title, date, right, note }: { edge: string; title: string; date: string; right: React.ReactNode; note?: string }) => (
  <div className={`flex items-center justify-between gap-2 border-r-4 ${edge} bg-white px-2.5 py-2 shadow-sm`}>
    <div className="min-w-0">
      <p className="truncate font-mono text-[11px] font-black text-slate-800">{title}</p>
      <p className="text-[10px] font-bold text-slate-400">{day(date)}{note ? ` · ${note}` : ''}</p>
    </div>
    <div className="shrink-0 text-left">{right}</div>
  </div>
);

export const PartnerWorkspaceModal = ({ partner, custody, onClose }: { partner: ApiPartner; custody: ApiGoldBalance[]; onClose: () => void }) => {
  const [data, setData] = useState<PartnerWorkspace | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    partnersApi.workspace(partner.id)
      .then(result => { if (!cancelled) setData(result); })
      .catch((failure: any) => { if (!cancelled) setError(failure?.message || 'تعذر تحميل بيانات الجهة.'); });
    return () => { cancelled = true; };
  }, [partner.id]);

  const balance = data?.financial.balanceUSD ?? partner.balanceUSD;

  return (
    <div onClick={onClose} className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div onClick={event => event.stopPropagation()} className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-lg border border-slate-200 bg-slate-50 shadow-2xl sm:rounded-sm">

        <header className="flex items-start justify-between gap-2 border-b border-slate-200 bg-white px-3 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-black text-slate-900">{partner.name}</h3>
            <p className="truncate text-[11px] font-bold text-slate-500">
              {partner.phone ? <span dir="ltr" className="font-mono">{partner.phone}</span> : 'بلا رقم هاتف'}
              {partner.address ? ` · ${partner.address}` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="إغلاق" className="shrink-0 rounded-sm border border-slate-200 bg-white p-1.5 text-slate-600"><X className="h-4 w-4" /></button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">

          {/* §34: the headline is the subledger balance, not a sum of the rows below — those are
              only the most recent few and would understate an older account. */}
          <div className="rounded-sm border border-slate-200 bg-white px-3 py-2.5">
            <p className="text-[10px] font-bold text-slate-400">الرصيد المالي</p>
            <p className={`font-mono text-lg font-black ${balanceTone(balance)}`}>{balanceWords(balance)}</p>
            <p className="mt-0.5 text-[10px] font-bold text-slate-400">آخر حركة: {day(data?.financial.lastActivityAt ?? partner.lastActivityAt)}</p>
          </div>

          {/* §23/§38: custody is stated only where a relationship exists, per karat, never merged. */}
          <div className="rounded-sm border border-slate-200 bg-white px-3 py-2.5">
            <p className="mb-1 text-[10px] font-bold text-slate-400">ذمة الأوزان</p>
            {!custody.length
              ? <p className="text-[11px] font-bold text-slate-400">لا توجد ذمة أوزان</p>
              : <div className="space-y-1">{custody.map(row => (
                  <div key={row.karat} className="flex items-center justify-between font-mono text-[11px] font-black">
                    <span className="text-slate-500">عيار {row.karat}</span>
                    <span className={row.grams > 0 ? 'text-amber-800' : 'text-rose-700'}>{Math.abs(row.grams).toFixed(3)} غ {row.grams > 0 ? 'عليه' : 'له'}</span>
                  </div>))}
                </div>}
          </div>

          {error && <p className="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">{error}</p>}
          {!data && !error && <p className="px-1 text-[11px] font-bold text-slate-400">جارٍ التحميل…</p>}

          {data && <>
            <Section title="أحدث المبيعات" count={data.sales.length}>
              <div className="space-y-1.5">{data.sales.map(row => (
                <Row key={row.id} edge={row.status === 'cancelled' ? 'border-r-slate-300' : row.remainingUSD > 0 ? 'border-r-rose-500' : 'border-r-emerald-500'}
                     title={row.number} date={row.date} note={row.status === 'cancelled' ? 'ملغاة' : row.remainingUSD > 0 ? `متبقٍ ${money(row.remainingUSD)}` : 'مسددة'}
                     right={<span className="font-mono text-[11px] font-black text-slate-800">{money(row.totalUSD)}</span>} />))}
              </div>
            </Section>

            <Section title="أحدث المشتريات" count={data.purchases.length}>
              <div className="space-y-1.5">{data.purchases.map(row => (
                <Row key={row.id} edge={row.status === 'cancelled' ? 'border-r-slate-300' : row.remainingUSD > 0 ? 'border-r-amber-500' : 'border-r-emerald-500'}
                     title={row.number} date={row.date} note={row.status === 'cancelled' ? 'ملغاة' : row.remainingUSD > 0 ? `متبقٍ ${money(row.remainingUSD)}` : 'مسددة'}
                     right={<span className="font-mono text-[11px] font-black text-slate-800">{money(row.totalUSD)}</span>} />))}
              </div>
            </Section>

            <Section title="السندات" count={data.vouchers.length}>
              <div className="space-y-1.5">{data.vouchers.map(row => (
                <Row key={row.id} edge={row.type === 'receipt' ? 'border-r-emerald-500' : 'border-r-sky-500'}
                     title={row.number} date={row.date} note={row.type === 'receipt' ? 'سند قبض' : 'سند دفع'}
                     right={<span className="font-mono text-[11px] font-black text-slate-800">{row.currency === 'USD' ? money(row.amountUSD) : `${row.amount.toFixed(0)} ل.س`}</span>} />))}
              </div>
            </Section>

            <Section title="المرتجعات" count={data.returns.length}>
              <div className="space-y-1.5">{data.returns.map(row => (
                <Row key={row.id} edge="border-r-violet-500" title={row.number} date={row.date}
                     note={row.type === 'sales_return' ? 'مرتجع مبيعات' : 'مرتجع مشتريات'}
                     right={<span className="font-mono text-[11px] font-black text-slate-800">{money(row.totalUSD)}</span>} />))}
              </div>
            </Section>

            <Section title="آخر حركات الحساب" count={data.movements.length}>
              <div className="space-y-1.5">{data.movements.map(row => (
                <Row key={row.id} edge={row.debitUSD > 0 ? 'border-r-rose-400' : 'border-r-emerald-400'}
                     title={row.documentNumber || row.description} date={row.date}
                     right={<span className={`font-mono text-[11px] font-black ${row.debitUSD > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{row.debitUSD > 0 ? `+${money(row.debitUSD)}` : `−${money(row.creditUSD)}`}</span>} />))}
              </div>
            </Section>
          </>}
        </div>
      </div>
    </div>
  );
};
