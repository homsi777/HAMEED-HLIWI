import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import type { InfrastructureUser, SessionScope } from '../services/infrastructureApi';
import { 
  Coins, 
  RefreshCw, 
  DollarSign, 
  User, 
  MapPin, 
  ChevronDown, 
  Sparkles,
  Edit2,
  Check,
  Building2
} from 'lucide-react';
import { GoldKarat } from '../types';

export const Navbar: React.FC<{ activeTab: string; setActiveTab: (tab: string) => void; authenticatedUser?: InfrastructureUser | null; scope: SessionScope; onLogout?: () => void }> = ({ activeTab, setActiveTab, authenticatedUser, scope, onLogout }) => {
  const { 
    settings, 
    goldPrices, 
    activeCurrency, 
    setActiveCurrency, 
    updateKaratPrice,
    updateSettings,
    warehouses
  } = useStore();

  const [editingKarat, setEditingKarat] = useState<GoldKarat | null>(null);
  const [editBuyUSD, setEditBuyUSD] = useState('');
  const [editSellUSD, setEditSellUSD] = useState('');
  const [editingRate, setEditingRate] = useState(false);
  const [newRateSYP, setNewRateSYP] = useState(settings.usdToSypRate.toString());

  const handleStartEditKarat = (karat: GoldKarat) => {
    const p = goldPrices.find(g => g.karat === karat);
    if (p) {
      setEditingKarat(karat);
      setEditBuyUSD(p.buyPriceUSDPerGram.toString());
      setEditSellUSD(p.sellPriceUSDPerGram.toString());
    }
  };

  const handleSaveKarat = (karat: GoldKarat) => {
    const buy = parseFloat(editBuyUSD);
    const sell = parseFloat(editSellUSD);
    if (!isNaN(buy) && !isNaN(sell) && buy > 0 && sell > 0) {
      updateKaratPrice(karat, buy, sell);
    }
    setEditingKarat(null);
  };

  const handleSaveRate = () => {
    const rate = parseFloat(newRateSYP);
    if (!isNaN(rate) && rate > 0) {
      updateSettings({ usdToSypRate: rate });
    }
    setEditingRate(false);
  };

  // The header reflects the authenticated session only. Switching accounts means logging out
  // and logging in again, so a browser can never present itself as somebody else.
  const scopeLabel = scope.type === 'global' ? 'المدير العام — كل الفروع' : scope.type === 'own' ? 'بائع' : 'مدير مستودع';
  const currentWh = warehouses.find(w => w.name === authenticatedUser?.warehouses[0]?.name) || warehouses[0];
  const displayName = authenticatedUser?.fullName || '';

  return (
    <header className="bg-white text-slate-900 shadow-sm border-b-2 border-slate-200 sticky top-0 z-40">
      {/* Main Header Bar */}
      <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8 py-2 sm:py-2.5 flex items-center justify-between gap-1 sm:gap-4">
        {/* Brand Header */}
        <div className="flex items-center gap-1 sm:gap-3 min-w-0 flex-1">
          <div className="w-7 h-7 sm:w-10 sm:h-10 bg-slate-900 border-2 border-amber-400 rounded-sm flex items-center justify-center shrink-0 shadow-sm">
            <Coins className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1 flex-nowrap min-w-0">
              <h1 className="text-[11px] sm:text-xl font-black text-slate-900 tracking-tight truncate whitespace-nowrap">
                {settings.storeName}
              </h1>
              <span className="text-[8px] sm:text-[10px] px-1 py-0.5 rounded-sm bg-amber-400 text-slate-900 font-bold uppercase tracking-wider shrink-0">
                حلب
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 hidden sm:flex items-center gap-2 mt-0.5 font-medium">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              <span>{settings.address}</span>
              <span className="text-slate-300">•</span>
              <Building2 className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-slate-700 font-bold">{currentWh?.name}</span>
            </p>
          </div>
        </div>

        {/* Action Controls & User Switcher */}
        <div className="flex items-center gap-1 sm:gap-3 shrink-0 flex-nowrap">
          {/* Exchange Rate Box */}
          <div className={`${activeCurrency === 'USD' ? 'flex' : 'hidden'} sm:flex bg-slate-100 border border-slate-200 rounded-sm px-1 sm:px-3 py-1 items-center gap-1 text-xs font-mono`}>
            <span className="text-slate-500 font-sans font-medium text-[11px] hidden xs:inline">1 $ =</span>
            {editingRate ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={newRateSYP}
                  onChange={e => setNewRateSYP(e.target.value)}
                  className="w-16 sm:w-20 bg-white border border-slate-900 rounded-sm px-1 py-0.5 text-slate-900 text-center font-bold focus:outline-none text-xs"
                />
                <button
                  onClick={handleSaveRate}
                  className="p-1 bg-amber-400 text-slate-900 rounded-sm hover:bg-amber-300 transition"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <span className="font-extrabold text-slate-900 text-xs sm:text-sm whitespace-nowrap">
                  {settings.usdToSypRate.toLocaleString('ar-SY')} <span className="text-[10px] font-normal">ل.س</span>
                </span>
                <button
                  onClick={() => {
                    setNewRateSYP(settings.usdToSypRate.toString());
                    setEditingRate(true);
                  }}
                  title="تعديل سعر الصرف"
                  className="hidden sm:block text-slate-400 hover:text-slate-900 p-0.5 transition"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Active Currency Switcher (Compact on mobile) */}
          <div className="bg-slate-100 p-0.5 rounded-sm border border-slate-200 flex items-center text-xs">
            <button
              onClick={() => setActiveCurrency('USD')}
              className={`px-1.5 sm:px-3 py-1 rounded-sm font-bold transition flex items-center gap-1 ${
                activeCurrency === 'USD'
                  ? 'bg-amber-400 text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5 hidden sm:inline" />
              <span>$</span>
            </button>
            <button
              onClick={() => setActiveCurrency('SYP')}
              className={`px-1.5 sm:px-3 py-1 rounded-sm font-bold transition flex items-center gap-1 ${
                activeCurrency === 'SYP'
                  ? 'bg-amber-400 text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>ل.س</span>
            </button>
          </div>

          {/* Current User Dropdown */}
          <div className="relative">
            <div className="bg-slate-900 text-white rounded-sm px-1 sm:px-3 py-1 text-xs flex items-center gap-1 sm:gap-2.5">
              <div className="w-6 h-6 rounded-sm bg-amber-400 text-slate-900 flex items-center justify-center font-bold text-xs shrink-0">
                {displayName.charAt(0)}
              </div>
              <div className="text-right hidden md:block">
                <p className="font-bold text-amber-400 leading-tight">{displayName}</p>
                <p className="text-[10px] text-slate-400">{scopeLabel}</p>
              </div>
            </div>

            {authenticatedUser && onLogout && (
              <button type="button" onClick={onLogout} className="mt-1 w-full text-[11px] font-bold text-slate-500 transition hover:text-rose-600">
                تسجيل الخروج
              </button>
            )}

          </div>
        </div>
      </div>
    </header>
  );
};
