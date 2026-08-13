import { 
  Warehouse, 
  InventoryItem, 
  Partner, 
  CashBox, 
  User, 
  GeneralSettings, 
  GoldPriceSetting, 
  Invoice, 
  Voucher,
  ActivityLog
} from '../types';

export const initialSettings: GeneralSettings = {
  storeName: "حميد حليوي لتجارة وصياغة الذهب",
  storeSubtitle: "مركز صياغة وتجارة الذهب والمجوهرات والسبائك الكسر",
  address: "سوريا - حلب - شارع التلل / سوق الصاغة",
  branchName: "المركز الرئيسي - حلب",
  phone1: "+963 21 224 5566",
  phone2: "+963 944 887 766",
  primaryCurrency: "USD",
  secondaryCurrency: "SYP",
  usdToSypRate: 15200, // 1 دولار = 15,200 ليرة سورية
  baseGoldOunceUSD: 2650, // سعر الأونصة العالمية بـ $
  baseGoldGram24kUSD: 85.20, // جرام عيار 24 بـ $
  buyMarginPercent: 0.5,
  sellMarginPercent: 1.5,
  autoSyncGoldPrices: true,
  taxRatePercent: 0
};

export const initialGoldPrices: GoldPriceSetting[] = [
  {
    karat: '24',
    buyPriceUSDPerGram: 84.80,
    sellPriceUSDPerGram: 86.20,
    laborFeeUSDPerGram: 5,
    buyPriceSYPPerGram: 1288960,
    sellPriceSYPPerGram: 1310240
  },
  {
    karat: '22',
    buyPriceUSDPerGram: 77.70,
    sellPriceUSDPerGram: 79.00,
    laborFeeUSDPerGram: 5,
    buyPriceSYPPerGram: 1181040,
    sellPriceSYPPerGram: 1200800
  },
  {
    karat: '21',
    buyPriceUSDPerGram: 74.20,
    sellPriceUSDPerGram: 75.40,
    laborFeeUSDPerGram: 5,
    buyPriceSYPPerGram: 1127840,
    sellPriceSYPPerGram: 1146080
  },
  {
    karat: '18',
    buyPriceUSDPerGram: 63.60,
    sellPriceUSDPerGram: 64.60,
    laborFeeUSDPerGram: 5,
    buyPriceSYPPerGram: 966720,
    sellPriceSYPPerGram: 981920
  },
  {
    karat: '14',
    buyPriceUSDPerGram: 49.50,
    sellPriceUSDPerGram: 50.30,
    laborFeeUSDPerGram: 5,
    buyPriceSYPPerGram: 752400,
    sellPriceSYPPerGram: 764560
  }
];

export const initialWarehouses: Warehouse[] = [
  {
    id: 'wh-main',
    name: 'المستودع الرئيسي - شارع التلل',
    location: 'حلب - سوق الصاغة - شارع التلل',
    manager: 'حميد حليوي',
    phone: '+963 21 224 5566',
    isDefault: true
  },
  {
    id: 'wh-aziziyah',
    name: 'فرع العزيزية',
    location: 'حلب - حي العزيزية - الشارع العام',
    manager: 'أحمد حليوي',
    phone: '+963 21 445 1122'
  },
  {
    id: 'wh-furqan',
    name: 'فرع الفرقان',
    location: 'حلب - حي الفرقان - دوار الموت',
    manager: 'سامر الحلبي',
    phone: '+963 21 667 8899'
  },
  {
    id: 'wh-safe',
    name: 'الخزنة المركزية (الأمانات)',
    location: 'حلب - المركز الرئيسي',
    manager: 'حميد حليوي',
    phone: '+963 944 887 766'
  }
];

export const initialInventory: InventoryItem[] = [
  {
    id: 'item-101',
    code: 'GLD-21-001',
    name: 'طقم ذهب ملكي كامل عيار 21',
    category: 'أطقم',
    karat: '21',
    grossWeightGrams: 48.5,
    stoneWeightGrams: 1.2,
    netWeightGrams: 47.3,
    laborFeeUSDPerGram: 6.5,
    totalLaborFeeUSD: 307.45,
    warehouseId: 'wh-main',
    status: 'in_stock',
    imageUrl: 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=600&q=80',
    notes: 'طقم نقش حلبي فاخر مع زركون عالي الجودة',
    dateAdded: '2026-08-01'
  },
  {
    id: 'item-102',
    code: 'GLD-24-002',
    name: 'سبيكة ذهب صافي 24k زنة 100 غرام',
    category: 'سبائك وليرات',
    karat: '24',
    grossWeightGrams: 100.0,
    stoneWeightGrams: 0,
    netWeightGrams: 100.0,
    laborFeeUSDPerGram: 1.2,
    totalLaborFeeUSD: 120.0,
    warehouseId: 'wh-safe',
    status: 'in_stock',
    imageUrl: 'https://images.unsplash.com/photo-1610375461246-83df859d849d?auto=format&fit=crop&w=600&q=80',
    notes: 'سبيكة سويسرية معتمدة ومختومة 999.9',
    dateAdded: '2026-08-02'
  },
  {
    id: 'item-103',
    code: 'GLD-21-003',
    name: 'ليرة ذهبية سورية (الرشادي)',
    category: 'سبائك وليرات',
    karat: '21',
    grossWeightGrams: 8.0,
    stoneWeightGrams: 0,
    netWeightGrams: 8.0,
    laborFeeUSDPerGram: 2.5,
    totalLaborFeeUSD: 20.0,
    warehouseId: 'wh-main',
    status: 'in_stock',
    notes: 'ليرة ذهبية صك جديد مدموغة',
    dateAdded: '2026-08-03'
  },
  {
    id: 'item-104',
    code: 'GLD-21-004',
    name: 'زوج أساور مبرومة حلبية عيار 21',
    category: 'أساور ومبارم',
    karat: '21',
    grossWeightGrams: 36.2,
    stoneWeightGrams: 0,
    netWeightGrams: 36.2,
    laborFeeUSDPerGram: 4.8,
    totalLaborFeeUSD: 173.76,
    warehouseId: 'wh-aziziyah',
    status: 'in_stock',
    imageUrl: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=600&q=80',
    notes: 'أساور مبرومة شغل صاغة حلب التقليدية',
    dateAdded: '2026-08-05'
  },
  {
    id: 'item-105',
    code: 'GLD-18-005',
    name: 'خاتم محبس خطوبة ماسي عيار 18',
    category: 'خواتم ومحابس',
    karat: '18',
    grossWeightGrams: 5.4,
    stoneWeightGrams: 0.4,
    netWeightGrams: 5.0,
    laborFeeUSDPerGram: 8.0,
    totalLaborFeeUSD: 40.0,
    warehouseId: 'wh-furqan',
    status: 'in_stock',
    imageUrl: 'https://images.unsplash.com/photo-1603561591411-07134e71a2a9?auto=format&fit=crop&w=600&q=80',
    notes: 'ديزاين إيطالي حديث موديل 2026',
    dateAdded: '2026-08-06'
  },
  {
    id: 'item-106',
    code: 'GLD-21-006',
    name: 'قلادة ليرة مع سلسلة حلي حلبية',
    category: 'قلائد وسلاسل',
    karat: '21',
    grossWeightGrams: 18.6,
    stoneWeightGrams: 0.1,
    netWeightGrams: 18.5,
    laborFeeUSDPerGram: 5.0,
    totalLaborFeeUSD: 92.5,
    warehouseId: 'wh-main',
    status: 'in_stock',
    notes: 'إطار ليرة رشادية مع سلسلة جدل',
    dateAdded: '2026-08-07'
  },
  {
    id: 'item-107',
    code: 'SCRAP-21-01',
    name: 'ذهب كسر مجمع عيار 21',
    category: 'ذهب كسر',
    karat: '21',
    grossWeightGrams: 125.0,
    stoneWeightGrams: 0,
    netWeightGrams: 125.0,
    laborFeeUSDPerGram: 0,
    totalLaborFeeUSD: 0,
    warehouseId: 'wh-safe',
    status: 'in_stock',
    notes: 'كسر مشتريات من الزبائن مجهز للصهر والتصفية',
    dateAdded: '2026-08-08'
  }
];

export const initialPartners: Partner[] = [
  {
    id: 'prt-1',
    name: 'المهندس محمد زاهر المرعشي',
    type: 'customer',
    phone: '+963 933 112233',
    address: 'حلب - حي المحافظة',
    balanceUSD: -450.00, // عليه 450 $
    goldBalance21kGrams: -12.5, // عليه 12.5 غرام ذهب 21
    notes: 'زبون دائم وموثوق - شيكات ومواعيد سداد منتظمة',
    createdAt: '2026-01-15'
  },
  {
    id: 'prt-2',
    name: 'شركة الصاغة السورية لصناعة السبائك',
    type: 'supplier',
    phone: '+963 21 211 9988',
    address: 'حلب - المنطقة الصناعية - الشيخ نجار',
    balanceUSD: 3200.00, // له علينا 3200 $
    goldBalance21kGrams: 45.0, // له علينا 45 غرام ذهب 21
    notes: 'مورد رئيسي للسبائك والليرات',
    createdAt: '2026-02-01'
  },
  {
    id: 'prt-3',
    name: 'الحاج عبد القادر الكردي',
    type: 'both',
    phone: '+963 944 554433',
    address: 'حلب - العزيزية',
    balanceUSD: 0,
    goldBalance21kGrams: 0,
    notes: 'عميل ومورد تجاري في سوق الصاغة',
    createdAt: '2026-03-10'
  },
  {
    id: 'prt-4',
    name: 'السيدة ديما العطار',
    type: 'customer',
    phone: '+963 988 776655',
    address: 'حلب - الفرقان',
    balanceUSD: -120.00,
    goldBalance21kGrams: 0,
    notes: 'شراء أطقم ومجوهرات بالتقسيط',
    createdAt: '2026-05-20'
  }
];

export const initialCashBoxes: CashBox[] = [
  {
    id: 'box-usd',
    name: 'صندوق الدولار الرئيسي ($)',
    currency: 'USD',
    balanceAmount: 18500.00
  },
  {
    id: 'box-syp',
    name: 'صندوق الليرة السورية (ل.س)',
    currency: 'SYP',
    balanceAmount: 42500000.00 // 42.5 مليون ليرة سورية
  },
  {
    id: 'box-safe',
    name: 'الخزنة المركزية ($)',
    currency: 'USD',
    balanceAmount: 75000.00
  }
];

export const initialUsers: User[] = [
  {
    id: 'usr-1',
    username: 'hameed',
    fullName: 'الحاج حميد حليوي',
    role: 'admin',
    assignedWarehouseId: 'wh-main',
    active: true,
    permissions: {
      dashboard: true,
      inventory: true,
      invoices: true,
      partners: true,
      finance: true,
      reports: true,
      users: true,
      settings: true
    },
    lastLogin: '2026-08-10 10:30'
  },
  {
    id: 'usr-2',
    username: 'ahmad',
    fullName: 'أحمد حليوي',
    role: 'inventory_manager',
    assignedWarehouseId: 'wh-aziziyah',
    active: true,
    permissions: {
      dashboard: true,
      inventory: true,
      invoices: true,
      partners: true,
      finance: false,
      reports: true,
      users: false,
      settings: false
    },
    lastLogin: '2026-08-10 09:15'
  },
  {
    id: 'usr-3',
    username: 'mahmoud',
    fullName: 'محمود الحلبي (محاسب)',
    role: 'accountant',
    assignedWarehouseId: 'wh-main',
    active: true,
    permissions: {
      dashboard: true,
      inventory: true,
      invoices: true,
      partners: true,
      finance: true,
      reports: true,
      users: false,
      settings: false
    },
    lastLogin: '2026-08-09 16:45'
  },
  {
    id: 'usr-4',
    username: 'samer',
    fullName: 'سامر الجاسم (مبيعات)',
    role: 'sales',
    assignedWarehouseId: 'wh-furqan',
    active: true,
    permissions: {
      dashboard: true,
      inventory: true,
      invoices: true,
      partners: true,
      finance: false,
      reports: false,
      users: false,
      settings: false
    },
    lastLogin: '2026-08-10 08:00'
  }
];

export const initialInvoices: Invoice[] = [
  {
    id: 'inv-1001',
    invoiceNumber: 'INV-2026-001',
    type: 'sale',
    date: '2026-08-08',
    customerOrSupplierId: 'prt-1',
    customerOrSupplierName: 'المهندس محمد زاهر المرعشي',
    customerPhone: '+963 933 112233',
    warehouseId: 'wh-main',
    items: [
      {
        itemId: 'item-101',
        itemName: 'طقم ذهب ملكي كامل عيار 21',
        category: 'أطقم',
        karat: '21',
        grossWeightGrams: 48.5,
        stoneWeightGrams: 1.2,
        netWeightGrams: 47.3,
        laborFeeUSDPerGram: 6.5,
        pricePerGramUSD: 75.40,
        totalPriceUSD: 3873.87, // (47.3 * 75.40) + (47.3 * 6.5)
        warehouseId: 'wh-main'
      }
    ],
    scrapGoldItems: [
      {
        karat: '21',
        weightGrams: 10.0,
        pricePerGramUSD: 74.20,
        totalScrapValueUSD: 742.00
      }
    ],
    subtotalGoldUSD: 3566.42,
    totalLaborUSD: 307.45,
    scrapTotalValueUSD: 742.00,
    discountUSD: 31.87,
    finalTotalUSD: 3100.00,
    finalTotalSYP: 47120000,
    paidUSD: 2650.00,
    paidSYPInUSD: 0,
    paidSYP: 0,
    remainingDebtUSD: 450.00,
    remainingDebtGold21kGrams: 0,
    paymentMethod: 'mixed',
    notes: 'تم استلام ذهب كسر 10 غرام عيار 21 ودفع 2650$ نقداً والباقي ذمة',
    createdBy: 'الحاج حميد حليوي'
  },
  {
    id: 'inv-1002',
    invoiceNumber: 'INV-2026-002',
    type: 'purchase',
    date: '2026-08-09',
    customerOrSupplierId: 'prt-2',
    customerOrSupplierName: 'شركة الصاغة السورية لصناعة السبائك',
    customerPhone: '+963 21 211 9988',
    warehouseId: 'wh-safe',
    items: [
      {
        itemId: 'item-102',
        itemName: 'سبيكة ذهب صافي 24k زنة 100 غرام',
        category: 'سبائك وليرات',
        karat: '24',
        grossWeightGrams: 100.0,
        stoneWeightGrams: 0,
        netWeightGrams: 100.0,
        laborFeeUSDPerGram: 1.2,
        pricePerGramUSD: 84.80,
        totalPriceUSD: 8600.00,
        warehouseId: 'wh-safe'
      }
    ],
    subtotalGoldUSD: 8480.00,
    totalLaborUSD: 120.00,
    scrapTotalValueUSD: 0,
    discountUSD: 0,
    finalTotalUSD: 8600.00,
    finalTotalSYP: 130720000,
    paidUSD: 5400.00,
    paidSYPInUSD: 0,
    paidSYP: 0,
    remainingDebtUSD: 3200.00,
    paymentMethod: 'debt',
    notes: 'شراء سبيكة 100غ وتم دفع دفعة 5400$ والباقي ذمة للشركة الموردة',
    createdBy: 'الحاج حميد حليوي'
  }
];

export const initialVouchers: Voucher[] = [
  {
    id: 'vch-501',
    voucherNumber: 'VCH-2026-01',
    type: 'receipt',
    date: '2026-08-08',
    partnerId: 'prt-1',
    partnerName: 'المهندس محمد زاهر المرعشي',
    cashBoxId: 'box-usd',
    amountUSD: 500.00,
    amountSYP: 7600000,
    exchangeRate: 15200,
    statement: 'دفعة حساب من فاتورة شراء طقم ذهب ملكي',
    createdBy: 'الحاج حميد حليوي'
  },
  {
    id: 'vch-502',
    voucherNumber: 'VCH-2026-02',
    type: 'expense',
    date: '2026-08-09',
    cashBoxId: 'box-syp',
    amountUSD: 100.00,
    amountSYP: 1520000,
    exchangeRate: 15200,
    category: 'مصاريف كهرباء وطاقة شمسية',
    statement: 'سداد فاتورة اشتراك أمبيرات وطاقة لمحل التلل',
    createdBy: 'محمود الحلبي'
  }
];

export const initialActivityLogs: ActivityLog[] = [
  {
    id: 'act-1',
    timestamp: '2026-08-10 10:15',
    userName: 'الحاج حميد حليوي',
    action: 'تحديث أسعار الذهب',
    details: 'تم تحديث سعر جرام الذهب عيار 21 إلى 75.40 دولار للبيع',
    type: 'setting'
  },
  {
    id: 'act-2',
    timestamp: '2026-08-09 14:30',
    userName: 'أحمد حليوي',
    action: 'إضافة منتج جديد',
    details: 'إضافة زوج أساور مبرومة حلبية إلى فرع العزيزية',
    type: 'inventory'
  },
  {
    id: 'act-3',
    timestamp: '2026-08-08 12:00',
    userName: 'الحاج حميد حليوي',
    action: 'إنشاء فاتورة بيع',
    details: 'فاتورة INV-2026-001 بقيمة 3100$ للزبون محمد زاهر المرعشي',
    type: 'invoice'
  }
];
