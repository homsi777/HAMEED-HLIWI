import React, { useEffect, useState } from 'react';
import { useStore } from '../context/StoreContext';
import { 
  FileText, 
  Plus, 
  Search, 
  Printer, 
  Eye, 
  Trash2, 
  X, 
  Check, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Coins, 
  Calendar, 
  Users, 
  DollarSign, 
  MinusCircle,
  PlusCircle,
  Building2,
  Camera,
  Upload,
  Image as ImageIcon,
  MoreVertical,
  RotateCcw,
  FileDown,
  Share2,
  Send
} from 'lucide-react';
import { 
  Invoice, 
  InvoiceType, 
  GoldKarat, 
  ItemCategory, 
  InvoiceItem, 
  ScrapGoldItem, 
  PaymentMethod 
} from '../types';
import { PrintInvoiceModal } from './PrintInvoiceModal';
import { salesApi, type SalesInvoice } from '../services/salesApi';
import { partnersApi, type ApiPartner } from '../services/partnersApi';
import { purchasesApi, type PurchaseInvoice } from '../services/purchasesApi';
import { inventoryApi } from '../services/inventoryApi';

interface InvoicesViewProps {
  initialType?: 'sale' | 'purchase';
}

const money = (value: number) => Number(value.toFixed(2));

// Both the gold value and the labor charge are calculated per gram for each item.
// Rounding each line prevents floating-point fractions from affecting the invoice total.
const calculateItemPricing = (netWeightGrams: number, goldPricePerGramUSD: number, laborFeeUSDPerGram: number) => {
  const goldValueUSD = money(netWeightGrams * goldPricePerGramUSD);
  const laborValueUSD = money(netWeightGrams * laborFeeUSDPerGram);

  return {
    goldValueUSD,
    laborValueUSD,
    totalPriceUSD: money(goldValueUSD + laborValueUSD)
  };
};

export const InvoicesView: React.FC<InvoicesViewProps> = ({ initialType }) => {
  const { 
    invoices, 
    inventory: legacyInventory, 
    partners,
    warehouses: legacyWarehouses,
    goldPrices, 
    settings, 
    addInvoice, 
    cancelInvoice,
    addPartner, 
    formatMoney,
    currentUser,
    activeShift,
    startShift,
    closeShift
  } = useStore();

  const [filterType, setFilterType] = useState<'all' | 'sale' | 'purchase' | 'return'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [serverSales, setServerSales] = useState<SalesInvoice[]>([]);
  const [serverPurchases, setServerPurchases] = useState<PurchaseInvoice[]>([]);
  const [serverCustomers, setServerCustomers] = useState<ApiPartner[]>([]);
  const [serverSuppliers, setServerSuppliers] = useState<ApiPartner[]>([]);
  const [serverWarehouses, setServerWarehouses] = useState<typeof legacyWarehouses>([]);
  const [serverInventory, setServerInventory] = useState<typeof legacyInventory>([]);
  const [salesPage, setSalesPage] = useState(1);
  const [purchasesPage, setPurchasesPage] = useState(1);
  const [salesTotal, setSalesTotal] = useState(0);
  const [purchasesTotal, setPurchasesTotal] = useState(0);
  const [salesLoading, setSalesLoading] = useState(true);
  const [salesError, setSalesError] = useState('');
  const [purchasesError, setPurchasesError] = useState('');
  const warehouses = serverWarehouses;
  const inventory = serverInventory;
  const refreshServerSales = async () => { try { setSalesLoading(true); setSalesError(''); const response = await salesApi.list({ page: salesPage, limit: 30 }); setServerSales(response.items); setSalesTotal(response.meta.total); } catch (reason: any) { setSalesError(reason?.message || 'تعذر تحميل فواتير البيع من الخادم.'); } finally { setSalesLoading(false); } };
  const refreshServerPurchases = async () => { try { setPurchasesError(''); const response = await purchasesApi.list({ page: purchasesPage, limit: 30 }); setServerPurchases(response.items); setPurchasesTotal(response.meta.total); } catch (reason: any) { setPurchasesError(reason?.message || 'تعذر تحميل فواتير الشراء من الخادم.'); } };
  const refreshCustomers = async () => { try { const response = await partnersApi.list({ type: 'customer', page: 1, limit: 100, sort: 'name', order: 'asc' }); setServerCustomers(response.items); } catch { /* Quick customer creation remains available. */ } };
  const refreshSuppliers = async () => { try { const response = await partnersApi.list({ type: 'supplier', page: 1, limit: 100, sort: 'name', order: 'asc' }); setServerSuppliers(response.items); } catch { /* Quick supplier creation remains available. */ } };
  const refreshOperationalStock = async () => { try { const [warehouseRows, stockRows] = await Promise.all([inventoryApi.warehouses(), inventoryApi.list({ page: 1, limit: 100, status: 'all' })]); setServerWarehouses(warehouseRows); setServerInventory(stockRows.items); } catch (reason: any) { setPurchasesError(reason?.message || 'تعذر تحميل المستودعات أو المخزون من الخادم.'); } };
  useEffect(() => { void refreshServerSales(); }, [salesPage]);
  useEffect(() => { void refreshServerPurchases(); }, [purchasesPage]);
  useEffect(() => { void refreshCustomers(); void refreshSuppliers(); void refreshOperationalStock(); }, []);

  // 3-Dots Invoice Actions Menu State (Fixed Viewport Position to avoid clipping)
  const [activeMenu, setActiveMenu] = useState<{ inv: Invoice; top: number; left: number } | null>(null);

  const toggleInvoiceMenu = (e: React.MouseEvent, inv: Invoice) => {
    e.stopPropagation();
    if (activeMenu?.inv.id === inv.id) {
      setActiveMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 220;
    const menuHeight = 250;
    
    // Determine whether to open above or below the button
    const spaceBelow = window.innerHeight - rect.bottom;
    let top = rect.bottom + 4;
    if (spaceBelow < menuHeight && rect.top > menuHeight) {
      top = rect.top - menuHeight - 4;
    }
    
    // Align horizontally within screen bounds
    let left = rect.left - 165;
    if (left < 10) left = 10;
    if (left + menuWidth > window.innerWidth - 10) {
      left = window.innerWidth - menuWidth - 10;
    }

    setActiveMenu({ inv, top, left });
  };

  // Handlers for Invoice 3-Dots Menu
  const handlePreviewInvoice = (inv: Invoice) => {
    setActiveMenu(null);
    setSelectedInvoiceForPrint(inv);
  };

  const handlePrintInvoice = (inv: Invoice) => {
    setActiveMenu(null);
    setSelectedInvoiceForPrint(inv);
    setTimeout(() => {
      window.print();
    }, 300);
  };

  const handleReturnInvoice = (inv: Invoice) => {
    setActiveMenu(null);
    setInvType('return');
    setInvPartnerName(inv.customerOrSupplierName);
    setInvPartnerId(inv.customerOrSupplierId || '');
    setInvWarehouseId(inv.warehouseId || warehouses[0]?.id || '');
    setInvPaymentMethod(inv.paymentMethod || 'cash_usd');
    setInvNotes(`مرتجع عن الفاتورة رقم ${inv.invoiceNumber}`);
    setInvItems(
      inv.items.map(item => ({
        ...item,
        id: 'ret-item-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6)
      }))
    );
    setScrapItems([]);
    setShowCreateModal(true);
  };

  const handleExportPdf = (inv: Invoice) => {
    setActiveMenu(null);
    setSelectedInvoiceForPrint(inv);
    setTimeout(() => {
      window.print();
    }, 400);
  };

  const handleShareWhatsApp = (inv: Invoice) => {
    setActiveMenu(null);
    const itemLines = inv.items.map((item, index) => `${index + 1}. ${item.itemName}\n   عيار ${item.karat} • صافي ${item.netWeightGrams.toFixed(2)} غ • أجرة $${item.laborFeeUSDPerGram.toFixed(2)}/غ\n   الإجمالي: $${item.totalPriceUSD.toFixed(2)}`).join('\n');
    const scrapLines = inv.scrapGoldItems?.length ? `\n\n*الذهب المستبدل:*\n${inv.scrapGoldItems.map((item, index) => `${index + 1}. عيار ${item.karat} • ${item.weightGrams.toFixed(2)} غ • $${item.totalScrapValueUSD.toFixed(2)}`).join('\n')}` : '';
    const text = `*${settings.storeName}* 💎\n*${inv.type === 'sale' ? 'فاتورة بيع ذهب' : inv.type === 'purchase' ? 'فاتورة شراء ذهب' : 'فاتورة مرتجع'}*\n\n*رقم الفاتورة:* ${inv.invoiceNumber}\n*التاريخ:* ${inv.date}\n*العميل/المورد:* ${inv.customerOrSupplierName}${inv.customerPhone ? `\n*الهاتف:* ${inv.customerPhone}` : ''}\n\n*بنود الفاتورة:*\n${itemLines}${scrapLines}\n\n*ملخص مالي:*\nقيمة الذهب: $${inv.subtotalGoldUSD.toFixed(2)}\nالمصنعية: $${inv.totalLaborUSD.toFixed(2)}\nالخصم: $${inv.discountUSD.toFixed(2)}\n*الإجمالي الصافي: $${inv.finalTotalUSD.toFixed(2)}*\nالمدفوع: $${inv.paidUSD.toFixed(2)}\nالمتبقي: $${inv.remainingDebtUSD.toFixed(2)}\n\nشكراً لثقتكم بـ ${settings.storeName}`;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const handleCancelInvoiceAction = (inv: Invoice) => {
    setActiveMenu(null);
    if (!window.confirm(`هل أنت تأكيد من إلغاء الفاتورة رقم (${inv.invoiceNumber})؟\nسوف يتم إرجاع كافة القطع المباعة للمخزون وعكس التسويات المالية.`)) return;
    if (inv.type === 'return') { cancelInvoice(inv.id); return; }
    const reason = window.prompt(`سبب إلغاء فاتورة ${inv.type === 'sale' ? 'البيع' : 'الشراء'}:`);
    if (!reason?.trim()) return;
    const cancel = inv.type === 'sale' ? salesApi.cancel(inv.id, reason).then(async () => { await Promise.all([refreshServerSales(), refreshOperationalStock()]); }) : purchasesApi.cancel(inv.id, reason).then(async () => { await Promise.all([refreshServerPurchases(), refreshOperationalStock()]); });
    void cancel.catch((error: any) => alert(error?.message || 'تعذر إلغاء الفاتورة.'));
  };

  // Printable Invoice Modal State
  const [selectedInvoiceForPrint, setSelectedInvoiceForPrint] = useState<Invoice | null>(null);

  // New Invoice Wizard Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [invType, setInvType] = useState<InvoiceType>(initialType || 'sale');
  const [invPartnerId, setInvPartnerId] = useState('');
  const [invPartnerName, setInvPartnerName] = useState('');
  const [invCustomerPhone, setInvCustomerPhone] = useState('');
  const [invWarehouseId, setInvWarehouseId] = useState('');
  useEffect(() => { if (!invWarehouseId && warehouses[0]) setInvWarehouseId(warehouses[0].id); }, [invWarehouseId, warehouses]);
  const [invPaymentMethod, setInvPaymentMethod] = useState<PaymentMethod>('cash_usd');
  const [invNotes, setInvNotes] = useState('');
  const [invDiscountUSD, setInvDiscountUSD] = useState('');

  // Selected Stock Items or Custom Items for the invoice
  const [invItems, setInvItems] = useState<InvoiceItem[]>([]);

  // Temp form for adding an item into invoice
  const [selectedStockItemId, setSelectedStockItemId] = useState('');
  const [stockSearchQuery, setStockSearchQuery] = useState('');
  const [stockSalePricePerGram, setStockSalePricePerGram] = useState('');
  const [aggregateSoldWeight, setAggregateSoldWeight] = useState('');
  const [aggregateSoldQuantity, setAggregateSoldQuantity] = useState('1');
  const [customItemName, setCustomItemName] = useState('');
  const [customKarat, setCustomKarat] = useState<GoldKarat>('21');
  const [customCategory, setCustomCategory] = useState<ItemCategory>('أطقم');
  const [customGrossWeight, setCustomGrossWeight] = useState('');
  const [customStoneWeight, setCustomStoneWeight] = useState('0');
  const [customLaborPerGram, setCustomLaborPerGram] = useState('');
  const [customPricePerGram, setCustomPricePerGram] = useState('');
  const [purchaseReconciliationTargetId, setPurchaseReconciliationTargetId] = useState('');

  // Scrap Gold Items (ذهب كسر بديل)
  const [scrapItems, setScrapItems] = useState<ScrapGoldItem[]>([]);
  const [scrapKarat, setScrapKarat] = useState<GoldKarat>('21');
  const [scrapWeight, setScrapWeight] = useState('');
  const [scrapPricePerGram, setScrapPricePerGram] = useState('');

  // Payments & Photo Guarantee
  const [paidUSD, setPaidUSD] = useState('');
  const [paidSYP, setPaidSYP] = useState('');
  const [itemPhotoUrl, setItemPhotoUrl] = useState(''); // صورة ضمان القطعة المباعة/المشتراة

  // Photo Capture/Upload handler (with automatic canvas optimization for clear printing)
  const handleCaptureItemPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.src = reader.result as string;
        img.onload = () => {
          const maxDim = 900;
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const optimizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);
            setItemPhotoUrl(optimizedDataUrl);
          } else {
            setItemPhotoUrl(reader.result as string);
          }
        };
        img.onerror = () => {
          setItemPhotoUrl(reader.result as string);
        };
      };
      reader.readAsDataURL(file);
    }
    // Reset file input value so same file can be re-selected if needed
    e.target.value = '';
  };

  // Quick Add Partner Modal inside Invoice
  const [showQuickAddPartner, setShowQuickAddPartner] = useState(false);
  const [quickPartnerName, setQuickPartnerName] = useState('');
  const [quickPartnerPhone, setQuickPartnerPhone] = useState('');

  // Trigger open creation modal
  const handleOpenCreateModal = (type: InvoiceType = 'sale') => {
    setInvType(type);
    setInvPartnerId('');
    setInvPartnerName('');
    setInvCustomerPhone('');
    setInvWarehouseId(warehouses[0]?.id || '');
    setInvPaymentMethod('cash_usd');
    setInvNotes('');
    setInvDiscountUSD('');
    setInvItems([]);
    setScrapItems([]);
    setPaidUSD('');
    setPaidSYP('');
    setItemPhotoUrl('');
    setStockSearchQuery('');
    setSelectedStockItemId('');
    setStockSalePricePerGram('');
    setAggregateSoldWeight('');
    setAggregateSoldQuantity('1');
    const default21KPrice = goldPrices.find(g => g.karat === '21')?.buyPriceUSDPerGram;
    setScrapPricePerGram(default21KPrice ? default21KPrice.toString() : '70');
    setCustomPricePerGram('');
    setPurchaseReconciliationTargetId('');
    setCustomLaborPerGram(type === 'sale' ? '' : (goldPrices.find(g => g.karat === '21')?.laborFeeUSDPerGram ?? 5).toString());
    setShowCreateModal(true);
  };

  useEffect(() => {
    if (initialType) handleOpenCreateModal(initialType);
  }, [initialType]);

  // Select item from available stock
  const handleAddStockItemToInvoice = (itemToAdd?: any) => {
    const stockItem = itemToAdd || inventory.find(i => i.id === selectedStockItemId);
    if (!stockItem) return;

    const enteredSalePrice = parseFloat(stockSalePricePerGram);
    if (invType === 'sale' && (!Number.isFinite(enteredSalePrice) || enteredSalePrice < 0)) {
      alert('أدخل سعر البيع للغرام قبل إضافة القطعة.');
      return;
    }
    const p = goldPrices.find(g => g.karat === stockItem.karat);
    const goldPricePerGram = invType === 'sale' ? enteredSalePrice : (p?.buyPriceUSDPerGram ?? 75);
    const laborFeePerGram = invType === 'sale' ? (p?.laborFeeUSDPerGram ?? stockItem.laborFeeUSDPerGram) : stockItem.laborFeeUSDPerGram;
    const isAggregate = stockItem.inventoryMode === 'aggregate';
    const soldWeight = isAggregate ? parseFloat(aggregateSoldWeight) : stockItem.netWeightGrams;
    const soldQuantity = isAggregate ? parseFloat(aggregateSoldQuantity) : 1;
    if (isAggregate && (!Number.isFinite(soldWeight) || soldWeight <= 0 || !Number.isFinite(soldQuantity) || soldQuantity <= 0)) { setSelectedStockItemId(stockItem.id); alert(`هذا صنف مجمّع. المتاح ${stockItem.netWeightGrams.toFixed(3)} غ؛ أدخل وزن البيع وعدد القطع أولاً.`); return; }
    const { totalPriceUSD } = calculateItemPricing(soldWeight, goldPricePerGram, laborFeePerGram);

    const newItem: InvoiceItem = {
      itemId: stockItem.id,
      itemName: stockItem.name,
      category: stockItem.category,
      karat: stockItem.karat,
      grossWeightGrams: soldWeight,
      stoneWeightGrams: isAggregate ? 0 : stockItem.stoneWeightGrams,
      netWeightGrams: soldWeight,
      quantity: soldQuantity,
      laborFeeUSDPerGram: laborFeePerGram,
      pricePerGramUSD: goldPricePerGram,
      totalPriceUSD,
      warehouseId: stockItem.warehouseId
    };

    setInvItems(prev => [...prev, newItem]);
    setSelectedStockItemId('');
    setStockSearchQuery('');
    if (invType === 'sale') setStockSalePricePerGram('');
    setAggregateSoldWeight('');
    setAggregateSoldQuantity('1');
  };

  // Add custom item into invoice
  const handleAddCustomItemToInvoice = () => {
    const gross = parseFloat(customGrossWeight);
    const stone = parseFloat(customStoneWeight) || 0;
    const labor = parseFloat(customLaborPerGram) || 0;
    
    if (!customItemName.trim() || isNaN(gross) || gross <= 0) return;

    const net = Math.max(0, gross - stone);
    const enteredGoldPrice = parseFloat(customPricePerGram);
    if (invType === 'sale' && (!Number.isFinite(enteredGoldPrice) || enteredGoldPrice < 0)) {
      alert('أدخل سعر البيع للغرام قبل إضافة القطعة.');
      return;
    }
    const p = goldPrices.find(g => g.karat === customKarat);
    const goldPricePerGram = Number.isFinite(enteredGoldPrice) ? enteredGoldPrice : (p ? p.buyPriceUSDPerGram : 75);
    const { totalPriceUSD } = calculateItemPricing(net, goldPricePerGram, labor);

    const newItem: InvoiceItem = {
      itemName: customItemName,
      category: customCategory,
      karat: customKarat,
      grossWeightGrams: gross,
      stoneWeightGrams: stone,
      netWeightGrams: net,
      laborFeeUSDPerGram: labor,
      pricePerGramUSD: goldPricePerGram,
      totalPriceUSD,
      warehouseId: invWarehouseId,
      reconciliationTargetInventoryItemId: invType === 'purchase' && purchaseReconciliationTargetId ? purchaseReconciliationTargetId : undefined
    };

    setInvItems(prev => [...prev, newItem]);
    setCustomItemName('');
    setCustomGrossWeight('');
    setCustomStoneWeight('0');
    setPurchaseReconciliationTargetId('');
    if (invType === 'sale') {
      setCustomPricePerGram('');
      setCustomLaborPerGram('');
    }
  };

  // Remove item from invoice items draft
  const handleRemoveItemFromInvoice = (idx: number) => {
    setInvItems(prev => prev.filter((_, i) => i !== idx));
  };

  // Add scrap gold item (ذهب كسر مقايضة)
  const handleAddScrapGold = () => {
    const w = parseFloat(scrapWeight);
    if (isNaN(w) || w <= 0) return;

    const defaultPrice = goldPrices.find(g => g.karat === scrapKarat)?.buyPriceUSDPerGram || 70;
    const pricePerGram = parseFloat(scrapPricePerGram) || defaultPrice;
    const totalVal = w * pricePerGram;

    setScrapItems(prev => [
      ...prev,
      {
        karat: scrapKarat,
        weightGrams: w,
        pricePerGramUSD: pricePerGram,
        totalScrapValueUSD: totalVal
      }
    ]);

    setScrapWeight('');
  };

  // Remove scrap gold
  const handleRemoveScrapGold = (idx: number) => {
    setScrapItems(prev => prev.filter((_, i) => i !== idx));
  };

  // Invoice calculations
  const subtotalGoldUSD = money(invItems.reduce((acc, item) => acc + calculateItemPricing(item.netWeightGrams, item.pricePerGramUSD, item.laborFeeUSDPerGram).goldValueUSD, 0));
  const totalLaborUSD = money(invItems.reduce((acc, item) => acc + calculateItemPricing(item.netWeightGrams, item.pricePerGramUSD, item.laborFeeUSDPerGram).laborValueUSD, 0));
  const totalInvoiceGrossUSD = money(subtotalGoldUSD + totalLaborUSD);
  const scrapTotalValueUSD = scrapItems.reduce((acc, s) => acc + s.totalScrapValueUSD, 0);
  const requestedDiscountUSD = parseFloat(invDiscountUSD) || 0;
  const discountUSD = money(Math.min(Math.max(0, requestedDiscountUSD), Math.max(0, totalInvoiceGrossUSD - scrapTotalValueUSD)));

  const finalTotalUSD = money(Math.max(0, totalInvoiceGrossUSD - scrapTotalValueUSD - discountUSD));
  const finalTotalSYP = Math.round(finalTotalUSD * settings.usdToSypRate);

  const numPaidUSD = parseFloat(paidUSD) || 0;
  const numPaidSYP = parseFloat(paidSYP) || 0;
  const numPaidSYPInUSD = numPaidSYP / settings.usdToSypRate;

  const totalPaidInUSD = numPaidUSD + numPaidSYPInUSD;
  const remainingDebtUSD = Math.max(0, finalTotalUSD - totalPaidInUSD);

  // Quick Add Partner Handle
  const handleSaveQuickPartner = async () => {
    if (!quickPartnerName.trim()) return;
    if (invType !== 'sale') { try { const supplier = await partnersApi.create({ name: quickPartnerName, type: 'supplier', phone: quickPartnerPhone, address: 'حلب - سوريا' }); setInvPartnerId(supplier.id); setInvPartnerName(supplier.name); setInvCustomerPhone(supplier.phone || ''); setShowQuickAddPartner(false); await refreshSuppliers(); } catch (error: any) { setPurchasesError(error?.message || 'تعذر إنشاء المورد.'); } return; }
    try { const partner = await partnersApi.create({ name: quickPartnerName, type: 'customer', phone: quickPartnerPhone, address: 'حلب - سوريا' }); setInvPartnerId(partner.id); setInvPartnerName(partner.name); setInvCustomerPhone(partner.phone); setShowQuickAddPartner(false); } catch (error: any) { alert(error?.message || 'تعذر حفظ العميل.'); }
  };

  // Save Final Invoice
  const notifyNewSale = (invoice: Invoice) => {
    if (invoice.type !== 'sale' || typeof window === 'undefined' || !('Notification' in window)) return;

    const showNotification = () => {
      new Notification(settings.storeName, {
        body: `فاتورة بيع جديدة ${invoice.invoiceNumber}\nالبائع: ${invoice.createdBy}\n${invoice.customerOrSupplierName} — $ ${invoice.finalTotalUSD.toFixed(2)}`,
        tag: `sale-${invoice.id}`
      });
    };

    if (Notification.permission === 'granted') {
      showNotification();
    } else if (Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') showNotification();
      });
    }
  };

  const handleSaveInvoice = async (andPrint: boolean = false) => {
    if (invItems.length === 0) {
      alert('يرجى إضافة قطعة ذهب واحدة على الأقل للفاتورة');
      return;
    }

    const partnerName = invPartnerName.trim() || 'زبون نقدي عام';
    if (!invWarehouseId) { setSalesError('أنشئ أو اختر مستودعاً حقيقياً قبل حفظ الفاتورة.'); return; }

    if (invType === 'sale') {
      try {
        let customerId = invPartnerId;
        if (!customerId) { const partner = await partnersApi.create({ name: partnerName, type: 'customer', phone: invCustomerPhone, address: 'حلب - سوريا' }); customerId = partner.id; setInvPartnerId(partner.id); }
        const newInv = await salesApi.create({ warehouseId: invWarehouseId, customerId, items: invItems.map(item => ({ ...item, soldWeightGrams: item.itemId ? item.netWeightGrams : undefined })), scrapGoldItems: scrapItems, discountUSD, paidUSD: numPaidUSD, paidSYP: numPaidSYP, paymentMethod: invPaymentMethod, exchangeRateSypPerUsd: settings.usdToSypRate, notes: invNotes, itemPhotoUrl: itemPhotoUrl || undefined, idempotencyKey: crypto.randomUUID() });
        await refreshServerSales(); setShowCreateModal(false); if (!invItems.some(item => !item.itemId)) notifyNewSale(newInv); if (andPrint) setSelectedInvoiceForPrint(newInv); return;
      } catch (error: any) { setSalesError(error?.message || 'تعذر حفظ فاتورة البيع.'); return; }
    }
    if (invType === 'purchase') {
      try {
        let supplierId = invPartnerId;
        if (!supplierId) { const supplier = await partnersApi.create({ name: partnerName, type: 'supplier', phone: invCustomerPhone, address: 'حلب - سوريا' }); supplierId = supplier.id; setInvPartnerId(supplier.id); await refreshSuppliers(); }
        const newInv = await purchasesApi.create({ warehouseId: invWarehouseId, supplierId, items: invItems, discountUSD, paidUSD: numPaidUSD, paidSYP: numPaidSYP, paymentMethod: invPaymentMethod === 'gold_exchange' ? 'debt' : invPaymentMethod, exchangeRateSypPerUsd: settings.usdToSypRate, notes: invNotes, itemPhotoUrl: itemPhotoUrl || undefined, idempotencyKey: crypto.randomUUID() });
        await Promise.all([refreshServerPurchases(), refreshOperationalStock()]); setShowCreateModal(false); if (andPrint) setSelectedInvoiceForPrint(newInv); return;
      } catch (error: any) { setPurchasesError(error?.message || 'تعذر حفظ فاتورة الشراء.'); return; }
    }
    const newInv = addInvoice({
      type: invType,
      date: new Date().toISOString().split('T')[0],
      customerOrSupplierId: invPartnerId,
      customerOrSupplierName: partnerName,
      customerPhone: invCustomerPhone,
      warehouseId: invWarehouseId,
      items: invItems,
      scrapGoldItems: scrapItems,
      subtotalGoldUSD,
      totalLaborUSD,
      scrapTotalValueUSD,
      discountUSD,
      finalTotalUSD,
      finalTotalSYP,
      paidUSD: numPaidUSD,
      paidSYPInUSD: numPaidSYPInUSD,
      paidSYP: numPaidSYP,
      remainingDebtUSD,
      remainingDebtGold21kGrams: 0,
      paymentMethod: invPaymentMethod,
      notes: invNotes,
      itemPhotoUrl: itemPhotoUrl || undefined,
      createdBy: currentUser.fullName
    });

    notifyNewSale(newInv);

    setShowCreateModal(false);

    if (andPrint) {
      setSelectedInvoiceForPrint(newInv);
    }
  };

  // Filtered invoices list
  const combinedInvoices = [...serverSales, ...serverPurchases, ...invoices.filter(invoice => invoice.type === 'return')];
  const filteredInvoices = combinedInvoices.filter(inv => {
    if (filterType !== 'all' && inv.type !== filterType) return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customerOrSupplierName.toLowerCase().includes(q) ||
        inv.notes?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="invoice-view-root space-y-3 sm:space-y-6">
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-3 sm:p-5 rounded-sm border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-1.5 text-amber-600 font-bold text-[11px] sm:text-xs uppercase mb-0.5">
            <FileText className="w-3.5 h-3.5" />
            <span>نظام الفواتير الرسمية والمقايضة</span>
          </div>
          <h2 className="text-base sm:text-2xl font-black text-slate-900 tracking-tight">
            فواتير البيع والمشتريات والكسر
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenCreateModal('sale')}
            className="flex-1 sm:flex-none justify-center bg-amber-400 hover:bg-amber-300 text-slate-900 px-3 py-2 sm:px-4 sm:py-2.5 rounded-sm font-bold text-xs shadow flex items-center gap-1.5 transition"
          >
            <Plus className="w-4 h-4" />
            <span>+ فاتورة بيع جديدة</span>
          </button>

          <button
            onClick={() => handleOpenCreateModal('purchase')}
            className="flex-1 sm:flex-none justify-center bg-slate-900 hover:bg-slate-800 text-amber-400 px-3 py-2 sm:px-4 sm:py-2.5 rounded-sm font-bold text-xs shadow flex items-center gap-1.5 transition"
          >
            <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
            <span>فاتورة شراء ذهب</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search */}
      <div className="bg-white p-2.5 sm:p-4 rounded-sm border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-2.5 sm:gap-4 text-xs">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-sm w-full sm:w-auto font-bold overflow-x-auto">
          <button
            onClick={() => setFilterType('all')}
            className={`px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-sm transition whitespace-nowrap text-[11px] sm:text-xs ${
              filterType === 'all' ? 'bg-amber-400 text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            الكافة ({salesTotal + purchasesTotal + invoices.filter(i => i.type === 'return').length})
          </button>
          <button
            onClick={() => setFilterType('sale')}
            className={`px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-sm transition whitespace-nowrap text-[11px] sm:text-xs ${
              filterType === 'sale' ? 'bg-amber-400 text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            البيع ({salesTotal})
          </button>
          <button
            onClick={() => setFilterType('purchase')}
            className={`px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-sm transition whitespace-nowrap text-[11px] sm:text-xs ${
              filterType === 'purchase' ? 'bg-amber-400 text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            الشراء ({purchasesTotal})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute right-2.5 top-2" />
          <input
            type="text"
            placeholder="ابحث برقم الفاتورة أو الزبون..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pr-8 pl-3 py-1.5 sm:py-2 bg-slate-50 border border-slate-200 rounded-sm text-slate-800 focus:outline-none focus:border-amber-400 font-medium text-xs"
          />
        </div>
      </div>

      <div className={`flex flex-col gap-2 rounded-sm border p-3 text-xs sm:flex-row sm:items-center sm:justify-between ${activeShift ? 'border-emerald-300 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`}>
        <div><p className="font-black text-slate-900">{activeShift ? `وردية مفتوحة: ${currentUser.fullName}` : 'لا توجد وردية مفتوحة'}</p><p className="mt-0.5 text-[10px] text-slate-600">{activeShift ? `بدأت: ${new Date(activeShift.startedAt).toLocaleString('ar-SY')}` : 'ابدأ ورديتك قبل تنفيذ المبيعات لتسجيل نشاطك باسمك.'}</p></div>
        {activeShift ? <button onClick={() => { if (window.confirm('إغلاق الوردية الحالية؟')) closeShift(); }} className="bg-rose-600 px-4 py-2 text-xs font-black text-white">إنهاء الوردية</button> : <button onClick={() => startShift()} className="bg-emerald-600 px-4 py-2 text-xs font-black text-white">بدء وردية</button>}
      </div>

      {(salesLoading || salesError || purchasesError) && <div className={`rounded-sm border px-3 py-2 text-xs font-bold ${(salesError || purchasesError) ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{salesError || purchasesError || 'جار تحميل فواتير البيع من الخادم...'}</div>}

      {/* Invoices List Table (Desktop) & Compact Rows (Mobile) */}
      <div className="bg-white rounded-sm border border-slate-200 shadow-sm overflow-hidden">
        {/* MOBILE COMPACT CARDS VIEW (Phone screens) */}
        <div className="block sm:hidden divide-y divide-slate-100">
          {filteredInvoices.length === 0 ? (
            <div className="p-6 text-center text-slate-400 font-medium text-xs">
              لا يوجد فواتير مسجلة تطابق خيارات البحث
            </div>
          ) : (
            filteredInvoices.map(inv => (
              <div key={inv.id} className="p-2.5 space-y-2 bg-white hover:bg-amber-50/30 transition text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded text-[11px]">
                      {inv.invoiceNumber}
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                        inv.type === 'sale'
                          ? 'bg-emerald-100 text-emerald-800'
                          : inv.type === 'purchase'
                          ? 'bg-amber-200 text-amber-900'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {inv.type === 'sale' ? 'بيع' : inv.type === 'purchase' ? 'شراء' : 'مرتجع'}
                    </span>
                    {inv.itemPhotoUrl && (
                      <span className="bg-amber-200 text-amber-950 px-1 py-0.5 rounded text-[10px] font-bold flex items-center gap-0.5" title="مرفق صورة ضمان للقطعة">
                        <Camera className="w-3 h-3 text-amber-800" />
                        <span>ضمان</span>
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">{inv.date}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1 pl-2">
                    <span className="font-bold text-slate-900 text-xs truncate block">
                      {inv.customerOrSupplierName}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      {inv.items.length} قطعة | البائع: {inv.createdBy}
                    </span>
                  </div>
                  <div className="text-left font-mono shrink-0">
                    <span className="font-black text-amber-900 text-xs">$ {inv.finalTotalUSD.toFixed(2)}</span>
                    <div className="text-[10px]">
                      {inv.remainingDebtUSD > 0 ? (
                        <span className="text-rose-700 font-bold">باقي: ${inv.remainingDebtUSD.toFixed(0)}</span>
                      ) : (
                        <span className="text-emerald-600 font-bold">خالص</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-1 border-t border-slate-100 flex items-center justify-between">
                  <div className="text-[10px] text-slate-500 font-mono">
                    مدفوع: ${inv.paidUSD.toFixed(0)}
                  </div>

                  <button
                    onClick={(e) => toggleInvoiceMenu(e, inv)}
                    className={`p-1.5 rounded-sm transition flex items-center justify-center border shadow-sm ${
                      activeMenu?.inv.id === inv.id
                        ? 'bg-amber-400 text-slate-900 border-amber-500'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                    }`}
                    title="خيارات وإجراءات الفاتورة"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* DESKTOP TABLE VIEW */}
        <div className="hidden sm:block overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-900 text-amber-400 font-bold border-b border-slate-800 uppercase">
              <tr>
                <th className="py-3.5 px-4">رقم الفاتورة</th>
                <th className="py-3.5 px-3">النوع</th>
                <th className="py-3.5 px-3">التاريخ</th>
                <th className="py-3.5 px-4">الزبون / المورد</th>
                <th className="py-3.5 px-3 text-center">المواد</th>
                <th className="py-3.5 px-3">الإجمالي الصافي ($)</th>
                <th className="py-3.5 px-3">المدفوع ($)</th>
                <th className="py-3.5 px-3">المتبقي (ذمة)</th>
                <th className="py-3.5 px-3">البائع / المنفذ</th>
                <th className="py-3.5 px-4 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-800 font-medium">
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    لا يوجد فواتير مسجلة تطابق خيارات البحث
                  </td>
                </tr>
              ) : (
                filteredInvoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-amber-50/50 transition">
                    <td className="py-3 px-4 font-mono font-bold text-amber-900">
                      <div className="flex items-center gap-1.5">
                        <span>{inv.invoiceNumber}</span>
                        {inv.itemPhotoUrl && (
                          <span className="bg-amber-100 text-amber-900 p-1 rounded text-[10px]" title="مرفق صورة ضمان للقطعة">
                            <Camera className="w-3 h-3 text-amber-700" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-sm text-[10px] font-black ${
                          inv.type === 'sale'
                            ? 'bg-emerald-100 text-emerald-800'
                            : inv.type === 'purchase'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {inv.type === 'sale' ? 'فاتورة بيع' : inv.type === 'purchase' ? 'فاتورة شراء' : 'مرتجع'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-500 font-mono">{inv.date}</td>
                    <td className="py-3 px-4 font-bold text-slate-900">{inv.customerOrSupplierName}</td>
                    <td className="py-3 px-3 text-center font-bold text-slate-600 font-mono">{inv.items.length} قطع</td>
                    <td className="py-3 px-3 font-black font-mono text-amber-900">$ {inv.finalTotalUSD.toFixed(2)}</td>
                    <td className="py-3 px-3 text-emerald-700 font-bold font-mono">$ {inv.paidUSD.toFixed(2)}</td>
                    <td className="py-3 px-3">
                      {inv.remainingDebtUSD > 0 ? (
                        <span className="text-rose-700 font-black font-mono">$ {inv.remainingDebtUSD.toFixed(2)}</span>
                      ) : (
                        <span className="text-emerald-600 font-bold">خالص متسدد</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-[11px] font-bold text-slate-700">{inv.createdBy}</td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center">
                        <button
                          onClick={(e) => toggleInvoiceMenu(e, inv)}
                          className={`p-1.5 rounded-sm transition flex items-center justify-center border shadow-sm ${
                            activeMenu?.inv.id === inv.id
                              ? 'bg-amber-400 text-slate-900 border-amber-500'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                          }`}
                          title="خيارات وإجراءات الفاتورة"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {salesTotal > 30 && (filterType === 'all' || filterType === 'sale') && <div className="flex items-center justify-center gap-3 text-xs font-bold text-slate-600"><button disabled={salesPage <= 1} onClick={() => setSalesPage(page => page - 1)} className="rounded-sm border border-slate-300 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50">السابق</button><span>صفحة {salesPage} من {Math.ceil(salesTotal / 30)}</span><button disabled={salesPage >= Math.ceil(salesTotal / 30)} onClick={() => setSalesPage(page => page + 1)} className="rounded-sm border border-slate-300 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50">التالي</button></div>}
      {purchasesTotal > 30 && (filterType === 'all' || filterType === 'purchase') && <div className="flex items-center justify-center gap-3 text-xs font-bold text-slate-600"><button disabled={purchasesPage <= 1} onClick={() => setPurchasesPage(page => page - 1)} className="rounded-sm border border-slate-300 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50">السابق</button><span>صفحة الشراء {purchasesPage} من {Math.ceil(purchasesTotal / 30)}</span><button disabled={purchasesPage >= Math.ceil(purchasesTotal / 30)} onClick={() => setPurchasesPage(page => page + 1)} className="rounded-sm border border-slate-300 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50">التالي</button></div>}

      {/* CREATE INVOICE WIZARD MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-sm border-2 border-amber-400 shadow-2xl max-w-4xl w-full p-3 sm:p-6 text-right space-y-3 sm:space-y-6 max-h-[96vh] sm:max-h-[92vh] overflow-y-auto my-auto sm:my-6">
            <div className="flex items-center justify-between border-b-2 border-amber-300 pb-2 sm:pb-3">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-sm bg-amber-400 text-slate-900 flex items-center justify-center font-bold shadow-sm shrink-0">
                  <Coins className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-lg font-black text-slate-900">
                    إنشاء فاتورة {invType === 'sale' ? 'بيع ذهب ومجوهرات' : 'شراء ذهب'} جديدة
                  </h3>
                  <p className="hidden sm:block text-xs text-slate-500">حساب الأسعار اللحظية والأجور والمقايضة</p>
                </div>
              </div>

              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-900 p-1 rounded-sm"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step 1: Customer & Warehouse Selection Header */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 bg-slate-50 p-2.5 sm:p-4 rounded-sm border border-slate-200 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-0.5 sm:mb-1">اسم الزبون / المورد *</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="اكتب اسم الزبون..."
                    value={invPartnerName}
                    list={invType === 'sale' ? 'sales-customers' : invType === 'purchase' ? 'purchase-suppliers' : undefined}
                    onChange={e => { const name = e.target.value; setInvPartnerName(name); const partner = (invType === 'sale' ? serverCustomers : serverSuppliers).find(candidate => candidate.name === name); setInvPartnerId(partner?.id || ''); if (partner) setInvCustomerPhone(partner.phone || ''); }}
                    className="w-full p-1.5 sm:p-2 bg-white border border-slate-200 rounded-sm text-slate-800 font-bold"
                  />
                  {invType === 'sale' && <datalist id="sales-customers">{serverCustomers.map(partner => <option key={partner.id} value={partner.name}>{partner.phone}</option>)}</datalist>}
                  {invType === 'purchase' && <datalist id="purchase-suppliers">{serverSuppliers.map(partner => <option key={partner.id} value={partner.name}>{partner.phone}</option>)}</datalist>}
                  <button
                    type="button"
                    onClick={() => setShowQuickAddPartner(true)}
                    className="px-2 py-1 bg-amber-400 text-slate-900 rounded-sm font-bold shrink-0 text-xs"
                  >
                    + زبون
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-0.5 sm:mb-1">رقم الهاتف (اختياري)</label>
                <input
                  type="text"
                  placeholder="+963..."
                  value={invCustomerPhone}
                  onChange={e => setInvCustomerPhone(e.target.value)}
                  className="w-full p-1.5 sm:p-2 bg-white border border-slate-200 rounded-sm font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-0.5 sm:mb-1">المستودع / الفرع *</label>
                <select
                  value={invWarehouseId}
                  onChange={e => setInvWarehouseId(e.target.value)}
                  className="w-full p-1.5 sm:p-2 bg-white border border-slate-200 rounded-sm font-medium"
                >
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Step 2: Add Items Section (From Stock OR Custom) */}
            <div className="space-y-2 sm:space-y-3">
              <h4 className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                <PlusCircle className="w-4 h-4 text-amber-600" />
                <span>إضافة قطع الذهب إلى الفاتورة:</span>
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-4 text-xs">
                {/* Option A: Predictive Search & Select from Existing Inventory */}
                <div className="bg-amber-50/90 p-2.5 sm:p-3.5 rounded-sm border border-amber-200 space-y-1.5 sm:space-y-2 relative">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 block text-[11px] sm:text-xs">اختيار قطعة من المخزون:</span>
                    <span className="text-[10px] text-amber-900 font-bold bg-amber-200/80 px-1.5 py-0.5 rounded-sm">
                      {inventory.filter(i => i.status === 'in_stock' && i.warehouseId === invWarehouseId).length} بالمخزون
                    </span>
                  </div>

                  {/* Predictive Search Input */}
                  <div className="relative">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="ابحث بكود أو اسم القطعة أو العيار..."
                        value={stockSearchQuery}
                        onChange={e => setStockSearchQuery(e.target.value)}
                        className="w-full pr-8 pl-7 py-1.5 sm:py-2 bg-white border border-amber-300 rounded-sm text-slate-900 font-bold text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      {stockSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setStockSearchQuery('')}
                          className="absolute left-2 top-2 text-slate-400 hover:text-slate-700"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Predictive Live List Dropdown */}
                    {stockSearchQuery.trim().length > 0 && (
                      <div className="absolute top-full right-0 left-0 mt-1 bg-white border-2 border-amber-400 rounded-sm shadow-2xl z-30 max-h-56 overflow-y-auto divide-y divide-slate-100 text-xs">
                        {inventory
                          .filter(
                            i =>
                              i.status === 'in_stock' &&
                              i.warehouseId === invWarehouseId &&
                              (i.name.toLowerCase().includes(stockSearchQuery.toLowerCase()) ||
                                i.code.toLowerCase().includes(stockSearchQuery.toLowerCase()) ||
                                i.category.toLowerCase().includes(stockSearchQuery.toLowerCase()) ||
                                i.karat.includes(stockSearchQuery))
                          )
                          .length === 0 ? (
                          <div className="p-3 text-center text-slate-500 font-medium">
                            لا يوجد نتائج متطابقة في المستودع الحالي
                          </div>
                        ) : (
                          inventory
                            .filter(
                              i =>
                                i.status === 'in_stock' &&
                                i.warehouseId === invWarehouseId &&
                                (i.name.toLowerCase().includes(stockSearchQuery.toLowerCase()) ||
                                  i.code.toLowerCase().includes(stockSearchQuery.toLowerCase()) ||
                                  i.category.toLowerCase().includes(stockSearchQuery.toLowerCase()) ||
                                  i.karat.includes(stockSearchQuery))
                            )
                            .map(item => {
                              const p = goldPrices.find(g => g.karat === item.karat);
                              const itemEstTotal = invType === 'sale' ? null : (item.netWeightGrams * (p?.buyPriceUSDPerGram ?? 75)) + item.totalLaborFeeUSD;

                              return (
                                <div
                                  key={item.id}
                                  className="p-2.5 hover:bg-amber-50 flex items-center justify-between gap-2 transition cursor-pointer"
                                  onClick={() => handleAddStockItemToInvoice(item)}
                                >
                                  <div className="min-w-0 space-y-0.5 flex items-center gap-2">
                                    {item.imageUrl && <img src={item.imageUrl} alt="" className="h-10 w-10 rounded-sm border border-amber-200 object-cover bg-amber-50 shrink-0" />}
                                    <div className="min-w-0 space-y-0.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono font-bold bg-amber-400 text-slate-900 px-1.5 py-0.2 rounded text-[10px]">
                                        {item.code}
                                      </span>
                                      <span className="font-bold text-slate-900 truncate">{item.name}</span>
                                      <span className="bg-amber-100 text-amber-900 font-bold px-1.5 py-0.2 rounded text-[10px] shrink-0">
                                        عيار {item.karat}
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-slate-500 font-mono flex gap-2">
                                      <span>الوزن: {item.netWeightGrams.toFixed(2)} غ</span>
                                      <span>|</span>
                                      <span>الأجرة: ${item.laborFeeUSDPerGram}/غ</span>
                                    </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 shrink-0">
                                    <div className="text-left font-mono">
                                      {itemEstTotal === null ? <div className="text-[10px] font-bold text-amber-900">سعر بيع حر</div> : <div className="font-black text-amber-900 text-xs">$ {itemEstTotal.toFixed(2)}</div>}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleAddStockItemToInvoice(item);
                                      }}
                                      className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-black px-2.5 py-1 rounded-sm text-[11px] shadow-sm"
                                    >
                                      + إضافة
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                        )}
                      </div>
                    )}
                  </div>

                  {invType === 'sale' && (
                    <div>
                      <label className="mb-0.5 block text-[10px] font-bold text-amber-950">سعر البيع الحر للغرام ($)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="أدخل سعر البيع الذي تحدده الإدارة"
                        value={stockSalePricePerGram}
                        onChange={e => setStockSalePricePerGram(e.target.value)}
                        className="w-full border border-amber-300 bg-white p-1.5 font-mono font-bold text-xs text-slate-900"
                      />
                    </div>
                  )}

                  {invType === 'sale' && inventory.find(item => item.id === selectedStockItemId)?.inventoryMode === 'aggregate' && (() => { const item = inventory.find(row => row.id === selectedStockItemId)!; return <div className="grid grid-cols-2 gap-2 rounded-sm border border-amber-300 bg-amber-50 p-2"><p className="col-span-2 text-[11px] font-bold text-amber-950">صنف مجمّع — المتاح: {item.netWeightGrams.toFixed(3)} غ، الكمية: {item.quantity ?? 0}</p><input type="number" min="0.001" step="0.001" value={aggregateSoldWeight} onChange={e => setAggregateSoldWeight(e.target.value)} placeholder="وزن البيع (غ)" className="border border-amber-300 bg-white p-1.5 font-mono text-xs" /><input type="number" min="0.001" step="1" value={aggregateSoldQuantity} onChange={e => setAggregateSoldQuantity(e.target.value)} placeholder="عدد القطع" className="border border-amber-300 bg-white p-1.5 font-mono text-xs" /></div>; })()}

                  {/* Fallback standard select for quick browsing without typing */}
                  <div className="flex gap-1.5 pt-0.5">
                    <select
                      value={selectedStockItemId}
                      onChange={e => {
                        setSelectedStockItemId(e.target.value);
                      }}
                      className="w-full p-1.5 bg-white border border-amber-300 rounded-sm text-slate-800 font-medium text-xs"
                    >
                      <option value="">-- أو اختر من قائمة قطع المستودع --</option>
                      {inventory
                        .filter(i => i.status === 'in_stock' && i.warehouseId === invWarehouseId)
                        .map(item => (
                          <option key={item.id} value={item.id}>
                            [{item.code}] {item.name} - عيار {item.karat} - {item.netWeightGrams}غ
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => handleAddStockItemToInvoice()}
                      className="bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold px-2.5 py-1 rounded-sm shrink-0 shadow-sm text-xs"
                    >
                      إضافة
                    </button>
                  </div>
                </div>

                {/* Option B: Enter Custom Item on the fly */}
                <div className="bg-slate-50 p-2.5 sm:p-3.5 rounded-sm border border-slate-200 space-y-1.5">
                  <span className="font-bold text-slate-800 block text-[11px] sm:text-xs">إدخال قطعة جديدة يدوياً:</span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                    <input
                      type="text"
                      placeholder="اسم القطعة"
                      value={customItemName}
                      onChange={e => setCustomItemName(e.target.value)}
                      className="p-1.5 bg-white border border-slate-200 rounded-sm text-xs"
                    />
                    <select
                      value={customKarat}
                      onChange={e => setCustomKarat(e.target.value as GoldKarat)}
                      className="p-1.5 bg-white border border-slate-200 rounded-sm font-bold text-xs"
                    >
                      <option value="21">عيار 21</option>
                      <option value="24">عيار 24</option>
                      <option value="22">عيار 22</option>
                      <option value="18">عيار 18</option>
                      <option value="14">عيار 14</option>
                    </select>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="الوزن غ"
                      value={customGrossWeight}
                      onChange={e => setCustomGrossWeight(e.target.value)}
                      className="p-1.5 bg-white border border-slate-200 rounded-sm font-mono font-bold text-xs"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={invType === 'sale' ? 'سعر البيع $/غ' : 'سعر الشراء $/غ'}
                      value={customPricePerGram}
                      onChange={e => setCustomPricePerGram(e.target.value)}
                      className="p-1.5 bg-white border border-slate-200 rounded-sm font-mono text-xs"
                    />
                    <input
                      type="number"
                      step="0.1"
                      placeholder="الأجرة $/غ"
                      value={customLaborPerGram}
                      onChange={e => setCustomLaborPerGram(e.target.value)}
                      className="p-1.5 bg-white border border-slate-200 rounded-sm font-mono text-xs"
                    />
                    {invType === 'purchase' && <select value={purchaseReconciliationTargetId} onChange={e => setPurchaseReconciliationTargetId(e.target.value)} className="col-span-2 sm:col-span-3 p-1.5 bg-white border border-slate-200 rounded-sm text-xs"><option value="">استلام جديد دون تسوية رصيد سلبي</option>{inventory.filter(item => item.warehouseId === invWarehouseId && item.isManualSaleEntry && (item.quantity ?? 0) < 0 && item.status === 'sold').map(item => <option key={item.id} value={item.id}>تسوية صريحة: {item.name} — {item.netWeightGrams}غ / كمية {item.quantity}</option>)}</select>}
                    <button
                      type="button"
                      onClick={handleAddCustomItemToInvoice}
                      className="col-span-2 bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold p-1.5 rounded-sm shadow-sm text-xs"
                    >
                      + إضافة يدوي
                    </button>
                  </div>
                </div>
              </div>

              {/* Items List Draft (Mobile Rows + Desktop Table) */}
              <div className="border border-slate-200 rounded-sm overflow-hidden bg-white">
                {/* Mobile View Items List */}
                <div className="block sm:hidden divide-y divide-slate-100">
                  {invItems.length === 0 ? (
                    <div className="py-4 text-center text-slate-400 text-xs">
                      لم يتم إضافة أي قطعة للفاتورة بعد
                    </div>
                  ) : (
                    invItems.map((item, idx) => (
                      <div key={idx} className="p-2 flex items-center justify-between gap-2 font-mono text-xs hover:bg-amber-50/50">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-slate-900 font-sans truncate">{item.itemName}</span>
                            <span className="bg-amber-100 text-amber-900 px-1 py-0.2 rounded text-[10px] font-bold shrink-0 font-sans">
                              {item.karat}k
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {item.netWeightGrams.toFixed(2)} غ | ${item.pricePerGramUSD}/غ | أجرة: ${item.laborFeeUSDPerGram}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-black text-slate-900 text-xs">${item.totalPriceUSD.toFixed(2)}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveItemFromInvoice(idx)}
                            className="text-rose-600 hover:text-rose-800 p-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Desktop View Items Table */}
                <table className="hidden sm:table w-full text-right text-xs font-mono">
                  <thead className="bg-amber-400 text-slate-900 font-extrabold font-sans border-b border-amber-300">
                    <tr>
                      <th className="py-2.5 px-3">القطعة</th>
                      <th className="py-2.5 px-2 text-center">العيار</th>
                      <th className="py-2.5 px-2 text-center">الوزن (غ)</th>
                      <th className="py-2.5 px-2 text-center">سعر الجرام ($)</th>
                      <th className="py-2.5 px-2 text-center">أجرة الجرام ($)</th>
                      <th className="py-2.5 px-3 text-left">الإجمالي ($)</th>
                      <th className="py-2.5 px-2 text-center">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
                    {invItems.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-slate-400 font-sans">
                          لم يتم إضافة أي قطعة للفاتورة بعد
                        </td>
                      </tr>
                    ) : (
                      invItems.map((item, idx) => (
                        <tr key={idx} className="hover:bg-amber-50/50">
                          <td className="py-2 px-3 font-bold font-sans">{item.itemName}</td>
                          <td className="py-2 px-2 text-center font-bold text-amber-800 font-sans">عيار {item.karat}</td>
                          <td className="py-2 px-2 text-center font-extrabold">{item.netWeightGrams.toFixed(2)} غ</td>
                          <td className="py-2 px-2 text-center">${item.pricePerGramUSD}</td>
                          <td className="py-2 px-2 text-center">${item.laborFeeUSDPerGram}</td>
                          <td className="py-2 px-3 text-left font-black text-slate-900">
                            $ {item.totalPriceUSD.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-center font-sans">
                            <button
                              type="button"
                              onClick={() => handleRemoveItemFromInvoice(idx)}
                              className="text-rose-600 hover:text-rose-800 p-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Step 3: Scrap Gold Trade-in (مقايضة ذهب كسر بديل) */}
            <div className="bg-amber-50 p-2.5 sm:p-4 rounded-sm border border-amber-200 space-y-2 sm:space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Coins className="w-4 h-4 text-amber-600" />
                  <span>مقايضة ذهب كسر مستلم خصماً من الفاتورة:</span>
                </h4>
                <span className="text-[11px] text-amber-800 font-mono font-bold">
                  خصم: ${scrapTotalValueUSD.toFixed(2)}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                <div>
                  <label className="block text-[10px] sm:text-[11px] font-bold text-slate-700 mb-0.5">العيار:</label>
                  <select
                    value={scrapKarat}
                    onChange={e => {
                      const newKarat = e.target.value as GoldKarat;
                      setScrapKarat(newKarat);
                      const p = goldPrices.find(g => g.karat === newKarat)?.buyPriceUSDPerGram;
                      if (p) setScrapPricePerGram(p.toString());
                    }}
                    className="w-full p-1.5 sm:p-2 bg-white border border-amber-300 rounded-sm font-bold text-xs"
                  >
                    <option value="21">كسر 21</option>
                    <option value="24">كسر 24</option>
                    <option value="22">كسر 22</option>
                    <option value="18">كسر 18</option>
                    <option value="14">كسر 14</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] sm:text-[11px] font-bold text-slate-700 mb-0.5">الوزن (غ):</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="الوزن..."
                    value={scrapWeight}
                    onChange={e => setScrapWeight(e.target.value)}
                    className="w-full p-1.5 sm:p-2 bg-white border border-amber-300 rounded-sm font-mono font-bold text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[10px] sm:text-[11px] font-bold text-slate-700 mb-0.5">سعر الجرام ($):</label>
                  <input
                    type="number"
                    step="0.1"
                    placeholder={`$${goldPrices.find(g => g.karat === scrapKarat)?.buyPriceUSDPerGram || 70}`}
                    value={scrapPricePerGram}
                    onChange={e => setScrapPricePerGram(e.target.value)}
                    className="w-full p-1.5 sm:p-2 bg-white border border-amber-300 rounded-sm font-mono font-bold text-xs text-amber-950"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleAddScrapGold}
                  className="col-span-2 sm:col-span-1 px-3 py-1.5 sm:py-2 bg-amber-400 hover:bg-amber-300 text-slate-900 font-bold rounded-sm shadow-sm text-xs flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ مقايضة</span>
                </button>
              </div>

              {scrapItems.length > 0 && (
                <div className="space-y-1 pt-1 font-mono">
                  {scrapItems.map((s, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-white p-1.5 sm:p-2 rounded-sm border border-amber-200 text-xs">
                      <span>كسر {s.karat}k - {s.weightGrams}غ بسعر ${s.pricePerGramUSD}</span>
                      <div className="flex items-center gap-2 font-bold text-rose-700">
                        <span>-${s.totalScrapValueUSD.toFixed(2)}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveScrapGold(idx)}
                          className="text-slate-400 hover:text-rose-600 p-0.5"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Step 4: Payments & Totals */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-4 text-xs pt-2 border-t border-slate-200">
              <div className="space-y-2 sm:space-y-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">طريقة السداد الرئيسة</label>
                  <select
                    value={invPaymentMethod}
                    onChange={e => setInvPaymentMethod(e.target.value as PaymentMethod)}
                    className="w-full p-1.5 sm:p-2 bg-slate-50 border border-slate-200 rounded-sm font-bold text-xs"
                  >
                    <option value="cash_usd">دفع كاش بالدولار ($)</option>
                    <option value="cash_syp">دفع كاش بالليرة السورية (ل.س)</option>
                    <option value="gold_exchange">مقايضة ذهب بالكامل</option>
                    <option value="debt">آجل / تسجيل ذمة مالية</option>
                    <option value="mixed">دفع مشترك ($ + ليرة سورية + كسر)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold text-slate-700 mb-0.5">المدفوع ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={paidUSD}
                      onChange={e => setPaidUSD(e.target.value)}
                      className="w-full p-1.5 sm:p-2 bg-slate-50 border border-slate-200 rounded-sm font-mono font-black text-slate-900 text-xs"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-0.5">المدفوع (ل.س)</label>
                    <input
                      type="number"
                      placeholder="0 ل.س"
                      value={paidSYP}
                      onChange={e => setPaidSYP(e.target.value)}
                      className="w-full p-1.5 sm:p-2 bg-slate-50 border border-slate-200 rounded-sm font-mono font-black text-slate-800 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-0.5">ملاحظات الفاتورة</label>
                  <input
                    type="text"
                    placeholder="ملاحظات العميل، تفاصيل التسليم..."
                    value={invNotes}
                    onChange={e => setInvNotes(e.target.value)}
                    className="w-full p-1.5 sm:p-2 bg-slate-50 border border-slate-200 rounded-sm text-xs"
                  />
                </div>
              </div>

              {/* Summary Calculations Card */}
              <div className="bg-amber-50/90 border-2 border-amber-300 text-slate-900 p-2.5 sm:p-4 rounded-sm space-y-1.5 sm:space-y-2.5 font-mono shadow-sm text-xs">
                <div className="flex justify-between font-bold text-slate-700">
                  <span className="font-sans">الذهب + الأجور:</span>
                  <span>$ {totalInvoiceGrossUSD.toFixed(2)}</span>
                </div>

                {scrapTotalValueUSD > 0 && (
                  <div className="flex justify-between font-bold text-amber-800">
                    <span className="font-sans">خصم الكسر:</span>
                    <span>-$ {scrapTotalValueUSD.toFixed(2)}</span>
                  </div>
                )}

                {invType === 'sale' && (
                  <div className="flex items-center justify-between gap-3 border-t border-amber-200 pt-2">
                    <label htmlFor="invoice-discount" className="font-sans font-black text-slate-800">حسم للزبون ($):</label>
                    <input
                      id="invoice-discount"
                      type="number"
                      min="0"
                      max={Math.max(0, totalInvoiceGrossUSD - scrapTotalValueUSD)}
                      step="0.01"
                      placeholder="0.00"
                      value={invDiscountUSD}
                      onChange={e => setInvDiscountUSD(e.target.value)}
                      className="w-28 border border-rose-300 bg-white p-1.5 text-left font-mono font-black text-rose-800"
                    />
                  </div>
                )}

                {discountUSD > 0 && (
                  <div className="flex justify-between font-bold text-rose-700">
                    <span className="font-sans">الحسم:</span>
                    <span>-$ {discountUSD.toFixed(2)}</span>
                  </div>
                )}

                <div className="border-t border-amber-300 pt-1.5 flex justify-between font-black text-base sm:text-lg text-amber-900">
                  <span className="font-sans">الصافي المطلوب:</span>
                  <span>$ {finalTotalUSD.toFixed(2)}</span>
                </div>

                <div className="flex justify-between text-[11px] sm:text-xs text-slate-600 font-bold">
                  <span className="font-sans">بالليرة السورية:</span>
                  <span className="text-slate-900">{finalTotalSYP.toLocaleString('ar-SY')} ل.س</span>
                </div>

                <div className="border-t border-amber-300 pt-1.5 flex justify-between text-xs font-black text-rose-700">
                  <span className="font-sans">المتبقي (ذمة):</span>
                  <span>$ {remainingDebtUSD.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Step 5: Guarantee Photo Capture Section (التقاط صورة للقطعة كضمان للبائع والشاري) */}
            <div className="pt-3 border-t border-slate-200 space-y-2">
              <div className="bg-slate-900 text-white p-3 rounded-sm flex flex-col sm:flex-row items-center justify-between gap-3 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-sm bg-amber-400 text-slate-900 flex items-center justify-center font-bold shrink-0">
                    <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-xs text-amber-400">
                        التقاط / إرفاق صورة القطعة ({invType === 'sale' ? 'المباعة' : 'المشتراة'})
                      </span>
                      <span className="bg-amber-400/20 text-amber-300 text-[10px] px-1.5 py-0.5 rounded font-bold">
                        ضمان للبائع والشاري
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      توثيق بصري مباشر لمواصفات وهيئة الذهب يرفق قانونياً مع الفاتورة المطبوعة.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                  {/* Button 1: Live Camera Capture */}
                  <label className="cursor-pointer bg-amber-400 hover:bg-amber-300 text-slate-900 font-black px-3 py-2 rounded-sm text-xs flex items-center justify-center gap-1.5 transition shadow-sm flex-1 sm:flex-none">
                    <Camera className="w-4 h-4" />
                    <span>التقاط بالكاميرا</span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleCaptureItemPhoto}
                      className="hidden"
                    />
                  </label>

                  {/* Button 2: Upload from Device/Gallery */}
                  <label className="cursor-pointer bg-slate-800 hover:bg-slate-700 text-white font-bold px-3 py-2 rounded-sm text-xs flex items-center justify-center gap-1.5 transition shadow-sm border border-slate-700 flex-1 sm:flex-none">
                    <Upload className="w-4 h-4 text-amber-400" />
                    <span>رفع من الاستوديو</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleCaptureItemPhoto}
                      className="hidden"
                    />
                  </label>

                  {itemPhotoUrl && (
                    <button
                      type="button"
                      onClick={() => setItemPhotoUrl('')}
                      className="p-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded-sm text-xs font-bold transition shrink-0"
                      title="حذف الصورة"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Photo Preview Thumbnail if uploaded */}
              {itemPhotoUrl && (
                <div className="flex items-center gap-3 bg-amber-50 p-2.5 rounded-sm border border-amber-300">
                  <img
                    src={itemPhotoUrl}
                    alt="صورة ضمان القطعة"
                    className="w-16 h-16 object-cover rounded border-2 border-amber-400 shadow-sm shrink-0"
                  />
                  <div className="text-xs space-y-0.5">
                    <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded text-[10px] font-black inline-block">
                      تم إرفاق صورة ضمان القطعة بنجاح ✓
                    </span>
                    <p className="text-slate-700 font-medium text-[11px]">
                      ستكون هذه الصورة متاحة في معاينة وطباعة الفاتورة لضمان حق الطرفين.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Submit Buttons */}
            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 sm:gap-3 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-sm font-bold text-xs"
              >
                إلغاء
              </button>

              <button
                type="button"
                onClick={() => handleSaveInvoice(false)}
                className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 rounded-sm font-bold text-xs shadow-sm"
              >
                حفظ الفاتورة فقط
              </button>

              <button
                type="button"
                onClick={() => handleSaveInvoice(true)}
                className="px-5 py-2 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-sm font-bold text-xs shadow flex items-center justify-center gap-1.5"
              >
                <Printer className="w-4 h-4" />
                <span>حفظ وطباعة الفاتورة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Add Partner Modal */}
      {showQuickAddPartner && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-sm border-2 border-slate-900 p-5 max-w-sm w-full space-y-3 text-right">
            <h4 className="font-bold text-slate-900 text-sm">إضافة زبون جديد سريع</h4>
            <input
              type="text"
              placeholder="اسم الزبون *"
              value={quickPartnerName}
              onChange={e => setQuickPartnerName(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-sm text-xs font-medium"
            />
            <input
              type="text"
              placeholder="رقم الهاتف"
              value={quickPartnerPhone}
              onChange={e => setQuickPartnerPhone(e.target.value)}
              className="w-full p-2 bg-slate-50 border border-slate-200 rounded-sm text-xs font-mono"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowQuickAddPartner(false)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-sm text-xs font-bold"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={handleSaveQuickPartner}
                className="px-4 py-1.5 bg-amber-400 text-slate-900 rounded-sm text-xs font-bold shadow-sm"
              >
                حفظ الزبون
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating 3-Dots Invoice Actions Menu (Viewport Fixed to prevent container clipping) */}
      {activeMenu && (
        <div className="fixed inset-0 z-50">
          <div 
            className="fixed inset-0 bg-slate-900/10" 
            onClick={() => setActiveMenu(null)} 
          />
          <div 
            style={{ top: `${activeMenu.top}px`, left: `${activeMenu.left}px` }}
            className="fixed w-52 bg-white border-2 border-slate-900 rounded-sm shadow-2xl z-50 py-1 text-right text-xs divide-y divide-slate-100 font-medium animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="py-0.5">
              <button
                onClick={() => handlePreviewInvoice(activeMenu.inv)}
                className="w-full px-3 py-2 text-slate-900 hover:bg-amber-100 flex items-center gap-2 transition font-bold"
              >
                <Eye className="w-4 h-4 text-amber-700 shrink-0" />
                <span>معاينة الفاتورة والتفاصيل</span>
              </button>

              <button
                onClick={() => handlePrintInvoice(activeMenu.inv)}
                className="w-full px-3 py-2 text-slate-800 hover:bg-amber-100 flex items-center gap-2 transition"
              >
                <Printer className="w-4 h-4 text-slate-700 shrink-0" />
                <span>طباعة الفاتورة</span>
              </button>
              
              <button
                onClick={() => handleReturnInvoice(activeMenu.inv)}
                className="w-full px-3 py-2 text-slate-800 hover:bg-amber-100 flex items-center gap-2 transition"
              >
                <RotateCcw className="w-4 h-4 text-blue-600 shrink-0" />
                <span>إنشاء مرتجع عن الفاتورة</span>
              </button>

              <button
                onClick={() => handleExportPdf(activeMenu.inv)}
                className="w-full px-3 py-2 text-slate-800 hover:bg-amber-100 flex items-center gap-2 transition"
              >
                <FileDown className="w-4 h-4 text-purple-600 shrink-0" />
                <span>تصدير PDF</span>
              </button>

              <button
                onClick={() => handleShareWhatsApp(activeMenu.inv)}
                className="w-full px-3 py-2 text-emerald-800 hover:bg-emerald-50 flex items-center gap-2 transition font-bold"
              >
                <Share2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>مشاركة / واتس اب</span>
              </button>
            </div>

            <div className="pt-1">
              <button
                onClick={() => handleCancelInvoiceAction(activeMenu.inv)}
                className="w-full px-3 py-2 text-rose-700 hover:bg-rose-50 flex items-center gap-2 transition font-bold"
              >
                <Trash2 className="w-4 h-4 text-rose-600 shrink-0" />
                <span>إلغاء الفاتورة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Printable Invoice Modal */}
      {selectedInvoiceForPrint && (
        <PrintInvoiceModal
          invoice={selectedInvoiceForPrint}
          onClose={() => setSelectedInvoiceForPrint(null)}
        />
      )}
    </div>
  );
};
