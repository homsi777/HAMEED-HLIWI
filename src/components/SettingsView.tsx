import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { BackupPanel } from './BackupPanel';
import { GoldPriceSetting } from '../types';
import { 
  Settings, 
  Save, 
  Coins, 
  DollarSign, 
  RefreshCw, 
  RotateCcw, 
  Building2, 
  CheckCircle2, 
  ShieldAlert,
  Percent
} from 'lucide-react';

type GoldPriceInputField = 'buyPriceUSDPerGram' | 'sellPriceUSDPerGram' | 'laborFeeUSDPerGram';
const karatPurity: Record<string, number> = { '24': 1, '22': 22 / 24, '21': 21 / 24, '18': 18 / 24, '14': 14 / 24 };

const priceInputKey = (karat: string, field: GoldPriceInputField) => `${karat}-${field}`;

const priceInputValuesFrom = (prices: GoldPriceSetting[]) => prices.reduce<Record<string, string>>((values, price) => {
  values[priceInputKey(price.karat, 'buyPriceUSDPerGram')] = String(price.buyPriceUSDPerGram);
  values[priceInputKey(price.karat, 'sellPriceUSDPerGram')] = String(price.sellPriceUSDPerGram);
  values[priceInputKey(price.karat, 'laborFeeUSDPerGram')] = String(price.laborFeeUSDPerGram ?? '');
  return values;
}, {});

export const SettingsView: React.FC = () => {
  const { settings, goldPrices, updateSettings, updateGoldPrices, resetToDefaultData, settingsProvisional } = useStore();

  const [storeName, setStoreName] = useState(settings.storeName);
  const [address, setAddress] = useState(settings.address);
  const [phone1, setPhone1] = useState(settings.phone1);
  const [phone2, setPhone2] = useState(settings.phone2);
  const [usdToSypRate, setUsdToSypRate] = useState(settings.usdToSypRate.toString());
  const [baseOunceUSD, setBaseOunceUSD] = useState(settings.baseGoldOunceUSD.toString());
  const [buyMargin, setBuyMargin] = useState(settings.buyMarginPercent.toString());
  const [sellMargin, setSellMargin] = useState(settings.sellMarginPercent.toString());
  const [priceDraft, setPriceDraft] = useState(() => goldPrices.map(price => ({ ...price })));
  const [priceInputValues, setPriceInputValues] = useState(() => priceInputValuesFrom(goldPrices));

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError('');
    const rate = parseFloat(usdToSypRate) || 15200;
    const ounce = parseFloat(baseOunceUSD) || 2650;
    const bMargin = parseFloat(buyMargin) || 0.5;
    const sMargin = parseFloat(sellMargin) || 1.5;

    try {
    await updateSettings({
      storeName,
      address,
      phone1,
      phone2,
      usdToSypRate: rate,
      baseGoldOunceUSD: ounce,
      buyMarginPercent: bMargin,
      sellMarginPercent: sMargin
    });

    await updateGoldPrices(priceDraft.map(price => ({
      ...price,
      buyPriceSYPPerGram: Math.round(price.buyPriceUSDPerGram * rate),
      sellPriceSYPPerGram: Math.round(price.sellPriceUSDPerGram * rate)
    })));
    } catch (reason: any) {
      // A refused save must not look like a successful one, least of all on a phone.
      setSaveError(reason?.message || 'تعذر حفظ الإعدادات على الخادم.');
      return;
    }

    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3000);
  };

  const updateKaratDraft = (karat: string, field: GoldPriceInputField, value: string) => {
    setPriceInputValues(current => ({ ...current, [priceInputKey(karat, field)]: value }));
    if (value.trim() === '') return;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) return;

    const is24KPurchasePrice = karat === '24' && field === 'buyPriceUSDPerGram';
    if (!is24KPurchasePrice) {
      setPriceDraft(current => current.map(price => price.karat === karat ? { ...price, [field]: numericValue } : price));
      return;
    }

    // Purchase prices follow purity relative to 24K. Sale prices and labor fees stay independent.
    setPriceDraft(current => current.map(price => ({
      ...price,
      [field]: Number((numericValue * karatPurity[price.karat]).toFixed(2))
    })));
    setPriceInputValues(current => {
      const next = { ...current, [priceInputKey(karat, field)]: value };
      Object.keys(karatPurity).forEach(currentKarat => {
        if (currentKarat !== '24') next[priceInputKey(currentKarat, field)] = (numericValue * karatPurity[currentKarat]).toFixed(2);
      });
      return next;
    });
  };

  const calculatePricesFromOunce = () => {
    const ounce = Number(baseOunceUSD) || 2650;
    const rate = Number(usdToSypRate) || 15200;
    const buy = Number(buyMargin) || 0;
    const sell = Number(sellMargin) || 0;
    const next = priceDraft.map(price => {
      const gramValue = (ounce / 31.1034768) * karatPurity[price.karat];
      const buyUSD = Number((gramValue * (1 - buy / 100)).toFixed(2));
      const sellUSD = Number((gramValue * (1 + sell / 100)).toFixed(2));
      return { ...price, buyPriceUSDPerGram: buyUSD, sellPriceUSDPerGram: sellUSD, buyPriceSYPPerGram: Math.round(buyUSD * rate), sellPriceSYPPerGram: Math.round(sellUSD * rate) };
    });
    setPriceDraft(next);
    setPriceInputValues(priceInputValuesFrom(next));
  };

  const handleResetData = () => {
    if (confirm('هل أنت أطيد من إغادة ضبط كافة البيانات والمخزون إلى القيم الافتراضية؟')) {
      resetToDefaultData();
      alert('تم إعادة ضبط البيانات بنجاح.');
      window.location.reload();
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-sm border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-amber-600 font-bold text-xs uppercase mb-1">
            <Settings className="w-4 h-4" />
            <span>تخصيص النظام وأسعار الصرف وتفاصيل المتجر</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            الإعدادات العامة - حميد حليوي
          </h2>
        </div>

        {settingsProvisional && (
          <div className="mb-3 rounded-sm border border-amber-400 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
            هذه القيم مبدئية — استُنتجت من آخر مستنداتك المرحّلة ولم يؤكّدها أحد بعد.
            راجع سعر الصرف وأسعار العيارات ثم احفظ لتصبح معتمدة.
          </div>
        )}
        {saveError && (
          <div className="mb-3 rounded-sm border border-rose-300 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-800">
            {saveError}
          </div>
        )}
        {savedSuccess && (
          <div className="bg-emerald-100 text-emerald-900 font-bold px-4 py-2 rounded-sm text-xs flex items-center gap-2 border border-emerald-300">
            <CheckCircle2 className="w-4 h-4" />
            <span>تم حفظ الإعدادات بنجاح</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        {/* Currencies & Gold Pricing Settings */}
        <div className="bg-white p-6 rounded-sm border border-slate-200 shadow-sm space-y-6">
          <h3 className="font-black text-slate-900 text-base flex items-center gap-2 border-b border-slate-200 pb-3">
            <Coins className="w-5 h-5 text-amber-600" />
            <span>إعدادات العملات وأسعار الذهب للعيارات المختلفة</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">العملة الرئيسية للنظام</label>
              <input
                type="text"
                disabled
                value="الدولار الأمريكي ($)"
                className="w-full p-2.5 bg-slate-100 border border-slate-200 rounded-sm font-bold text-slate-700"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">العملة الثانوية للنظام</label>
              <input
                type="text"
                disabled
                value="الليرة السورية (ل.س)"
                className="w-full p-2.5 bg-slate-100 border border-slate-200 rounded-sm font-bold text-slate-700"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">سعر صرف $ مقابل الليرة السورية *</label>
              <input
                type="number"
                required
                value={usdToSypRate}
                onChange={e => setUsdToSypRate(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono font-black text-amber-900"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block font-mono">مثال: 1 $ = 15,200 ل.س</span>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">سعر الأونصة العالمية بـ ($) *</label>
              <input
                type="number"
                step="0.01"
                required
                value={baseOunceUSD}
                onChange={e => setBaseOunceUSD(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono font-black text-slate-900"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">تحديث أوتوماتيكي لكافة العيارات</span>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">نسبة هامش خصم الشراء (%)</label>
              <input
                type="number"
                step="0.1"
                value={buyMargin}
                onChange={e => setBuyMargin(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">نسبة هامش ربح البيع (%)</label>
              <input
                type="number"
                step="0.1"
                value={sellMargin}
                onChange={e => setSellMargin(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono"
              />
            </div>
          </div>

          {/* Current Per-Gram Gold Prices Table */}
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Coins className="w-4 h-4 text-amber-500" />
                <span>أسعار غرام الذهب المعتمدة في الفواتير والمعاملات:</span>
              </h4>
              <span className="text-[11px] text-slate-500">يتم الاحتساب والتحديث بناءً على الأونصة أو يدويّاً</span>
            </div>

            <div className="mb-3 flex justify-end">
              <button type="button" onClick={calculatePricesFromOunce} className="flex items-center gap-1 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900"><RefreshCw className="h-3.5 w-3.5" />احتساب أسعار العيارات للغرام</button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {priceDraft.map(price => (
                <div key={price.karat} className="border-r-4 border-r-amber-400 border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between"><span className="font-black text-slate-900">عيار {price.karat}</span><span className="text-[10px] text-slate-500">للغرام الواحد</span></div>
                  <div className="grid grid-cols-3 gap-2 text-xs"><label className="text-slate-600">شراء ($/غ)<input type="number" min="0" step="0.01" value={priceInputValues[priceInputKey(price.karat, 'buyPriceUSDPerGram')] ?? ''} onChange={event => updateKaratDraft(price.karat, 'buyPriceUSDPerGram', event.target.value)} className="mt-1 w-full border border-emerald-200 bg-white p-2 font-mono font-bold text-emerald-800" /></label><label className="text-slate-600">بيع ($/غ)<input type="number" min="0" step="0.01" value={priceInputValues[priceInputKey(price.karat, 'sellPriceUSDPerGram')] ?? ''} onChange={event => updateKaratDraft(price.karat, 'sellPriceUSDPerGram', event.target.value)} className="mt-1 w-full border border-amber-300 bg-white p-2 font-mono font-bold text-amber-900" /></label><label className="text-slate-600">صياغة ($/غ)<input type="number" min="0" step="0.01" value={priceInputValues[priceInputKey(price.karat, 'laborFeeUSDPerGram')] ?? ''} onChange={event => updateKaratDraft(price.karat, 'laborFeeUSDPerGram', event.target.value)} className="mt-1 w-full border border-blue-200 bg-white p-2 font-mono font-bold text-blue-800" /></label></div>
                  <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-[10px] text-slate-500"><span>شراء: {Math.round(price.buyPriceUSDPerGram * (Number(usdToSypRate) || 0)).toLocaleString('ar-SY')} ل.س</span><span>بيع: {Math.round(price.sellPriceUSDPerGram * (Number(usdToSypRate) || 0)).toLocaleString('ar-SY')} ل.س</span></div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto">
              <table className="w-full text-right text-xs border border-slate-200 rounded-sm overflow-hidden font-mono">
                <thead className="bg-slate-900 text-amber-400 font-bold font-sans">
                  <tr>
                    <th className="py-2.5 px-3">العيار</th>
                    <th className="py-2.5 px-3">سعر الشراء ($ / غرام)</th>
                    <th className="py-2.5 px-3">سعر البيع ($ / غرام)</th>
                    <th className="py-2.5 px-3">سعر الشراء (ل.س)</th>
                    <th className="py-2.5 px-3">سعر البيع (ل.س)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {goldPrices.map(p => (
                    <tr key={p.karat} className="hover:bg-slate-50 transition font-bold">
                      <td className="py-2.5 px-3 font-sans font-black text-slate-900">
                        <span className="bg-amber-400 text-slate-900 px-2 py-0.5 rounded-sm text-xs">
                          عيار {p.karat}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-emerald-700">$ {p.buyPriceUSDPerGram.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-amber-900">$ {p.sellPriceUSDPerGram.toFixed(2)}</td>
                      <td className="py-2.5 px-3 text-slate-700">{p.buyPriceSYPPerGram.toLocaleString('ar-SY')} ل.س</td>
                      <td className="py-2.5 px-3 text-slate-900">{p.sellPriceSYPPerGram.toLocaleString('ar-SY')} ل.س</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Company & Store Identity */}
        <div className="bg-white p-6 rounded-sm border border-slate-200 shadow-sm space-y-4">
          <h3 className="font-black text-slate-900 text-base flex items-center gap-2 border-b border-slate-200 pb-3">
            <Building2 className="w-5 h-5 text-amber-600" />
            <span>بيانات ومعلومات المركز والفواتير (حلب - سوريا)</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">اسم المشروع / المتجر *</label>
              <input
                type="text"
                required
                value={storeName}
                onChange={e => setStoreName(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-bold"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">العنوان بالتفصيل *</label>
              <input
                type="text"
                required
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">رقم الهاتف الأول</label>
              <input
                type="text"
                value={phone1}
                onChange={e => setPhone1(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">رقم الهاتف الثاني</label>
              <input
                type="text"
                value={phone2}
                onChange={e => setPhone2(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono"
              />
            </div>
          </div>
        </div>

        {/* Buttons Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <button
            type="button"
            onClick={handleResetData}
            className="px-4 py-2.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-800 rounded-sm font-bold text-xs flex items-center gap-2 transition"
          >
            <RotateCcw className="w-4 h-4" />
            <span>إعادة ضبط كافة بيانات النظام للافتراضي</span>
          </button>

          <button
            type="submit"
            className="px-8 py-3 bg-amber-400 hover:bg-amber-300 text-slate-900 font-black text-sm rounded-sm shadow-md flex items-center gap-2 transition"
          >
            <Save className="w-4 h-4 text-slate-900" />
            <span>حفظ الإعدادات وتحديث أسعار الذهب</span>
          </button>
        </div>
      </form>
      <div className="mt-6"><BackupPanel /></div>
    </div>
  );
};
