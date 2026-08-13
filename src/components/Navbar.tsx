import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import type { InfrastructureUser } from '../services/infrastructureApi';
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

export const Navbar: React.FC<{ activeTab: string; setActiveTab: (tab: string) => void; authenticatedUser?: InfrastructureUser | null; onLogout?: () => void }> = ({ activeTab, setActiveTab, authenticatedUser, onLogout }) => {
  const { 
    settings, 
    goldPrices, 
    activeCurrency, 
    setActiveCurrency, 
    currentUser, 
    users, 
    setCurrentUser,
    updateKaratPrice,
    updateSettings,
    warehouses
  } = useStore();

  const [showUserMenu, setShowUserMenu] = useState(false);
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

  const currentWh = warehouses.find(w => w.id === currentUser.assignedWarehouseId) || warehouses[0];
  const canSwitchLegacyUser = currentUser.permissions.users && !authenticatedUser;
  const displayName = authenticatedUser?.fullName || currentUser.fullName;

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
            <button
              onClick={() => canSwitchLegacyUser && setShowUserMenu(!showUserMenu)}
              className="bg-slate-900 hover:bg-slate-800 text-white rounded-sm px-1 sm:px-3 py-1 text-xs flex items-center gap-1 sm:gap-2.5 transition"
            >
              <div className="w-6 h-6 rounded-sm bg-amber-400 text-slate-900 flex items-center justify-center font-bold text-xs shrink-0">
                {displayName.charAt(0)}
              </div>
              <div className="text-right hidden md:block">
                <p className="font-bold text-amber-400 leading-tight">{displayName}</p>
                <p className="text-[10px] text-slate-400">{currentUser.role === 'admin' ? 'مدير عام' : currentUser.role}</p>
              </div>
              {canSwitchLegacyUser && <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
            </button>

            {authenticatedUser && onLogout && (
              <button type="button" onClick={onLogout} className="mt-1 w-full text-[11px] font-bold text-slate-500 transition hover:text-rose-600">
                تسجيل الخروج
              </button>
            )}

            {canSwitchLegacyUser && showUserMenu && (
              <div className="absolute left-0 mt-2 w-56 sm:w-60 bg-slate-900 border-2 border-slate-800 rounded-sm shadow-2xl py-2 z-50 text-xs text-white">
                <div className="px-3 py-1.5 border-b border-slate-800 text-slate-400 font-bold">
                  تبديل حساب المستخدم
                </div>
                {users.map(u => (
                  <button
                    key={u.id}
                    onClick={() => {
                      setCurrentUser(u);
                      setShowUserMenu(false);
                    }}
                    className={`w-full text-right px-3 py-2 flex items-center justify-between hover:bg-slate-800 transition ${
                      u.id === currentUser.id ? 'bg-amber-400/20 text-amber-400 font-bold' : 'text-slate-300'
                    }`}
                  >
                    <div>
                      <p>{u.fullName}</p>
                      <p className="text-[10px] text-slate-500">@{u.username}</p>
                    </div>
                    {u.id === currentUser.id && <Check className="w-4 h-4 text-amber-400" />}
                  </button>
                ))}
                <div className="border-t border-slate-800 pt-1 mt-1 px-3">
                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      setActiveTab('users');
                    }}
                    className="text-amber-400 hover:underline text-[11px] font-bold block py-1"
                  >
                    إدارة الصلاحيات والمستخدمين
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
