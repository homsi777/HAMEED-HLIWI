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
import { useIsLargeScreen } from '../hooks/useMediaQuery';
import { salesApi, type SalesInvoice } from '../services/salesApi';
import { SellerShiftBar } from './SellerShiftBar';
import { partnersApi, type ApiPartner } from '../services/partnersApi';
import { purchasesApi, type PurchaseInvoice } from '../services/purchasesApi';
import { returnsApi, type ReturnInvoice, type ReturnableDocument } from '../services/returnsApi';
import { accountingApi, type ApiJournal } from '../services/accountingApi';
import { inventoryApi } from '../services/inventoryApi';

interface InvoicesViewProps {
  initialType?: 'sale' | 'purchase';
  /** Pre-fills the search so a row opened from السجلات lands on the existing preview. */
  initialSearch?: string;
  /** Whether this session holds the purchases module. A seller does not. */
  canPurchase?: boolean;
}

const money = (value: number) => Number(value.toFixed(2));

// List rows deliberately carry no invoice lines, so the number of pieces comes from the
// server-side aggregate over the invoice lines. It falls back to the loaded lines only
// when a row already has them (a freshly saved invoice held in memory).
const pieceCount = (invoice: any) => {
  const aggregated = Number(invoice?.itemCount);
  if (Number.isFinite(aggregated) && aggregated > 0) return Number(aggregated.toFixed(3)).toLocaleString('en-US');
  const lines: any[] = Array.isArray(invoice?.items) ? invoice.items : [];
  const summed = lines.reduce((total, line) => total + (Number(line?.quantity) || 1), 0);
  return Number(summed.toFixed(3)).toLocaleString('en-US');
};

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

export const InvoicesView: React.FC<InvoicesViewProps> = ({ initialType, initialSearch, canPurchase = true }) => {
  const {
    inventory: legacyInventory,
    partners,
    warehouses: legacyWarehouses,
    goldPrices,
    settings,
    addPartner,
    formatMoney,
    currentUser,
  } = useStore();

  const [filterType, setFilterType] = useState<'all' | 'sale' | 'purchase' | 'return'>('all');
  const [searchQuery, setSearchQuery] = useState(initialSearch ?? '');
  const [serverSales, setServerSales] = useState<SalesInvoice[]>([]);
  const [serverPurchases, setServerPurchases] = useState<PurchaseInvoice[]>([]);
  const [serverReturns, setServerReturns] = useState<ReturnInvoice[]>([]);
  const [returnsPage, setReturnsPage] = useState(1);
  const [returnsTotal, setReturnsTotal] = useState(0);
  const [returnsError, setReturnsError] = useState('');
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
  const refreshServerReturns = async () => { try { setReturnsError(''); const response = await returnsApi.list({ page: returnsPage, limit: 30 }); setServerReturns(response.items); setReturnsTotal(response.meta.total); } catch (reason: any) { setReturnsError(reason?.message || 'تعذر تحميل المرتجعات من الخادم.'); } };
  useEffect(() => { void refreshServerSales(); }, [salesPage]);
  useEffect(() => { if (canPurchase) void refreshServerPurchases(); }, [purchasesPage, canPurchase]);
  useEffect(() => { void refreshServerReturns(); }, [returnsPage]);
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
  // List rows carry summary data only. Printing must use the authoritative document from
  // the backend, which is the single source of the saved line snapshots, and the same
  // fetch brings the financial trail so a manager can follow the money from the invoice.
  const loadInvoiceDocument = async (inv: Invoice) => {
    const detail: any = inv.type === 'sale' ? await salesApi.get(inv.id) : inv.type === 'purchase' ? await purchasesApi.get(inv.id) : await returnsApi.get(inv.id);
    setSelectedInvoiceForPrint(detail);
    if (inv.type !== 'return') setInvoiceFinancials({ invoiceId: inv.id, vouchers: detail.vouchers ?? [], outstandingUSD: detail.customerOutstandingUSD ?? detail.supplierOutstandingUSD ?? 0 });
    // The accounting trail is informational: a document still prints if it is unreadable.
    const reference = inv.type === 'sale' ? { salesInvoiceId: inv.id } : inv.type === 'purchase' ? { purchaseInvoiceId: inv.id } : { returnInvoiceId: inv.id };
    accountingApi.journalsBySource(reference).then(setInvoiceJournals).catch(() => setInvoiceJournals([]));
    return detail as Invoice;
  };

  const handlePreviewInvoice = async (inv: Invoice) => {
    setActiveMenu(null);
    setInvoiceFinancials(null);
    setSelectedInvoiceForPrint(inv);
    try { await loadInvoiceDocument(inv); }
    catch (error: any) { setSalesError(error?.message || 'تعذر تحميل تفاصيل الفاتورة من الخادم.'); }
  };

  // Printing waits for the saved document so the sheet can never go to paper with
  // the header filled in and the item rows blank.
  const handlePrintInvoice = async (inv: Invoice) => {
    setActiveMenu(null);
    setInvoiceFinancials(null);
    try { await loadInvoiceDocument(inv); } catch (error: any) { setSalesError(error?.message || 'تعذر تحميل تفاصيل الفاتورة للطباعة.'); return; }
    setTimeout(() => { window.print(); }, 300);
  };

  // The returnable lines and every amount come from the server, so the browser never
  // decides how much of an invoice is still returnable.
  const handleReturnInvoice = async (inv: Invoice) => {
    setActiveMenu(null);
    if (inv.type === 'return') { alert('لا يمكن إنشاء مرتجع عن مرتجع. استخدم الإلغاء أو أنشئ حركة تصحيحية.'); return; }
    if ((inv as any).status === 'cancelled') { alert('لا يمكن إنشاء مرتجع عن فاتورة ملغاة.'); return; }
    setReturnError('');
    setReturnReason(`مرتجع عن الفاتورة رقم ${inv.invoiceNumber}`);
    setReturnRefundUSD('');
    setReturnRefundSYP('');
    setReturnNotes('');
    setReturnQuantities({});
    setReturnWeights({});
    setReturnSaving(false);
    try {
      const document = await returnsApi.returnable(inv.type === 'sale' ? 'sales_return' : 'purchase_return', inv.id);
      setReturnDocument(document);
      setShowReturnModal(true);
    } catch (error: any) {
      alert(error?.message || 'تعذر تحميل بنود الفاتورة القابلة للإرجاع.');
    }
  };

  const handleExportPdf = async (inv: Invoice) => {
    setActiveMenu(null);
    setInvoiceFinancials(null);
    try { await loadInvoiceDocument(inv); } catch (error: any) { setSalesError(error?.message || 'تعذر تحميل تفاصيل الفاتورة للتصدير.'); return; }
    setTimeout(() => { window.print(); }, 400);
  };

  // Sharing quotes the saved lines, so it needs the document rather than the list row.
  const handleShareWhatsApp = async (listRow: Invoice) => {
    setActiveMenu(null);
    let inv = listRow;
    try { inv = await loadInvoiceDocument(listRow); } catch { /* fall back to the summary row */ }
    const itemLines = inv.items.map((item, index) => `${index + 1}. ${item.itemName}\n   عيار ${item.karat} • صافي ${item.netWeightGrams.toFixed(2)} غ • أجرة $${item.laborFeeUSDPerGram.toFixed(2)}/غ\n   الإجمالي: $${item.totalPriceUSD.toFixed(2)}`).join('\n');
    const scrapLines = inv.scrapGoldItems?.length ? `\n\n*الذهب المستبدل:*\n${inv.scrapGoldItems.map((item, index) => `${index + 1}. عيار ${item.karat} • ${item.weightGrams.toFixed(2)} غ • $${item.totalScrapValueUSD.toFixed(2)}`).join('\n')}` : '';
    const text = `*${settings.storeName}* 💎\n*${inv.type === 'sale' ? 'فاتورة بيع ذهب' : inv.type === 'purchase' ? 'فاتورة شراء ذهب' : 'فاتورة مرتجع'}*\n\n*رقم الفاتورة:* ${inv.invoiceNumber}\n*التاريخ:* ${inv.date}\n*العميل/المورد:* ${inv.customerOrSupplierName}${inv.customerPhone ? `\n*الهاتف:* ${inv.customerPhone}` : ''}\n\n*بنود الفاتورة:*\n${itemLines}${scrapLines}\n\n*ملخص مالي:*\nقيمة الذهب: $${inv.subtotalGoldUSD.toFixed(2)}\nالمصنعية: $${inv.totalLaborUSD.toFixed(2)}\nالخصم: $${inv.discountUSD.toFixed(2)}\n*الإجمالي الصافي: $${inv.finalTotalUSD.toFixed(2)}*\nالمدفوع: $${inv.paidUSD.toFixed(2)}\nالمتبقي: $${inv.remainingDebtUSD.toFixed(2)}\n\nشكراً لثقتكم بـ ${settings.storeName}`;
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  const handleCancelInvoiceAction = (inv: Invoice) => {
    setActiveMenu(null);
    if (!window.confirm(`هل أنت تأكيد من إلغاء الفاتورة رقم (${inv.invoiceNumber})؟\nسوف يتم إرجاع كافة القطع المباعة للمخزون وعكس التسويات المالية.`)) return;
    const reason = window.prompt(`سبب إلغاء ${inv.type === 'sale' ? 'فاتورة البيع' : inv.type === 'purchase' ? 'فاتورة الشراء' : 'المرتجع'}:`);
    if (!reason?.trim()) return;
    const cancel = inv.type === 'return'
      ? returnsApi.cancel(inv.id, reason).then(async () => { await Promise.all([refreshServerReturns(), refreshOperationalStock()]); })
      : inv.type === 'sale' ? salesApi.cancel(inv.id, reason).then(async () => { await Promise.all([refreshServerSales(), refreshOperationalStock()]); }) : purchasesApi.cancel(inv.id, reason).then(async () => { await Promise.all([refreshServerPurchases(), refreshOperationalStock()]); });
    void cancel.catch((error: any) => alert(error?.message || 'تعذر إلغاء الفاتورة.'));
  };

  // Printable Invoice Modal State
  const [selectedInvoiceForPrint, setSelectedInvoiceForPrint] = useState<Invoice | null>(null);
  const isLargeScreen = useIsLargeScreen();
  const [invoiceFinancials, setInvoiceFinancials] = useState<{ invoiceId: string; vouchers: any[]; outstandingUSD: number } | null>(null);
  const [invoiceJournals, setInvoiceJournals] = useState<ApiJournal[]>([]);

  // Return Wizard Modal State (PostgreSQL-backed, one original document at a time)
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnDocument, setReturnDocument] = useState<ReturnableDocument | null>(null);
  const [returnQuantities, setReturnQuantities] = useState<Record<string, string>>({});
  const [returnWeights, setReturnWeights] = useState<Record<string, string>>({});
  const [returnReason, setReturnReason] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [returnRefundUSD, setReturnRefundUSD] = useState('');
  const [returnRefundSYP, setReturnRefundSYP] = useState('');
  const [returnError, setReturnError] = useState('');
  const [returnSaving, setReturnSaving] = useState(false);

  // Preview only: the same proportional rule the server applies, so the cashier sees the
  // expected refund before confirming. The saved return always carries the server totals.
  const returnSelection = (returnDocument?.lines ?? []).map(line => {
    const quantity = parseFloat(returnQuantities[line.sourceLineId] ?? '') || 0;
    const netWeightGrams = parseFloat(returnWeights[line.sourceLineId] ?? '') || 0;
    const lineGrossUSD = money(netWeightGrams * line.pricePerGramUSD) + money(netWeightGrams * line.laborFeeUSDPerGram);
    return { line, quantity, netWeightGrams, lineGrossUSD };
  }).filter(entry => entry.quantity > 0 && entry.netWeightGrams > 0);
  const returnGrossUSD = money(returnSelection.reduce((total, entry) => total + entry.lineGrossUSD, 0));
  const returnShare = returnDocument && returnDocument.grossTotalUSD > 0 ? returnGrossUSD / returnDocument.grossTotalUSD : 0;
  const returnDiscountUSD = money((returnDocument?.discountUSD ?? 0) * returnShare);
  const returnScrapCreditUSD = money((returnDocument?.scrapTotalValueUSD ?? 0) * returnShare);
  const returnFinalTotalUSD = money(Math.max(0, returnGrossUSD - returnDiscountUSD - returnScrapCreditUSD));
  // Money is not the whole story: returning a sale paid with scrap leaves the shop owing
  // that weight back, at the same karat and in the same proportion as the credit.
  const returnGoldObligation = (returnDocument?.scrapGoldItems ?? [])
    .map(entry => ({ karat: entry.karat, weightGrams: Number((entry.weightGrams * returnShare).toFixed(3)) }))
    .filter(entry => entry.weightGrams > 0);
  const returnRefundApplied = money((parseFloat(returnRefundUSD) || 0) + (parseFloat(returnRefundSYP) || 0) / (returnDocument?.exchangeRateSypPerUsd || settings.usdToSypRate));
  const returnOutstandingUSD = money(Math.max(0, returnFinalTotalUSD - returnRefundApplied));

  // Built once and placed in exactly one surface — the desktop corner panel or, on a
  // phone, a stacked section inside the invoice preview itself.
  const invoiceTrail = selectedInvoiceForPrint && invoiceFinancials?.invoiceId === selectedInvoiceForPrint.id ? (
    <>
      <p className="mb-2 border-b border-slate-200 pb-1.5 font-black text-slate-900">الأثر المالي للفاتورة</p>
      <div className="space-y-1 font-mono">
        <div className="flex justify-between"><span className="font-sans font-bold text-slate-600">إجمالي الفاتورة</span><span>$ {selectedInvoiceForPrint.finalTotalUSD.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="font-sans font-bold text-slate-600">المدفوع</span><span>$ {selectedInvoiceForPrint.paidUSD.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="font-sans font-bold text-slate-600">المتبقي على الفاتورة</span><span>$ {selectedInvoiceForPrint.remainingDebtUSD.toFixed(2)}</span></div>
        <div className="flex justify-between border-t border-slate-200 pt-1"><span className="font-sans font-bold text-slate-600">رصيد الطرف الإجمالي</span><span>$ {invoiceFinancials.outstandingUSD.toFixed(2)}</span></div>
      </div>
      {invoiceFinancials.vouchers.length > 0 ? (
        <div className="mt-2 space-y-1 border-t border-slate-200 pt-2">
          {invoiceFinancials.vouchers.map(voucher => (
            <div key={voucher.id} className={voucher.status === 'cancelled' ? 'text-slate-400 line-through' : 'text-slate-800'}>
              <p className="font-bold">{voucher.type === 'receipt' ? 'سند قبض' : 'سند صرف'}: {voucher.voucherNumber}</p>
              <p className="font-mono text-[10px]">{voucher.amount.toLocaleString('en-US')} {voucher.currency} — {voucher.cashboxName}</p>
            </div>
          ))}
        </div>
      ) : <p className="mt-2 border-t border-slate-200 pt-2 text-slate-500">لا توجد حركة نقدية — الفاتورة على الحساب.</p>}
      <div className="mt-2 border-t border-slate-200 pt-2">
        <p className="font-bold text-slate-900">الحالة المحاسبية: {invoiceJournals.length ? <span className="text-emerald-700">مرحّلة</span> : <span className="text-amber-700">غير مرحّلة</span>}</p>
        {invoiceJournals.map(journal => (
          <p key={journal.id} className={journal.status === 'reversed' ? 'font-mono text-[10px] text-slate-400 line-through' : 'font-mono text-[10px] text-slate-700'}>القيد: {journal.journalNumber}</p>
        ))}
      </div>
    </>
  ) : null;

  const handleSelectReturnLine = (line: ReturnableDocument['lines'][number], checked: boolean) => {
    setReturnQuantities(previous => ({ ...previous, [line.sourceLineId]: checked ? line.remainingQuantity.toFixed(3) : '' }));
    setReturnWeights(previous => ({ ...previous, [line.sourceLineId]: checked ? line.remainingNetWeightGrams.toFixed(3) : '' }));
  };

  const handleSaveReturn = async (andPrint: boolean = false) => {
    if (!returnDocument) return;
    if (!returnSelection.length) { setReturnError('اختر بنداً واحداً على الأقل وأدخل الكمية والوزن المرتجعين.'); return; }
    if (!returnReason.trim()) { setReturnError('سبب الإرجاع مطلوب.'); return; }
    setReturnSaving(true);
    setReturnError('');
    try {
      const saved = await returnsApi.create({
        type: returnDocument.type,
        originalInvoiceId: returnDocument.invoiceId,
        partnerId: returnDocument.partnerId,
        reason: returnReason.trim(),
        items: returnSelection.map(entry => ({ sourceLineId: entry.line.sourceLineId, quantity: entry.quantity, netWeightGrams: entry.netWeightGrams })),
        refundUSD: parseFloat(returnRefundUSD) || 0,
        refundSYP: parseFloat(returnRefundSYP) || 0,
        exchangeRateSypPerUsd: returnDocument.exchangeRateSypPerUsd || settings.usdToSypRate,
        notes: returnNotes || undefined,
        idempotencyKey: crypto.randomUUID(),
      });
      await Promise.all([refreshServerReturns(), refreshServerSales(), refreshServerPurchases(), refreshOperationalStock()]);
      setShowReturnModal(false);
      setReturnDocument(null);
      if (andPrint) setSelectedInvoiceForPrint(saved);
    } catch (error: any) {
      setReturnError(error?.message || 'تعذر حفظ المرتجع.');
    } finally {
      setReturnSaving(false);
    }
  };

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
  useEffect(() => { if (initialSearch) setSearchQuery(initialSearch); }, [initialSearch]);

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
        const newInv = await salesApi.create({ warehouseId: invWarehouseId, customerId, items: invItems, scrapGoldItems: scrapItems, discountUSD, paidUSD: numPaidUSD, paidSYP: numPaidSYP, paymentMethod: invPaymentMethod, exchangeRateSypPerUsd: settings.usdToSypRate, notes: invNotes, itemPhotoUrl: itemPhotoUrl || undefined, idempotencyKey: crypto.randomUUID() });
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
    // Returns are created from their own PostgreSQL-backed wizard, never from this form.
    setSalesError('نوع الفاتورة غير مدعوم في هذه الشاشة.');
  };

  // Filtered invoices list
  const combinedInvoices = [...serverSales, ...serverPurchases, ...serverReturns];
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

          {canPurchase && (
          <button
            onClick={() => handleOpenCreateModal('purchase')}
            className="flex-1 sm:flex-none justify-center bg-slate-900 hover:bg-slate-800 text-amber-400 px-3 py-2 sm:px-4 sm:py-2.5 rounded-sm font-bold text-xs shadow flex items-center gap-1.5 transition"
          >
            <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
            <span>فاتورة شراء ذهب</span>
          </button>
          )}
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
            الكافة ({salesTotal + purchasesTotal + returnsTotal})
          </button>
          <button
            onClick={() => setFilterType('sale')}
            className={`px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-sm transition whitespace-nowrap text-[11px] sm:text-xs ${
              filterType === 'sale' ? 'bg-amber-400 text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            البيع ({salesTotal})
          </button>
          {canPurchase && (
          <button
            onClick={() => setFilterType('purchase')}
            className={`px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-sm transition whitespace-nowrap text-[11px] sm:text-xs ${
              filterType === 'purchase' ? 'bg-amber-400 text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            الشراء ({purchasesTotal})
          </button>
          )}
          <button
            onClick={() => setFilterType('return')}
            className={`px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-sm transition whitespace-nowrap text-[11px] sm:text-xs ${
              filterType === 'return' ? 'bg-amber-400 text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            المرتجعات ({returnsTotal})
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

      {/* The seller's shift, read from the server. Managers who cannot run shifts see nothing. */}
      <SellerShiftBar onShiftChanged={() => { void refreshServerSales(); }} />

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
                      {pieceCount(inv)} قطعة | البائع: {inv.createdBy}
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
                    <td className="py-3 px-3 text-center font-bold text-slate-600 font-mono">{pieceCount(inv)} قطع</td>
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
      {returnsTotal > 30 && (filterType === 'all' || filterType === 'return') && <div className="flex items-center justify-center gap-3 text-xs font-bold text-slate-600"><button disabled={returnsPage <= 1} onClick={() => setReturnsPage(page => page - 1)} className="rounded-sm border border-slate-300 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50">السابق</button><span>صفحة المرتجعات {returnsPage} من {Math.ceil(returnsTotal / 30)}</span><button disabled={returnsPage >= Math.ceil(returnsTotal / 30)} onClick={() => setReturnsPage(page => page + 1)} className="rounded-sm border border-slate-300 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50">التالي</button></div>}
      {returnsError && <div className="rounded-sm border border-rose-200 bg-rose-50 p-2 text-xs font-bold text-rose-700">{returnsError}</div>}

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

      {/* RETURN WIZARD MODAL — server-derived returnable lines and authoritative totals */}
      {showReturnModal && returnDocument && (
        <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-sm border-2 border-amber-400 shadow-2xl max-w-4xl w-full p-3 sm:p-6 text-right space-y-3 sm:space-y-6 max-h-[96vh] sm:max-h-[92vh] overflow-y-auto my-auto sm:my-6">
            <div className="flex items-center justify-between border-b-2 border-amber-300 pb-2 sm:pb-3">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-sm bg-amber-400 text-slate-900 flex items-center justify-center font-bold shadow-sm shrink-0">
                  <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-lg font-black text-slate-900">
                    إنشاء مرتجع {returnDocument.type === 'sales_return' ? 'مبيعات' : 'مشتريات'} — عن الفاتورة {returnDocument.invoiceNumber}
                  </h3>
                  <p className="hidden sm:block text-xs text-slate-500">الكميات والأوزان المتاحة للإرجاع محسوبة على الخادم من الفاتورة الأصلية</p>
                </div>
              </div>
              <button onClick={() => { setShowReturnModal(false); setReturnDocument(null); }} className="text-slate-400 hover:text-slate-900 p-1 rounded-sm">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 bg-slate-50 p-2.5 sm:p-4 rounded-sm border border-slate-200 text-xs">
              <div><span className="block font-bold text-slate-700 mb-0.5">{returnDocument.type === 'sales_return' ? 'الزبون' : 'المورد'}</span><span className="font-bold text-slate-900">{returnDocument.partnerName}</span></div>
              <div><span className="block font-bold text-slate-700 mb-0.5">تاريخ الفاتورة الأصلية</span><span className="font-mono text-slate-900">{returnDocument.date}</span></div>
              <div><span className="block font-bold text-slate-700 mb-0.5">إجمالي الفاتورة الأصلية</span><span className="font-mono text-slate-900">$ {returnDocument.finalTotalUSD.toFixed(2)}</span></div>
              <div><span className="block font-bold text-slate-700 mb-0.5">سبق إرجاعه</span><span className="font-mono text-slate-900">$ {returnDocument.alreadyReturnedValueUSD.toFixed(2)}</span></div>
            </div>

            <div className="border border-slate-200 rounded-sm overflow-x-auto">
              <table className="w-full text-[11px] sm:text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="p-2 text-right font-bold">إرجاع</th>
                    <th className="p-2 text-right font-bold">الصنف</th>
                    <th className="p-2 text-right font-bold">العيار</th>
                    <th className="p-2 text-right font-bold">المتبقي للإرجاع</th>
                    <th className="p-2 text-right font-bold">الكمية المرتجعة</th>
                    <th className="p-2 text-right font-bold">الوزن المرتجع (غ)</th>
                    <th className="p-2 text-right font-bold">قيمة البند</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {returnDocument.lines.map(line => {
                    const selected = Boolean(returnQuantities[line.sourceLineId]);
                    const exhausted = line.remainingQuantity <= 0.0005 || line.remainingNetWeightGrams <= 0.0005;
                    const entry = returnSelection.find(candidate => candidate.line.sourceLineId === line.sourceLineId);
                    return (
                      <tr key={line.sourceLineId} className={exhausted ? 'bg-slate-50 text-slate-400' : 'bg-white'}>
                        <td className="p-2"><input type="checkbox" disabled={exhausted} checked={selected} onChange={event => handleSelectReturnLine(line, event.target.checked)} className="w-4 h-4 accent-amber-500" /></td>
                        <td className="p-2 font-bold text-slate-900">{line.itemName}{line.inventoryMode === 'aggregate' && <span className="mr-1 text-[10px] font-bold text-amber-700">(مجمّع)</span>}{!line.inventoryRestorable && !exhausted && <span className="mr-1 text-[10px] font-bold text-rose-600">(المخزون غير متاح)</span>}</td>
                        <td className="p-2 font-mono">{line.karat}</td>
                        <td className="p-2 font-mono">{line.remainingQuantity.toFixed(3)} قطعة / {line.remainingNetWeightGrams.toFixed(3)} غ</td>
                        <td className="p-2"><input type="number" min="0" step="0.001" disabled={exhausted || !selected} value={returnQuantities[line.sourceLineId] ?? ''} onChange={event => setReturnQuantities(previous => ({ ...previous, [line.sourceLineId]: event.target.value }))} className="w-24 border border-slate-200 bg-white p-1.5 font-mono text-xs rounded-sm disabled:bg-slate-100" /></td>
                        <td className="p-2"><input type="number" min="0" step="0.001" disabled={exhausted || !selected} value={returnWeights[line.sourceLineId] ?? ''} onChange={event => setReturnWeights(previous => ({ ...previous, [line.sourceLineId]: event.target.value }))} className="w-24 border border-slate-200 bg-white p-1.5 font-mono text-xs rounded-sm disabled:bg-slate-100" /></td>
                        <td className="p-2 font-mono font-bold text-slate-900">$ {(entry?.lineGrossUSD ?? 0).toFixed(2)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 text-xs">
              <div className="sm:col-span-2 space-y-2">
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5 sm:mb-1">سبب الإرجاع *</label>
                  <input type="text" value={returnReason} onChange={event => setReturnReason(event.target.value)} placeholder="اكتب سبب الإرجاع..." className="w-full p-1.5 sm:p-2 bg-white border border-slate-200 rounded-sm text-slate-800 font-bold" />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-0.5 sm:mb-1">ملاحظات (اختياري)</label>
                  <textarea value={returnNotes} onChange={event => setReturnNotes(event.target.value)} rows={2} className="w-full p-1.5 sm:p-2 bg-white border border-slate-200 rounded-sm text-slate-800" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block font-bold text-slate-700 mb-0.5">المبلغ المعاد نقداً $</label><input type="number" min="0" step="0.01" value={returnRefundUSD} onChange={event => setReturnRefundUSD(event.target.value)} className="w-full p-1.5 bg-white border border-slate-200 rounded-sm font-mono" /></div>
                  <div><label className="block font-bold text-slate-700 mb-0.5">المبلغ المعاد ل.س</label><input type="number" min="0" step="1" value={returnRefundSYP} onChange={event => setReturnRefundSYP(event.target.value)} className="w-full p-1.5 bg-white border border-slate-200 rounded-sm font-mono" /></div>
                </div>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-sm p-2.5 sm:p-3 space-y-1.5 font-mono">
                <div className="flex items-center justify-between"><span className="font-sans font-bold text-slate-700">قيمة البنود المرتجعة</span><span>$ {returnGrossUSD.toFixed(2)}</span></div>
                <div className="flex items-center justify-between"><span className="font-sans font-bold text-slate-700">حصة الخصم الأصلي</span><span>- $ {returnDiscountUSD.toFixed(2)}</span></div>
                {returnScrapCreditUSD > 0 && <div className="flex items-center justify-between"><span className="font-sans font-bold text-slate-700">حصة الذهب المستبدل</span><span>- $ {returnScrapCreditUSD.toFixed(2)}</span></div>}
                {returnGoldObligation.length > 0 && <p className="font-sans text-[10px] font-bold text-amber-700">سيصبح المحل مديناً بوزن: {returnGoldObligation.map(entry => `${entry.weightGrams.toFixed(3)} غ عيار ${entry.karat}`).join('، ')} — يُسلَّم من شاشة ذمم الأوزان.</p>}
                <div className="flex items-center justify-between border-t border-slate-300 pt-1.5 text-sm font-black text-slate-900"><span className="font-sans">إجمالي المرتجع</span><span>$ {returnFinalTotalUSD.toFixed(2)}</span></div>
                <div className="flex items-center justify-between"><span className="font-sans font-bold text-slate-700">{returnDocument.type === 'sales_return' ? 'يخصم من رصيد الزبون' : 'يخصم من رصيد المورد'}</span><span>$ {returnOutstandingUSD.toFixed(2)}</span></div>
                <p className="font-sans text-[10px] text-slate-500">القيم النهائية تُحتسب على الخادم عند الحفظ.</p>
              </div>
            </div>

            {returnError && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-sm p-2 text-xs font-bold">{returnError}</div>}

            <div className="flex flex-col sm:flex-row items-center justify-end gap-2 border-t-2 border-amber-300 pt-3">
              <button onClick={() => { setShowReturnModal(false); setReturnDocument(null); }} className="w-full sm:w-auto px-4 py-2 bg-slate-100 text-slate-700 rounded-sm font-bold text-xs">إلغاء</button>
              <button disabled={returnSaving} onClick={() => void handleSaveReturn(false)} className="w-full sm:w-auto px-4 py-2 bg-slate-900 text-white rounded-sm font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-60"><Check className="w-4 h-4" />{returnSaving ? 'جارٍ الحفظ...' : 'حفظ المرتجع'}</button>
              <button disabled={returnSaving} onClick={() => void handleSaveReturn(true)} className="w-full sm:w-auto px-4 py-2 bg-amber-400 text-slate-900 rounded-sm font-bold text-xs flex items-center justify-center gap-1.5 disabled:opacity-60"><Printer className="w-4 h-4" />حفظ وطباعة</button>
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
                onClick={() => void handlePreviewInvoice(activeMenu.inv)}
                className="w-full px-3 py-2 text-slate-900 hover:bg-amber-100 flex items-center gap-2 transition font-bold"
              >
                <Eye className="w-4 h-4 text-amber-700 shrink-0" />
                <span>معاينة الفاتورة والتفاصيل</span>
              </button>

              <button
                onClick={() => void handlePrintInvoice(activeMenu.inv)}
                className="w-full px-3 py-2 text-slate-800 hover:bg-amber-100 flex items-center gap-2 transition"
              >
                <Printer className="w-4 h-4 text-slate-700 shrink-0" />
                <span>طباعة الفاتورة</span>
              </button>
              
              <button
                onClick={() => void handleReturnInvoice(activeMenu.inv)}
                className="w-full px-3 py-2 text-slate-800 hover:bg-amber-100 flex items-center gap-2 transition"
              >
                <RotateCcw className="w-4 h-4 text-blue-600 shrink-0" />
                <span>إنشاء مرتجع عن الفاتورة</span>
              </button>

              <button
                onClick={() => void handleExportPdf(activeMenu.inv)}
                className="w-full px-3 py-2 text-slate-800 hover:bg-amber-100 flex items-center gap-2 transition"
              >
                <FileDown className="w-4 h-4 text-purple-600 shrink-0" />
                <span>تصدير PDF</span>
              </button>

              <button
                onClick={() => void handleShareWhatsApp(activeMenu.inv)}
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

      {/* Financial trail of the opened invoice: vouchers, cashboxes and outstanding.
          It is a corner panel beside the preview on large screens; on a phone the very same
          component travels inside the preview instead, because a second fixed layer over
          the preview is what read as two stacked previews. Exactly one copy is mounted. */}
      {invoiceTrail && isLargeScreen && (
        <div className="no-print fixed bottom-4 left-4 z-[60] w-72 rounded-sm border-2 border-slate-900 bg-white p-3 text-right text-[11px] shadow-2xl">{invoiceTrail}</div>
      )}

      {/* Printable Invoice Modal */}
      {selectedInvoiceForPrint && (
        <PrintInvoiceModal
          invoice={selectedInvoiceForPrint}
          onClose={() => { setSelectedInvoiceForPrint(null); setInvoiceFinancials(null); setInvoiceJournals([]); }}
          financialTrail={!isLargeScreen && invoiceTrail ? invoiceTrail : undefined}
        />
      )}
    </div>
  );
};
