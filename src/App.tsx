import React, { useEffect, useState } from 'react';
import { StoreProvider } from './context/StoreContext';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { InventoryView } from './components/InventoryView';
import { InvoicesView } from './components/InvoicesView';
import { PartnersView } from './components/PartnersView';
import { GoldWeightAccountsView } from './components/GoldWeightAccountsView';
import { FinanceView } from './components/FinanceView';
import { AccountingView } from './components/AccountingView';
import { ReportsView } from './components/ReportsView';
import { UsersView } from './components/UsersView';
import { ShiftsView } from './components/ShiftsView';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import { InstallPrompt } from './components/InstallPrompt';
import { LoginView } from './components/LoginView';
import { ServiceUnavailableView } from './components/ServiceUnavailableView';
import { useInfrastructureSession } from './hooks/useInfrastructureSession';
import { infrastructureApi, type InfrastructureUser, type SessionScope } from './services/infrastructureApi';
import type { HistoryFilters } from './services/historyApi';

// Which authenticated module each screen belongs to. The module list itself is produced by the
// backend from real permission codes, so nothing here can widen access on its own.
const TAB_MODULE: Record<string, string> = {
  dashboard: 'dashboard', inventory: 'inventory', invoices: 'invoices', partners: 'partners',
  'gold-weight-accounts': 'gold-weight-accounts', reports: 'reports', users: 'users', shifts: 'shifts', history: 'history', settings: 'settings',
  'finance-accounts': 'accounting', 'finance-ledger': 'accounting',
};
// The order a user lands in: the most senior screen they are actually allowed to open.
const LANDING_ORDER = ['dashboard', 'invoices', 'inventory', 'history', 'partners', 'finance-boxes', 'reports', 'users', 'settings'];

function MainAppContent({ authenticatedUser, scope, onLogout }: { authenticatedUser?: InfrastructureUser | null; scope: SessionScope; onLogout?: () => void }) {
  const modules = scope.modules;
  const canAccessTab = (tab: string) => {
    const module = TAB_MODULE[tab] ?? (tab.startsWith('finance') ? 'finance' : undefined);
    return module ? modules.includes(module) : false;
  };
  // A seller lands straight in Sales because it is the only module they hold.
  const firstAllowedTab = () => LANDING_ORDER.find(canAccessTab) ?? 'invoices';
  const [activeTab, setActiveTab] = useState<string>(() => firstAllowedTab());
  const [invoiceTypeTrigger, setInvoiceTypeTrigger] = useState<'sale' | 'purchase'>('sale');
  // Drill-down state: a shift hands filters to السجلات, and a history row hands a shift or an
  // invoice number back. Nothing is recomputed on the way — each screen stays the authority.
  const [historyPreset, setHistoryPreset] = useState<{ filters: HistoryFilters; tab: 'invoices' | 'weights' } | null>(null);
  const [shiftPreset, setShiftPreset] = useState<string | undefined>();
  const [invoiceSearch, setInvoiceSearch] = useState<string | undefined>();

  const openHistoryForShift = (shiftId: string, tab: 'invoices' | 'weights') => {
    setHistoryPreset({ filters: { shiftId }, tab });
    setActiveTab('history');
  };
  const openShift = (shiftId: string) => { setShiftPreset(shiftId); setActiveTab('shifts'); };
  const openInvoice = (invoiceNumber: string) => { setInvoiceSearch(invoiceNumber); setActiveTab('invoices'); };

  useEffect(() => {
    if (!canAccessTab(activeTab)) setActiveTab(firstAllowedTab());
  }, [modules, activeTab]);

  const handleNewInvoiceClick = (type: 'sale' | 'purchase') => {
    setInvoiceTypeTrigger(type);
    setActiveTab('invoices');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-amber-400 selection:text-slate-900" dir="rtl">
      {/* Top Fixed Header with Gold Ticker */}
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} authenticatedUser={authenticatedUser} scope={scope} onLogout={onLogout} />

      {/* Sticky Top Horizontal Navigation Bar (Phone & Mobile Optimized) */}
      <div className="sticky top-0 z-30 shadow-md">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} modules={modules} />
      </div>

      {/* Main Container */}
      <main className="max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-5 flex-1 flex flex-col gap-6">
        {/* View Viewport */}
        <section className="w-full space-y-6">
          {activeTab === 'dashboard' && (
            <DashboardView
              setActiveTab={setActiveTab}
              onNewInvoiceClick={handleNewInvoiceClick}
            />
          )}

          {activeTab === 'inventory' && <InventoryView />}

          {activeTab === 'invoices' && <InvoicesView initialType={invoiceTypeTrigger} initialSearch={invoiceSearch} canPurchase={modules.includes('purchases')} />}

          {activeTab === 'partners' && <PartnersView />}
          {activeTab === 'gold-weight-accounts' && <GoldWeightAccountsView />}

          {(activeTab === 'finance-accounts' || activeTab === 'finance-ledger') && <AccountingView activeTab={activeTab} />}

          {activeTab.startsWith('finance') && activeTab !== 'finance-accounts' && activeTab !== 'finance-ledger' && (
            <FinanceView activeTab={activeTab} setActiveTab={setActiveTab} />
          )}

          {activeTab === 'reports' && <ReportsView />}

          {activeTab === 'users' && <UsersView />}

          {activeTab === 'history' && (
            <HistoryView
              key={historyPreset ? `${historyPreset.tab}-${historyPreset.filters.shiftId ?? ''}` : 'history'}
              initialFilters={historyPreset?.filters}
              initialTab={historyPreset?.tab}
              onOpenInvoiceNumber={openInvoice}
              onOpenShift={modules.includes('shifts') ? openShift : undefined}
            />
          )}

          {activeTab === 'shifts' && <ShiftsView initialShiftId={shiftPreset} onDrillDown={openHistoryForShift} />}

          {activeTab === 'settings' && <SettingsView />}
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-4 px-6 text-center text-xs border-t-2 border-slate-800 no-print mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="font-bold text-amber-400 tracking-wide">
            حميد حليوي (Hameed Hliwi Jewelry) - نظام إدارة وصياغة الذهب
          </p>
          <p className="text-slate-500 font-mono">
            سوريا - حلب | العملات: USD ($) & SYP (ل.س)
          </p>
        </div>
      </footer>
      <InstallPrompt />
    </div>
  );
}

export default function App() {
  const session = useInfrastructureSession();
  const logout = async () => { await infrastructureApi.logout(); await session.refresh(); };
  if (session.mode === 'loading') return <ServiceUnavailableView connecting />;
  if (session.mode === 'unavailable') return <ServiceUnavailableView />;
  if (session.mode === 'unauthenticated' || !session.user || !session.scope) return <LoginView onLoggedIn={session.refresh} />;
  return (
    <StoreProvider identity={session.user}>
      <MainAppContent authenticatedUser={session.user} scope={session.scope} onLogout={() => { void logout(); }} />
    </StoreProvider>
  );
}
