import React, { useEffect, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { 
  Wallet, 
  Plus, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Receipt, 
  Coins, 
  Building2, 
  Search, 
  DollarSign, 
  X,
  CreditCard,
  ArrowRightLeft,
  BookOpen,
  Calendar,
  Printer,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  Filter,
  FileSpreadsheet,
  Tag,
  ShieldAlert,
  ChevronDown,
  MoreVertical,
  FileDown,
  Share2
} from 'lucide-react';
import { VoucherType, GoldKarat } from '../types';
import { financeApi, type ApiCashbox, type ApiCashMovement, type ApiPartnerBalance, type ApiVoucher } from '../services/financeApi';

interface FinanceViewProps {
  activeTab?: string;
  setActiveTab?: (tab: string) => void;
}

export const FinanceView: React.FC<FinanceViewProps> = ({ activeTab = 'finance-boxes', setActiveTab }) => {
  const {
    partners,
    formatMoney,
    settings,
    currentUser
  } = useStore();

  // Finance now reads and writes PostgreSQL only. The rows below keep the exact shape
  // the approved screen already renders, so no layout or styling had to change.
  const [cashBoxes, setCashBoxes] = useState<ApiCashbox[]>([]);
  const [vouchers, setVouchers] = useState<ApiVoucher[]>([]);
  const [movements, setMovements] = useState<ApiCashMovement[]>([]);
  const [partnerBalances, setPartnerBalances] = useState<ApiPartnerBalance[]>([]);
  const [financeError, setFinanceError] = useState('');
  const [financeBusy, setFinanceBusy] = useState(false);

  const refreshFinance = async () => {
    try {
      setFinanceError('');
      const [boxes, voucherPage, movementPage, balances] = await Promise.all([
        financeApi.cashboxes(),
        financeApi.vouchers({ page: 1, limit: 200 }),
        financeApi.movements({ page: 1, limit: 200 }),
        financeApi.partnerBalances({ limit: 200 }),
      ]);
      setCashBoxes(boxes);
      setVouchers(voucherPage.items);
      setMovements(movementPage.items);
      setPartnerBalances(balances);
    } catch (reason: any) {
      setFinanceError(reason?.message || 'تعذر تحميل بيانات المالية من الخادم.');
    }
  };
  useEffect(() => { void refreshFinance(); }, []);
  // The cashbox pickers are seeded from the backend once, never from a hardcoded id.
  useEffect(() => {
    if (!cashBoxes.length) return;
    const usdBox = cashBoxes.find(box => box.currency === 'USD') ?? cashBoxes[0];
    const otherBox = cashBoxes.find(box => box.id !== usdBox.id) ?? usdBox;
    setVchCashBoxId(current => (cashBoxes.some(box => box.id === current) ? current : usdBox.id));
    setExpCashBoxId(current => (cashBoxes.some(box => box.id === current) ? current : usdBox.id));
    setFromBoxId(current => (cashBoxes.some(box => box.id === current) ? current : usdBox.id));
    setToBoxId(current => (cashBoxes.some(box => box.id === current) ? current : otherBox.id));
  }, [cashBoxes]);

  const runFinanceAction = async (action: () => Promise<unknown>) => {
    setFinanceBusy(true);
    setFinanceError('');
    try { await action(); await refreshFinance(); return true; }
    catch (reason: any) { setFinanceError(reason?.message || 'تعذر تنفيذ العملية المالية.'); return false; }
    finally { setFinanceBusy(false); }
  };

  // Active sub-screen: 'boxes' | 'vouchers' | 'journal' | 'expenses'
  const currentSubTab = activeTab.replace('finance-', '').replace('finance', '') || 'boxes';

  const handleSubTabChange = (tab: string) => {
    if (setActiveTab) {
      setActiveTab(`finance-${tab}`);
    }
  };

  // ------------------ SEARCH & FILTERS ------------------
  const [searchQuery, setSearchQuery] = useState('');
  const [voucherTypeFilter, setVoucherTypeFilter] = useState<'all' | 'receipt' | 'payment' | 'expense'>('all');
  const [journalDateRange, setJournalDateRange] = useState<'today' | 'week' | 'month' | 'all'>('today');

  // ------------------ MODALS & FORMS ------------------
  // 1. Voucher Modal State (Print / Detailed View)
  const [selectedVoucherForPrint, setSelectedVoucherForPrint] = useState<ApiVoucher | null>(null);

  // 2. Embedded / Modal Voucher Creation Form State
  const [showVoucherForm, setShowVoucherForm] = useState(false);
  const [voucherActionsOpen, setVoucherActionsOpen] = useState(false);
  const [activeVoucherMenu, setActiveVoucherMenu] = useState<ApiVoucher | null>(null);
  const [editingVoucher, setEditingVoucher] = useState<ApiVoucher | null>(null);
  const [showCashBoxForm, setShowCashBoxForm] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [cashBoxName, setCashBoxName] = useState('');
  const [cashBoxCurrency, setCashBoxCurrency] = useState<'USD' | 'SYP'>('USD');
  const [cashBoxOpeningBalance, setCashBoxOpeningBalance] = useState('');
  const [vchType, setVchType] = useState<VoucherType>('receipt');
  const [vchPartnerId, setVchPartnerId] = useState('');
  const [vchCashBoxId, setVchCashBoxId] = useState(cashBoxes[0]?.id || 'box-usd');
  const [vchAmountUSD, setVchAmountUSD] = useState('');
  const [vchAmountSYP, setVchAmountSYP] = useState('');
  const [vchCategory, setVchCategory] = useState('سند مالي');
  const [vchStatement, setVchStatement] = useState('');
  const [vchGoldGrams, setVchGoldGrams] = useState('0');

  // 3. Cash Box Transfer Form State
  const [fromBoxId, setFromBoxId] = useState(cashBoxes[0]?.id || 'box-usd');
  const [toBoxId, setToBoxId] = useState(cashBoxes[1]?.id || 'box-syp');
  const [transferAmountFrom, setTransferAmountFrom] = useState('');
  const [transferAmountTo, setTransferAmountTo] = useState('');
  const [transferStatement, setTransferStatement] = useState('');
  const [transferSuccess, setTransferSuccess] = useState(false);

  // 4. Quick Expense Form State
  const [expCategory, setExpCategory] = useState('مصاريف كهرباء وطاقة');
  const [expCashBoxId, setExpCashBoxId] = useState('');
  const [expAmountUSD, setExpAmountUSD] = useState('');
  const [expAmountSYP, setExpAmountSYP] = useState('');
  const [expPayee, setExpPayee] = useState('');
  const [expStatement, setExpStatement] = useState('');
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [showExpenseCategoryForm, setShowExpenseCategoryForm] = useState(false);
  const [newExpenseCategory, setNewExpenseCategory] = useState('');
  const [expenseActionsOpen, setExpenseActionsOpen] = useState(false);
  const [customExpenseCategories, setCustomExpenseCategories] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('HAMEED_HLIWI_EXPENSE_CATEGORIES') || '[]'); } catch { return []; }
  });

  // ------------------ HANDLERS ------------------
  const handleOpenVoucherForm = (type: VoucherType) => {
    setEditingVoucher(null);
    setVchType(type);
    setVchPartnerId('');
    setVchCashBoxId(cashBoxes[0]?.id || 'box-usd');
    setVchAmountUSD('');
    setVchAmountSYP('');
    setVchCategory(
      type === 'expense'
        ? 'مصاريف كهرباء وطاقة'
        : type === 'receipt'
        ? 'سند قبض دفعة زبون'
        : 'سند صرف دفعة مورد'
    );
    setVchStatement('');
    setVchGoldGrams('0');
    setShowVoucherForm(true);
  };

  const handleEditVoucher = (voucher: ApiVoucher) => {
    setEditingVoucher(voucher);
    setVchType(voucher.type);
    setVchPartnerId(voucher.partnerId || '');
    setVchCashBoxId(voucher.cashBoxId);
    setVchAmountUSD(voucher.amountUSD.toString());
    setVchAmountSYP(voucher.amountSYP.toString());
    setVchCategory(voucher.category || 'سند مالي');
    setVchStatement(voucher.statement);
    setVchGoldGrams('0');
    setActiveVoucherMenu(null);
    setShowVoucherForm(true);
  };

  // A voucher records one currency. The cashbox chosen decides which amount is the
  // real one, so the original figure the cashier typed is what reaches the backend.
  const handleSaveVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingVoucher) { setFinanceError('السندات المرحّلة لا تُعدّل. ألغِ السند وأنشئ سنداً صحيحاً.'); return; }
    const box = cashBoxes.find(candidate => candidate.id === vchCashBoxId);
    if (!box) { setFinanceError('اختر صندوقاً صالحاً.'); return; }
    const amount = box.currency === 'USD' ? parseFloat(vchAmountUSD) || 0 : parseFloat(vchAmountSYP) || 0;
    if (!(amount > 0)) { setFinanceError(`أدخل مبلغاً أكبر من صفر بعملة الصندوق (${box.currency === 'USD' ? 'دولار' : 'ليرة'}).`); return; }
    if (vchType !== 'expense' && !vchPartnerId) { setFinanceError('اختر العميل أو المورد للسند.'); return; }

    const saved = await runFinanceAction(() => financeApi.createVoucher({
      type: vchType,
      partnerId: vchType === 'expense' ? undefined : vchPartnerId,
      currency: box.currency,
      amount: amount.toFixed(4),
      exchangeRateSypPerUsd: settings.usdToSypRate,
      cashBoxId: vchCashBoxId,
      warehouseId: box.warehouseId ?? undefined,
      category: vchType === 'expense' ? vchCategory : undefined,
      userNote: vchStatement || undefined,
      idempotencyKey: crypto.randomUUID(),
    }));
    if (saved) { setEditingVoucher(null); setShowVoucherForm(false); }
  };

  const handleExecuteTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    const amtFrom = parseFloat(transferAmountFrom);
    if (isNaN(amtFrom) || amtFrom <= 0) return;

    const fromBox = cashBoxes.find(b => b.id === fromBoxId);
    const toBox = cashBoxes.find(b => b.id === toBoxId);
    if (!fromBox || !toBox || fromBoxId === toBoxId) return;

    let amtTo = parseFloat(transferAmountTo);
    if (isNaN(amtTo) || amtTo <= 0) {
      if (fromBox.currency === 'USD' && toBox.currency === 'SYP') {
        amtTo = amtFrom * settings.usdToSypRate;
      } else if (fromBox.currency === 'SYP' && toBox.currency === 'USD') {
        amtTo = amtFrom / settings.usdToSypRate;
      } else {
        amtTo = amtFrom;
      }
    }

    const moved = await runFinanceAction(() => financeApi.createTransfer({ fromCashboxId: fromBoxId, toCashboxId: toBoxId, amountFrom: amtFrom.toFixed(4), amountTo: amtTo.toFixed(4), exchangeRateSypPerUsd: settings.usdToSypRate, note: transferStatement || undefined, idempotencyKey: crypto.randomUUID() }));
    if (!moved) return;

    setTransferAmountFrom('');
    setTransferAmountTo('');
    setTransferStatement('');
    setTransferSuccess(true);
    setShowTransferForm(false);
    setTimeout(() => setTransferSuccess(false), 3000);
  };

  const handleAddCashBox = async (event: React.FormEvent) => {
    event.preventDefault();
    const openingBalance = parseFloat(cashBoxOpeningBalance);
    if (!cashBoxName.trim() || isNaN(openingBalance) || openingBalance < 0) { setFinanceError('أدخل اسم الصندوق ورصيداً افتتاحياً صحيحاً.'); return; }
    const created = await runFinanceAction(() => financeApi.createCashbox({ name: cashBoxName.trim(), currency: cashBoxCurrency, warehouseId: cashBoxes.find(candidate => candidate.warehouseId)?.warehouseId ?? undefined, openingBalance: openingBalance.toFixed(4) }));
    if (!created) return;
    setCashBoxName('');
    setCashBoxOpeningBalance('');
    setShowCashBoxForm(false);
  };

  const handleSaveQuickExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const box = cashBoxes.find(candidate => candidate.id === expCashBoxId) ?? cashBoxes.find(candidate => candidate.currency === 'USD');
    if (!box) { setFinanceError('أنشئ صندوقاً قبل تسجيل المصاريف.'); return; }
    const amount = box.currency === 'USD' ? parseFloat(expAmountUSD) || 0 : parseFloat(expAmountSYP) || 0;
    if (!(amount > 0)) { setFinanceError(`أدخل مبلغ المصروف بعملة الصندوق (${box.currency === 'USD' ? 'دولار' : 'ليرة'}).`); return; }

    const saved = await runFinanceAction(() => financeApi.createVoucher({
      type: 'expense', currency: box.currency, amount: amount.toFixed(4), exchangeRateSypPerUsd: settings.usdToSypRate,
      cashBoxId: box.id, warehouseId: box.warehouseId ?? undefined, category: expCategory,
      userNote: `المستفيد: ${expPayee || 'عام'}${expStatement ? ` - ${expStatement}` : ''}`,
      idempotencyKey: crypto.randomUUID(),
    }));
    if (!saved) return;

    setExpAmountUSD('');
    setExpAmountSYP('');
    setExpPayee('');
    setExpStatement('');
    setShowExpenseForm(false);
  };

  const handleAddExpenseCategory = (event: React.FormEvent) => {
    event.preventDefault();
    const category = newExpenseCategory.trim();
    if (!category) return;
    const updated = Array.from(new Set([...customExpenseCategories, category]));
    setCustomExpenseCategories(updated);
    localStorage.setItem('HAMEED_HLIWI_EXPENSE_CATEGORIES', JSON.stringify(updated));
    setExpCategory(category);
    setNewExpenseCategory('');
    setShowExpenseCategoryForm(false);
  };

  // ------------------ CALCULATIONS ------------------
  const totalUSDInBoxes = cashBoxes.filter(b => b.currency === 'USD').reduce((sum, b) => sum + b.balanceAmount, 0);
  const totalSYPInBoxes = cashBoxes.filter(b => b.currency === 'SYP').reduce((sum, b) => sum + b.balanceAmount, 0);

  // Expenses Stats
  const expenseVouchers = vouchers.filter(v => v.type === 'expense');
  const totalExpenseUSD = expenseVouchers.reduce((sum, v) => sum + v.amountUSD, 0);
  const expenseCategoriesList = [
    'مصاريف كهرباء وطاقة',
    'أجور وإيجارات المحلات',
    'مصاريف شحن ونقل وتأمين',
    'صيانة موازين ومعدات',
    'ضيافة ونثريات المعرض',
    'رواتب ومكافآت العاملين'
  ];

  const availableExpenseCategories = Array.from(new Set([...expenseCategoriesList, ...customExpenseCategories]));

  // ------------------ DAYBOOK JOURNAL ENTRIES GENERATION ------------------
  interface JournalEntry {
    id: string;
    date: string;
    refNumber: string;
    type: 'مبيعات' | 'مشتريات' | 'سند قبض' | 'سند صرف' | 'مصروف تشغيلي' | 'مقايضة كسر';
    entityName: string;
    description: string;
    debitUSD: number; // مدين (دخل)
    creditUSD: number; // دائن (خرج)
    goldWeightGrams: number; // غرامات ذهب (+ / -)
    cashBoxName: string;
    operatorName: string;
  }

  // The journal is the immutable cash movement ledger itself: every row here exists
  // because a voucher moved money, and each one names the document that caused it.
  const generateJournalEntries = (): JournalEntry[] => movements.map(movement => {
    const voucher = vouchers.find(candidate => candidate.id === movement.voucherId);
    const partnerName = voucher?.partnerName || partners.find(partner => partner.id === movement.partnerId)?.name || '';
    return {
      id: `journal-mov-${movement.id}`,
      date: movement.createdAt.slice(0, 10),
      refNumber: movement.voucherNumber || '—',
      type: movement.direction === 'inflow' ? 'قبض نقدي' : voucher?.type === 'expense' ? 'مصروف تشغيلي' : 'صرف نقدي',
      entityName: partnerName || voucher?.category || 'عام',
      description: movement.description,
      debitUSD: movement.direction === 'inflow' ? movement.amountUSD : 0,
      creditUSD: movement.direction === 'outflow' ? movement.amountUSD : 0,
      goldWeightGrams: 0,
      cashBoxName: movement.cashboxName,
      operatorName: movement.actor,
    };
  }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const journalEntries = generateJournalEntries().filter(entry => {
    const todayStr = new Date().toISOString().split('T')[0];
    if (journalDateRange === 'today' && entry.date !== todayStr) return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return (
        entry.refNumber.toLowerCase().includes(q) ||
        entry.entityName.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const totalJournalDebitUSD = journalEntries.reduce((sum, e) => sum + e.debitUSD, 0);
  const totalJournalCreditUSD = journalEntries.reduce((sum, e) => sum + e.creditUSD, 0);

  return (
    <div className="space-y-3 sm:space-y-6 text-slate-900" dir="rtl">
      {financeError && <div className="rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700">{financeError}</div>}
      {financeBusy && <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">جارٍ تنفيذ العملية المالية...</div>}
      {/* ========================================================================= */}
      {/* SUB-SCREEN 1: قسم الصناديق والخزائن (CASH BOXES & VAULTS) */}
      {/* ========================================================================= */}
      {currentSubTab === 'boxes' && (
        <div className="space-y-3 sm:space-y-6">
          {/* Dedicated Screen Header */}
          <div className="bg-white p-3 sm:p-5 rounded-sm border-r-4 border-r-amber-500 border-slate-200 border shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-amber-600 font-bold text-[11px] sm:text-xs uppercase tracking-wider mb-0.5">
                <Building2 className="w-3.5 h-3.5 text-amber-600" />
                <span>الإدارة المالية - الصناديق والخزائن</span>
              </div>
              <h2 className="text-base sm:text-2xl font-black text-slate-900">
                قسم الصناديق والخزائن والسيولة النقدية
              </h2>
              <p className="hidden sm:block text-xs text-slate-500 font-medium mt-1">
                شاشة مستقلة لعرض ومتابعة سيولة كاش الخزائن العامة بالدولار والليرة السورية وتنفيذ المناقلات المالية.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="bg-amber-100 text-amber-900 font-extrabold px-2.5 py-1 rounded text-xs border border-amber-300">
                الخزائن: {cashBoxes.length} صناديق
              </span>
              <button onClick={() => setShowCashBoxForm(true)} className="bg-amber-400 hover:bg-amber-300 text-slate-900 px-3 py-2 rounded-sm text-xs font-black flex items-center gap-1.5"><Plus className="w-4 h-4" />إضافة صندوق</button>
              <button onClick={() => setShowTransferForm(true)} className="bg-slate-900 hover:bg-slate-800 text-amber-400 px-3 py-2 rounded-sm text-xs font-black flex items-center gap-1.5"><ArrowRightLeft className="w-4 h-4" />مناقلة</button>
            </div>
          </div>

          {/* Liquidity Overview Header Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
            <div className="bg-slate-900 text-white p-3 sm:p-5 rounded-sm border-r-4 border-r-amber-400 shadow-sm space-y-0.5">
              <span className="text-[10px] sm:text-xs font-bold text-amber-400 uppercase tracking-wider block">
                سيولة الدولار ($)
              </span>
              <div className="text-base sm:text-3xl font-black font-mono text-amber-400">
                $ {totalUSDInBoxes.toLocaleString()}
              </div>
              <p className="hidden sm:block text-[11px] text-slate-400 font-medium pt-1">
                تشمل كاش الصندوق الرئيسي والمبيعات
              </p>
            </div>

            <div className="bg-slate-900 text-white p-3 sm:p-5 rounded-sm border-r-4 border-r-emerald-500 shadow-sm space-y-0.5">
              <span className="text-[10px] sm:text-xs font-bold text-emerald-400 uppercase tracking-wider block">
                سيولة الليرة (ل.س)
              </span>
              <div className="text-base sm:text-3xl font-black font-mono text-emerald-400">
                {totalSYPInBoxes.toLocaleString('ar-SY')} ل.س
              </div>
              <p className="hidden sm:block text-[11px] text-slate-400 font-medium pt-1">
                سعر الصرف: 1$ = {settings.usdToSypRate.toLocaleString()} ل.س
              </p>
            </div>

            <div className="col-span-2 sm:col-span-1 bg-slate-900 text-white p-3 sm:p-5 rounded-sm border-r-4 border-r-amber-500 shadow-sm space-y-0.5">
              <span className="text-[10px] sm:text-xs font-bold text-amber-300 uppercase tracking-wider block">
                مقر الخزينة الرئيسية
              </span>
              <div className="text-sm sm:text-xl font-black text-amber-200">
                فرع حلب المركز - الخزينة العامة
              </div>
              <p className="hidden sm:block text-[11px] text-slate-400 font-medium pt-1">
                حالة الصناديق: نشطة ومطابقة
              </p>
            </div>
          </div>

          {/* Individual Cash Box Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-5">
            {cashBoxes.map(box => (
              <div
                key={box.id}
                className="bg-white border-2 border-slate-200 hover:border-amber-400 p-3 sm:p-5 rounded-sm shadow-sm transition space-y-2 sm:space-y-3 relative overflow-hidden"
              >
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-sm bg-amber-100 text-amber-900 flex items-center justify-center font-bold">
                      <Building2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                    <span className="font-bold text-slate-900 text-xs sm:text-sm">{box.name}</span>
                  </div>
                  <span className="text-xs font-mono font-bold bg-amber-400 text-slate-900 px-2 py-0.5 rounded-sm">
                    {box.currency}
                  </span>
                </div>

                <div className="text-xl sm:text-2xl font-black font-mono text-slate-900">
                  {box.currency === 'USD'
                    ? `$ ${box.balanceAmount.toLocaleString()}`
                    : `${box.balanceAmount.toLocaleString('ar-SY')} ل.س`}
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 pt-2 font-medium border-t border-slate-100">
                  <span>نوع الحساب: <strong className="text-slate-800">صندوق سيولة مباشر</strong></span>
                  <span className="text-emerald-700 font-bold">متحقق ✓</span>
                </div>
              </div>
            ))}
          </div>

          {/* EMBEDDED CASH & VAULT TRANSFER TOOL */}
          <div className="hidden bg-amber-50/80 border-2 border-amber-300 p-6 rounded-sm shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-amber-950 font-black text-base border-b border-amber-200 pb-3">
              <ArrowRightLeft className="w-5 h-5 text-amber-700" />
              <span>لوحة المناقلات والتحويل المالي بين الخزائن والصناديق</span>
            </div>

            {transferSuccess && (
              <div className="bg-emerald-100 border border-emerald-400 text-emerald-900 p-3 rounded-sm text-xs font-bold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                <span>تم إتمام المناقلة المالية بين الصناديق وتسجيل القيد في السجل بنجاح!</span>
              </div>
            )}

            <form onSubmit={handleExecuteTransfer} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end text-xs font-bold">
              <div>
                <label className="block text-slate-700 mb-1">من صندوق / خزنة:</label>
                <select
                  value={fromBoxId}
                  onChange={e => setFromBoxId(e.target.value)}
                  className="w-full p-2.5 bg-white border border-amber-300 rounded-sm text-slate-900"
                >
                  {cashBoxes.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 mb-1">المبلغ المخصوم:</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="المبلغ من..."
                  value={transferAmountFrom}
                  onChange={e => setTransferAmountFrom(e.target.value)}
                  className="w-full p-2.5 bg-white border border-amber-300 rounded-sm font-mono text-slate-900"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-1">إلى صندوق / خزنة:</label>
                <select
                  value={toBoxId}
                  onChange={e => setToBoxId(e.target.value)}
                  className="w-full p-2.5 bg-white border border-amber-300 rounded-sm text-slate-900"
                >
                  {cashBoxes.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 mb-1">المبلغ المستلم (اختياري للتقويم):</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="آلي حسب الصرف..."
                  value={transferAmountTo}
                  onChange={e => setTransferAmountTo(e.target.value)}
                  className="w-full p-2.5 bg-white border border-amber-300 rounded-sm font-mono text-slate-900"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-slate-900 hover:bg-slate-800 text-amber-400 font-black p-2.5 rounded-sm shadow-sm transition h-[42px] flex items-center justify-center gap-2"
              >
                <ArrowRightLeft className="w-4 h-4" />
                <span>تنفيذ التحويل</span>
              </button>
            </form>

            <div className="text-[11px] text-amber-900 font-medium">
              ملاحظة: عند التحويل بين عملتين مختلفتين ($ إلى ل.س أو العكس)، يتم اعتماد سعر الصرف الحسابي المعتمد في المحل أوتوماتيكياً (1 $ = {settings.usdToSypRate} ل.س).
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-SCREEN 2: السندات المالية (VOUCHERS DEDICATED SCREEN) */}
      {/* ========================================================================= */}
      {currentSubTab === 'vouchers' && (
        <div className="space-y-3 sm:space-y-6">
          {/* Dedicated Screen Header */}
          <div className="bg-white p-3 sm:p-5 rounded-sm border-r-4 border-r-amber-500 border-slate-200 border shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-amber-600 font-bold text-[11px] sm:text-xs uppercase tracking-wider mb-0.5">
                <Receipt className="w-3.5 h-3.5 text-amber-600" />
                <span>الإدارة المالية - السندات الرسمية</span>
              </div>
              <h2 className="text-base sm:text-2xl font-black text-slate-900">
                قسم السندات المالية (قبض وصرف وقيد)
              </h2>
              <p className="hidden sm:block text-xs text-slate-500 font-medium mt-1">
                شاشة خاصة بإصدار وتصفح كافة سندات القبض والصرف المالي الرسمية وتسوية حسابات العملاء والتجار وطباعتها.
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleOpenVoucherForm('receipt')}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-sm font-bold text-xs shadow-sm flex items-center gap-1 transition"
              >
                <ArrowUpRight className="w-3.5 h-3.5 text-white" />
                <span>+ قبض</span>
              </button>

              <button
                onClick={() => handleOpenVoucherForm('payment')}
                className="bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1.5 rounded-sm font-bold text-xs shadow-sm flex items-center gap-1 transition"
              >
                <ArrowDownLeft className="w-3.5 h-3.5 text-white" />
                <span>+ صرف</span>
              </button>
            </div>
          </div>

          {/* Action Bar & Filter */}
          <div className="bg-white p-2.5 sm:p-4 rounded-sm border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-2 sm:gap-4 text-xs">
            <div className="flex items-center gap-1 sm:gap-2 bg-slate-100 p-1 rounded-sm w-full sm:w-auto font-bold">
              <button
                onClick={() => setVoucherTypeFilter('all')}
                className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-sm transition text-[11px] sm:text-xs ${
                  voucherTypeFilter === 'all' ? 'bg-amber-400 text-slate-900 font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                الكل ({vouchers.length})
              </button>
              <button
                onClick={() => setVoucherTypeFilter('receipt')}
                className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-sm transition text-[11px] sm:text-xs ${
                  voucherTypeFilter === 'receipt' ? 'bg-amber-400 text-slate-900 font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                قبض ({vouchers.filter(v => v.type === 'receipt').length})
              </button>
              <button
                onClick={() => setVoucherTypeFilter('payment')}
                className={`px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-sm transition text-[11px] sm:text-xs ${
                  voucherTypeFilter === 'payment' ? 'bg-amber-400 text-slate-900 font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                صرف ({vouchers.filter(v => v.type === 'payment').length})
              </button>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2" />
                <input
                  type="text"
                  placeholder="ابحث بالسند، البيان، الجهة..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pr-8 pl-2 py-1.5 bg-slate-50 border border-slate-200 rounded-sm text-slate-800 focus:outline-none focus:border-amber-400 text-xs font-medium"
                />
              </div>

              <div className="hidden relative shrink-0" />
              <button
                onClick={() => handleOpenVoucherForm('receipt')}
                className="hidden bg-amber-400 hover:bg-amber-300 text-slate-900 px-3 py-1.5 rounded-sm font-bold text-xs shadow-sm shrink-0"
              >
                + سند جديد
              </button>
            </div>
          </div>

          {/* VOUCHER CREATION FORM CARD */}
          {showVoucherForm && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" className={`relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-sm border-2 p-3 shadow-2xl space-y-3 sm:p-6 sm:space-y-4 ${vchType === 'receipt' ? 'border-emerald-400 bg-emerald-50 [&_input]:border-emerald-300 [&_select]:border-emerald-300' : vchType === 'payment' ? 'border-rose-400 bg-rose-50 [&_input]:border-rose-300 [&_select]:border-rose-300' : 'border-amber-300 bg-amber-50'}`}>
              <div className={`flex items-center justify-between border-b pb-2 ${vchType === 'receipt' ? 'border-emerald-200' : vchType === 'payment' ? 'border-rose-200' : 'border-amber-200'}`}>
                <div className="flex items-center gap-1.5 text-slate-900 font-black text-sm sm:text-base">
                  <Receipt className="w-4 h-4 text-amber-700" />
                  <span>
                    إصدار {vchType === 'receipt' ? 'سند قبض مالي' : vchType === 'payment' ? 'سند صرف مالي' : 'سند مصروف'} جديد
                  </span>
                </div>
                <button
                  onClick={() => setShowVoucherForm(false)}
                  className="text-slate-500 hover:text-slate-800 p-0.5"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveVoucher} className="space-y-3 text-xs font-bold">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-3">
                  <div>
                    <label className="block text-slate-700 mb-0.5">نوع السند:</label>
                    <select
                      value={vchType}
                      onChange={e => setVchType(e.target.value as VoucherType)}
                      className="w-full p-2 bg-white border border-amber-300 rounded-sm font-bold"
                    >
                      <option value="receipt">سند قبض (قبض سيولة)</option>
                      <option value="payment">سند صرف (صرف سيولة)</option>
                      <option value="expense">سند مصروف تشغيلي</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 mb-0.5">الحساب / الجهة:</label>
                    <select
                      value={vchPartnerId}
                      onChange={e => setVchPartnerId(e.target.value)}
                      className="w-full p-2 bg-white border border-amber-300 rounded-sm"
                    >
                      <option value="">-- حساب عام --</option>
                      {partners.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.type === 'customer' ? 'عميل' : 'مورد'})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 mb-0.5">الصندوق المستهدف:</label>
                    <select
                      value={vchCashBoxId}
                      onChange={e => setVchCashBoxId(e.target.value)}
                      className="w-full p-2 bg-white border border-amber-300 rounded-sm"
                    >
                      {cashBoxes.map(b => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.currency})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 mb-0.5">فئة السند:</label>
                    <input
                      type="text"
                      placeholder="مثال: تسديد دفعة..."
                      value={vchCategory}
                      onChange={e => setVchCategory(e.target.value)}
                      className="w-full p-2 bg-white border border-amber-300 rounded-sm font-sans"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                  <div>
                    <label className="block text-slate-700 mb-0.5">المبلغ ($):</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={vchAmountUSD}
                      onChange={e => {
                        const val = e.target.value;
                        setVchAmountUSD(val);
                        if (val && !isNaN(parseFloat(val))) {
                          setVchAmountSYP((parseFloat(val) * settings.usdToSypRate).toString());
                        }
                      }}
                      className="w-full p-2 bg-white border border-amber-300 rounded-sm font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 mb-0.5">المبلغ (ل.س):</label>
                    <input
                      type="number"
                      step="1000"
                      placeholder="0"
                      value={vchAmountSYP}
                      onChange={e => setVchAmountSYP(e.target.value)}
                      className="w-full p-2 bg-white border border-amber-300 rounded-sm font-mono"
                    />
                  </div>

                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-slate-700 mb-0.5">ذهب ذمة (غ):</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={vchGoldGrams}
                      onChange={e => setVchGoldGrams(e.target.value)}
                      className="w-full p-2 bg-white border border-amber-300 rounded-sm font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-700 mb-0.5">البيان والشرح التفصيلي:</label>
                  <input
                    type="text"
                    placeholder="اكتب بيان السند للتوثيق..."
                    value={vchStatement}
                    onChange={e => setVchStatement(e.target.value)}
                    className="w-full p-2 bg-white border border-amber-300 rounded-sm font-sans"
                    required
                  />
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowVoucherForm(false)}
                    className="px-3 py-1.5 bg-slate-200 text-slate-800 rounded-sm font-bold"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className={`px-4 py-1.5 rounded-sm font-black text-white shadow-sm ${vchType === 'receipt' ? 'bg-emerald-600 hover:bg-emerald-700' : vchType === 'payment' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-500 hover:bg-amber-600'}`}
                  >
                    حفظ السند
                  </button>
                </div>
              </form>
            </div>
            </div>
          )}

          {/* Vouchers Directory Table (Desktop) & Compact Rows (Mobile) */}
          <div className="bg-white rounded-sm border border-slate-200 shadow-sm overflow-visible">
            {/* MOBILE VOUCHERS COMPACT ROWS VIEW */}
            <div className="block sm:hidden divide-y divide-slate-100">
              {vouchers
                .filter(v => {
                  if (voucherTypeFilter !== 'all' && v.type !== voucherTypeFilter) return false;
                  if (searchQuery.trim() !== '') {
                    const q = searchQuery.toLowerCase();
                    return (
                      v.voucherNumber.toLowerCase().includes(q) ||
                      v.statement.toLowerCase().includes(q) ||
                      v.partnerName?.toLowerCase().includes(q)
                    );
                  }
                  return true;
                })
                .map(vch => (
                  <div key={vch.id} onClick={() => setSelectedVoucherForPrint(vch)} className={`relative cursor-pointer p-3 pl-24 flex items-center justify-between gap-2 border-r-4 transition ${activeVoucherMenu?.id === vch.id ? 'z-50' : 'z-0'} ${vch.type === 'receipt' ? 'bg-emerald-50/80 border-r-emerald-500 hover:bg-emerald-100/70' : 'bg-rose-50/80 border-r-rose-500 hover:bg-rose-100/70'}`}>
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <div className={`w-8 h-8 shrink-0 rounded-sm flex items-center justify-center ${vch.type === 'receipt' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'}`}>{vch.type === 'receipt' ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownLeft className="w-5 h-5" />}</div>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                          vch.type === 'receipt'
                            ? 'bg-emerald-100 text-emerald-900'
                            : vch.type === 'payment'
                            ? 'bg-rose-100 text-rose-900'
                            : 'bg-rose-100 text-rose-900'
                        }`}
                      >
                        {vch.type === 'receipt' ? 'قبض' : vch.type === 'payment' ? 'صرف' : 'مصروف'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-slate-900 text-xs truncate font-sans">
                            {vch.partnerName || 'حساب عام'}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono shrink-0">#{vch.voucherNumber}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 truncate font-sans">{vch.statement}</div>
                      </div>
                    </div>
                    <div className="absolute left-3 top-1/2 flex flex-row-reverse -translate-y-1/2 items-center gap-2 text-left font-mono">
                      <button onClick={event => { event.stopPropagation(); setActiveVoucherMenu(activeVoucherMenu?.id === vch.id ? null : vch); }} className="bg-white/80 border border-slate-200 text-slate-800 p-1.5 rounded-sm"><MoreVertical className="w-4 h-4" /></button>
                      {activeVoucherMenu?.id === vch.id && <div onClick={event => event.stopPropagation()} className="absolute left-0 top-9 z-50 w-44 rounded-sm border border-slate-300 bg-white py-1 shadow-xl text-right text-xs"><button onClick={() => { setSelectedVoucherForPrint(vch); setActiveVoucherMenu(null); }} className="w-full px-3 py-2 hover:bg-amber-50">طباعة</button><button onClick={() => { setSelectedVoucherForPrint(vch); setActiveVoucherMenu(null); setTimeout(() => window.print(), 200); }} className="w-full px-3 py-2 hover:bg-amber-50">تصدير PDF</button><button onClick={() => handleEditVoucher(vch)} className="w-full px-3 py-2 hover:bg-amber-50">تعديل</button><button onClick={() => { const reason = window.prompt('سبب إلغاء السند:'); if (reason?.trim()) void runFinanceAction(() => financeApi.cancelVoucher(vch.id, reason.trim())); setActiveVoucherMenu(null); }} className="w-full px-3 py-2 text-rose-700 hover:bg-rose-50">إلغاء وعكس السند</button></div>}
                      <div>
                        <div className="font-black text-slate-900 text-xs">${vch.amountUSD.toFixed(0)}</div>
                        <div className="text-[9px] text-slate-400 font-sans">{vch.date.split(' ')[0]}</div>
                      </div>
                      <button
                        onClick={() => setSelectedVoucherForPrint(vch)}
                        className="hidden bg-amber-400 text-slate-900 p-1.5 rounded"
                        title="معاينة وطباعة"
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
            </div>

            {/* DESKTOP TABLE VIEW */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-amber-400 text-slate-900 font-extrabold border-b border-amber-300 uppercase">
                  <tr>
                    <th className="py-3 px-4">رقم السند</th>
                    <th className="py-3 px-3">النوع</th>
                    <th className="py-3 px-3">التاريخ</th>
                    <th className="py-3 px-4">الحساب / الجهة</th>
                    <th className="py-3 px-4">البيان والشرح</th>
                    <th className="py-3 px-3">الصندوق</th>
                    <th className="py-3 px-3 text-left">المبلغ ($)</th>
                    <th className="py-3 px-3 text-left">المبلغ (ل.س)</th>
                    <th className="py-3 px-3 text-center">معاينة/طباعة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {vouchers
                    .filter(v => {
                      if (voucherTypeFilter !== 'all' && v.type !== voucherTypeFilter) return false;
                      if (searchQuery.trim() !== '') {
                        const q = searchQuery.toLowerCase();
                        return (
                          v.voucherNumber.toLowerCase().includes(q) ||
                          v.statement.toLowerCase().includes(q) ||
                          v.partnerName?.toLowerCase().includes(q)
                        );
                      }
                      return true;
                    })
                    .map(vch => (
                      <tr key={vch.id} className={`transition ${vch.type === 'receipt' ? 'bg-emerald-50/50 hover:bg-emerald-100/70' : 'bg-rose-50/50 hover:bg-rose-100/70'}`}>
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">
                          {vch.voucherNumber}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              vch.type === 'receipt'
                                ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                : vch.type === 'payment'
                                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                : 'bg-rose-100 text-rose-900 border border-rose-300'
                            }`}
                          >
                            {vch.type === 'receipt' ? 'قبض' : vch.type === 'payment' ? 'صرف' : 'مصروف'}
                          </span>
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-600">{vch.date}</td>
                        <td className="py-3 px-4 font-bold text-slate-900">
                          {vch.partnerName || 'حساب عام / تشغيلي'}
                        </td>
                        <td className="py-3 px-4 text-slate-700">{vch.statement}</td>
                        <td className="py-3 px-3 font-mono text-slate-600">
                          {cashBoxes.find(b => b.id === vch.cashBoxId)?.name || 'الصندوق'}
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-left text-slate-900">
                          $ {vch.amountUSD.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-left text-amber-950">
                          {vch.amountSYP.toLocaleString('ar-SY')} ل.س
                        </td>
                        <td className="py-3 px-3 text-center">
                          <button
                            onClick={() => setSelectedVoucherForPrint(vch)}
                            className="bg-slate-100 hover:bg-amber-200 text-slate-800 p-1.5 rounded transition"
                            title="معاينة وطباعة السند"
                          >
                            <Printer className="w-4 h-4 text-slate-700" />
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-SCREEN 3: دفتر اليومية العام (GENERAL DAYBOOK JOURNAL SCREEN) */}
      {/* ========================================================================= */}
      {currentSubTab === 'journal' && (
        <div className="space-y-3 sm:space-y-6">
          {/* Dedicated Screen Header */}
          <div className="bg-white p-3 sm:p-5 rounded-sm border-r-4 border-r-amber-500 border-slate-200 border shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-amber-600 font-bold text-[11px] sm:text-xs uppercase tracking-wider mb-0.5">
                <BookOpen className="w-3.5 h-3.5 text-amber-600" />
                <span>الإدارة المالية - دفتر اليومية الشامل</span>
              </div>
              <h2 className="text-base sm:text-2xl font-black text-slate-900">
                قسم دفتر اليومية العام والقيود المحاسبية
              </h2>
              <p className="hidden sm:block text-xs text-slate-500 font-medium mt-1">
                سجل محاسبي شامل ومستقل لكافة حركات الدخل والخرج والقيود المالية وحركات وزن الذهب المسجلة.
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono">
              <div className="bg-amber-100 border border-amber-300 text-amber-950 px-2.5 py-1.5 rounded font-bold text-xs">
                السجل: {journalEntries.length} قيد
              </div>
            </div>
          </div>

          {/* Daybook Stat Summary Ticker */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
            <div className="bg-slate-900 text-white p-2.5 sm:p-4 rounded-sm border-r-4 border-r-amber-400 space-y-0.5 shadow-sm">
              <span className="text-[10px] sm:text-[11px] text-amber-400 font-bold block">مقبوضات (مدين)</span>
              <div className="text-sm sm:text-xl font-black font-mono text-amber-400">
                $ {totalJournalDebitUSD.toLocaleString()}
              </div>
            </div>

            <div className="bg-slate-900 text-white p-2.5 sm:p-4 rounded-sm border-r-4 border-r-rose-500 space-y-0.5 shadow-sm">
              <span className="text-[10px] sm:text-[11px] text-rose-400 font-bold block">مدفوعات (دائن)</span>
              <div className="text-sm sm:text-xl font-black font-mono text-rose-400">
                $ {totalJournalCreditUSD.toLocaleString()}
              </div>
            </div>

            <div className="bg-slate-900 text-white p-2.5 sm:p-4 rounded-sm border-r-4 border-r-emerald-400 space-y-0.5 shadow-sm">
              <span className="text-[10px] sm:text-[11px] text-emerald-400 font-bold block">صافي الحركة اليومية</span>
              <div className="text-sm sm:text-xl font-black font-mono text-emerald-300">
                $ {(totalJournalDebitUSD - totalJournalCreditUSD).toLocaleString()}
              </div>
            </div>

            <div className="bg-slate-900 text-white p-2.5 sm:p-4 rounded-sm border-r-4 border-r-amber-300 space-y-0.5 shadow-sm">
              <span className="text-[10px] sm:text-[11px] text-amber-300 font-bold block">عدد القيود</span>
              <div className="text-sm sm:text-xl font-black font-mono text-amber-200">
                {journalEntries.length} قيود
              </div>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="bg-white p-2.5 sm:p-4 rounded-sm border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-2 sm:gap-4 text-xs">
            <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-sm w-full sm:w-auto font-bold">
              <button
                onClick={() => setJournalDateRange('today')}
                className={`px-3 py-1.5 rounded-sm transition text-[11px] sm:text-xs ${
                  journalDateRange === 'today' ? 'bg-amber-400 text-slate-900 font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                قيود اليوم
              </button>
              <button
                onClick={() => setJournalDateRange('all')}
                className={`px-3 py-1.5 rounded-sm transition text-[11px] sm:text-xs ${
                  journalDateRange === 'all' ? 'bg-amber-400 text-slate-900 font-black' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                السجل الشامل
              </button>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-72">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2" />
                <input
                  type="text"
                  placeholder="ابحث في القيود والشروحات..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pr-8 pl-2 py-1.5 bg-slate-50 border border-slate-200 rounded-sm text-slate-800 font-medium text-xs"
                />
              </div>

              <button
                onClick={() => window.print()}
                className="bg-slate-900 hover:bg-slate-800 text-amber-400 px-3 py-1.5 rounded-sm font-bold shadow-sm flex items-center gap-1 shrink-0 text-xs"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة</span>
              </button>
            </div>
          </div>

          {/* Professional Daybook Table (Desktop) & Single-Line Rows (Mobile) */}
          <div className="bg-white rounded-sm border border-slate-200 shadow-sm overflow-hidden">
            {/* MOBILE DAYBOOK SINGLE-LINE ROWS */}
            <div className="block sm:hidden divide-y divide-slate-100">
              {journalEntries.length === 0 ? (
                <div className="p-6 text-center text-slate-500 font-sans text-xs">
                  لا يوجد قيود يومية مطابقة للبحث في هذا التاريخ.
                </div>
              ) : (
                journalEntries.map(entry => (
                  <div key={entry.id} className="p-3 space-y-2.5 bg-white hover:bg-amber-50/50 transition font-mono text-xs">
                    <div className="flex items-start gap-1.5 min-w-0">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                          entry.type === 'مبيعات' || entry.type === 'سند قبض'
                            ? 'bg-emerald-100 text-emerald-900'
                            : entry.type === 'مشتريات' || entry.type === 'سند صرف'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-rose-100 text-rose-900'
                        }`}
                      >
                        {entry.type}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-slate-900 text-[11px] truncate font-sans flex items-center gap-1">
                          <span>{entry.entityName}</span>
                          <span className="text-[10px] text-slate-400 font-mono font-normal">#{entry.refNumber}</span>
                        </div>
                        <div className="text-xs leading-5 text-slate-600 whitespace-normal font-sans">{entry.description}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-right">
                      {entry.debitUSD > 0 && <span className="rounded-sm bg-emerald-50 px-2 py-1.5 font-black text-emerald-700 text-xs before:content-['مدين'] before:block before:mb-0.5 before:text-[9px] before:font-bold before:text-emerald-600">+${entry.debitUSD.toFixed(0)}</span>}
                      {entry.creditUSD > 0 && <span className="rounded-sm bg-rose-50 px-2 py-1.5 font-black text-rose-700 text-xs before:content-['دائن'] before:block before:mb-0.5 before:text-[9px] before:font-bold before:text-rose-600">-${entry.creditUSD.toFixed(0)}</span>}
                      {entry.goldWeightGrams !== 0 && <span className="font-extrabold text-amber-800 text-[11px]">{entry.goldWeightGrams}غ</span>}
                      <span className="rounded-sm bg-slate-50 px-2 py-1.5 text-[10px] text-slate-500 font-sans before:content-['التاريخ'] before:block before:mb-0.5 before:text-[9px] before:font-bold before:text-slate-400">{entry.date.split(' ')[0]}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* DESKTOP TABLE VIEW */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-amber-400 text-slate-900 font-extrabold border-b border-amber-300 uppercase">
                  <tr>
                    <th className="py-3 px-3">التاريخ</th>
                    <th className="py-3 px-3">الرقم المرجعي</th>
                    <th className="py-3 px-3">طبيعة القيد</th>
                    <th className="py-3 px-4">الحساب / الجهة</th>
                    <th className="py-3 px-5">البيان والشرح المحاسبي</th>
                    <th className="py-3 px-3 text-left">مدين / دخل ($)</th>
                    <th className="py-3 px-3 text-left">دائن / خرج ($)</th>
                    <th className="py-3 px-3 text-center">حركة الذهب (غ)</th>
                    <th className="py-3 px-3 text-center">المستخدم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800 font-mono">
                  {journalEntries.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500 font-sans">
                        لا يوجد قيود يومية مطابقة للبحث في هذا التاريخ.
                      </td>
                    </tr>
                  ) : (
                    journalEntries.map(entry => (
                      <tr key={entry.id} className="hover:bg-amber-50/50 transition">
                        <td className="py-3 px-3 text-slate-600">{entry.date}</td>
                        <td className="py-3 px-3 font-bold text-slate-900">{entry.refNumber}</td>
                        <td className="py-3 px-3 font-sans">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              entry.type === 'مبيعات' || entry.type === 'سند قبض'
                                ? 'bg-emerald-100 text-emerald-900'
                                : entry.type === 'مشتريات' || entry.type === 'سند صرف'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-rose-100 text-rose-900'
                            }`}
                          >
                            {entry.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-900 font-sans">{entry.entityName}</td>
                        <td className="py-3 px-5 font-sans text-slate-700">{entry.description}</td>
                        <td className="py-3 px-3 text-left font-bold text-emerald-700">
                          {entry.debitUSD > 0 ? `$ ${entry.debitUSD.toFixed(2)}` : '-'}
                        </td>
                        <td className="py-3 px-3 text-left font-bold text-rose-700">
                          {entry.creditUSD > 0 ? `$ ${entry.creditUSD.toFixed(2)}` : '-'}
                        </td>
                        <td className="py-3 px-3 text-center font-bold">
                          {entry.goldWeightGrams !== 0 ? (
                            <span className={entry.goldWeightGrams > 0 ? 'text-emerald-700' : 'text-amber-800'}>
                              {entry.goldWeightGrams > 0 ? '+' : ''}{entry.goldWeightGrams.toFixed(2)} غ
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="py-3 px-3 text-center font-sans text-slate-600">{entry.operatorName}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SUB-SCREEN 4: المصاريف والتشغيل (EXPENSES DEDICATED SCREEN) */}
      {/* ========================================================================= */}
      {currentSubTab === 'expenses' && (
        <div className="space-y-3 sm:space-y-6">
          {/* Dedicated Screen Header */}
          <div className="bg-white p-3 sm:p-5 rounded-sm border-r-4 border-r-rose-500 border-slate-200 border shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
            <div>
              <div className="flex items-center gap-1.5 text-rose-600 font-bold text-[11px] sm:text-xs uppercase tracking-wider mb-0.5">
                <Coins className="w-3.5 h-3.5 text-rose-600" />
                <span>الإدارة المالية - المصاريف التشغيلية</span>
              </div>
              <h2 className="text-base sm:text-2xl font-black text-slate-900">
                قسم إدارة المصاريف التشغيلية والإيجارات
              </h2>
              <p className="hidden sm:block text-xs text-slate-500 font-medium mt-1">
                شاشة مستقلة لتسجيل نفقات وإيجارات وفواتير صيانة المعرض التشغيلية وتتبع نفقات المحل.
              </p>
            </div>

            <div className="bg-rose-50 border border-rose-200 text-rose-950 px-2.5 py-1.5 rounded text-xs font-mono font-bold">
              <span>المصاريف: </span>
              <span className="text-rose-700 text-xs sm:text-sm font-black">${totalExpenseUSD.toLocaleString()}</span>
            </div>
          </div>

          {/* Expenses Category Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4">
            <div className="bg-slate-900 text-white p-2.5 sm:p-5 rounded-sm border-r-4 border-r-rose-500 shadow-sm space-y-0.5">
              <span className="text-[10px] sm:text-xs font-bold text-rose-400 uppercase tracking-wider block">
                المصاريف التشغيلية ($)
              </span>
              <div className="text-sm sm:text-3xl font-black font-mono text-rose-400">
                $ {totalExpenseUSD.toLocaleString()}
              </div>
              <p className="hidden sm:block text-[11px] text-slate-400 font-medium pt-1">
                تُخصم أوتوماتيكياً من الصندوق عند الصرف
              </p>
            </div>

            <div className="bg-slate-900 text-white p-2.5 sm:p-5 rounded-sm border-r-4 border-r-amber-400 shadow-sm space-y-0.5">
              <span className="text-[10px] sm:text-xs font-bold text-amber-400 uppercase tracking-wider block">
                عدد الفواتير
              </span>
              <div className="text-sm sm:text-3xl font-black font-mono text-amber-300">
                {expenseVouchers.length} سندات
              </div>
              <p className="hidden sm:block text-[11px] text-slate-400 font-medium pt-1">
                موثقة تفصيلياً مع أسباب الصرف
              </p>
            </div>

            <div className="col-span-2 sm:col-span-1 bg-slate-900 text-white p-2.5 sm:p-5 rounded-sm border-r-4 border-r-amber-300 shadow-sm space-y-0.5">
              <span className="text-[10px] sm:text-xs font-bold text-amber-200 uppercase tracking-wider block">
                البند الأكثر استهلاكاً
              </span>
              <div className="text-xs sm:text-lg font-black text-amber-100 truncate">
                مصاريف كهرباء وتشغيل طاقة
              </div>
              <p className="hidden sm:block text-[11px] text-slate-400 font-medium pt-1">
                تشغيل المولدات والمحل
              </p>
            </div>
          </div>

          {/* EMBEDDED FAST EXPENSE ENTRY CARD */}
          <div className="flex items-center justify-between gap-2 rounded-sm border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex gap-2 flex-1"><button onClick={() => setShowExpenseForm(true)} className="flex-1 rounded-sm bg-rose-700 px-3 py-2 text-xs font-black text-white flex items-center justify-center gap-1"><Plus className="w-4 h-4" />إنشاء مصروف</button><button onClick={() => setShowExpenseCategoryForm(true)} className="flex-1 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-black text-amber-900">فئة جديدة</button></div>
            <div className="relative"><button onClick={() => setExpenseActionsOpen(value => !value)} className="rounded-sm border border-slate-200 bg-slate-50 p-2 text-slate-800"><MoreVertical className="w-4 h-4" /></button>{expenseActionsOpen && <div className="absolute left-0 top-full z-20 mt-1 w-40 rounded-sm border-2 border-slate-900 bg-white py-1 shadow-xl text-xs"><button onClick={() => window.print()} className="w-full px-3 py-2 text-right hover:bg-amber-50">طباعة المصاريف</button><button onClick={() => window.print()} className="w-full px-3 py-2 text-right hover:bg-amber-50 flex items-center gap-1"><FileDown className="w-3.5 h-3.5" />تصدير PDF</button><button onClick={() => { const text = `تقرير المصاريف\n${expenseVouchers.map(exp => `${exp.category}: $${exp.amountUSD.toFixed(2)} — ${exp.statement}`).join('\n')}\nالإجمالي: $${totalExpenseUSD.toFixed(2)}`; window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer'); setExpenseActionsOpen(false); }} className="w-full px-3 py-2 text-right hover:bg-emerald-50 text-emerald-800 flex items-center gap-1"><Share2 className="w-3.5 h-3.5" />مشاركة واتساب</button></div>}</div>
          </div>
          <div className="hidden bg-amber-50/90 border-2 border-amber-300 p-3 sm:p-6 rounded-sm shadow-sm space-y-3">
            <div className="flex items-center gap-1.5 text-slate-900 font-black text-xs sm:text-base border-b border-amber-200 pb-2">
              <Coins className="w-4 h-4 text-amber-700" />
              <span>تسجيل مصروف تشغيلي جديد مباشرة في الحسابات</span>
            </div>

            <form onSubmit={handleSaveQuickExpense} className="grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-3 text-xs font-bold items-end">
              <div>
                <label className="block text-slate-700 mb-0.5">فئة المصروف:</label>
                <select
                  value={expCategory}
                  onChange={e => setExpCategory(e.target.value)}
                  className="w-full p-2 bg-white border border-amber-300 rounded-sm text-slate-900"
                >
                  {availableExpenseCategories.map(cat => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-700 mb-0.5">المبلغ ($):</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="المبلغ $..."
                  value={expAmountUSD}
                  onChange={e => {
                    const val = e.target.value;
                    setExpAmountUSD(val);
                    if (val && !isNaN(parseFloat(val))) {
                      setExpAmountSYP((parseFloat(val) * settings.usdToSypRate).toString());
                    }
                  }}
                  className="w-full p-2 bg-white border border-amber-300 rounded-sm font-mono text-slate-900"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-0.5">المبلغ (ل.س):</label>
                <input
                  type="number"
                  step="1000"
                  placeholder="المبلغ ل.س..."
                  value={expAmountSYP}
                  onChange={e => setExpAmountSYP(e.target.value)}
                  className="w-full p-2 bg-white border border-amber-300 rounded-sm font-mono text-slate-900"
                />
              </div>

              <div>
                <label className="block text-slate-700 mb-0.5">المستفيد:</label>
                <input
                  type="text"
                  placeholder="اسم الشخص / الورشة..."
                  value={expPayee}
                  onChange={e => setExpPayee(e.target.value)}
                  className="w-full p-2 bg-white border border-amber-300 rounded-sm font-sans"
                />
              </div>

              <div className="sm:col-span-3">
                <label className="block text-slate-700 mb-0.5">الشرح والتفاصيل:</label>
                <input
                  type="text"
                  placeholder="مثال: فاتورة كهرباء لشهر آب..."
                  value={expStatement}
                  onChange={e => setExpStatement(e.target.value)}
                  className="w-full p-2 bg-white border border-amber-300 rounded-sm font-sans"
                  required
                />
              </div>

              <button
                type="submit"
                className="w-full bg-rose-700 hover:bg-rose-800 text-white font-black p-2 rounded-sm shadow-sm transition flex items-center justify-center gap-1 text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>+ ترحيل المصروف</span>
              </button>
            </form>
          </div>

          {/* Expenses Log Table (Desktop) & Rows (Mobile) */}
          <div className="bg-white rounded-sm border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-2.5 sm:p-4 border-b border-slate-100 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-900">سجل فواتير المصاريف</span>
              <span className="text-slate-500 font-mono font-bold">
                الإجمالي: ${totalExpenseUSD.toFixed(2)}
              </span>
            </div>

            {/* MOBILE EXPENSE COMPACT ROWS VIEW */}
            <div className="block sm:hidden divide-y divide-slate-100">
              {expenseVouchers.length === 0 ? (
                <div className="p-6 text-center text-slate-500 font-medium text-xs">
                  لا يوجد مصاريف مسجلة حتى الآن.
                </div>
              ) : (
                expenseVouchers.map(exp => (
                  <div key={exp.id} className="p-2 flex items-center justify-between gap-2 bg-white hover:bg-amber-50/50 transition font-mono text-xs">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="bg-rose-100 text-rose-900 px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 font-sans">
                        {exp.category}
                      </span>
                      <div className="min-w-0 flex-1 font-sans">
                        <div className="font-bold text-slate-900 text-xs truncate">
                          {exp.statement}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono">#{exp.voucherNumber}</div>
                      </div>
                    </div>

                    <div className="text-left shrink-0">
                      <div className="font-black text-rose-700 text-xs">${exp.amountUSD.toFixed(0)}</div>
                      <div className="text-[9px] text-slate-400 font-sans">{exp.date.split(' ')[0]}</div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* DESKTOP TABLE VIEW */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-amber-400 text-slate-900 font-extrabold border-b border-amber-300 uppercase">
                  <tr>
                    <th className="py-3 px-4">رقم السند</th>
                    <th className="py-3 px-3">التاريخ</th>
                    <th className="py-3 px-4">الفئة / التصنيف</th>
                    <th className="py-3 px-5">الشرح والتفاصيل</th>
                    <th className="py-3 px-3 text-left">المبلغ ($)</th>
                    <th className="py-3 px-3 text-left">المبلغ (ل.س)</th>
                    <th className="py-3 px-3 text-center">المستخدم</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                  {expenseVouchers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 font-medium">
                        لا يوجد مصاريف مسجلة حتى الآن.
                      </td>
                    </tr>
                  ) : (
                    expenseVouchers.map(exp => (
                      <tr key={exp.id} className="hover:bg-amber-50/50 transition">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">{exp.voucherNumber}</td>
                        <td className="py-3 px-3 font-mono text-slate-600">{exp.date}</td>
                        <td className="py-3 px-4">
                          <span className="bg-rose-100 text-rose-900 px-2 py-0.5 rounded text-[11px] font-bold">
                            {exp.category}
                          </span>
                        </td>
                        <td className="py-3 px-5 text-slate-700">{exp.statement}</td>
                        <td className="py-3 px-3 font-mono font-bold text-left text-rose-700">
                          $ {exp.amountUSD.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 font-mono font-bold text-left text-amber-950">
                          {exp.amountSYP.toLocaleString('ar-SY')} ل.س
                        </td>
                        <td className="py-3 px-3 text-center text-slate-600">{exp.createdBy}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PRINTABLE VOUCHER MODAL */}
      {false && activeVoucherMenu && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4" onClick={() => setActiveVoucherMenu(null)}>
          <div className={`w-full max-w-sm rounded-sm border-2 p-3 shadow-2xl ${activeVoucherMenu.type === 'receipt' ? 'border-emerald-500 bg-emerald-50' : 'border-rose-500 bg-rose-50'}`} onClick={event => event.stopPropagation()}>
            <div className={`mb-2 flex items-center gap-2 border-b pb-3 text-sm font-black ${activeVoucherMenu.type === 'receipt' ? 'border-emerald-200 text-emerald-950' : 'border-rose-200 text-rose-950'}`}>
              {activeVoucherMenu.type === 'receipt' ? <ArrowUpRight className="h-5 w-5" /> : <ArrowDownLeft className="h-5 w-5" />}
              <span>إجراءات السند {activeVoucherMenu.voucherNumber}</span>
            </div>
            <button onClick={() => { setSelectedVoucherForPrint(activeVoucherMenu); setActiveVoucherMenu(null); }} className="w-full rounded-sm px-3 py-3 text-right text-xs font-bold hover:bg-white/70">معاينة وطباعة</button>
            <button onClick={() => { setSelectedVoucherForPrint(activeVoucherMenu); setActiveVoucherMenu(null); setTimeout(() => window.print(), 200); }} className="w-full rounded-sm px-3 py-3 text-right text-xs font-bold hover:bg-white/70">تصدير PDF</button>
            <button onClick={() => handleEditVoucher(activeVoucherMenu)} className="w-full rounded-sm px-3 py-3 text-right text-xs font-bold hover:bg-white/70">تعديل السند</button>
            <button onClick={() => { const reason = window.prompt('سبب إلغاء السند:'); if (reason?.trim()) void runFinanceAction(() => financeApi.cancelVoucher(activeVoucherMenu.id, reason.trim())); setActiveVoucherMenu(null); }} className="w-full rounded-sm px-3 py-3 text-right text-xs font-black text-rose-800 hover:bg-rose-100">إلغاء وعكس السند</button>
          </div>
        </div>
      )}

      {showExpenseForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"><form onSubmit={handleSaveQuickExpense} className="w-full max-w-lg rounded-sm border-2 border-slate-900 bg-white p-5 shadow-2xl space-y-3"><div className="flex items-center justify-between border-b border-slate-200 pb-3"><h3 className="font-black text-slate-900">إنشاء مصروف جديد</h3><button type="button" onClick={() => setShowExpenseForm(false)} className="p-1 text-slate-500"><X className="w-5 h-5" /></button></div><div className="grid grid-cols-2 gap-3 text-xs font-bold"><div className="col-span-2"><label className="mb-1 block text-slate-700">فئة المصروف</label><select value={expCategory} onChange={event => setExpCategory(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5">{availableExpenseCategories.map(category => <option key={category} value={category}>{category}</option>)}</select></div><div><label className="mb-1 block text-slate-700">المبلغ ($)</label><input required type="number" min="0.01" step="0.01" value={expAmountUSD} onChange={event => { setExpAmountUSD(event.target.value); if (event.target.value) setExpAmountSYP((Number(event.target.value) * settings.usdToSypRate).toString()); }} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5 font-mono" /></div><div><label className="mb-1 block text-slate-700">المبلغ (ل.س)</label><input type="number" value={expAmountSYP} onChange={event => setExpAmountSYP(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5 font-mono" /></div><div className="col-span-2"><label className="mb-1 block text-slate-700">المستفيد</label><input value={expPayee} onChange={event => setExpPayee(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5" /></div><div className="col-span-2"><label className="mb-1 block text-slate-700">الشرح</label><input required value={expStatement} onChange={event => setExpStatement(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5" /></div></div><div className="flex justify-end gap-2 border-t border-slate-200 pt-3"><button type="button" onClick={() => setShowExpenseForm(false)} className="rounded-sm bg-slate-100 px-4 py-2 text-xs font-bold">إلغاء</button><button type="submit" className="rounded-sm bg-rose-700 px-5 py-2 text-xs font-black text-white">حفظ المصروف</button></div></form></div>
      )}

      {showExpenseCategoryForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"><form onSubmit={handleAddExpenseCategory} className="w-full max-w-sm rounded-sm border-2 border-slate-900 bg-white p-5 shadow-2xl space-y-4"><div className="flex items-center justify-between border-b border-slate-200 pb-3"><h3 className="font-black text-slate-900">تعريف فئة مصروف</h3><button type="button" onClick={() => setShowExpenseCategoryForm(false)} className="p-1 text-slate-500"><X className="w-5 h-5" /></button></div><div><label className="mb-1 block text-xs font-bold text-slate-700">اسم الفئة الجديدة</label><input autoFocus required value={newExpenseCategory} onChange={event => setNewExpenseCategory(event.target.value)} placeholder="مثال: صيانة أجهزة" className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5 text-sm" /></div><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowExpenseCategoryForm(false)} className="rounded-sm bg-slate-100 px-4 py-2 text-xs font-bold">إلغاء</button><button type="submit" className="rounded-sm bg-amber-400 px-5 py-2 text-xs font-black text-slate-900">حفظ الفئة</button></div></form></div>
      )}

      {showCashBoxForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <form onSubmit={handleAddCashBox} className="w-full max-w-md rounded-sm border-2 border-slate-900 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3"><h3 className="font-black text-slate-900">إضافة صندوق جديد</h3><button type="button" onClick={() => setShowCashBoxForm(false)} className="p-1 text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button></div>
            <div><label className="mb-1 block text-xs font-bold text-slate-700">اسم الصندوق *</label><input autoFocus required value={cashBoxName} onChange={event => setCashBoxName(event.target.value)} placeholder="مثال: صندوق فرع الجميلية" className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5 text-sm" /></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="mb-1 block text-xs font-bold text-slate-700">العملة *</label><select value={cashBoxCurrency} onChange={event => setCashBoxCurrency(event.target.value as 'USD' | 'SYP')} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5 text-sm font-bold"><option value="USD">دولار USD</option><option value="SYP">ليرة سورية SYP</option></select></div><div><label className="mb-1 block text-xs font-bold text-slate-700">الرصيد الافتتاحي *</label><input required min="0" step="0.01" type="number" value={cashBoxOpeningBalance} onChange={event => setCashBoxOpeningBalance(event.target.value)} placeholder="0.00" className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5 font-mono text-sm" /></div></div>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3"><button type="button" onClick={() => setShowCashBoxForm(false)} className="rounded-sm bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700">إلغاء</button><button type="submit" className="rounded-sm bg-amber-400 px-5 py-2 text-xs font-black text-slate-900">حفظ الصندوق</button></div>
          </form>
        </div>
      )}

      {showTransferForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <form onSubmit={handleExecuteTransfer} className="w-full max-w-lg rounded-sm border-2 border-slate-900 bg-white p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3"><div className="flex items-center gap-2"><ArrowRightLeft className="w-5 h-5 text-amber-700" /><h3 className="font-black text-slate-900">مناقلة بين الصناديق</h3></div><button type="button" onClick={() => setShowTransferForm(false)} className="p-1 text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs font-bold"><div><label className="mb-1 block text-slate-700">من صندوق</label><select value={fromBoxId} onChange={event => setFromBoxId(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5">{cashBoxes.map(box => <option key={box.id} value={box.id}>{box.name} ({box.currency})</option>)}</select></div><div><label className="mb-1 block text-slate-700">إلى صندوق</label><select value={toBoxId} onChange={event => setToBoxId(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5">{cashBoxes.map(box => <option key={box.id} value={box.id}>{box.name} ({box.currency})</option>)}</select></div><div><label className="mb-1 block text-slate-700">المبلغ المخصوم *</label><input required min="0.01" step="0.01" type="number" value={transferAmountFrom} onChange={event => setTransferAmountFrom(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5 font-mono" /></div><div><label className="mb-1 block text-slate-700">المبلغ المستلم</label><input min="0" step="0.01" type="number" value={transferAmountTo} onChange={event => setTransferAmountTo(event.target.value)} placeholder="يحسب تلقائياً عند اختلاف العملة" className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5 font-mono" /></div></div>
            <p className="rounded-sm bg-amber-50 p-2 text-[11px] text-amber-900">يُحسب التحويل بين الدولار والليرة تلقائياً بسعر الصرف المعتمد إذا تُرك المبلغ المستلم فارغاً.</p>
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3"><button type="button" onClick={() => setShowTransferForm(false)} className="rounded-sm bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700">إلغاء</button><button type="submit" className="rounded-sm bg-slate-900 px-5 py-2 text-xs font-black text-amber-400">تنفيذ المناقلة</button></div>
          </form>
        </div>
      )}

      {selectedVoucherForPrint && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className={`rounded-sm border-2 shadow-2xl max-w-2xl w-full p-6 text-right space-y-6 ${selectedVoucherForPrint.type === 'receipt' ? 'border-emerald-500 bg-emerald-50' : selectedVoucherForPrint.type === 'payment' ? 'border-rose-500 bg-rose-50' : 'border-amber-400 bg-amber-50'}`}>
            {/* Header Voucher */}
            <div className="flex items-center justify-between border-b-2 border-slate-900 pb-4">
              <div>
                <h3 className="text-xl font-black text-slate-900">{settings.storeName}</h3>
                <p className="text-xs text-slate-500 font-bold">{settings.address} | هاتف: {settings.phone}</p>
              </div>
              <div className="text-left font-mono">
                <div className="text-lg font-black text-amber-900">{selectedVoucherForPrint.voucherNumber}</div>
                <div className="text-xs text-slate-500 font-bold">{selectedVoucherForPrint.date}</div>
              </div>
            </div>

            <div className={`text-center border py-2 font-black text-lg text-slate-900 rounded-sm ${selectedVoucherForPrint.type === 'receipt' ? 'border-emerald-300 bg-emerald-100' : selectedVoucherForPrint.type === 'payment' ? 'border-rose-300 bg-rose-100' : 'border-amber-300 bg-amber-100'}`}>
              {selectedVoucherForPrint.type === 'receipt'
                ? 'سند قبض مالي رسمـي'
                : selectedVoucherForPrint.type === 'payment'
                ? 'سند صرف مالي رسمـي'
                : 'سند مصروف تشغيلي'}
            </div>

            <div className="space-y-3 text-sm font-bold text-slate-800">
              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">استلمنا من / صرفنا إلى:</span>
                <span className="text-slate-900 text-base">
                  {selectedVoucherForPrint.partnerName || selectedVoucherForPrint.category || 'حساب عام'}
                </span>
              </div>

              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">المبلغ بالدولار:</span>
                <span className={`font-mono text-base font-black ${selectedVoucherForPrint.type === 'payment' ? 'text-rose-800' : 'text-emerald-800'}`}>
                  $ {selectedVoucherForPrint.amountUSD.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">المبلغ بالليرة السورية:</span>
                <span className="font-mono text-base font-black text-slate-900">
                  {selectedVoucherForPrint.amountSYP.toLocaleString('ar-SY')} ل.س
                </span>
              </div>

              <div className="flex justify-between border-b border-slate-100 pb-2">
                <span className="text-slate-500">البيان والشرح:</span>
                <span className="text-slate-900">{selectedVoucherForPrint.statement}</span>
              </div>
            </div>

            {/* Signatures */}
            <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-200 text-center text-xs font-bold text-slate-700">
              <div>
                <p>توقيع المستلم / الدافع</p>
                <div className="h-12 border-b border-dashed border-slate-300 mt-2"></div>
              </div>
              <div>
                <p>توقيع وختم المحاسب ({selectedVoucherForPrint.createdBy})</p>
                <div className="h-12 border-b border-dashed border-slate-300 mt-2"></div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-4 no-print">
              <button
                onClick={() => setSelectedVoucherForPrint(null)}
                className="px-4 py-2 bg-slate-200 text-slate-800 font-bold rounded-sm text-xs"
              >
                إغلاق
              </button>
              <button
                onClick={() => window.print()}
                className="px-6 py-2 bg-slate-900 hover:bg-slate-800 text-amber-400 font-bold rounded-sm text-xs shadow-sm flex items-center gap-2"
              >
                <Printer className="w-4 h-4" />
                <span>طباعة السند</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
