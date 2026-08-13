import React, { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './context/StoreContext';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { DashboardView } from './components/DashboardView';
import { InventoryView } from './components/InventoryView';
import { InvoicesView } from './components/InvoicesView';
import { PartnersView } from './components/PartnersView';
import { GoldWeightAccountsView } from './components/GoldWeightAccountsView';
import { FinanceView } from './components/FinanceView';
import { ReportsView } from './components/ReportsView';
import { UsersView } from './components/UsersView';
import { ShiftsView } from './components/ShiftsView';
import { SettingsView } from './components/SettingsView';
import { InstallPrompt } from './components/InstallPrompt';

function MainAppContent() {
  const { currentUser } = useStore();
  const firstAllowedTab = () => {
    const permissions = currentUser.permissions;
    if (permissions.dashboard) return 'dashboard';
    if (permissions.invoices) return 'invoices';
    if (permissions.inventory) return 'inventory';
    if (permissions.partners) return 'partners';
    if (permissions.finance) return 'finance-boxes';
    if (permissions.reports) return 'reports';
    if (permissions.users) return 'users';
    if (permissions.settings) return 'settings';
    return 'invoices';
  };
  const canAccessTab = (tab: string) => {
    const permissions = currentUser.permissions;
    if (tab === 'dashboard') return permissions.dashboard;
    if (tab === 'inventory') return permissions.inventory;
    if (tab === 'invoices') return permissions.invoices;
    if (tab === 'partners') return permissions.partners;
    if (tab === 'gold-weight-accounts') return permissions.partners;
    if (tab.startsWith('finance')) return permissions.finance;
    if (tab === 'reports') return permissions.reports;
    if (tab === 'users') return permissions.users;
    if (tab === 'shifts') return permissions.users;
    if (tab === 'settings') return permissions.settings;
    return false;
  };
  const [activeTab, setActiveTab] = useState<string>(() => firstAllowedTab());
  const [invoiceTypeTrigger, setInvoiceTypeTrigger] = useState<'sale' | 'purchase'>('sale');

  useEffect(() => {
    if (!canAccessTab(activeTab)) setActiveTab(firstAllowedTab());
  }, [currentUser, activeTab]);

  const handleNewInvoiceClick = (type: 'sale' | 'purchase') => {
    setInvoiceTypeTrigger(type);
    setActiveTab('invoices');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-amber-400 selection:text-slate-900" dir="rtl">
      {/* Top Fixed Header with Gold Ticker */}
      <Navbar activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* Sticky Top Horizontal Navigation Bar (Phone & Mobile Optimized) */}
      <div className="sticky top-0 z-30 shadow-md">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
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

          {activeTab === 'invoices' && <InvoicesView initialType={invoiceTypeTrigger} />}

          {activeTab === 'partners' && <PartnersView />}
          {activeTab === 'gold-weight-accounts' && <GoldWeightAccountsView />}

          {activeTab.startsWith('finance') && (
            <FinanceView activeTab={activeTab} setActiveTab={setActiveTab} />
          )}

          {activeTab === 'reports' && <ReportsView />}

          {activeTab === 'users' && <UsersView />}

          {activeTab === 'shifts' && <ShiftsView />}

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
  return (
    <StoreProvider>
      <MainAppContent />
    </StoreProvider>
  );
}
