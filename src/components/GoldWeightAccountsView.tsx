import React, { useEffect, useMemo, useState } from 'react';
import { Coins, Package, Plus, Printer, RotateCcw, Shuffle, X } from 'lucide-react';
import { goldApi, equivalentWeight, GOLD_KARATS, type ApiGoldHoldings, type ApiGoldHoldingMovement, type ApiGoldPartnerSummary, type ApiGoldReconciliation, type ApiGoldStatement, type ApiGoldStatementRow } from '../services/goldApi';
import { partnersApi, type ApiPartner } from '../services/partnersApi';
import { inventoryApi } from '../services/inventoryApi';
import { UsedGoldPanel } from './UsedGoldPanel';
import { WeightCustodyPanel } from './WeightCustodyPanel';

// ذمم الأوزان: a weight is only meaningful together with its karat, so every balance is
// listed per karat and never merged. Positive means the partner owes the shop.
//
// Layout note: a phone gets stacked cards and a full-height sheet, a desktop gets the
// tables. The two are the same data in the shape each screen can actually read — a seven
// column ledger squeezed into 390px is unreadable however small the type gets.
const grams = (value: number) => `${Math.abs(value).toFixed(3)} غ`;
const balanceLabel = (value: number) => (value >= 0 ? 'المتبقي لديه ' : 'المتبقي لنا ');
const balanceTone = (value: number) => (value >= 0 ? 'text-emerald-700' : 'text-rose-700');

export const GoldWeightAccountsView: React.FC = () => {
  const [summaries, setSummaries] = useState<ApiGoldPartnerSummary[]>([]);
  const [partners, setPartners] = useState<ApiPartner[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [reconciliation, setReconciliation] = useState<ApiGoldReconciliation | null>(null);
  const [holdings, setHoldings] = useState<ApiGoldHoldings | null>(null);
  const [statement, setStatement] = useState<ApiGoldStatement | null>(null);
  const [showReconciliation, setShowReconciliation] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [showForm, setShowForm] = useState<null | 'receipt' | 'payment' | 'conversion' | 'opening'>(null);
  const [formPartnerId, setFormPartnerId] = useState('');
  const [karat, setKarat] = useState<string>('21');
  const [weight, setWeight] = useState('');
  const [toKarat, setToKarat] = useState<string>('18');
  const [toWeight, setToWeight] = useState('');
  const [direction, setDirection] = useState<'partner_owes_shop' | 'shop_owes_partner'>('partner_owes_shop');
  const [note, setNote] = useState('');

  const refresh = async () => {
    try {
      const [balances, partnerList, reconcile, physical] = await Promise.all([
        goldApi.partnerBalances(),
        partnersApi.list({ page: 1, limit: 500 }),
        goldApi.reconciliation(),
        goldApi.holdings({ limit: 50 }),
      ]);
      setSummaries(balances); setPartners(partnerList.items); setReconciliation(reconcile); setHoldings(physical);
    } catch (reason: any) { setError(reason?.message || 'تعذر تحميل ذمم الأوزان من الخادم.'); }
  };
  useEffect(() => { void refresh(); void inventoryApi.warehouses().then(rows => setWarehouseId(current => current || rows[0]?.id || '')).catch(() => undefined); }, []);

  const openStatement = async (partnerId: string) => {
    setError('');
    try { setStatement(await goldApi.statement(partnerId, { limit: 200 })); }
    catch (reason: any) { setError(reason?.message || 'تعذر عرض كشف الأوزان.'); }
  };

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try {
      await action();
      await refresh();
      if (statement) setStatement(await goldApi.statement(statement.partner.id, { limit: 200 }));
      setShowForm(null); setWeight(''); setToWeight(''); setNote('');
    } catch (reason: any) { setError(reason?.message || 'تعذر تنفيذ حركة الوزن.'); }
    finally { setBusy(false); }
  };

  const submit = () => {
    if (!formPartnerId) { setError('اختر الطرف أولاً.'); return; }
    const idempotencyKey = crypto.randomUUID();
    if (showForm === 'conversion') return void run(() => goldApi.conversion({ partnerId: formPartnerId, fromKarat: karat, toKarat, fromWeightGrams: weight, toWeightGrams: toWeight, note: note || undefined, idempotencyKey }));
    if (showForm === 'opening') return void run(() => goldApi.opening({ partnerId: formPartnerId, karat, weightGrams: weight, direction, note: note || undefined, idempotencyKey }));
    const input = { partnerId: formPartnerId, karat, weightGrams: weight, warehouseId: warehouseId || undefined, note: note || undefined, idempotencyKey };
    return void run(() => (showForm === 'receipt' ? goldApi.receipt(input) : goldApi.payment(input)));
  };

  // Suggested only — the operator still confirms the weight that was actually agreed.
  const suggestedToWeight = useMemo(() => (Number(weight) > 0 ? String(equivalentWeight(Number(weight), karat, toKarat)) : ''), [weight, karat, toKarat]);

  const printStatement = () => {
    if (!statement) return;
    const rows = statement.rows.map(row => `<tr><td>${row.date}</td><td>${row.transactionNumber}</td><td>${row.description}</td><td>${row.karat}</td><td>${row.debitGrams ? row.debitGrams.toFixed(3) : ''}</td><td>${row.creditGrams ? row.creditGrams.toFixed(3) : ''}</td><td>${row.runningBalanceGrams.toFixed(3)}</td></tr>`).join('');
    const balances = statement.balances.map(row => `<b>عيار ${row.karat}: ${balanceLabel(row.grams)}${grams(row.grams)}</b>`).join(' — ');
    const win = window.open('', '_blank');
    if (!win) return;
    win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>كشف أوزان — ${statement.partner.name}</title><style>body{font-family:system-ui,sans-serif;padding:24px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:right}th{background:#fef3c7}h1{font-size:18px}</style></head><body><h1>كشف ذمم الأوزان — ${statement.partner.name}</h1><p>${balances || 'لا يوجد رصيد أوزان'}</p><table><thead><tr><th>التاريخ</th><th>رقم الحركة</th><th>البيان</th><th>العيار</th><th>وارد (غ)</th><th>صادر (غ)</th><th>الرصيد (غ)</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
    win.document.close(); win.focus(); win.print();
  };

  const actionButton = (kind: 'receipt' | 'payment' | 'conversion' | 'opening', label: string, icon: React.ReactNode, className: string) => (
    <button onClick={() => { setShowForm(kind); setError(''); if (statement) setFormPartnerId(statement.partner.id); }} className={className}>{icon} {label}</button>
  );

  const sourceBadge = (row: ApiGoldHoldingMovement) => (row.source === 'scrap_exchange'
    ? <span className="rounded-sm bg-amber-200 px-1.5 py-0.5 text-[10px] font-black text-amber-900">كسر مقايضة</span>
    : <span className="rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">حركة يدوية</span>);

  const statementRowTone = (row: ApiGoldStatementRow) => (row.status === 'reversed' ? 'text-slate-400 line-through' : '');

  return <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-black text-slate-900 sm:text-xl"><Coins className="h-5 w-5 shrink-0 text-amber-600" />ذمم الأوزان</h2>
        <p className="mt-0.5 text-[11px] leading-4 text-slate-500 sm:text-xs">دفتر أوزان الذهب بالغرام وبالعيار، مرتبط بفواتير البيع والمرتجعات.</p>
      </div>
      {/* Two rows of two on a phone: four buttons in one row is what crushed this header. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
        {actionButton('receipt', 'استلام ذهب', <Plus className="inline h-4 w-4" />, 'bg-amber-400 px-3 py-2.5 text-xs font-black text-slate-900 sm:py-2 sm:text-sm')}
        {actionButton('payment', 'تسليم ذهب', <RotateCcw className="inline h-4 w-4" />, 'bg-slate-900 px-3 py-2.5 text-xs font-black text-white sm:py-2 sm:text-sm')}
        {actionButton('conversion', 'تحويل عيار', <Shuffle className="inline h-4 w-4" />, 'bg-slate-100 px-3 py-2.5 text-xs font-black text-slate-700 sm:py-2 sm:text-sm')}
        {actionButton('opening', 'رصيد افتتاحي', <Plus className="inline h-4 w-4" />, 'bg-slate-100 px-3 py-2.5 text-xs font-black text-slate-700 sm:py-2 sm:text-sm')}
      </div>
    </div>

    {error && <div className="border-r-4 border-rose-500 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</div>}

    {/* ذمم الأوزان بالمعنى الحقيقي: عهدة وزن لدى أشخاص، والشخص ليس بالضرورة عميلاً. */}
    <WeightCustodyPanel warehouseId={warehouseId || undefined} />

    {/* كسر المقايضة القابل للتحويل — منفصل عن ذمم الأوزان ولا يمسّها. */}
    <UsedGoldPanel onConverted={() => { void refresh(); }} />

    {/* الذهب الموجود فعلاً في المحل — منفصل تماماً عن ذمم الأوزان: هذا معدن في الخزنة، لا التزام على أحد. */}
    {holdings && holdings.totals.length > 0 && <div className="bg-white p-3 shadow-sm sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <b className="flex items-center gap-2 text-sm text-slate-900 sm:text-base"><Package className="h-4 w-4 shrink-0 text-amber-600" />الذهب الموجود فعلياً في المحل</b>
        <span className="text-[11px] text-slate-400">إجمالي {holdings.pureGoldTotalGrams.toFixed(3)} غ ذهب صافٍ</span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {holdings.accounts.map(account => <div key={account.id} className="border-r-4 border-amber-400 bg-slate-50 p-3">
          <b className="block text-xs text-slate-900">{account.name}</b>
          {account.balances.map(row => <div key={row.karat} className="mt-1">
            <span className="font-mono text-sm font-black text-amber-800">{row.grams.toFixed(3)} غ</span>
            <span className="mr-1 text-xs font-bold text-slate-500">عيار {row.karat}</span>
            {row.scrapGrams > 0 && <span className="mt-1 block w-fit rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-black text-amber-900">منها {row.scrapGrams.toFixed(3)} غ كسر مقايضة</span>}
          </div>)}
        </div>)}
      </div>

      {/* Phone: one card per movement. Desktop: the table. */}
      <div className="mt-3 space-y-2 sm:hidden">
        {holdings.movements.map(row => <div key={row.id} className={`border-r-4 p-2.5 ${row.status === 'reversed' ? 'border-slate-300 bg-slate-50 text-slate-400 line-through' : row.source === 'scrap_exchange' ? 'border-amber-400 bg-amber-50/50' : 'border-slate-300 bg-slate-50'}`}>
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
          <tbody>{holdings.movements.map(row => <tr key={row.id} className={row.status === 'reversed' ? 'border-b text-slate-400 line-through' : row.source === 'scrap_exchange' ? 'border-b bg-amber-50/40' : 'border-b'}>
            <td className="whitespace-nowrap p-2">{row.date}</td>
            <td className="p-2">{sourceBadge(row)}{row.sourceNumber && <span className="mr-1 font-mono text-[10px] text-slate-500">{row.sourceNumber}</span>}</td>
            <td className="p-2">{row.description}</td>
            <td className="p-2">{row.karat}</td>
            <td className="p-2 font-bold text-emerald-700">{row.inGrams ? row.inGrams.toFixed(3) : '—'}</td>
            <td className="p-2 font-bold text-rose-700">{row.outGrams ? row.outGrams.toFixed(3) : '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-slate-400">الذهب المستلم مقايضةً يدخل خزنة الفرع ولا يُضاف كقطعة قابلة للبيع؛ تحويله إلى مخزون يحتاج قراراً صريحاً.</p>
    </div>}

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {summaries.map(account => <button key={account.accountId} onClick={() => account.partnerId && openStatement(account.partnerId)} className="border-r-4 border-amber-400 bg-white p-3 text-right shadow-sm sm:p-4">
        <b className="block text-sm text-slate-900">{account.name}</b>
        {account.balances.map(row => <span key={row.karat} className={`mt-1 block text-xs ${balanceTone(row.grams)}`}>
          عيار {row.karat}: {balanceLabel(row.grams)}{grams(row.grams)}
        </span>)}
        <span className="mt-2 block text-[11px] text-slate-400">ما يعادل {account.pureGoldTotalGrams.toFixed(3)} غ ذهب صافٍ</span>
      </button>)}
    </div>
    {!summaries.length && <div className="border border-dashed p-6 text-center text-sm text-slate-400 sm:p-8">لا توجد أرصدة أوزان مفتوحة.</div>}

    {/* Reconciliation is a check, not daily reading — collapsed on a phone by default. */}
    {reconciliation && <div className="bg-white p-3 text-xs text-slate-600 shadow-sm sm:p-4">
      <button onClick={() => setShowReconciliation(current => !current)} className="flex w-full items-center justify-between text-right sm:cursor-default" type="button">
        <b className="text-sm text-slate-900">مطابقة الأوزان</b>
        <span className="text-[11px] font-bold text-amber-700 sm:hidden">{showReconciliation ? 'إخفاء' : 'عرض'}</span>
      </button>
      <div className={`${showReconciliation ? 'block' : 'hidden'} sm:block`}>
        <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
          <span className="block">ذهب الكسر المُرحَّل: <b className="text-slate-900">{reconciliation.salesExchanges.posted} من {reconciliation.salesExchanges.total}</b></span>
          <span className="block">حركات غير متوازنة: <b className="text-slate-900">{reconciliation.transactions.unbalanced}</b></span>
          <span className="block">صافي الذهب الخالص: <b className="text-slate-900">{reconciliation.netPureGoldGrams.toFixed(3)} غ</b></span>
        </div>
        <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          {reconciliation.karats.map(row => <span key={row.karat} className="block leading-5">
            عيار {row.karat}: وارد {row.totalDebitGrams.toFixed(3)} غ · صادر {row.totalCreditGrams.toFixed(3)} غ{row.conversionNetGrams ? ` · من التحويل ${row.conversionNetGrams.toFixed(3)} غ` : ''}
          </span>)}
        </div>
      </div>
    </div>}

    {showForm && <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div className="max-h-[92dvh] w-full overflow-y-auto bg-white p-4 sm:max-w-sm sm:p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black sm:text-base">{showForm === 'receipt' ? 'استلام ذهب من طرف' : showForm === 'payment' ? 'تسليم ذهب لطرف' : showForm === 'conversion' ? 'تحويل عيار' : 'رصيد أوزان افتتاحي'}</h3>
          <button onClick={() => { setShowForm(null); setError(''); }} aria-label="إغلاق" className="p-1 text-slate-500 sm:hidden"><X className="h-5 w-5" /></button>
        </div>
        <select value={formPartnerId} onChange={event => setFormPartnerId(event.target.value)} className="mt-3 w-full border p-2.5 text-sm">
          <option value="">اختر الطرف</option>
          {partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
        </select>
        <select value={karat} onChange={event => setKarat(event.target.value)} className="mt-2 w-full border p-2.5 text-sm">
          {GOLD_KARATS.map(value => <option key={value} value={value}>عيار {value}{showForm === 'conversion' ? ' (من)' : ''}</option>)}
        </select>
        <input value={weight} onChange={event => setWeight(event.target.value)} type="number" inputMode="decimal" step="0.001" placeholder="الوزن بالغرام" className="mt-2 w-full border p-2.5 text-sm" />
        {showForm === 'conversion' && <>
          <select value={toKarat} onChange={event => setToKarat(event.target.value)} className="mt-2 w-full border p-2.5 text-sm">
            {GOLD_KARATS.map(value => <option key={value} value={value}>عيار {value} (إلى)</option>)}
          </select>
          <input value={toWeight} onChange={event => setToWeight(event.target.value)} type="number" inputMode="decimal" step="0.001" placeholder={suggestedToWeight ? `الوزن المقابل — المقترح ${suggestedToWeight}` : 'الوزن المقابل بالغرام'} className="mt-2 w-full border p-2.5 text-sm" />
          {suggestedToWeight && <button type="button" onClick={() => setToWeight(suggestedToWeight)} className="mt-1.5 text-xs font-bold text-amber-700">استخدام الوزن المكافئ {suggestedToWeight} غ</button>}
        </>}
        {showForm === 'opening' && <select value={direction} onChange={event => setDirection(event.target.value as typeof direction)} className="mt-2 w-full border p-2.5 text-sm">
          <option value="partner_owes_shop">عليه لنا (مدين بالوزن)</option>
          <option value="shop_owes_partner">لنا عليه (المحل مدين بالوزن)</option>
        </select>}
        <input value={note} onChange={event => setNote(event.target.value)} placeholder="ملاحظة" className="mt-2 w-full border p-2.5 text-sm" />
        <div className="mt-4 flex gap-2">
          <button disabled={busy} onClick={submit} className="flex-1 bg-amber-400 px-4 py-2.5 text-sm font-bold disabled:opacity-50 sm:flex-none sm:py-2">حفظ</button>
          <button onClick={() => { setShowForm(null); setError(''); }} className="flex-1 bg-slate-100 px-4 py-2.5 text-sm sm:flex-none sm:py-2">إلغاء</button>
        </div>
      </div>
    </div>}

    {/* A phone gets the statement as a full-height sheet, not a shrunken desktop dialog. */}
    {statement && <div className="fixed inset-0 z-[120] flex items-stretch justify-center bg-black/60 sm:items-center sm:p-3">
      <div className="flex h-[100dvh] w-full flex-col bg-white sm:h-auto sm:max-h-[92vh] sm:max-w-3xl">
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-200 p-3 sm:p-5 sm:pb-3">
          <button onClick={() => setStatement(null)} aria-label="إغلاق" className="shrink-0 p-1 text-slate-600"><X className="h-5 w-5" /></button>
          <div className="min-w-0 text-right">
            <h3 className="truncate text-sm font-black sm:text-base">{statement.partner.name}</h3>
            {statement.balances.map(row => <b key={row.karat} className={`block text-xs sm:text-sm ${balanceTone(row.grams)}`}>
              عيار {row.karat}: {balanceLabel(row.grams)}{grams(row.grams)}
            </b>)}
            {!statement.balances.length && <b className="block text-xs text-slate-500 sm:text-sm">لا يوجد رصيد أوزان مفتوح</b>}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 px-3 py-2.5 sm:px-5">
          {actionButton('receipt', 'استلام', <Plus className="inline h-3.5 w-3.5" />, 'bg-amber-400 px-3 py-2 text-xs font-bold text-slate-900 sm:py-1.5')}
          {actionButton('payment', 'تسليم', <RotateCcw className="inline h-3.5 w-3.5" />, 'bg-slate-900 px-3 py-2 text-xs font-bold text-white sm:py-1.5')}
          <button onClick={printStatement} className="bg-slate-100 px-3 py-2 text-xs font-bold sm:py-1.5"><Printer className="inline h-3.5 w-3.5" /> طباعة الكشف</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 sm:px-5">
          {/* Phone: one card per movement, so nothing is squeezed into a sliver column. */}
          <div className="space-y-2 sm:hidden">
            {statement.rows.map(row => <div key={row.id} className={`border-r-4 border-slate-200 bg-slate-50 p-2.5 ${statementRowTone(row)}`}>
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-mono text-[10px] text-slate-500">{row.transactionNumber}{row.sourceNumber ? ` · ${row.sourceNumber}` : ''}</span>
                <span className="text-[10px] text-slate-400">{row.date}</span>
              </div>
              <p className="mt-1.5 text-[11px] leading-4 text-slate-700">{row.description}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs font-black">
                <span className="text-slate-500">عيار {row.karat}</span>
                {row.debitGrams > 0 && <span className="text-emerald-700">وارد {row.debitGrams.toFixed(3)}</span>}
                {row.creditGrams > 0 && <span className="text-rose-700">صادر {row.creditGrams.toFixed(3)}</span>}
                <span className="text-slate-900">الرصيد {row.runningBalanceGrams.toFixed(3)}</span>
              </div>
            </div>)}
          </div>

          <table className="hidden w-full text-right text-xs sm:table">
            <thead className="sticky top-0 bg-amber-50"><tr className="text-slate-700"><th className="p-2">التاريخ</th><th className="p-2">رقم الحركة</th><th className="p-2">البيان</th><th className="p-2">العيار</th><th className="p-2">وارد</th><th className="p-2">صادر</th><th className="p-2">الرصيد</th></tr></thead>
            <tbody>{statement.rows.map(row => <tr key={row.id} className={`border-b ${statementRowTone(row)}`}>
              <td className="whitespace-nowrap p-2">{row.date}</td>
              <td className="p-2 font-mono">{row.transactionNumber}{row.sourceNumber ? ` · ${row.sourceNumber}` : ''}</td>
              <td className="p-2">{row.description}</td>
              <td className="p-2">{row.karat}</td>
              <td className="p-2">{row.debitGrams ? row.debitGrams.toFixed(3) : '—'}</td>
              <td className="p-2">{row.creditGrams ? row.creditGrams.toFixed(3) : '—'}</td>
              <td className="p-2 font-bold">{row.runningBalanceGrams.toFixed(3)}</td>
            </tr>)}</tbody>
          </table>

          {!statement.rows.length && <div className="mt-4 border border-dashed p-6 text-center text-xs text-slate-400">لا توجد حركات أوزان لهذا الطرف.</div>}
        </div>
      </div>
    </div>}
  </div>;
};
