import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import {
  GeneralSettings,
  GoldPriceSetting,
  Warehouse,
  InventoryItem,
  Partner,
  Invoice,
  Voucher,
  CashBox,
  User,
  ActivityLog,
  GoldKarat
  , GoldWeightAccount, GoldDebtEntry
} from '../types';
import { settingsApi } from '../services/settingsApi';
import {

  initialSettings,
  initialGoldPrices,
  initialWarehouses,
  initialInventory,
  initialPartners,
  initialCashBoxes,
  initialUsers,
  initialInvoices,
  initialVouchers,
  initialActivityLogs
} from '../data/initialData';

interface StoreContextType {
  settings: GeneralSettings;
  goldPrices: GoldPriceSetting[];
  warehouses: Warehouse[];
  inventory: InventoryItem[];
  partners: Partner[];
  goldWeightAccounts: GoldWeightAccount[];
  invoices: Invoice[];
  vouchers: Voucher[];
  cashBoxes: CashBox[];
  currentUser: User;
  activityLogs: ActivityLog[];
  activeCurrency: 'USD' | 'SYP';
  
  // Actions
  updateSettings: (newSettings: Partial<GeneralSettings>) => Promise<void>;
  // TASK 18 §5: true while the values are the ones derived from past documents rather than
  // ones a human confirmed. The Settings screen says so until a manager saves.
  settingsProvisional: boolean;
  updateGoldPrices: (newPrices: GoldPriceSetting[]) => Promise<void>;
  updateKaratPrice: (karat: GoldKarat, buyUSD: number, sellUSD: number) => void;
  recalculateAllGoldPricesFromBase: (baseOunceUSD: number, exchangeRateSYP: number) => void;
  
  // Warehouses
  addWarehouse: (warehouse: Omit<Warehouse, 'id'>) => void;
  updateWarehouse: (id: string, warehouse: Partial<Warehouse>) => void;
  
  // Inventory
  addInventoryItem: (item: Omit<InventoryItem, 'id' | 'dateAdded'>) => void;
  updateInventoryItem: (id: string, item: Partial<InventoryItem>) => void;
  deleteInventoryItem: (id: string) => void;
  transferInventoryItem: (itemId: string, targetWarehouseId: string) => void;
  
  // Invoices
  addInvoice: (invoice: Omit<Invoice, 'id' | 'invoiceNumber'>) => Invoice;
  cancelInvoice: (invoiceId: string) => void;
  
  // Partners
  addPartner: (partner: Omit<Partner, 'id' | 'createdAt'>) => void;
  updatePartner: (id: string, partner: Partial<Partner>) => void;
  addGoldWeightAccount: (personName: string, phone?: string) => void;
  addGoldWeightEntry: (accountId: string, entry: Omit<GoldDebtEntry, 'id' | 'date'>) => void;
  
  // Vouchers & Cashboxes
  addVoucher: (voucher: Omit<Voucher, 'id' | 'voucherNumber'>) => void;
  updateVoucher: (id: string, voucher: Partial<Voucher>) => void;
  cancelVoucher: (id: string) => void;
  addCashBox: (cashBox: Omit<CashBox, 'id'>) => void;
  transferBetweenCashBoxes: (fromBoxId: string, toBoxId: string, amountFrom: number, amountTo: number, statement: string) => void;
  
  // Users
  // Users are administered through the backend users API; the store no longer owns identity.
  
  // Currency & System
  setActiveCurrency: (curr: 'USD' | 'SYP') => void;
  logActivity: (action: string, details: string, type: ActivityLog['type']) => void;
  resetToDefaultData: () => void;
  
  // Helpers
  getGoldPrice: (karat: GoldKarat, type: 'buy' | 'sell', curr?: 'USD' | 'SYP') => number;
  formatMoney: (amountInUSD: number, targetCurr?: 'USD' | 'SYP') => string;
}

const StoreContext = createContext<StoreContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'HAMEED_HLIWI_GOLD_STORE_V1';

export interface SessionIdentity { id: string; username: string; fullName: string; roles: string[]; permissions: string[]; warehouses: Array<{ id: string; name: string; isManager: boolean }>; }

export const StoreProvider: React.FC<{ children: ReactNode; identity: SessionIdentity }> = ({ children, identity }) => {
  // Try loading from localStorage
  const loadInitialState = () => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Remove only the known old UI fixtures; real backend inventory is never
        // stored here and no arbitrary local records are deleted.
        if (Array.isArray(parsed.inventory)) parsed.inventory = parsed.inventory.filter((item: InventoryItem) => !/^item-10[1-7]$/.test(item.id));
        // Finance lives in PostgreSQL since Task 07, so stale local cashboxes, vouchers
        // and expense categories are dropped rather than shown next to real balances.
        parsed.cashBoxes = [];
        parsed.vouchers = [];
        // Returns now live in PostgreSQL, so any locally stored return document is dropped.
        if (Array.isArray(parsed.invoices)) parsed.invoices = parsed.invoices.filter((invoice: Invoice) => invoice.type !== 'return');
        return parsed;
      }
    } catch (e) {
      console.error('Failed to load state from localStorage', e);
    }
    return null;
  };

  const savedData = loadInitialState();

  const [settings, setSettings] = useState<GeneralSettings>(savedData?.settings || initialSettings);
  // TASK 18: the server owns these values. What is kept here is a cache so the app renders
  // before the first response lands; it is overwritten on every load and never wins over the
  // server. `settingsVersion` guards concurrent saves, `settingsProvisional` says the values
  // are still the ones derived from past documents rather than ones a human confirmed.
  const [settingsVersion, setSettingsVersion] = useState(0);
  const [settingsProvisional, setSettingsProvisional] = useState(false);
  const [goldPrices, setGoldPrices] = useState<GoldPriceSetting[]>(() => (savedData?.goldPrices || initialGoldPrices).map((price: GoldPriceSetting) => ({ ...price, laborFeeUSDPerGram: price.laborFeeUSDPerGram ?? 5 })));
  const [warehouses, setWarehouses] = useState<Warehouse[]>(savedData?.warehouses || initialWarehouses);
  const [inventory, setInventory] = useState<InventoryItem[]>(savedData?.inventory || initialInventory);
  const [partners, setPartners] = useState<Partner[]>(savedData?.partners || initialPartners);
  const [goldWeightAccounts, setGoldWeightAccounts] = useState<GoldWeightAccount[]>(savedData?.goldWeightAccounts || []);
  const [invoices, setInvoices] = useState<Invoice[]>(savedData?.invoices || initialInvoices);
  const [vouchers, setVouchers] = useState<Voucher[]>(savedData?.vouchers || initialVouchers);
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>(savedData?.cashBoxes || initialCashBoxes);
  // The authenticated identity is the only identity. It is derived from the backend session
  // on every render, so nothing stored in this browser can change who the user is.
  const currentUser = useMemo<User>(() => ({
    id: identity.id,
    username: identity.username,
    fullName: identity.fullName,
    role: identity.permissions.includes('warehouses.scope.all') ? 'admin' : identity.permissions.includes('data.scope.own') ? 'sales' : 'inventory_manager',
    assignedWarehouseId: identity.warehouses[0]?.id ?? '',
    active: true,
    permissions: { dashboard: true, inventory: true, invoices: true, partners: true, finance: true, reports: true, users: true, settings: true },
  }), [identity]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>(savedData?.activityLogs || initialActivityLogs);
  const [activeCurrency, setActiveCurrency] = useState<'USD' | 'SYP'>(savedData?.activeCurrency || 'USD');

  // Save state on change
  useEffect(() => {
    const stateToSave = {
      settings,
      goldPrices,
      warehouses,
      inventory,
      partners,
      goldWeightAccounts,
      invoices,
      vouchers,
      cashBoxes,
      activityLogs,
      activeCurrency
    };
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (e) {
      console.error('Failed to save state to localStorage', e);
    }
  }, [
    settings,
    goldPrices,
    warehouses,
    inventory,
    partners,
    goldWeightAccounts,
    invoices,
    vouchers,
    cashBoxes,
    currentUser,
    activityLogs,
    activeCurrency
  ]);

  const logActivity = (action: string, details: string, type: ActivityLog['type']) => {
    const newLog: ActivityLog = {
      id: 'act-' + Date.now(),
      timestamp: new Date().toLocaleString('ar-SY', { hour12: false }),
      userName: currentUser.fullName,
      action,
      details,
      type
    };
    setActivityLogs(prev => [newLog, ...prev]);
  };


  // The server is the source of truth for the shop's operating parameters. It is read on mount
  // and again whenever the app comes back to the front, which is what makes a manager's rate
  // change reach a seller's phone. The backend also emits `settings.changed` over the realtime
  // gateway; there is no socket client in this app yet, so convergence is on focus instead.
  const applyServerSettings = React.useCallback((server: Awaited<ReturnType<typeof settingsApi.get>>) => {
    const { goldPrices: serverPrices, isProvisional, version, updatedAt, ...general } = server;
    setSettings(prev => ({ ...prev, ...general }));
    setGoldPrices(serverPrices.map(({ version: _priceVersion, ...price }) => price));
    setSettingsVersion(version);
    setSettingsProvisional(isProvisional);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const load = () => { void settingsApi.get().then(server => { if (!cancelled) applyServerSettings(server); }).catch(() => undefined); };
    load();
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, [applyServerSettings]);

  // TASK 18: saved on the server, then re-read from its answer. The local state is never the
  // authority — if the save is refused, nothing here moves, which is the point.
  const updateSettings = async (newSettings: Partial<GeneralSettings>) => {
    const server = await settingsApi.update({ ...newSettings, version: settingsVersion });
    applyServerSettings(server);
    logActivity('تحديث الإعدادات', 'تم تعديل إعدادات النظام العامة', 'setting');
  };

  const updateGoldPrices = async (newPrices: GoldPriceSetting[]) => {
    const server = await settingsApi.updateGoldPrices(newPrices.map(price => ({ ...price, karat: String(price.karat) })));
    applyServerSettings(server);
    logActivity('تحديث أسعار الذهب', 'تم تحديث جدول أسعار الذهب رسمياً', 'setting');
  };

  const updateKaratPrice = (karat: GoldKarat, buyUSD: number, sellUSD: number) => {
    const rate = settings.usdToSypRate;
    setGoldPrices(prev =>
      prev.map(p => {
        if (p.karat === karat) {
          return {
            ...p,
            buyPriceUSDPerGram: buyUSD,
            sellPriceUSDPerGram: sellUSD,
            buyPriceSYPPerGram: Math.round(buyUSD * rate),
            sellPriceSYPPerGram: Math.round(sellUSD * rate)
          };
        }
        return p;
      })
    );
    logActivity('تحديث سعر العيار', `تم تعديل سعر عيار ${karat} إلى شراء $${buyUSD} / بيع $${sellUSD}`, 'setting');
  };

  const recalculateAllGoldPricesFromBase = (baseOunceUSD: number, rateSYP: number) => {
    // 1 Ounce = 31.1034768 grams of 24K gold
    const gram24USD = baseOunceUSD / 31.1034768;
    const karatsMultiplier: Record<GoldKarat, number> = {
      '24': 1.0,
      '22': 22 / 24,
      '21': 21 / 24,
      '18': 18 / 24,
      '14': 14 / 24
    };

    const newPrices: GoldPriceSetting[] = (['24', '22', '21', '18', '14'] as GoldKarat[]).map(k => {
      const pureGramVal = gram24USD * karatsMultiplier[k];
      const buyUSD = Number((pureGramVal * (1 - settings.buyMarginPercent / 100)).toFixed(2));
      const sellUSD = Number((pureGramVal * (1 + settings.sellMarginPercent / 100)).toFixed(2));
      return {
        karat: k,
        buyPriceUSDPerGram: buyUSD,
        sellPriceUSDPerGram: sellUSD,
        laborFeeUSDPerGram: goldPrices.find(price => price.karat === k)?.laborFeeUSDPerGram ?? 5,
        buyPriceSYPPerGram: Math.round(buyUSD * rateSYP),
        sellPriceSYPPerGram: Math.round(sellUSD * rateSYP)
      };
    });

    setGoldPrices(newPrices);
  };

  const addWarehouse = (whData: Omit<Warehouse, 'id'>) => {
    const newWh: Warehouse = {
      ...whData,
      id: 'wh-' + Date.now()
    };
    setWarehouses(prev => [...prev, newWh]);
    logActivity('إضافة مستودع', `تم إضافة مستودع/فرع جديد: ${newWh.name}`, 'inventory');
  };

  const updateWarehouse = (id: string, whData: Partial<Warehouse>) => {
    setWarehouses(prev => prev.map(w => (w.id === id ? { ...w, ...whData } : w)));
    logActivity('تعديل مستودع', `تم تعديل بيانت المستودع ${id}`, 'inventory');
  };

  const addInventoryItem = (itemData: Omit<InventoryItem, 'id' | 'dateAdded'>) => {
    const newItem: InventoryItem = {
      ...itemData,
      id: 'item-' + Date.now(),
      dateAdded: new Date().toISOString().split('T')[0]
    };
    setInventory(prev => [newItem, ...prev]);
    logActivity('إضافة منتج', `تم إضافة القطعة (${newItem.name}) كود ${newItem.code}`, 'inventory');
  };

  const updateInventoryItem = (id: string, itemData: Partial<InventoryItem>) => {
    setInventory(prev => prev.map(item => (item.id === id ? { ...item, ...itemData } : item)));
    logActivity('تعديل منتج', `تم تعديل القطعة برقم ${id}`, 'inventory');
  };

  const deleteInventoryItem = (id: string) => {
    const target = inventory.find(i => i.id === id);
    setInventory(prev => prev.filter(i => i.id !== id));
    if (target) {
      logActivity('حذف منتج', `تم حذف القطعة (${target.name}) من المخزون`, 'inventory');
    }
  };

  const transferInventoryItem = (itemId: string, targetWarehouseId: string) => {
    const item = inventory.find(i => i.id === itemId);
    const targetWh = warehouses.find(w => w.id === targetWarehouseId);
    if (item && targetWh) {
      setInventory(prev => prev.map(i => (i.id === itemId ? { ...i, warehouseId: targetWarehouseId } : i)));
      logActivity('نقل قطعة', `تم نقل القطعة (${item.name}) إلى مستودع ${targetWh.name}`, 'inventory');
    }
  };

  // Shifts are server records since Task 11. The store no longer tracks them: the seller's
  // shift bar and the manager's الورديات module both read the shifts API directly.
  const addInvoice = (invData: Omit<Invoice, 'id' | 'invoiceNumber'>): Invoice => {
    // Returns are posted by the backend returns module; they are never written locally.
    if (invData.type === 'return') throw new Error('Returns are created through the backend returns API.');
    const count = invoices.length + 1;
    const invNumber = `INV-${new Date().getFullYear()}-${String(count).padStart(3, '0')}`;
    const newInvoice: Invoice = {
      ...invData,
      id: 'inv-' + Date.now(),
      invoiceNumber: invNumber,
    };

    setInvoices(prev => [newInvoice, ...prev]);

    // Handle Stock updates
    if (newInvoice.type === 'sale') {
      // Mark sold items
      const soldItemIds = newInvoice.items.map(i => i.itemId).filter(Boolean) as string[];
      setInventory(prev =>
        prev.map(item => (soldItemIds.includes(item.id) ? { ...item, status: 'sold' as const } : item))
      );
    } else if (newInvoice.type === 'purchase') {
      // Automatically create new inventory items for purchased gold
      const newItems: InventoryItem[] = newInvoice.items.map((item, idx) => ({
        id: 'item-purchased-' + Date.now() + '-' + idx,
        code: `PUR-${newInvoice.invoiceNumber}-${idx + 1}`,
        name: item.itemName,
        category: item.category,
        karat: item.karat,
        grossWeightGrams: item.grossWeightGrams,
        stoneWeightGrams: item.stoneWeightGrams,
        netWeightGrams: item.netWeightGrams,
        laborFeeUSDPerGram: item.laborFeeUSDPerGram,
        totalLaborFeeUSD: item.laborFeeUSDPerGram * item.netWeightGrams,
        warehouseId: newInvoice.warehouseId,
        status: 'in_stock',
        notes: `مشتريات فاتورة ${invNumber}`,
        dateAdded: newInvoice.date
      }));
      setInventory(prev => [...newItems, ...prev]);
    }

    // Update Partner Balance if debt remaining
    if (newInvoice.customerOrSupplierId && (newInvoice.remainingDebtUSD !== 0 || (newInvoice.remainingDebtGold21kGrams && newInvoice.remainingDebtGold21kGrams !== 0))) {
      setPartners(prev =>
        prev.map(partner => {
          if (partner.id === newInvoice.customerOrSupplierId) {
            // Sale debt means customer owes us money (negative balance)
            // Purchase debt means we owe supplier money (positive balance)
            const debtUSDMultiplier = newInvoice.type === 'sale' ? -1 : 1;
            const updatedDebt = partner.balanceUSD + newInvoice.remainingDebtUSD * debtUSDMultiplier;
            const updatedGold = partner.goldBalance21kGrams + (newInvoice.remainingDebtGold21kGrams || 0) * debtUSDMultiplier;
            return {
              ...partner,
              balanceUSD: Number(updatedDebt.toFixed(2)),
              goldBalance21kGrams: Number(updatedGold.toFixed(2))
            };
          }
          return partner;
        })
      );
    }

    // Update Cash Boxes if paid amount
    if (newInvoice.paidUSD > 0) {
      setCashBoxes(prev =>
        prev.map(box => {
          if (box.currency === 'USD' && box.id === 'box-usd') {
            const multiplier = newInvoice.type === 'sale' ? 1 : -1;
            return { ...box, balanceAmount: box.balanceAmount + newInvoice.paidUSD * multiplier };
          }
          return box;
        })
      );
    }

    if (newInvoice.paidSYP > 0) {
      setCashBoxes(prev =>
        prev.map(box => {
          if (box.currency === 'SYP' && box.id === 'box-syp') {
            const multiplier = newInvoice.type === 'sale' ? 1 : -1;
            return { ...box, balanceAmount: box.balanceAmount + newInvoice.paidSYP * multiplier };
          }
          return box;
        })
      );
    }

    logActivity(
      `إنشاء فاتورة ${newInvoice.type === 'sale' ? 'بيع' : newInvoice.type === 'purchase' ? 'شراء' : 'مرتجع'}`,
      `فاتورة رقم ${invNumber} بقيمة $${newInvoice.finalTotalUSD} للعميل/المورد ${newInvoice.customerOrSupplierName}`,
      'invoice'
    );

    return newInvoice;
  };

  const cancelInvoice = (invoiceId: string) => {
    const inv = invoices.find(i => i.id === invoiceId);
    if (!inv) return;

    // Restore stock status if sale
    if (inv.type === 'sale') {
      const itemIds = inv.items.map(i => i.itemId).filter(Boolean) as string[];
      setInventory(prev =>
        prev.map(item => (itemIds.includes(item.id) ? { ...item, status: 'in_stock' as const } : item))
      );
    }

    // Reverse Partner Balance changes if applicable
    if (inv.customerOrSupplierId && (inv.remainingDebtUSD !== 0 || (inv.remainingDebtGold21kGrams && inv.remainingDebtGold21kGrams !== 0))) {
      setPartners(prev =>
        prev.map(partner => {
          if (partner.id === inv.customerOrSupplierId) {
            const debtUSDMultiplier = inv.type === 'sale' ? 1 : -1;
            const updatedDebt = partner.balanceUSD + inv.remainingDebtUSD * debtUSDMultiplier;
            const updatedGold = partner.goldBalance21kGrams + (inv.remainingDebtGold21kGrams || 0) * debtUSDMultiplier;
            return {
              ...partner,
              balanceUSD: Number(updatedDebt.toFixed(2)),
              goldBalance21kGrams: Number(updatedGold.toFixed(2))
            };
          }
          return partner;
        })
      );
    }

    // Reverse Cash box changes
    if (inv.paidUSD > 0) {
      setCashBoxes(prev =>
        prev.map(box => {
          if (box.currency === 'USD' && box.id === 'box-usd') {
            const multiplier = inv.type === 'sale' ? -1 : 1;
            return { ...box, balanceAmount: Math.max(0, box.balanceAmount + inv.paidUSD * multiplier) };
          }
          return box;
        })
      );
    }

    if (inv.paidSYP > 0) {
      setCashBoxes(prev =>
        prev.map(box => {
          if (box.currency === 'SYP' && box.id === 'box-syp') {
            const multiplier = inv.type === 'sale' ? -1 : 1;
            return { ...box, balanceAmount: Math.max(0, box.balanceAmount + inv.paidSYP * multiplier) };
          }
          return box;
        })
      );
    }

    // Remove invoice
    setInvoices(prev => prev.filter(i => i.id !== invoiceId));

    logActivity('إلغاء فاتورة', `تم إلغاء الفاتورة رقم ${inv.invoiceNumber} وإعادة ضبط قيودها`, 'invoice');
  };

  const addPartner = (partnerData: Omit<Partner, 'id' | 'createdAt'>) => {
    const newPartner: Partner = {
      ...partnerData,
      id: 'prt-' + Date.now(),
      createdAt: new Date().toISOString().split('T')[0]
    };
    setPartners(prev => [...prev, newPartner]);
    logActivity('إضافة عميل/مورد', `تم إضافة ${newPartner.type === 'customer' ? 'العميل' : 'المورد'} ${newPartner.name}`, 'partners');
  };

  const updatePartner = (id: string, partnerData: Partial<Partner>) => {
    setPartners(prev => prev.map(p => (p.id === id ? { ...p, ...partnerData } : p)));
    logActivity('تعديل عميل/مورد', `تم تعديل البيانات للجهة رقم ${id}`, 'partners');
  };

  const addGoldWeightAccount = (personName: string, phone?: string) => {
    setGoldWeightAccounts(prev => [...prev, { id: `weight-account-${Date.now()}`, personName, phone, entries: [] }]);
  };

  const addGoldWeightEntry = (accountId: string, entry: Omit<GoldDebtEntry, 'id' | 'date'>) => {
    const newEntry: GoldDebtEntry = { ...entry, id: `weight-entry-${Date.now()}`, date: new Date().toISOString() };
    setGoldWeightAccounts(prev => prev.map(account => account.id === accountId ? { ...account, entries: [...account.entries, newEntry] } : account));
  };

  const addVoucher = (vchData: Omit<Voucher, 'id' | 'voucherNumber'>) => {
    const count = vouchers.length + 1;
    const voucherNumber = `VCH-${new Date().getFullYear()}-${String(count).padStart(2, '0')}`;
    const newVoucher: Voucher = {
      ...vchData,
      id: 'vch-' + Date.now(),
      voucherNumber
    };

    setVouchers(prev => [newVoucher, ...prev]);

    // Update cash box balance
    setCashBoxes(prev =>
      prev.map(box => {
        if (box.id === newVoucher.cashBoxId) {
          const isReceipt = newVoucher.type === 'receipt';
          const isUSD = box.currency === 'USD';
          const delta = isUSD ? newVoucher.amountUSD : newVoucher.amountSYP;
          return {
            ...box,
            balanceAmount: isReceipt ? box.balanceAmount + delta : box.balanceAmount - delta
          };
        }
        return box;
      })
    );

    // Update partner balance if receipt or payment
    if (newVoucher.partnerId && newVoucher.type !== 'expense') {
      setPartners(prev =>
        prev.map(partner => {
          if (partner.id === newVoucher.partnerId) {
            // Receipt voucher from partner reduces customer debt (increases balance towards positive)
            // Payment voucher to partner reduces supplier debt
            const isReceipt = newVoucher.type === 'receipt';
            const updatedUSD = partner.balanceUSD + (isReceipt ? newVoucher.amountUSD : -newVoucher.amountUSD);
            const updatedGold = partner.goldBalance21kGrams + (isReceipt ? (newVoucher.goldWeight21kGrams || 0) : -(newVoucher.goldWeight21kGrams || 0));
            return {
              ...partner,
              balanceUSD: Number(updatedUSD.toFixed(2)),
              goldBalance21kGrams: Number(updatedGold.toFixed(2))
            };
          }
          return partner;
        })
      );
    }

    logActivity(
      `سند ${newVoucher.type === 'receipt' ? 'قبض' : newVoucher.type === 'payment' ? 'صرف' : 'مصروف'}`,
      `سند رقم ${voucherNumber} بقيمة $${newVoucher.amountUSD} (${newVoucher.statement})`,
      'finance'
    );
  };

  const updateVoucher = (id: string, voucherData: Partial<Voucher>) => {
    setVouchers(prev => prev.map(voucher => voucher.id === id ? { ...voucher, ...voucherData } : voucher));
    logActivity('تعديل سند', `تم تعديل السند ${id}`, 'finance');
  };

  const cancelVoucher = (id: string) => {
    const voucher = vouchers.find(item => item.id === id);
    if (!voucher) return;
    setVouchers(prev => prev.filter(item => item.id !== id));
    setCashBoxes(prev => prev.map(box => {
      if (box.id !== voucher.cashBoxId) return box;
      const amount = box.currency === 'USD' ? voucher.amountUSD : voucher.amountSYP;
      return { ...box, balanceAmount: voucher.type === 'receipt' ? box.balanceAmount - amount : box.balanceAmount + amount };
    }));
    if (voucher.partnerId && voucher.type !== 'expense') {
      setPartners(prev => prev.map(partner => partner.id !== voucher.partnerId ? partner : {
        ...partner,
        balanceUSD: Number((partner.balanceUSD - (voucher.type === 'receipt' ? voucher.amountUSD : -voucher.amountUSD)).toFixed(2)),
        goldBalance21kGrams: Number((partner.goldBalance21kGrams - (voucher.type === 'receipt' ? (voucher.goldWeight21kGrams || 0) : -(voucher.goldWeight21kGrams || 0))).toFixed(2))
      }));
    }
    logActivity('إلغاء وعكس سند', `تم عكس السند ${voucher.voucherNumber}`, 'finance');
  };

  const transferBetweenCashBoxes = (
    fromBoxId: string,
    toBoxId: string,
    amountFrom: number,
    amountTo: number,
    statement: string
  ) => {
    setCashBoxes(prev =>
      prev.map(box => {
        if (box.id === fromBoxId) {
          return { ...box, balanceAmount: box.balanceAmount - amountFrom };
        }
        if (box.id === toBoxId) {
          return { ...box, balanceAmount: box.balanceAmount + amountTo };
        }
        return box;
      })
    );

    const fromBox = cashBoxes.find(b => b.id === fromBoxId);
    const toBox = cashBoxes.find(b => b.id === toBoxId);
    const count = vouchers.length + 1;
    const voucherNumber = `TRF-${new Date().getFullYear()}-${String(count).padStart(2, '0')}`;

    const newVoucher: Voucher = {
      id: 'vch-trf-' + Date.now(),
      voucherNumber,
      type: 'expense',
      date: new Date().toISOString().split('T')[0],
      cashBoxId: fromBoxId,
      amountUSD: fromBox?.currency === 'USD' ? amountFrom : amountTo / settings.usdToSypRate,
      amountSYP: fromBox?.currency === 'SYP' ? amountFrom : amountTo,
      exchangeRate: settings.usdToSypRate,
      category: 'مناقلة تحويل بين الخزائن',
      statement: statement || `مناقلة من ${fromBox?.name} إلى ${toBox?.name}`,
      createdBy: currentUser.fullName
    };

    setVouchers(prev => [newVoucher, ...prev]);
    logActivity('مناقلة نقدية', `تحويل من ${fromBox?.name} إلى ${toBox?.name}`, 'finance');
  };

  const addCashBox = (cashBoxData: Omit<CashBox, 'id'>) => {
    const newCashBox: CashBox = { ...cashBoxData, id: 'box-' + Date.now() };
    setCashBoxes(prev => [...prev, newCashBox]);
    logActivity('إضافة صندوق', `تم إنشاء صندوق جديد: ${newCashBox.name}`, 'finance');
  };

  const resetToDefaultData = () => {
    setSettings(initialSettings);
    setGoldPrices(initialGoldPrices);
    setWarehouses(initialWarehouses);
    setInventory(initialInventory);
    setPartners(initialPartners);
    setInvoices(initialInvoices);
    setVouchers(initialVouchers);
    setCashBoxes(initialCashBoxes);
    setActivityLogs(initialActivityLogs);
    setActiveCurrency('USD');
    localStorage.removeItem(LOCAL_STORAGE_KEY);
  };

  // Helper getters
  const getGoldPrice = (karat: GoldKarat, type: 'buy' | 'sell', curr: 'USD' | 'SYP' = activeCurrency): number => {
    const item = goldPrices.find(g => g.karat === karat);
    if (!item) return 0;
    if (curr === 'USD') {
      return type === 'buy' ? item.buyPriceUSDPerGram : item.sellPriceUSDPerGram;
    } else {
      return type === 'buy' ? item.buyPriceSYPPerGram : item.sellPriceSYPPerGram;
    }
  };

  const formatMoney = (amountInUSD: number, targetCurr: 'USD' | 'SYP' = activeCurrency): string => {
    if (targetCurr === 'USD') {
      return `$ ${amountInUSD.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      const syp = Math.round(amountInUSD * settings.usdToSypRate);
      return `${syp.toLocaleString('ar-SY')} ل.س`;
    }
  };

  return (
    <StoreContext.Provider
      value={{
        settings,
        goldPrices,
        warehouses,
        inventory,
        partners,
        goldWeightAccounts,
        invoices,
        vouchers,
        cashBoxes,
        currentUser,
        activityLogs,
        activeCurrency,
        updateSettings,
        settingsProvisional,
        updateGoldPrices,
        updateKaratPrice,
        recalculateAllGoldPricesFromBase,
        addWarehouse,
        updateWarehouse,
        addInventoryItem,
        updateInventoryItem,
        deleteInventoryItem,
        transferInventoryItem,
        addInvoice,
        cancelInvoice,
        addPartner,
        updatePartner,
        addGoldWeightAccount,
        addGoldWeightEntry,
        addVoucher,
        updateVoucher,
        cancelVoucher,
        addCashBox,
        transferBetweenCashBoxes,
        setActiveCurrency,
        logActivity,
        resetToDefaultData,
        getGoldPrice,
        formatMoney
      }}
    >
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error('useStore must be used within a StoreProvider');
  }
  return context;
};
