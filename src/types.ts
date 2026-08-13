/**
 * Types & Interfaces for Hameed Hliwi Gold Trading Application (حميد حليوي)
 */

export type GoldKarat = '24' | '22' | '21' | '18' | '14';

export interface GoldPriceSetting {
  karat: GoldKarat;
  buyPriceUSDPerGram: number; // سعر الشراء للجرام $
  sellPriceUSDPerGram: number; // سعر البيع للجرام $
  buyPriceSYPPerGram: number; // سعر الشراء للجرام ل.س
  sellPriceSYPPerGram: number; // سعر البيع للجرام ل.س
  laborFeeUSDPerGram: number;
}

export type ItemCategory =
  | 'أطقم'
  | 'خواتم ومحابس'
  | 'أساور ومبارم'
  | 'قلائد وسلاسل'
  | 'أقراط'
  | 'سبائك وليرات'
  | 'ذهب كسر'
  | 'متنوع';

export interface Warehouse {
  id: string;
  name: string; // اسم المستودع (مثلاً: المستودع الرئيسي - التلل، فرع العزيزية، فرع الفرقان)
  location: string; // حلب - سوريا
  manager: string;
  phone: string;
  isDefault?: boolean;
}

export interface InventoryItem {
  id: string;
  code: string; // رمز أو باركود القطعة
  name: string; // اسم قطعة الذهب
  category: ItemCategory;
  karat: GoldKarat;
  grossWeightGrams: number; // الوزن القائم بالجرام (مع الأحجار)
  stoneWeightGrams: number; // وزن الأحجار / الفصوص
  netWeightGrams: number; // الوزن الصافي بالجرام
  laborFeeUSDPerGram: number; // صياغة / أجرة الجرام بالدولار
  totalLaborFeeUSD: number; // إجمالي الأجرة بالدولار
  warehouseId: string; // المستودع التابع له
  status: 'in_stock' | 'sold' | 'reserved';
  imageUrl?: string;
  notes?: string;
  dateAdded: string;
  quantity?: number;
  isManualSaleEntry?: boolean;
}

export interface ScrapGoldItem {
  karat: GoldKarat;
  weightGrams: number;
  pricePerGramUSD: number;
  totalScrapValueUSD: number;
}

export interface InvoiceItem {
  itemId?: string;
  isManualSaleEntry?: boolean;
  itemName: string;
  category: ItemCategory;
  karat: GoldKarat;
  grossWeightGrams: number;
  stoneWeightGrams: number;
  netWeightGrams: number;
  laborFeeUSDPerGram: number;
  pricePerGramUSD: number; // سعر الذهب للجرام وقت البيع/الشراء
  totalPriceUSD: number; // (الوزن الصافي * سعر الجرام) + إجمالي المصنعية
  warehouseId: string;
}

export type InvoiceType = 'sale' | 'purchase' | 'return';
export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'gold_exchange' | 'debt' | 'mixed';

export interface Invoice {
  id: string;
  invoiceNumber: string; // رقم الفاتورة (مثلاً INV-2026-001)
  type: InvoiceType;
  date: string;
  customerOrSupplierId: string;
  customerOrSupplierName: string;
  customerPhone?: string;
  warehouseId: string;
  items: InvoiceItem[];
  scrapGoldItems?: ScrapGoldItem[]; // ذهب كسر بديل (مستلم من الزبون)
  
  subtotalGoldUSD: number; // مجموع قيمة الذهب $
  totalLaborUSD: number; // مجموع الأجور $
  scrapTotalValueUSD: number; // مجموع قيمة الذهب الكسر المخصوم $
  
  discountUSD: number;
  finalTotalUSD: number;
  finalTotalSYP: number;
  
  paidUSD: number;
  paidSYPInUSD: number; // ما دفعه بالليرة السورية مقوماً بالدولار
  paidSYP: number; // المبلغ المدفوع بالليرة السورية
  
  remainingDebtUSD: number; // الباقي كذمة بالدولار
  remainingDebtGold21kGrams?: number; // الباقي كذمة ذهب عيار 21 غرام
  
  paymentMethod: PaymentMethod;
  notes?: string;
  itemPhotoUrl?: string; // صورة القطعة المباعة/المشتراة كضمان للبائع والشاري
  createdBy: string; // اسم المستخدم الذي أنشأ الفاتورة
  shiftId?: string;
}

export type PartnerType = 'customer' | 'supplier' | 'both';

export interface GoldDebtEntry {
  id: string;
  date: string;
  itemName: string;
  weightGrams: number;
  direction: 'owed_to_partner' | 'owed_by_partner';
  settledAt?: string;
}

export interface GoldWeightAccount {
  id: string;
  personName: string;
  phone?: string;
  entries: GoldDebtEntry[];
}

export interface Partner {
  id: string;
  name: string;
  type: PartnerType;
  phone: string;
  address: string; // حلب - سوريا
  balanceUSD: number; // الرصيد المالي $ (+ دائن / - مدين)
  goldBalance21kGrams: number; // رصيد الذهب عيار 21 غرام (+ له / - عليه)
  goldDebtEntries?: GoldDebtEntry[];
  notes?: string;
  taxNumber?: string;
  createdAt: string;
}

export type VoucherType = 'receipt' | 'payment' | 'expense';

export interface Voucher {
  id: string;
  voucherNumber: string;
  type: VoucherType; // receipt: سند قبض, payment: سند صرف, expense: مصروف
  date: string;
  partnerId?: string;
  partnerName?: string;
  cashBoxId: string; // صندوق الدولار / الليرة السورية
  amountUSD: number;
  amountSYP: number;
  exchangeRate: number; // سعر الصرف المستخدم
  goldWeight21kGrams?: number; // في حال دفع/قبض ذهب كذمة
  category?: string; // فئة المصروف (إيجار، رواتب، كهرباء، صيانة، الخ)
  statement: string; // البيان / الشرح
  createdBy: string;
}

export interface CashBox {
  id: string;
  name: string; // صندوق الدولار الرئيسي، صندوق الليرة السورية، الخزنة المركزية
  currency: 'USD' | 'SYP';
  balanceAmount: number; // الرصيد الحالي
}

export interface WorkShift {
  id: string;
  userId: string;
  userName: string;
  startedAt: string;
  endedAt?: string;
  invoiceCount?: number;
  salesTotalUSD?: number;
  soldWeightGrams?: number;
}

export interface UserPermissions {
  dashboard: boolean;
  inventory: boolean;
  invoices: boolean;
  partners: boolean;
  finance: boolean;
  reports: boolean;
  users: boolean;
  settings: boolean;
}

export type UserRole = 'admin' | 'sales' | 'inventory_manager' | 'accountant';

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  assignedWarehouseId: string;
  permissions: UserPermissions;
  active: boolean;
  lastLogin?: string;
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  userName: string;
  action: string;
  details: string;
  type: 'invoice' | 'inventory' | 'finance' | 'user' | 'setting' | 'partners';
}

export interface GeneralSettings {
  storeName: string; // "حميد حليوي لتجارة وصياغة الذهب"
  storeSubtitle: string; // "مجال بيع وشراء وتصنيع كافة أنواع الذهب والمجوهرات"
  address: string; // "سوريا - حلب - شارع التلل"
  branchName: string; // "فرع حلب الرئيسي"
  phone1: string; // "+963 21 2233445"
  phone2: string; // "+963 944 112233"
  
  // Currencies
  primaryCurrency: 'USD';
  secondaryCurrency: 'SYP';
  usdToSypRate: number; // مثلا 15,000 ل.س
  
  // Gold Base Prices
  baseGoldOunceUSD: number; // سعر الأونصة العالمية $
  baseGoldGram24kUSD: number; // سعر جرام 24 $
  
  // Default margins
  buyMarginPercent: number; // نسبة هامش الشراء
  sellMarginPercent: number; // نسبة هامش البيع
  
  autoSyncGoldPrices: boolean; // تحديث مستمر
  taxRatePercent: number; // نسبة الضريبة إن وجدت
}
