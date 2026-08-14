import React, { useEffect, useState } from 'react';
import { BookOpen, Check, FileSpreadsheet, Layers, Plus, RotateCcw, Scale, Search, X } from 'lucide-react';
import { accountingApi, type ApiAccount, type ApiJournal, type ApiLedgerRow, type ApiReconciliation, type ApiTrialBalanceRow } from '../services/accountingApi';
import { useStore } from '../context/StoreContext';

interface AccountingViewProps { activeTab: string; }

const CLASS_LABEL: Record<string, string> = { asset: 'أصول', liability: 'خصوم', equity: 'حقوق ملكية', revenue: 'إيرادات', expense: 'مصاريف' };
const SOURCE_LABEL: Record<string, string> = { manual: 'قيد يدوي', opening: 'رصيد افتتاحي', sale: 'فاتورة بيع', purchase: 'فاتورة شراء', sales_return: 'مرتجع مبيعات', purchase_return: 'مرتجع مشتريات', voucher: 'سند مالي', cashbox_transfer: 'مناقلة نقدية' };
const usd = (value: number) => `$ ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const AccountingView: React.FC<AccountingViewProps> = ({ activeTab }) => {
  const { settings } = useStore();
  const [accounts, setAccounts] = useState<ApiAccount[]>([]);
  const [journals, setJournals] = useState<ApiJournal[]>([]);
  const [journalTotal, setJournalTotal] = useState(0);
  const [journalPage, setJournalPage] = useState(1);
  const [journalSearch, setJournalSearch] = useState('');
  const [selectedJournal, setSelectedJournal] = useState<ApiJournal | null>(null);
  const [trialBalance, setTrialBalance] = useState<{ rows: ApiTrialBalanceRow[]; totalDebitUSD: number; totalCreditUSD: number; balanced: boolean } | null>(null);
  const [reconciliation, setReconciliation] = useState<ApiReconciliation | null>(null);
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [ledger, setLedger] = useState<{ account: any; openingBalanceUSD: number; closingBalanceUSD: number; items: ApiLedgerRow[]; meta: { total: number } } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [showAccountForm, setShowAccountForm] = useState(false);
  const [accountCode, setAccountCode] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountClass, setAccountClass] = useState<'asset' | 'liability' | 'equity' | 'revenue' | 'expense'>('expense');
  const [accountParentId, setAccountParentId] = useState('');

  const [showJournalForm, setShowJournalForm] = useState(false);
  const [journalDescription, setJournalDescription] = useState('');
  const [journalLines, setJournalLines] = useState([{ accountId: '', debitUSD: '', creditUSD: '', memo: '' }, { accountId: '', debitUSD: '', creditUSD: '', memo: '' }]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); await refresh(); return true; }
    catch (reason: any) { setError(reason?.message || 'تعذر تنفيذ العملية المحاسبية.'); return false; }
    finally { setBusy(false); }
  };

  const refresh = async () => {
    try {
      setError('');
      const [chart, journalPage_, balance, recon] = await Promise.all([
        accountingApi.accounts(),
        accountingApi.journals({ page: journalPage, limit: 30, search: journalSearch || undefined }),
        accountingApi.trialBalance(),
        accountingApi.reconciliation(),
      ]);
      setAccounts(chart); setJournals(journalPage_.items); setJournalTotal(journalPage_.meta.total);
      setTrialBalance(balance); setReconciliation(recon);
    } catch (reason: any) { setError(reason?.message || 'تعذر تحميل البيانات المحاسبية من الخادم.'); }
  };
  useEffect(() => { void refresh(); }, [journalPage, journalSearch]);
  useEffect(() => { if (!ledgerAccountId) { setLedger(null); return; } void accountingApi.generalLedger({ accountId: ledgerAccountId, page: 1, limit: 100 }).then(setLedger).catch(() => setLedger(null)); }, [ledgerAccountId, journals.length]);

  const postingAccounts = accounts.filter(account => account.allowsPosting && account.isActive);
  const lineTotal = (field: 'debitUSD' | 'creditUSD') => journalLines.reduce((sum, line) => sum + (parseFloat(line[field]) || 0), 0);
  const journalBalanced = Math.abs(lineTotal('debitUSD') - lineTotal('creditUSD')) < 0.005 && lineTotal('debitUSD') > 0;

  const handleCreateAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    const saved = await run(() => accountingApi.createAccount({ code: accountCode.trim(), nameAr: accountName.trim(), accountClass, normalBalance: accountClass === 'asset' || accountClass === 'expense' ? 'debit' : 'credit', parentAccountId: accountParentId || undefined }));
    if (saved) { setAccountCode(''); setAccountName(''); setAccountParentId(''); setShowAccountForm(false); }
  };

  const handleCreateJournal = async (event: React.FormEvent) => {
    event.preventDefault();
    const lines = journalLines.filter(line => line.accountId && ((parseFloat(line.debitUSD) || 0) > 0 || (parseFloat(line.creditUSD) || 0) > 0))
      .map(line => ({ accountId: line.accountId, debitUSD: parseFloat(line.debitUSD) ? Number(line.debitUSD).toFixed(4) : undefined, creditUSD: parseFloat(line.creditUSD) ? Number(line.creditUSD).toFixed(4) : undefined, memo: line.memo || undefined }));
    const saved = await run(() => accountingApi.createJournal({ description: journalDescription.trim(), exchangeRateSypPerUsd: settings.usdToSypRate, lines }));
    if (saved) { setJournalDescription(''); setJournalLines([{ accountId: '', debitUSD: '', creditUSD: '', memo: '' }, { accountId: '', debitUSD: '', creditUSD: '', memo: '' }]); setShowJournalForm(false); }
  };

  const showChart = activeTab === 'finance-accounts';

  return (
    <div className="space-y-3 sm:space-y-6 text-slate-900" dir="rtl">
      {error && <div className="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{error}</div>}
      {busy && <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">جارٍ تنفيذ العملية المحاسبية...</div>}

      <div className="flex flex-col gap-3 rounded-sm border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <div className="mb-0.5 flex items-center gap-1.5 text-[11px] font-bold uppercase text-amber-600 sm:text-xs">
            <Scale className="h-3.5 w-3.5" />
            <span>النظام المحاسبي — قيد مزدوج</span>
          </div>
          <h2 className="text-base font-black tracking-tight text-slate-900 sm:text-2xl">{showChart ? 'شجرة الحسابات والربط المحاسبي' : 'القيود ودفتر الأستاذ وميزان المراجعة'}</h2>
        </div>
        <button onClick={() => (showChart ? setShowAccountForm(true) : setShowJournalForm(true))} className="flex flex-1 items-center justify-center gap-1.5 rounded-sm bg-amber-400 px-3 py-2 text-xs font-bold text-slate-900 shadow transition hover:bg-amber-300 sm:flex-none sm:px-4 sm:py-2.5">
          <Plus className="h-4 w-4" />
          <span>{showChart ? '+ حساب جديد' : '+ قيد يدوي'}</span>
        </button>
      </div>

      {/* Trial balance and reconciliation summary */}
      {trialBalance && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-4">
          <div className="space-y-0.5 rounded-sm border-r-4 border-r-amber-500 bg-slate-900 p-3 text-white shadow-sm sm:p-5">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-amber-400 sm:text-xs">إجمالي المدين</span>
            <div className="font-mono text-base font-black text-amber-400 sm:text-2xl">{usd(trialBalance.totalDebitUSD)}</div>
          </div>
          <div className="space-y-0.5 rounded-sm border-r-4 border-r-emerald-500 bg-slate-900 p-3 text-white shadow-sm sm:p-5">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-400 sm:text-xs">إجمالي الدائن</span>
            <div className="font-mono text-base font-black text-emerald-400 sm:text-2xl">{usd(trialBalance.totalCreditUSD)}</div>
          </div>
          <div className={`space-y-0.5 rounded-sm border p-3 shadow-sm sm:p-5 ${trialBalance.balanced ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
            <span className="block text-[10px] font-bold uppercase text-slate-600 sm:text-xs">توازن الميزان</span>
            <div className={`text-base font-black sm:text-xl ${trialBalance.balanced ? 'text-emerald-700' : 'text-rose-700'}`}>{trialBalance.balanced ? 'متوازن ✓' : 'غير متوازن'}</div>
          </div>
          {reconciliation && (
            <div className={`space-y-0.5 rounded-sm border p-3 shadow-sm sm:p-5 ${reconciliation.cashBalanced && reconciliation.receivable.matches && reconciliation.payable.matches ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
              <span className="block text-[10px] font-bold uppercase text-slate-600 sm:text-xs">مطابقة المالية</span>
              <div className="text-base font-black text-slate-900 sm:text-xl">{reconciliation.cashBalanced && reconciliation.receivable.matches && reconciliation.payable.matches ? 'مطابقة ✓' : 'راجع الفروقات'}</div>
            </div>
          )}
        </div>
      )}

      {showChart ? (
        <>
          <div className="overflow-x-auto rounded-sm border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-[11px] sm:text-xs">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="p-2.5 text-right font-bold">الرمز</th>
                  <th className="p-2.5 text-right font-bold">اسم الحساب</th>
                  <th className="p-2.5 text-right font-bold">التصنيف</th>
                  <th className="p-2.5 text-right font-bold">الطبيعة</th>
                  <th className="p-2.5 text-right font-bold">مدين</th>
                  <th className="p-2.5 text-right font-bold">دائن</th>
                  <th className="p-2.5 text-right font-bold">الرصيد</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.map(account => (
                  <tr key={account.id} className={account.allowsPosting ? 'bg-white' : 'bg-slate-50 font-bold'}>
                    <td className="p-2.5 font-mono">{account.code}</td>
                    <td className="p-2.5" style={{ paddingRight: `${Math.max(0, account.code.length - 1) * 10 + 10}px` }}>
                      {account.nameAr}
                      {account.isSystem && <span className="mr-1.5 rounded-sm bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-900">نظامي</span>}
                      {!account.allowsPosting && <span className="mr-1.5 text-[10px] text-slate-500">(رئيسي)</span>}
                    </td>
                    <td className="p-2.5">{CLASS_LABEL[account.accountClass]}</td>
                    <td className="p-2.5">{account.normalBalance === 'debit' ? 'مدين' : 'دائن'}</td>
                    <td className="p-2.5 font-mono">{account.totalDebitUSD ? usd(account.totalDebitUSD) : '—'}</td>
                    <td className="p-2.5 font-mono">{account.totalCreditUSD ? usd(account.totalCreditUSD) : '—'}</td>
                    <td className="p-2.5 font-mono font-black">{usd(account.balanceUSD)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {reconciliation && (
            <div className="rounded-sm border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-black text-slate-900"><Layers className="h-4 w-4 text-amber-600" />مطابقة المحاسبة مع المالية التشغيلية</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-100 text-slate-700"><tr><th className="p-2 text-right font-bold">البند</th><th className="p-2 text-right font-bold">المحاسبة</th><th className="p-2 text-right font-bold">التشغيلي</th><th className="p-2 text-right font-bold">الفرق</th><th className="p-2 text-right font-bold">الحالة</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {reconciliation.cash.map(row => (
                      <tr key={row.cashboxId}><td className="p-2">{row.name}</td><td className="p-2 font-mono">{row.accountingBalance.toLocaleString('en-US')} {row.currency}</td><td className="p-2 font-mono">{row.financeBalance.toLocaleString('en-US')} {row.currency}</td><td className="p-2 font-mono">{row.differenceUSD.toFixed(2)}</td><td className={`p-2 font-bold ${row.matches ? 'text-emerald-700' : 'text-rose-700'}`}>{row.matches ? 'مطابق ✓' : 'فرق'}</td></tr>
                    ))}
                    <tr><td className="p-2 font-bold">ذمم العملاء</td><td className="p-2 font-mono">{usd(reconciliation.receivable.accountingUSD)}</td><td className="p-2 font-mono">{usd(reconciliation.receivable.operationalUSD)}</td><td className="p-2 font-mono">{reconciliation.receivable.unexplainedUSD.toFixed(2)}</td><td className={`p-2 font-bold ${reconciliation.receivable.matches ? 'text-emerald-700' : 'text-rose-700'}`}>{reconciliation.receivable.matches ? 'مطابق ✓' : 'فرق'}</td></tr>
                    <tr><td className="p-2 font-bold">ذمم الموردين</td><td className="p-2 font-mono">{usd(reconciliation.payable.accountingUSD)}</td><td className="p-2 font-mono">{usd(reconciliation.payable.operationalUSD)}</td><td className="p-2 font-mono">{reconciliation.payable.unexplainedUSD.toFixed(2)}</td><td className={`p-2 font-bold ${reconciliation.payable.matches ? 'text-emerald-700' : 'text-rose-700'}`}>{reconciliation.payable.matches ? 'مطابق ✓' : 'فرق'}</td></tr>
                  </tbody>
                </table>
              </div>
              <ul className="mt-2 list-inside list-disc space-y-0.5 text-[10px] text-slate-500">{reconciliation.notes.map(note => <li key={note}>{note}</li>)}</ul>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-sm border border-slate-200 bg-white p-2.5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="relative w-full sm:w-72">
              <Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input value={journalSearch} onChange={event => { setJournalPage(1); setJournalSearch(event.target.value); }} placeholder="ابحث برقم القيد أو المستند..." className="w-full rounded-sm border border-slate-200 bg-slate-50 py-2 pr-8 pl-2 text-xs" />
            </div>
            <select value={ledgerAccountId} onChange={event => setLedgerAccountId(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-white p-2 text-xs font-bold sm:w-72">
              <option value="">— دفتر الأستاذ: اختر حساباً —</option>
              {postingAccounts.map(account => <option key={account.id} value={account.id}>{account.code} — {account.nameAr}</option>)}
            </select>
          </div>

          {ledger && (
            <div className="rounded-sm border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-black text-slate-900"><BookOpen className="h-4 w-4 text-amber-600" />دفتر الأستاذ — {ledger.account.code} {ledger.account.nameAr}</h3>
              <div className="mb-2 flex flex-wrap gap-3 text-[11px] font-bold"><span>الرصيد الافتتاحي: <span className="font-mono">{usd(ledger.openingBalanceUSD)}</span></span><span>الرصيد الختامي: <span className="font-mono">{usd(ledger.closingBalanceUSD)}</span></span><span className="text-slate-500">عدد الحركات: {ledger.meta.total}</span></div>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-slate-100 text-slate-700"><tr><th className="p-2 text-right font-bold">التاريخ</th><th className="p-2 text-right font-bold">القيد</th><th className="p-2 text-right font-bold">المستند</th><th className="p-2 text-right font-bold">البيان</th><th className="p-2 text-right font-bold">مدين</th><th className="p-2 text-right font-bold">دائن</th><th className="p-2 text-right font-bold">الرصيد</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {ledger.items.map(row => (
                      <tr key={row.id} className="odd:bg-white even:bg-slate-50">
                        <td className="p-2 font-mono">{row.date}</td>
                        <td className="p-2 font-mono">{row.journalNumber}</td>
                        <td className="p-2">{row.sourceNumber || SOURCE_LABEL[row.sourceType] || '—'}</td>
                        <td className="p-2">{row.description}</td>
                        <td className="p-2 font-mono text-rose-700">{row.debitUSD ? row.debitUSD.toFixed(2) : '—'}</td>
                        <td className="p-2 font-mono text-emerald-700">{row.creditUSD ? row.creditUSD.toFixed(2) : '—'}</td>
                        <td className="p-2 font-mono font-bold">{row.runningBalanceUSD.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-sm border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-[11px] sm:text-xs">
              <thead className="bg-slate-100 text-slate-700"><tr><th className="p-2.5 text-right font-bold">رقم القيد</th><th className="p-2.5 text-right font-bold">التاريخ</th><th className="p-2.5 text-right font-bold">المصدر</th><th className="p-2.5 text-right font-bold">البيان</th><th className="p-2.5 text-right font-bold">المبلغ</th><th className="p-2.5 text-right font-bold">الحالة</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {journals.map(journal => (
                  <tr key={journal.id} onClick={() => void accountingApi.journal(journal.id).then(setSelectedJournal)} className="cursor-pointer transition hover:bg-amber-50">
                    <td className="p-2.5 font-mono font-bold">{journal.journalNumber}</td>
                    <td className="p-2.5 font-mono">{journal.date}</td>
                    <td className="p-2.5">{SOURCE_LABEL[journal.sourceType] || journal.sourceType}{journal.sourceNumber && <span className="mr-1 font-mono text-slate-500">{journal.sourceNumber}</span>}</td>
                    <td className="p-2.5">{journal.description}</td>
                    <td className="p-2.5 font-mono font-bold">{usd(journal.totalDebitUSD)}</td>
                    <td className={`p-2.5 font-bold ${journal.status === 'reversed' ? 'text-rose-700' : 'text-emerald-700'}`}>{journal.status === 'reversed' ? 'معكوس' : 'مرحّل'}</td>
                  </tr>
                ))}
                {!journals.length && <tr><td colSpan={6} className="p-6 text-center text-slate-500">لا توجد قيود مطابقة.</td></tr>}
              </tbody>
            </table>
          </div>
          {journalTotal > 30 && (
            <div className="flex items-center justify-center gap-3 text-xs font-bold text-slate-600">
              <button disabled={journalPage <= 1} onClick={() => setJournalPage(page => page - 1)} className="rounded-sm border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">السابق</button>
              <span>صفحة {journalPage} من {Math.ceil(journalTotal / 30)}</span>
              <button disabled={journalPage >= Math.ceil(journalTotal / 30)} onClick={() => setJournalPage(page => page + 1)} className="rounded-sm border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">التالي</button>
            </div>
          )}

          {trialBalance && (
            <div className="rounded-sm border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-black text-slate-900"><FileSpreadsheet className="h-4 w-4 text-amber-600" />ميزان المراجعة</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-slate-100 text-slate-700"><tr><th className="p-2 text-right font-bold">الرمز</th><th className="p-2 text-right font-bold">الحساب</th><th className="p-2 text-right font-bold">رصيد افتتاحي</th><th className="p-2 text-right font-bold">مدين الفترة</th><th className="p-2 text-right font-bold">دائن الفترة</th><th className="p-2 text-right font-bold">الرصيد الختامي</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {trialBalance.rows.map(row => (
                      <tr key={row.accountId} className="odd:bg-white even:bg-slate-50">
                        <td className="p-2 font-mono">{row.code}</td><td className="p-2">{row.nameAr}</td>
                        <td className="p-2 font-mono">{row.openingBalanceUSD.toFixed(2)}</td>
                        <td className="p-2 font-mono text-rose-700">{row.periodDebitUSD.toFixed(2)}</td>
                        <td className="p-2 font-mono text-emerald-700">{row.periodCreditUSD.toFixed(2)}</td>
                        <td className="p-2 font-mono font-bold">{row.closingBalanceUSD.toFixed(2)}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-900 font-black text-white"><td className="p-2" colSpan={3}>الإجمالي</td><td className="p-2 font-mono">{trialBalance.totalDebitUSD.toFixed(2)}</td><td className="p-2 font-mono">{trialBalance.totalCreditUSD.toFixed(2)}</td><td className="p-2">{trialBalance.balanced ? 'متوازن ✓' : 'غير متوازن'}</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* New account */}
      {showAccountForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-sm">
          <form onSubmit={handleCreateAccount} className="w-full max-w-lg space-y-3 rounded-sm border-2 border-amber-400 bg-white p-4 text-right shadow-2xl sm:p-6">
            <div className="flex items-center justify-between border-b-2 border-amber-300 pb-2"><h3 className="text-sm font-black sm:text-lg">إضافة حساب جديد</h3><button type="button" onClick={() => setShowAccountForm(false)} className="p-1 text-slate-400"><X className="h-5 w-5" /></button></div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div><label className="mb-1 block font-bold text-slate-700">رمز الحساب *</label><input value={accountCode} onChange={event => setAccountCode(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2 font-mono" /></div>
              <div><label className="mb-1 block font-bold text-slate-700">اسم الحساب *</label><input value={accountName} onChange={event => setAccountName(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2 font-bold" /></div>
              <div><label className="mb-1 block font-bold text-slate-700">التصنيف</label><select value={accountClass} onChange={event => setAccountClass(event.target.value as any)} className="w-full rounded-sm border border-slate-200 bg-white p-2">{Object.entries(CLASS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              <div><label className="mb-1 block font-bold text-slate-700">الحساب الأب</label><select value={accountParentId} onChange={event => setAccountParentId(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-white p-2"><option value="">— بدون —</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.code} — {account.nameAr}</option>)}</select></div>
            </div>
            <div className="flex justify-end gap-2 border-t-2 border-amber-300 pt-3"><button type="button" onClick={() => setShowAccountForm(false)} className="rounded-sm bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700">إلغاء</button><button type="submit" className="flex items-center gap-1.5 rounded-sm bg-amber-400 px-5 py-2 text-xs font-bold text-slate-900"><Check className="h-4 w-4" />حفظ الحساب</button></div>
          </form>
        </div>
      )}

      {/* Manual journal */}
      {showJournalForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-sm">
          <form onSubmit={handleCreateJournal} className="my-6 w-full max-w-3xl space-y-3 rounded-sm border-2 border-amber-400 bg-white p-4 text-right shadow-2xl sm:p-6">
            <div className="flex items-center justify-between border-b-2 border-amber-300 pb-2"><h3 className="text-sm font-black sm:text-lg">قيد يومية يدوي</h3><button type="button" onClick={() => setShowJournalForm(false)} className="p-1 text-slate-400"><X className="h-5 w-5" /></button></div>
            <div className="text-xs"><label className="mb-1 block font-bold text-slate-700">البيان *</label><input value={journalDescription} onChange={event => setJournalDescription(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2 font-bold" /></div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-100 text-slate-700"><tr><th className="p-2 text-right font-bold">الحساب</th><th className="p-2 text-right font-bold">مدين $</th><th className="p-2 text-right font-bold">دائن $</th><th className="p-2 text-right font-bold">ملاحظة</th></tr></thead>
                <tbody>
                  {journalLines.map((line, index) => (
                    <tr key={index}>
                      <td className="p-1"><select value={line.accountId} onChange={event => setJournalLines(rows => rows.map((row, position) => position === index ? { ...row, accountId: event.target.value } : row))} className="w-full rounded-sm border border-slate-200 bg-white p-1.5"><option value="">— اختر —</option>{postingAccounts.map(account => <option key={account.id} value={account.id}>{account.code} — {account.nameAr}</option>)}</select></td>
                      <td className="p-1"><input type="number" step="0.01" min="0" value={line.debitUSD} onChange={event => setJournalLines(rows => rows.map((row, position) => position === index ? { ...row, debitUSD: event.target.value, creditUSD: '' } : row))} className="w-24 rounded-sm border border-slate-200 bg-white p-1.5 font-mono" /></td>
                      <td className="p-1"><input type="number" step="0.01" min="0" value={line.creditUSD} onChange={event => setJournalLines(rows => rows.map((row, position) => position === index ? { ...row, creditUSD: event.target.value, debitUSD: '' } : row))} className="w-24 rounded-sm border border-slate-200 bg-white p-1.5 font-mono" /></td>
                      <td className="p-1"><input value={line.memo} onChange={event => setJournalLines(rows => rows.map((row, position) => position === index ? { ...row, memo: event.target.value } : row))} className="w-full rounded-sm border border-slate-200 bg-white p-1.5" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={() => setJournalLines(rows => [...rows, { accountId: '', debitUSD: '', creditUSD: '', memo: '' }])} className="rounded-sm border border-slate-300 px-3 py-1.5 text-[11px] font-bold text-slate-700">+ سطر</button>
            <div className={`rounded-sm p-2 text-xs font-bold ${journalBalanced ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>مجموع المدين: <span className="font-mono">{lineTotal('debitUSD').toFixed(2)}</span> — مجموع الدائن: <span className="font-mono">{lineTotal('creditUSD').toFixed(2)}</span> {journalBalanced ? '✓ متوازن' : '— يجب أن يتساوى الطرفان'}</div>
            <div className="flex justify-end gap-2 border-t-2 border-amber-300 pt-3"><button type="button" onClick={() => setShowJournalForm(false)} className="rounded-sm bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700">إلغاء</button><button type="submit" disabled={!journalBalanced || busy} className="flex items-center gap-1.5 rounded-sm bg-amber-400 px-5 py-2 text-xs font-bold text-slate-900 disabled:opacity-50"><Check className="h-4 w-4" />ترحيل القيد</button></div>
          </form>
        </div>
      )}

      {/* Journal detail */}
      {selectedJournal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-sm">
          <div className="my-6 w-full max-w-3xl space-y-3 rounded-sm border-2 border-amber-400 bg-white p-4 text-right shadow-2xl sm:p-6">
            <div className="flex items-center justify-between border-b-2 border-amber-300 pb-2">
              <div>
                <h3 className="text-sm font-black sm:text-lg">{selectedJournal.journalNumber}</h3>
                <p className="text-[11px] text-slate-500">{SOURCE_LABEL[selectedJournal.sourceType] || selectedJournal.sourceType}{selectedJournal.sourceNumber ? ` — ${selectedJournal.sourceNumber}` : ''} · {selectedJournal.date} · {selectedJournal.createdBy}</p>
              </div>
              <button onClick={() => setSelectedJournal(null)} className="p-1 text-slate-400"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-xs font-bold text-slate-800">{selectedJournal.description}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-100 text-slate-700"><tr><th className="p-2 text-right font-bold">الحساب</th><th className="p-2 text-right font-bold">البيان</th><th className="p-2 text-right font-bold">العملة</th><th className="p-2 text-right font-bold">المبلغ الأصلي</th><th className="p-2 text-right font-bold">مدين $</th><th className="p-2 text-right font-bold">دائن $</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {(selectedJournal.lines ?? []).map(line => (
                    <tr key={line.id}><td className="p-2"><span className="font-mono">{line.accountCode}</span> {line.accountName}</td><td className="p-2">{line.memo}</td><td className="p-2">{line.currency}</td><td className="p-2 font-mono">{line.originalAmount.toLocaleString('en-US')}</td><td className="p-2 font-mono text-rose-700">{line.debitUSD ? line.debitUSD.toFixed(2) : '—'}</td><td className="p-2 font-mono text-emerald-700">{line.creditUSD ? line.creditUSD.toFixed(2) : '—'}</td></tr>
                  ))}
                  <tr className="bg-slate-900 font-black text-white"><td className="p-2" colSpan={4}>الإجمالي</td><td className="p-2 font-mono">{selectedJournal.totalDebitUSD.toFixed(2)}</td><td className="p-2 font-mono">{selectedJournal.totalCreditUSD.toFixed(2)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2 border-t-2 border-amber-300 pt-3">
              {selectedJournal.sourceType === 'manual' && selectedJournal.status === 'posted' && (
                <button onClick={async () => { const reason = window.prompt('سبب عكس القيد:'); if (!reason?.trim()) return; const done = await run(() => accountingApi.reverseJournal(selectedJournal.id, reason.trim())); if (done) setSelectedJournal(null); }} className="flex items-center gap-1.5 rounded-sm bg-rose-600 px-4 py-2 text-xs font-bold text-white"><RotateCcw className="h-4 w-4" />عكس القيد</button>
              )}
              <button onClick={() => setSelectedJournal(null)} className="rounded-sm bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700">إغلاق</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
