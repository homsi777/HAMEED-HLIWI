import React, { useRef, useState } from 'react';
import { 
  LayoutDashboard, 
  PackageSearch, 
  FileText, 
  Users, 
  Wallet, 
  BarChart3, 
  ShieldCheck, 
  Settings,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Building2,
  Receipt,
  BookOpen,
  Coins,
  Menu,
  X,
  Clock3,
  Layers,
  Scale,
  Archive
} from 'lucide-react';
interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  /** Modules the authenticated session actually holds, as computed by the backend. */
  modules: string[];
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, modules }) => {
  const allows = (module: string) => modules.includes(module);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showFinanceDropdown, setShowFinanceDropdown] = useState(false);
  const [showMobileDrawer, setShowMobileDrawer] = useState(false);

  const menuItems = [
    {
      id: 'dashboard',
      label: 'الرئيسية',
      icon: LayoutDashboard,
      allowed: allows('dashboard'),
      badge: null
    },
    {
      id: 'inventory',
      label: 'المخزون والعيارات',
      icon: PackageSearch,
      allowed: allows('inventory'),
      badge: 'الذهب'
    },
    {
      id: 'invoices',
      label: 'الفواتير والمبيعات',
      icon: FileText,
      allowed: allows('invoices'),
      badge: 'جديد'
    },
    {
      id: 'history',
      label: 'السجلات',
      icon: Archive,
      allowed: allows('history'),
      badge: 'أرشيف'
    },
    {
      id: 'partners',
      label: 'العملاء والموردين',
      icon: Users,
      allowed: allows('partners'),
      badge: 'ذمم'
    },
    { id: 'gold-weight-accounts', label: 'ذمم الأوزان', icon: Coins, allowed: allows('gold-weight-accounts'), badge: 'غرام' },
    {
      id: 'finance',
      label: 'الإدارة المالية',
      icon: Wallet,
      allowed: allows('finance') || allows('accounting'),
      badge: '4 أقسام',
      hasDropdown: true
    },
    {
      id: 'reports',
      label: 'التقارير والتحليلات',
      icon: BarChart3,
      allowed: allows('reports'),
      badge: null
    },
    {
      id: 'users',
      label: 'الصلاحيات والمستخدمين',
      icon: ShieldCheck,
      allowed: allows('users'),
      badge: null
    },
    {
      id: 'shifts',
      label: 'الورديات',
      icon: Clock3,
      allowed: allows('shifts'),
      badge: null
    },
    {
      id: 'settings',
      label: 'الإعدادات العامة',
      icon: Settings,
      allowed: allows('settings'),
      badge: null
    }
  ];

  // The two accounting screens sit under the same menu but answer to their own permission.
  const financeSubItems = [
    { id: 'finance-boxes', label: 'الصناديق والخزائن', icon: Building2, desc: 'حسابات السيولة والخزن', module: 'finance' },
    { id: 'finance-vouchers', label: 'السندات المالية', icon: Receipt, desc: 'سندات قبض وصرف وقيد', module: 'finance' },
    { id: 'finance-journal', label: 'دفتر اليومية العام', icon: BookOpen, desc: 'كشف الحركات والتسويات', module: 'finance' },
    { id: 'finance-expenses', label: 'المصاريف والتشغيل', icon: Coins, desc: 'مصاريف وإيجارات وطاقة', module: 'finance' },
    { id: 'finance-accounts', label: 'شجرة الحسابات', icon: Layers, desc: 'الدليل المحاسبي والمطابقة', module: 'accounting' },
    { id: 'finance-ledger', label: 'القيود والأستاذ', icon: Scale, desc: 'قيود اليومية وميزان المراجعة', module: 'accounting' },
  ].filter(sub => allows(sub.module));

  const scroll = (direction: 'left' | 'right') => {
    if (scrollContainerRef.current) {
      const scrollAmount = direction === 'left' ? -200 : 200;
      scrollContainerRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  return (
    <>
      {/* DESKTOP & TABLET TOP NAVIGATION BAR */}
      <nav className="w-full bg-slate-900 border-y-2 border-slate-800 text-white shadow-md relative py-2 no-print hidden sm:block">
        <div className="relative flex items-center max-w-7xl mx-auto px-2 sm:px-4">
          {/* Scroll Right Arrow for RTL Desktop */}
          <button
            onClick={() => scroll('right')}
            className="flex items-center justify-center w-8 h-8 rounded-sm bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 shrink-0 ml-1.5 z-10 transition border border-slate-700"
            aria-label="scroll right"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Scrollable Horizontal Tabs Strip */}
          <div
            ref={scrollContainerRef}
            className={`flex items-center gap-2 py-1 px-1 w-full scroll-smooth ${
              showFinanceDropdown ? 'overflow-visible' : 'overflow-x-auto'
            }`}
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {menuItems.map(item => {
              if (!item.allowed) return null;
              const Icon = item.icon;
              const isFinanceActive = activeTab.startsWith('finance');
              const isActive = item.id === 'finance' ? isFinanceActive : activeTab === item.id;

              if (item.hasDropdown) {
                return (
                  <div key={item.id} className="relative shrink-0">
                    <button
                      onClick={() => {
                        setShowFinanceDropdown(prev => !prev);
                      }}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-sm font-bold text-xs shrink-0 whitespace-nowrap transition-all duration-150 min-h-[42px] ${
                        isActive || showFinanceDropdown
                          ? 'bg-amber-400 text-slate-900 shadow-md ring-2 ring-amber-400/30 font-black'
                          : 'bg-slate-800/90 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700/60'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${isActive || showFinanceDropdown ? 'text-slate-900' : 'text-amber-400'}`} />
                      <span>{item.label}</span>
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${showFinanceDropdown ? 'rotate-180' : ''}`} />

                      {item.badge && (
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded-sm font-mono font-bold leading-none ${
                            isActive || showFinanceDropdown
                              ? 'bg-slate-900 text-amber-400'
                              : 'bg-slate-950 text-amber-400 border border-amber-400/30'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>

                    {/* DROPDOWN MENU ATTACHED DIRECTLY UNDER BUTTON */}
                    {showFinanceDropdown && (
                      <>
                        <div 
                          className="fixed inset-0 z-40 bg-transparent" 
                          onClick={() => setShowFinanceDropdown(false)} 
                        />

                        <div className="absolute top-full right-0 mt-1.5 w-64 bg-slate-900 border-2 border-amber-400 rounded-sm shadow-2xl z-50 p-2 text-right divide-y divide-slate-800 animate-in fade-in duration-100">
                          <div className="px-2.5 py-1.5 text-[10px] text-amber-400 font-extrabold uppercase tracking-wider flex items-center justify-between">
                            <span className="flex items-center gap-1">
                              <Wallet className="w-3.5 h-3.5 text-amber-400" />
                              أقسام الإدارة المالية (4):
                            </span>
                            <span className="text-[9px] text-slate-400 font-normal">اختر قسم</span>
                          </div>
                          <div className="pt-1.5 space-y-1">
                            {financeSubItems.map(sub => {
                              const SubIcon = sub.icon;
                              const isSubActive = activeTab === sub.id;
                              return (
                                <button
                                  key={sub.id}
                                  onClick={() => {
                                    setActiveTab(sub.id);
                                    setShowFinanceDropdown(false);
                                  }}
                                  className={`w-full flex items-center gap-3 p-2.5 rounded-sm text-right transition group ${
                                    isSubActive
                                      ? 'bg-amber-400 text-slate-900 font-black shadow-sm'
                                      : 'text-slate-200 hover:bg-slate-800 hover:text-amber-400 font-bold'
                                  }`}
                                >
                                  <div className={`p-1.5 rounded-sm shrink-0 transition ${
                                    isSubActive 
                                      ? 'bg-slate-900 text-amber-400' 
                                      : 'bg-slate-800 text-amber-400 border border-slate-700'
                                  }`}>
                                    <SubIcon className="w-4 h-4" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs font-extrabold leading-tight">{sub.label}</div>
                                    <div className={`text-[10px] mt-0.5 font-normal ${isSubActive ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
                                      {sub.desc}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              }

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setShowFinanceDropdown(false);
                    setActiveTab(item.id);
                  }}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-sm font-bold text-xs shrink-0 whitespace-nowrap transition-all duration-150 min-h-[42px] ${
                    isActive
                      ? 'bg-amber-400 text-slate-900 shadow-md ring-2 ring-amber-400/30'
                      : 'bg-slate-800/90 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-slate-900' : 'text-amber-400'}`} />
                  <span>{item.label}</span>

                  {item.badge && (
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-sm font-mono font-bold leading-none ${
                        isActive
                          ? 'bg-slate-900 text-amber-400'
                          : 'bg-slate-950 text-amber-400 border border-amber-400/30'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Scroll Left Arrow for RTL Desktop */}
          <button
            onClick={() => scroll('left')}
            className="flex items-center justify-center w-8 h-8 rounded-sm bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 shrink-0 mr-1.5 z-10 transition border border-slate-700"
            aria-label="scroll left"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        </div>
      </nav>

      {/* MOBILE TOP COMPACT BAR FOR MOBILE VIEW */}
      <div className="bg-slate-900 text-white p-2.5 sm:hidden flex items-center justify-between border-b-2 border-slate-800 sticky top-[57px] z-30 shadow-md">
        {/* RIGHT SIDE: Menu Button (زر القائمة على اليمين من الأعلى) */}
        <div className="relative">
          <button
            onClick={() => setShowMobileDrawer(prev => !prev)}
            className="bg-amber-400 hover:bg-amber-300 text-slate-900 px-3.5 py-1.5 rounded-sm font-extrabold text-xs flex items-center gap-2 shadow-sm transition active:scale-95"
          >
            <Menu className="w-4 h-4 text-slate-900" />
            <span>قائمة الأقسام</span>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-900 transition-transform duration-200 ${showMobileDrawer ? 'rotate-180' : ''}`} />
          </button>

          {/* COMPACT FLOATING DROPDOWN FOR MOBILE (لا تأخذ مساحة شاشة كاملة) */}
          {showMobileDrawer && (
            <>
              {/* Transparent Overlay to close on outside click */}
              <div 
                className="fixed inset-0 z-40 bg-black/20" 
                onClick={() => setShowMobileDrawer(false)} 
              />

              <div className="absolute top-full right-0 mt-1 w-56 bg-slate-900 border-2 border-amber-400 rounded-sm shadow-2xl z-50 p-1.5 text-right divide-y divide-slate-800 text-white animate-in fade-in duration-150">
                <div className="px-2 py-1 bg-slate-950 rounded-t-sm flex items-center justify-between text-amber-400 font-extrabold text-xs">
                  <span>أقسام النظام</span>
                  <button 
                    onClick={() => setShowMobileDrawer(false)}
                    className="p-0.5 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="pt-1 space-y-0.5">
                  {menuItems.map(item => {
                    if (!item.allowed) return null;
                    const Icon = item.icon;
                    const isFinance = item.id === 'finance';
                    const isActive = isFinance ? activeTab.startsWith('finance') : activeTab === item.id;

                    if (isFinance) {
                      return (
                        <div key={item.id} className="space-y-0.5 bg-slate-950/90 p-1.5 rounded-sm border border-slate-800 my-0.5">
                          <div className="flex items-center justify-between text-amber-400 font-extrabold text-[11px] pb-0.5 border-b border-slate-800">
                            <div className="flex items-center gap-1">
                              <Wallet className="w-3.5 h-3.5 text-amber-400" />
                              <span>الإدارة المالية (4):</span>
                            </div>
                          </div>
                          <div className="space-y-0.5 pt-0.5">
                            {financeSubItems.map(sub => {
                              const SubIcon = sub.icon;
                              const isSubActive = activeTab === sub.id;
                              return (
                                <button
                                  key={sub.id}
                                  onClick={() => {
                                    setActiveTab(sub.id);
                                    setShowMobileDrawer(false);
                                  }}
                                  className={`w-full p-1.5 rounded-sm flex items-center gap-2 text-right transition text-xs ${
                                    isSubActive ? 'bg-amber-400 text-slate-900 font-black' : 'bg-slate-800/90 text-slate-200 hover:bg-slate-700'
                                  }`}
                                >
                                  <SubIcon className={`w-3.5 h-3.5 shrink-0 ${isSubActive ? 'text-slate-900' : 'text-amber-400'}`} />
                                  <span className="font-bold leading-none">{sub.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveTab(item.id);
                          setShowMobileDrawer(false);
                        }}
                        className={`w-full p-1.5 rounded-sm flex items-center justify-between text-right transition text-xs ${
                          isActive ? 'bg-amber-400 text-slate-900 font-extrabold shadow-sm' : 'bg-slate-800/80 text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-slate-900' : 'text-amber-400'}`} />
                          <span className="leading-none">{item.label}</span>
                        </div>
                        {item.badge && (
                          <span className={`text-[9px] px-1 py-0.5 rounded font-mono leading-none ${
                            isActive ? 'bg-slate-900 text-amber-400' : 'bg-slate-950 text-amber-400 border border-amber-400/30'
                          }`}>
                            {item.badge}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* LEFT SIDE: Current Active Section Label Badge */}
        <div className="flex items-center gap-1.5 text-xs bg-slate-800/90 border border-slate-700/80 text-amber-400 font-bold px-2.5 py-1 rounded-sm shadow-inner truncate max-w-[180px]">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"></span>
          <span className="truncate">
            {activeTab === 'finance-boxes' && 'الصناديق والخزائن'}
            {activeTab === 'finance-vouchers' && 'السندات المالية'}
            {activeTab === 'finance-journal' && 'دفتر اليومية العام'}
            {activeTab === 'finance-expenses' && 'المصاريف والتشغيل'}
            {activeTab === 'finance-accounts' && 'شجرة الحسابات'}
            {activeTab === 'finance-ledger' && 'القيود ودفتر الأستاذ'}
            {activeTab === 'dashboard' && 'الرئيسية'}
            {activeTab === 'inventory' && 'المخزون والعيارات'}
            {activeTab === 'invoices' && 'الفواتير والمبيعات'}
            {activeTab === 'partners' && 'العملاء والموردين'}
            {activeTab === 'reports' && 'التقارير والتحليلات'}
            {activeTab === 'users' && 'الصلاحيات والمستخدمين'}
            {activeTab === 'shifts' && 'الورديات'}
            {activeTab === 'history' && 'السجلات'}
            {activeTab === 'settings' && 'الإعدادات العامة'}
          </span>
        </div>
      </div>
    </>
  );
};
