import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { 
  Scale, 
  TrendingUp, 
  TrendingDown, 
  Coins, 
  Users, 
  FilePlus, 
  PackagePlus, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Sparkles,
  Receipt,
  Building2,
  Clock,
  Settings2
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  PieChart, 
  Pie, 
  Cell, 
  Legend 
} from 'recharts';
import { GoldKarat } from '../types';

interface DashboardProps {
  setActiveTab: (tab: string) => void;
  onNewInvoiceClick?: (type: 'sale' | 'purchase') => void;
}

export const DashboardView: React.FC<DashboardProps> = ({ setActiveTab, onNewInvoiceClick }) => {
  const { 
    inventory, 
    invoices, 
    partners, 
    cashBoxes, 
    goldPrices,
    updateGoldPrices,
    activityLogs, 
    formatMoney, 
    activeCurrency,
    settings 
  } = useStore();
  const [showShortcutSettings, setShowShortcutSettings] = useState(false);
  const [showGoldPriceModal, setShowGoldPriceModal] = useState(false);
  const [quickGoldPrices, setQuickGoldPrices] = useState(() => goldPrices.map(price => ({ ...price })));
  const [shortcutKeys, setShortcutKeys] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('HAMEED_HLIWI_DASHBOARD_SHORTCUTS');
      return saved ? [...new Set([...JSON.parse(saved), 'goldPrice'])] : ['sale', 'purchase', 'voucher', 'inventory', 'partners', 'cash', 'goldPrice'];
    } catch {
      return ['sale', 'purchase', 'voucher', 'inventory', 'partners', 'cash', 'goldPrice'];
    }
  });

  const shortcutOptions = [
    { key: 'sale', label: 'فاتورة بيع', icon: FilePlus, tone: 'bg-emerald-600 text-white' },
    { key: 'purchase', label: 'فاتورة شراء', icon: ArrowDownLeft, tone: 'bg-amber-400 text-slate-900' },
    { key: 'voucher', label: 'السندات', icon: Receipt, tone: 'bg-slate-800 text-amber-400' },
    { key: 'inventory', label: 'إضافة للمخزون', icon: PackagePlus, tone: 'bg-slate-800 text-white' },
    { key: 'partners', label: 'العملاء', icon: Users, tone: 'bg-slate-800 text-white' },
    { key: 'cash', label: 'الصناديق', icon: Building2, tone: 'bg-slate-800 text-white' }
    ,{ key: 'goldPrice', label: 'تحديث سعر الغرام', icon: Coins, tone: 'bg-amber-400 text-slate-900' }
  ];

  const runShortcut = (key: string) => {
    if (key === 'sale') { onNewInvoiceClick?.('sale'); setActiveTab('invoices'); return; }
    if (key === 'purchase') { onNewInvoiceClick?.('purchase'); setActiveTab('invoices'); return; }
    if (key === 'voucher') { setActiveTab('finance-vouchers'); return; }
    if (key === 'inventory') { setActiveTab('inventory'); return; }
    if (key === 'partners') { setActiveTab('partners'); return; }
    if (key === 'goldPrice') { setQuickGoldPrices(goldPrices.map(price => ({ ...price }))); setShowGoldPriceModal(true); return; }
    setActiveTab('finance-boxes');
  };

  const updateQuickGoldPrice = (karat: string, field: 'buyPriceUSDPerGram' | 'sellPriceUSDPerGram' | 'laborFeeUSDPerGram', value: string) => {
    const numericValue = Number(value);
    setQuickGoldPrices(current => current.map(price => price.karat === karat ? { ...price, [field]: Number.isFinite(numericValue) ? numericValue : 0 } : price));
  };

  const applyQuickGoldPrices = () => {
    updateGoldPrices(quickGoldPrices.map(price => ({ ...price, buyPriceSYPPerGram: Math.round(price.buyPriceUSDPerGram * settings.usdToSypRate), sellPriceSYPPerGram: Math.round(price.sellPriceUSDPerGram * settings.usdToSypRate) })));
    setShowGoldPriceModal(false);
  };

  const toggleShortcut = (key: string) => {
    setShortcutKeys(current => {
      const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key];
      localStorage.setItem('HAMEED_HLIWI_DASHBOARD_SHORTCUTS', JSON.stringify(next));
      return next;
    });
  };

  // Calculate total stock weights in grams per karat
  const stockByKarat: Record<GoldKarat, number> = {
    '24': 0,
    '22': 0,
    '21': 0,
    '18': 0,
    '14': 0
  };

  let totalGrossWeight = 0;
  let totalNetWeight = 0;
  let totalStockValueUSD = 0;

  inventory.forEach(item => {
    if (item.status === 'in_stock') {
      stockByKarat[item.karat] = (stockByKarat[item.karat] || 0) + item.netWeightGrams;
      totalGrossWeight += item.grossWeightGrams;
      totalNetWeight += item.netWeightGrams;

      const p = goldPrices.find(g => g.karat === item.karat);
      const pricePerGram = p ? p.sellPriceUSDPerGram : 70;
      totalStockValueUSD += item.netWeightGrams * pricePerGram + item.totalLaborFeeUSD;
    }
  });

  // Calculate Sales & Purchase totals
  const totalSalesUSD = invoices
    .filter(inv => inv.type === 'sale')
    .reduce((acc, inv) => acc + inv.finalTotalUSD, 0);

  const totalPurchasesUSD = invoices
    .filter(inv => inv.type === 'purchase')
    .reduce((acc, inv) => acc + inv.finalTotalUSD, 0);

  // Receivables & Payables
  let customerDebtsUSD = 0;
  let supplierDebtsUSD = 0;
  let customerGoldDebtsGrams = 0;

  partners.forEach(p => {
    if (p.balanceUSD < 0) {
      customerDebtsUSD += Math.abs(p.balanceUSD);
    } else {
      supplierDebtsUSD += p.balanceUSD;
    }
    if (p.goldBalance21kGrams < 0) {
      customerGoldDebtsGrams += Math.abs(p.goldBalance21kGrams);
    }
  });

  // Cash box totals
  const usdCash = cashBoxes.find(b => b.id === 'box-usd')?.balanceAmount || 0;
  const sypCash = cashBoxes.find(b => b.id === 'box-syp')?.balanceAmount || 0;
  const safeCash = cashBoxes.find(b => b.id === 'box-safe')?.balanceAmount || 0;

  // Pie chart data for Karat distribution
  const pieData = [
    { name: 'عيار 21 (الأكثر تداولاً)', value: stockByKarat['21'], color: '#f59e0b' },
    { name: 'عيار 24 (سبائك وعملات)', value: stockByKarat['24'], color: '#eab308' },
    { name: 'عيار 18 (صياغة ناعمة)', value: stockByKarat['18'], color: '#fbbf24' },
    { name: 'عيار 22', value: stockByKarat['22'], color: '#d97706' },
  ].filter(d => d.value > 0);

  // Sales vs Purchases timeline mock data for chart
  const chartTimelineData = [
    { day: 'سبت', مبيعات: 12000, مشتريات: 8500 },
    { day: 'أحد', مبيعات: 18500, مشتريات: 12000 },
    { day: 'إثنين', مبيعات: 15400, مشتريات: 9200 },
    { day: 'ثلاثاء', مبيعات: 22100, مشتريات: 14000 },
    { day: 'أربعاء', مبيعات: 19800, مشتريات: 11500 },
    { day: 'خميس', مبيعات: 28500, مشتريات: 16200 },
    { day: 'جمعة', مبيعات: totalSalesUSD, مشتريات: totalPurchasesUSD },
  ];

  return (
    <div className="space-y-6">
      {/* Top Welcome Banner & Quick Action Buttons */}
      <div className="hidden relative overflow-hidden rounded-sm border border-slate-800 bg-slate-900 p-4 text-white shadow-sm sm:p-6">
        <div className="relative z-10 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2 text-amber-400 font-bold text-xs uppercase tracking-wider mb-1">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>نظام حميد حليوي لتجارة وصياغة الذهب</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-amber-400 tracking-tight">
              لوحة التحكم والشاشة الرئيسية
            </h2>
            <p className="text-slate-300 text-xs mt-1 max-w-xl leading-relaxed">
              عرض لحظي وشامل لبيانات حركة بيع وشراء الذهب، أوزان المخزون بالغرام، السيولة بالدولار والليرة السورية بـ حلب.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <button
              onClick={() => {
                if (onNewInvoiceClick) onNewInvoiceClick('sale');
                setActiveTab('invoices');
              }}
              className="bg-amber-400 hover:bg-amber-300 text-slate-900 px-4 py-2.5 rounded-sm font-bold text-xs shadow flex items-center gap-2 transition"
            >
              <FilePlus className="w-4 h-4" />
              <span>فاتورة بيع جديدة</span>
            </button>

            <button
              onClick={() => {
                if (onNewInvoiceClick) onNewInvoiceClick('purchase');
                setActiveTab('invoices');
              }}
              className="bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 px-4 py-2.5 rounded-sm font-bold text-xs flex items-center gap-2 transition"
            >
              <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
              <span>فاتورة شراء ذهب</span>
            </button>

            <button
              onClick={() => setActiveTab('inventory')}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2.5 rounded-sm font-bold text-xs flex items-center gap-2 transition"
            >
              <PackagePlus className="w-4 h-4 text-amber-400" />
              <span>إضافة قطعة للمخزون</span>
            </button>
            <button onClick={() => setActiveTab('partners')} className="border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700 sm:col-span-1">
              <Users className="ml-1 inline h-4 w-4 text-amber-400" /> العملاء
            </button>
            <button onClick={() => setActiveTab('finance-boxes')} className="border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700 sm:col-span-1">
              <Building2 className="ml-1 inline h-4 w-4 text-amber-400" /> الصناديق
            </button>
          </div>
        </div>
      </div>

      <section className="rounded-sm border border-slate-800 bg-slate-900 p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-black text-amber-400">اختصارات العمل</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">المهام التي تستخدمها يومياً</p>
          </div>
          <button onClick={() => setShowShortcutSettings(true)} aria-label="تخصيص اختصارات الشاشة الرئيسية" className="rounded-sm border border-slate-700 bg-slate-800 p-2 text-amber-400 hover:bg-slate-700"><Settings2 className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {shortcutOptions.filter(shortcut => shortcutKeys.includes(shortcut.key)).map(shortcut => {
            const Icon = shortcut.icon;
            return <button key={shortcut.key} onClick={() => runShortcut(shortcut.key)} className={`flex min-h-16 items-center justify-center gap-2 rounded-sm px-2 py-3 text-xs font-black shadow-sm transition hover:brightness-110 ${shortcut.tone}`}><Icon className="h-4 w-4 shrink-0" /><span>{shortcut.label}</span></button>;
          })}
          {shortcutKeys.length === 0 && <button onClick={() => setShowShortcutSettings(true)} className="col-span-2 border border-dashed border-slate-600 py-4 text-xs font-bold text-slate-300 sm:col-span-3 lg:col-span-6">اختر اختصاراتك من زر المسننات</button>}
        </div>
      </section>

      {showShortcutSettings && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={() => setShowShortcutSettings(false)}>
          <div role="dialog" aria-modal="true" onClick={event => event.stopPropagation()} className="w-full max-w-md rounded-sm border-2 border-amber-400 bg-white p-4 text-right shadow-2xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-3"><h3 className="font-black text-slate-900">تخصيص اختصارات العمل</h3><button onClick={() => setShowShortcutSettings(false)} className="text-xs font-bold text-slate-500">إغلاق</button></div>
            <p className="mb-3 text-xs text-slate-500">اختر المهام التي تظهر في الشاشة الرئيسية.</p>
            <div className="grid grid-cols-2 gap-2">
              {shortcutOptions.map(shortcut => { const Icon = shortcut.icon; const selected = shortcutKeys.includes(shortcut.key); return <button key={shortcut.key} onClick={() => toggleShortcut(shortcut.key)} className={`flex items-center gap-2 border p-3 text-right text-xs font-bold ${selected ? 'border-amber-400 bg-amber-50 text-slate-900' : 'border-slate-200 bg-white text-slate-500'}`}><span className={`flex h-5 w-5 items-center justify-center border text-[10px] ${selected ? 'border-amber-500 bg-amber-400 text-slate-900' : 'border-slate-300 bg-white'}`}>{selected ? '✓' : ''}</span><Icon className="h-4 w-4" />{shortcut.label}</button>; })}
            </div>
          </div>
        </div>
      )}

      {showGoldPriceModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={() => setShowGoldPriceModal(false)}>
          <div role="dialog" aria-modal="true" onClick={event => event.stopPropagation()} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-sm border-2 border-amber-400 bg-white p-4 text-right shadow-2xl sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3 border-b border-slate-200 pb-3"><div><h3 className="flex items-center gap-2 font-black text-slate-900"><Coins className="h-5 w-5 text-amber-600" />تحديث أسعار الذهب للغرام</h3><p className="mt-1 text-[11px] text-slate-500">عدّل أسعار الشراء والبيع ثم طبّقها على الفواتير والمعاملات الجديدة.</p></div><button onClick={() => setShowGoldPriceModal(false)} className="text-xs font-bold text-slate-500">إغلاق</button></div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {quickGoldPrices.map(price => (
                <div key={price.karat} className="border-r-4 border-r-amber-400 border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex justify-between"><span className="font-black text-slate-900">عيار {price.karat}</span><span className="text-[10px] text-slate-500">السعر القديم: بيع $ {goldPrices.find(item => item.karat === price.karat)?.sellPriceUSDPerGram.toFixed(2)}</span></div>
                  <div className="grid grid-cols-3 gap-2 text-xs"><label className="text-slate-600">شراء ($/غ)<input type="number" min="0" step="0.01" value={price.buyPriceUSDPerGram} onChange={event => updateQuickGoldPrice(price.karat, 'buyPriceUSDPerGram', event.target.value)} className="mt-1 w-full border border-emerald-200 bg-white p-2 font-mono font-bold text-emerald-800" /></label><label className="text-slate-600">بيع ($/غ)<input type="number" min="0" step="0.01" value={price.sellPriceUSDPerGram} onChange={event => updateQuickGoldPrice(price.karat, 'sellPriceUSDPerGram', event.target.value)} className="mt-1 w-full border border-amber-300 bg-white p-2 font-mono font-bold text-amber-900" /></label><label className="text-slate-600">صياغة ($/غ)<input type="number" min="0" step="0.01" value={price.laborFeeUSDPerGram ?? 5} onChange={event => updateQuickGoldPrice(price.karat, 'laborFeeUSDPerGram', event.target.value)} className="mt-1 w-full border border-blue-200 bg-white p-2 font-mono font-bold text-blue-800" /></label></div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end gap-2 border-t border-slate-200 pt-3"><button onClick={() => setShowGoldPriceModal(false)} className="bg-slate-100 px-4 py-2 text-xs font-bold text-slate-700">إلغاء</button><button onClick={applyQuickGoldPrices} className="bg-amber-400 px-5 py-2 text-xs font-black text-slate-900 shadow-sm">تطبيق الأسعار الجديدة</button></div>
          </div>
        </div>
      )}

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Metric 1: Total Gold Stock Weight */}
        <div className="border-r-4 border-r-amber-400 border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">إجمالي وزن الذهب بالمخزون</span>
            <div className="w-8 h-8 rounded-sm bg-amber-400/20 text-slate-900 flex items-center justify-center font-bold">
              <Scale className="w-4 h-4 text-amber-600" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 font-mono">
            <span className="text-2xl font-black text-slate-900">{totalNetWeight.toLocaleString('ar-SY', { maximumFractionDigits: 2 })}</span>
            <span className="text-xs font-bold text-amber-700 font-sans">غرام صافي</span>
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono">
            <span className="font-sans">الوزن القائم (مع الأحجار):</span>
            <span className="font-bold text-slate-800">{totalGrossWeight.toFixed(1)} غ</span>
          </div>
        </div>

        {/* Metric 2: Estimated Stock Value */}
        <div className="border-r-4 border-r-slate-900 border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">القيمة التقديرية للمخزون</span>
            <div className="w-8 h-8 rounded-sm bg-slate-900 text-amber-400 flex items-center justify-center font-bold">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {formatMoney(totalStockValueUSD)}
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono">
            <span className="font-sans">العملة الثانوية:</span>
            <span className="font-bold text-slate-800">{formatMoney(totalStockValueUSD, 'SYP')}</span>
          </div>
        </div>

        {/* Metric 3: Total Sales */}
        <div className="border-r-4 border-r-emerald-500 border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">إجمالي مبيعات الذهب</span>
            <div className="w-8 h-8 rounded-sm bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-emerald-700 font-mono">
            {formatMoney(totalSalesUSD)}
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 font-mono">
            <span className="font-sans">فواتير الشراء:</span>
            <span className="font-bold text-slate-800">{formatMoney(totalPurchasesUSD)}</span>
          </div>
        </div>

        {/* Metric 4: Debts & Receivables */}
        <div className="border-r-4 border-r-blue-500 border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">ذمم العملاء (مستحقات لنا)</span>
            <div className="w-8 h-8 rounded-sm bg-blue-100 text-blue-800 flex items-center justify-center font-bold">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {formatMoney(customerDebtsUSD)}
          </div>
          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-mono">
            <span className="text-slate-500 font-sans">ذمم ذهب للعملاء:</span>
            <span className="font-bold text-amber-700">{customerGoldDebtsGrams} غ عيار 21</span>
          </div>
        </div>
      </div>

      {/* Gold Stock Weight Breakdown Pills */}
      <div className="bg-slate-900 border border-slate-800 rounded-sm p-5 text-white shadow-sm">
        <h3 className="text-xs font-bold text-amber-400 mb-3 flex items-center gap-2 uppercase tracking-wider">
          <Coins className="w-4 h-4 text-amber-400" />
          <span>توزيع أوزان المخزون بالمستودعات حسب العيارات (غرام صافي):</span>
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
          <div className="bg-slate-950 border-r-4 border-r-amber-400 border border-slate-800 rounded-sm p-3 text-center">
            <span className="text-[10px] text-slate-400 block mb-1 font-sans font-medium">عيار 21 (مجوهرات)</span>
            <span className="text-lg font-black text-amber-400">
              {stockByKarat['21'].toFixed(1)} <span className="text-xs font-normal font-sans">غرام</span>
            </span>
          </div>

          <div className="bg-slate-950 border-r-4 border-r-amber-400 border border-slate-800 rounded-sm p-3 text-center">
            <span className="text-[10px] text-slate-400 block mb-1 font-sans font-medium">عيار 24 (سبائك صافية)</span>
            <span className="text-lg font-black text-amber-400">
              {stockByKarat['24'].toFixed(1)} <span className="text-xs font-normal font-sans">غرام</span>
            </span>
          </div>

          <div className="bg-slate-950 border-r-4 border-r-amber-400 border border-slate-800 rounded-sm p-3 text-center">
            <span className="text-[10px] text-slate-400 block mb-1 font-sans font-medium">عيار 18 (صياغة)</span>
            <span className="text-lg font-black text-amber-400">
              {stockByKarat['18'].toFixed(1)} <span className="text-xs font-normal font-sans">غرام</span>
            </span>
          </div>

          <div className="bg-slate-950 border-r-4 border-r-amber-400 border border-slate-800 rounded-sm p-3 text-center">
            <span className="text-[10px] text-slate-400 block mb-1 font-sans font-medium">عيار 22</span>
            <span className="text-lg font-black text-amber-400">
              {stockByKarat['22'].toFixed(1)} <span className="text-xs font-normal font-sans">غرام</span>
            </span>
          </div>
        </div>
      </div>

      {/* Analytics Charts Row */}
      <div className="hidden grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sales & Purchases Timeline Chart (2 cols) */}
        <div className="lg:col-span-2 bg-white rounded-sm p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-900 text-sm">حركة المبيعات والمشتريات الرسمية</h3>
              <p className="text-xs text-slate-500">حركة التداول خلال الفترة الحالية مقومة بالدولار ($)</p>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold">
              <div className="flex items-center gap-1 text-amber-600">
                <span className="w-3 h-3 rounded-sm bg-amber-500 inline-block"></span>
                <span>المبيعات</span>
              </div>
              <div className="flex items-center gap-1 text-emerald-600">
                <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block"></span>
                <span>المشتريات</span>
              </div>
            </div>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartTimelineData}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorPurchases" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip 
                  formatter={(val: any) => `$ ${Number(val).toLocaleString()}`}
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#f59e0b', borderRadius: '4px', color: '#fff' }}
                />
                <Area type="monotone" dataKey="مبيعات" stroke="#f59e0b" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
                <Area type="monotone" dataKey="مشتريات" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorPurchases)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Karats Distribution Pie Chart (1 col) */}
        <div className="bg-white rounded-sm p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm mb-1">توزيع عيارات الذهب بالمخزون</h3>
            <p className="text-xs text-slate-500">نسب أوزان الجرامات المتاحة للبيع بالمحل</p>
          </div>

          <div className="h-52 my-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: any) => `${Number(val).toFixed(1)} غرام`} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-1.5 text-xs border-t border-slate-100 pt-3">
            {pieData.map(item => (
              <div key={item.name} className="flex items-center justify-between text-slate-600">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color }}></span>
                  <span>{item.name}</span>
                </div>
                <span className="font-bold text-slate-900 font-mono">{item.value.toFixed(1)} غ</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Cash Box Summary & Recent Activity Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cash Boxes & Safes Summary */}
        <div className="bg-white rounded-sm p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-amber-600" />
              <h3 className="font-bold text-slate-900 text-sm">حركة الصناديق والخزائن الحالية</h3>
            </div>
            <button
              onClick={() => setActiveTab('finance')}
              className="text-xs font-bold text-amber-600 hover:underline"
            >
              عرض التفاصيل والمالية ←
            </button>
          </div>

          <div className="space-y-3 font-mono">
            <div className="p-3.5 rounded-sm bg-slate-50 border border-slate-200 border-r-4 border-r-amber-400 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-900 text-xs block font-sans">صندوق الدولار الرئيسي ($)</span>
                <span className="text-[10px] text-slate-500 font-sans">سيولة النقد للعمليات اليومية</span>
              </div>
              <span className="text-lg font-black text-slate-900">$ {usdCash.toLocaleString()}</span>
            </div>

            <div className="p-3.5 rounded-sm bg-slate-50 border border-slate-200 border-r-4 border-r-slate-800 flex items-center justify-between">
              <div>
                <span className="font-bold text-slate-900 text-xs block font-sans">صندوق الليرة السورية (ل.س)</span>
                <span className="text-[10px] text-slate-500 font-sans">سيولة المحل بالليرة السورية</span>
              </div>
              <span className="text-lg font-black text-slate-900">{sypCash.toLocaleString('ar-SY')} ل.س</span>
            </div>

            <div className="p-3.5 rounded-sm bg-slate-900 text-white flex items-center justify-between border-r-4 border-r-amber-400">
              <div>
                <span className="font-bold text-amber-400 text-xs block font-sans">الخزنة المركزية ($)</span>
                <span className="text-[10px] text-slate-400 font-sans">الأمانات الاحتياطية</span>
              </div>
              <span className="text-lg font-black text-amber-400">$ {safeCash.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Recent System Activity Log */}
        <div className="bg-white rounded-sm p-5 border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-amber-600" />
              <h3 className="font-bold text-slate-900 text-sm">أحدث النشاطات والحركات بالنظام</h3>
            </div>
            <span className="text-xs text-slate-400 font-mono">سجل لحظي مباشر</span>
          </div>

          <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
            {activityLogs.slice(0, 5).map(log => (
              <div key={log.id} className="p-2.5 rounded-sm bg-slate-50 border border-slate-200 text-xs flex items-start gap-3">
                <div className="w-2 h-2 rounded-sm bg-amber-400 mt-1.5 shrink-0"></div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800">{log.action}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{log.timestamp}</span>
                  </div>
                  <p className="text-slate-600 mt-0.5">{log.details}</p>
                  <span className="text-[10px] text-amber-700 font-semibold mt-1 block">بواسطة: {log.userName}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
