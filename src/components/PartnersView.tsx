import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { 
  Users, 
  Plus, 
  Search, 
  Phone, 
  MapPin, 
  X, 
  Coins, 
  UserCheck, 
  Building,
  MoreVertical
} from 'lucide-react';
import { GoldDebtEntry, Partner, PartnerType } from '../types';
import { PrintAccountStatementModal } from './PrintAccountStatementModal';

export const PartnersView: React.FC = () => {
  const { partners, invoices, vouchers, addPartner, updatePartner, formatMoney, settings } = useStore();

  const [activeTab, setActiveTab] = useState<'all' | 'customers' | 'suppliers'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showAddPartnerModal, setShowAddPartnerModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [selectedPartnerForStatement, setSelectedPartnerForStatement] = useState<Partner | null>(null);
  const [activePartnerMenu, setActivePartnerMenu] = useState<Partner | null>(null);
  const [debtPartner, setDebtPartner] = useState<Partner | null>(null);
  const [debtItemName, setDebtItemName] = useState('');
  const [debtWeight, setDebtWeight] = useState('');
  const [debtDirection, setDebtDirection] = useState<GoldDebtEntry['direction']>('owed_to_partner');

  // Form State
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<PartnerType>('customer');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('حلب - سوريا');
  const [formNotes, setFormNotes] = useState('');

  const resetForm = () => {
    setFormName('');
    setFormType('customer');
    setFormPhone('');
    setFormAddress('حلب - سوريا');
    setFormNotes('');
    setEditingPartner(null);
  };

  const handleOpenEdit = (p: Partner) => {
    setEditingPartner(p);
    setFormName(p.name);
    setFormType(p.type);
    setFormPhone(p.phone);
    setFormAddress(p.address);
    setFormNotes(p.notes || '');
    setShowAddPartnerModal(true);
  };

  const handleOpenGoldDebt = (partner: Partner) => {
    setActivePartnerMenu(null);
    setDebtPartner(partner);
    setDebtItemName('');
    setDebtWeight('');
    setDebtDirection('owed_to_partner');
  };

  const handleSaveGoldDebt = (event: React.FormEvent) => {
    event.preventDefault();
    const weight = Number(debtWeight);
    if (!debtPartner || !debtItemName.trim() || !Number.isFinite(weight) || weight <= 0) return;
    const entry: GoldDebtEntry = { id: `gold-debt-${Date.now()}`, date: new Date().toLocaleDateString('ar-SY'), itemName: debtItemName.trim(), weightGrams: weight, direction: debtDirection };
    const signedWeight = debtDirection === 'owed_to_partner' ? weight : -weight;
    updatePartner(debtPartner.id, {
      goldBalance21kGrams: Number((debtPartner.goldBalance21kGrams + signedWeight).toFixed(2)),
      goldDebtEntries: [...(debtPartner.goldDebtEntries || []), entry]
    });
    setDebtPartner(null);
  };

  const handleSettleGoldDebt = (entry: GoldDebtEntry) => {
    const partner = selectedPartnerForStatement;
    if (!partner || entry.settledAt) return;
    if (!window.confirm(`هل تمّت تسوية ذمة «${entry.itemName}» بوزن ${entry.weightGrams} غرام؟`)) return;

    const signedWeight = entry.direction === 'owed_to_partner' ? entry.weightGrams : -entry.weightGrams;
    const settledAt = new Date().toLocaleDateString('ar-SY');
    const goldDebtEntries = (partner.goldDebtEntries || []).map(item => item.id === entry.id ? { ...item, settledAt } : item);
    const updatedPartner = {
      ...partner,
      goldBalance21kGrams: Number((partner.goldBalance21kGrams - signedWeight).toFixed(2)),
      goldDebtEntries
    };

    updatePartner(partner.id, {
      goldBalance21kGrams: updatedPartner.goldBalance21kGrams,
      goldDebtEntries
    });
    setSelectedPartnerForStatement(updatedPartner);
  };

  const handleSharePartner = (partner: Partner) => {
    const partnerInvoices = invoices.filter(invoice => invoice.customerOrSupplierId === partner.id);
    const partnerVouchers = vouchers.filter(voucher => voucher.partnerId === partner.id);
    const balanceText = partner.balanceUSD < 0 ? `مطلوب منه: $ ${Math.abs(partner.balanceUSD).toFixed(2)}` : partner.balanceUSD > 0 ? `له عندنا: $ ${partner.balanceUSD.toFixed(2)}` : 'الحساب خالص';
    const invoiceLines = partnerInvoices.map(invoice => {
      const items = invoice.items.map(item => `  • ${item.itemName} | عيار ${item.karat} | ${item.netWeightGrams.toFixed(2)} غ | $ ${item.totalPriceUSD.toFixed(2)}`).join('\n');
      return `${invoice.type === 'sale' ? 'فاتورة بيع' : invoice.type === 'purchase' ? 'فاتورة شراء' : 'فاتورة مرتجع'} ${invoice.invoiceNumber}\nالتاريخ: ${invoice.date}\nالإجمالي: $ ${invoice.finalTotalUSD.toFixed(2)} | المتبقي: $ ${invoice.remainingDebtUSD.toFixed(2)}${items ? `\nالبنود:\n${items}` : ''}`;
    });
    const voucherLines = partnerVouchers.map(voucher => `${voucher.type === 'receipt' ? 'سند قبض' : voucher.type === 'payment' ? 'سند صرف' : 'سند مصروف'} ${voucher.voucherNumber}\nالتاريخ: ${voucher.date}\nالدولار: $ ${voucher.amountUSD.toFixed(2)} | الليرة: ${voucher.amountSYP.toLocaleString('ar-SY')} ل.س${voucher.goldWeight21kGrams ? ` | الذهب: ${voucher.goldWeight21kGrams} غ` : ''}\nالبيان: ${voucher.statement}`);
    const transactions = [...invoiceLines, ...voucherLines];
    const text = `${settings.storeName}\nكشف حساب العميل: ${partner.name}\nالهاتف: ${partner.phone || '-'}\n${balanceText}\nذمة الذهب عيار 21: ${Math.abs(partner.goldBalance21kGrams)} غ\n\nتفاصيل الحركات (${transactions.length})\n${transactions.length ? transactions.join('\n\n────────\n\n') : 'لا توجد حركات مسجلة لهذا الحساب.'}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    setActivePartnerMenu(null);
  };

  const handleSavePartner = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    if (editingPartner) {
      updatePartner(editingPartner.id, {
        name: formName,
        type: formType,
        phone: formPhone,
        address: formAddress,
        notes: formNotes
      });
    } else {
      addPartner({
        name: formName,
        type: formType,
        phone: formPhone,
        address: formAddress,
        balanceUSD: 0,
        goldBalance21kGrams: 0,
        notes: formNotes
      });
    }

    setShowAddPartnerModal(false);
    resetForm();
  };

  // Filter partners
  const filteredPartners = partners.filter(p => {
    if (activeTab === 'customers' && p.type !== 'customer' && p.type !== 'both') return false;
    if (activeTab === 'suppliers' && p.type !== 'supplier' && p.type !== 'both') return false;
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.phone.toLowerCase().includes(q) ||
        p.address.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Totals calculations
  let totalReceivablesUSD = 0; // مستحقات لنا على العملاء
  let totalPayablesUSD = 0; // مستحقات علينا للموردين
  let totalGoldReceivables21k = 0; // ذهب مستحق لنا

  partners.forEach(p => {
    if (p.balanceUSD < 0) {
      totalReceivablesUSD += Math.abs(p.balanceUSD);
    } else {
      totalPayablesUSD += p.balanceUSD;
    }
    if (p.goldBalance21kGrams < 0) {
      totalGoldReceivables21k += Math.abs(p.goldBalance21kGrams);
    }
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-sm border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-amber-600 font-bold text-xs uppercase mb-1">
            <Users className="w-4 h-4" />
            <span>إدارة الحسابات المالية والذمم والتجار</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
            العملاء والموردين (سجل الذمم)
          </h2>
        </div>

        <button
          onClick={() => {
            resetForm();
            setShowAddPartnerModal(true);
          }}
          className="bg-amber-400 hover:bg-amber-300 text-slate-900 px-4 py-2.5 rounded-sm font-bold text-xs shadow flex items-center gap-2 transition"
        >
          <Plus className="w-4 h-4" />
          <span>إضافة عميل أو مورد جديد</span>
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="bg-white rounded-sm p-2.5 sm:p-4 border border-slate-200 border-r-4 border-r-rose-600 shadow-sm min-w-0 [&>span:first-child]:text-[10px] [&>span:first-child]:leading-4 [&>span:last-child]:text-sm sm:[&>span:first-child]:text-xs sm:[&>span:last-child]:text-2xl">
          <span className="text-xs font-bold text-slate-500 block mb-1">إجمالي ديون العملاء (لنا بالدولار)</span>
          <span className="text-2xl font-black text-slate-900 font-mono">{formatMoney(totalReceivablesUSD)}</span>
        </div>

        <div className="bg-white rounded-sm p-2.5 sm:p-4 border border-slate-200 border-r-4 border-r-amber-400 shadow-sm min-w-0 [&>span:first-child]:text-[10px] [&>span:first-child]:leading-4 [&>span:last-child]:text-sm sm:[&>span:first-child]:text-xs sm:[&>span:last-child]:text-2xl">
          <span className="text-xs font-bold text-slate-500 block mb-1">إجمالي الذمم بالذهب (لنا بالجرام 21)</span>
          <span className="text-2xl font-black text-amber-800 font-mono">{totalGoldReceivables21k.toFixed(2)} غ</span>
        </div>

        <div className="bg-white rounded-sm p-2.5 sm:p-4 border border-slate-200 border-r-4 border-r-emerald-600 shadow-sm min-w-0 [&>span:first-child]:text-[10px] [&>span:first-child]:leading-4 [&>span:last-child]:text-sm sm:[&>span:first-child]:text-xs sm:[&>span:last-child]:text-2xl">
          <span className="text-xs font-bold text-slate-500 block mb-1">مستحقات الموردين (علينا للموردين)</span>
          <span className="text-2xl font-black text-slate-900 font-mono">{formatMoney(totalPayablesUSD)}</span>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="bg-white p-4 rounded-sm border border-slate-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-sm w-full sm:w-auto font-bold">
          <button
            onClick={() => setActiveTab('all')}
            className={`px-4 py-2 rounded-sm transition ${
              activeTab === 'all' ? 'bg-amber-400 text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            الكل ({partners.length})
          </button>
          <button
            onClick={() => setActiveTab('customers')}
            className={`px-4 py-2 rounded-sm transition ${
              activeTab === 'customers' ? 'bg-amber-400 text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            العملاء والزبائن ({partners.filter(p => p.type === 'customer' || p.type === 'both').length})
          </button>
          <button
            onClick={() => setActiveTab('suppliers')}
            className={`px-4 py-2 rounded-sm transition ${
              activeTab === 'suppliers' ? 'bg-amber-400 text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            الموردين وتجار الذهب ({partners.filter(p => p.type === 'supplier' || p.type === 'both').length})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
          <input
            type="text"
            placeholder="ابحث بالاسم، رقم الهاتف، العنوان..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pr-9 pl-3 py-2 bg-slate-50 border border-slate-200 rounded-sm text-slate-800 focus:outline-none focus:border-amber-400 font-medium"
          />
        </div>
      </div>

      {/* Partners Cards / Table */}
      <div className="md:hidden space-y-2.5">
        {filteredPartners.length === 0 ? (
          <div className="bg-white rounded-sm border border-slate-200 py-10 text-center text-xs text-slate-400">لا يوجد نتائج مطابقة للبحث</div>
        ) : filteredPartners.map(p => (
          <article key={p.id} onClick={() => setSelectedPartnerForStatement(p)} className={`relative cursor-pointer rounded-sm border border-slate-200 bg-white p-3 pl-14 shadow-sm space-y-3 ${activePartnerMenu?.id === p.id ? 'z-50' : 'z-0'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-9 h-9 rounded-sm bg-slate-900 text-amber-400 flex items-center justify-center font-bold shrink-0">{p.name.charAt(0)}</div>
                <div className="min-w-0">
                  <h3 className="font-black text-sm text-slate-900 truncate">{p.name}</h3>
                  {p.phone && <a href={`tel:${p.phone}`} dir="ltr" className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-mono"><Phone className="w-3 h-3" />{p.phone}</a>}
                </div>
              </div>
              <span className={`shrink-0 px-2 py-1 rounded-sm text-[10px] font-black ${p.type === 'customer' ? 'bg-blue-100 text-blue-900' : p.type === 'supplier' ? 'bg-emerald-100 text-emerald-900' : 'bg-purple-100 text-purple-900'}`}>
                {p.type === 'customer' ? 'عميل' : p.type === 'supplier' ? 'مورّد' : 'عميل ومورّد'}
              </span>
              <div className="absolute left-3 top-3">
                <button onClick={event => { event.stopPropagation(); handleOpenGoldDebt(p); }} className="ml-1 rounded-sm border border-amber-300 bg-amber-50 p-1.5 text-amber-900" aria-label={`ذمة ${p.name}`}><Coins className="h-4 w-4" /></button>
                <button onClick={event => { event.stopPropagation(); setActivePartnerMenu(activePartnerMenu?.id === p.id ? null : p); }} aria-label={`إجراءات ${p.name}`} className="rounded-sm border border-slate-200 bg-white p-1.5 text-slate-700 shadow-sm"><MoreVertical className="h-4 w-4" /></button>
                {activePartnerMenu?.id === p.id && <div onClick={event => event.stopPropagation()} className="absolute left-0 top-9 z-50 w-40 rounded-sm border border-slate-300 bg-white py-1 text-right text-xs shadow-xl"><button onClick={() => { setSelectedPartnerForStatement(p); setActivePartnerMenu(null); setTimeout(() => window.print(), 150); }} className="w-full px-3 py-2 text-right hover:bg-amber-50">طباعة</button><button onClick={() => { setSelectedPartnerForStatement(p); setActivePartnerMenu(null); setTimeout(() => window.print(), 150); }} className="w-full px-3 py-2 text-right hover:bg-amber-50">تصدير PDF</button><button onClick={() => handleSharePartner(p)} className="w-full px-3 py-2 text-right text-emerald-800 hover:bg-emerald-50">مشاركة واتساب</button><button onClick={() => handleOpenEdit(p)} className="w-full px-3 py-2 text-right hover:bg-slate-50">تعديل</button></div>}
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-x-reverse divide-slate-200 border-y border-slate-100 py-2 text-[11px]">
              <div className="pl-2"><p className="text-slate-400 mb-0.5">الرصيد المالي</p><p className={`font-black font-mono ${p.balanceUSD < 0 ? 'text-rose-700' : p.balanceUSD > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>{p.balanceUSD === 0 ? 'خالص' : `$ ${Math.abs(p.balanceUSD).toFixed(2)}`}</p></div>
              <div className="pr-2"><p className="text-slate-400 mb-0.5">ذهب 21</p><p className={`font-black font-mono ${p.goldBalance21kGrams < 0 ? 'text-rose-700' : p.goldBalance21kGrams > 0 ? 'text-amber-800' : 'text-slate-500'}`}>{p.goldBalance21kGrams === 0 ? '0 غرام' : `${Math.abs(p.goldBalance21kGrams)} غ`}</p></div>
            </div>
          </article>
        ))}
      </div>

      <div className="hidden md:block overflow-visible rounded-sm border border-slate-200 bg-white shadow-sm">
        <div className="overflow-visible">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-900 text-amber-400 font-bold border-b border-slate-800 uppercase">
              <tr>
                <th className="py-3.5 px-4">اسم العميل / المورد</th>
                <th className="py-3.5 px-3">الصفة</th>
                <th className="py-3.5 px-3">رقم الهاتف</th>
                <th className="py-3.5 px-3">العنوان والموقع</th>
                <th className="py-3.5 px-3">الرصيد المالي ($)</th>
                <th className="py-3.5 px-3">ذمة الذهب (غرام 21)</th>
                <th className="py-3.5 px-4 text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
              {filteredPartners.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    لا يوجد نتائج مطابقة للبحث
                  </td>
                </tr>
              ) : (
                filteredPartners.map(p => (
                  <tr key={p.id} onClick={() => setSelectedPartnerForStatement(p)} className="cursor-pointer transition hover:bg-amber-50/50">
                    <td className="py-3 px-4 font-bold text-slate-900">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-sm bg-slate-900 text-amber-400 flex items-center justify-center font-bold">
                          {p.name.charAt(0)}
                        </div>
                        <div>
                          <span>{p.name}</span>
                          {p.notes && <p className="text-[10px] text-slate-400 font-normal">{p.notes}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-sm text-[10px] font-black ${
                          p.type === 'customer'
                            ? 'bg-blue-100 text-blue-900'
                            : p.type === 'supplier'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-purple-100 text-purple-900'
                        }`}
                      >
                        {p.type === 'customer' ? 'عميل' : p.type === 'supplier' ? 'مورد' : 'عميل ومورد'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-600 font-mono font-bold" dir="ltr">{p.phone || '-'}</td>
                    <td className="py-3 px-3 text-slate-600">{p.address}</td>
                    <td className="py-3 px-3 font-black text-sm font-mono">
                      {p.balanceUSD === 0 ? (
                        <span className="text-slate-400 font-sans font-normal">خالص ($0)</span>
                      ) : p.balanceUSD < 0 ? (
                        <span className="text-rose-700">مطلوب منه $ {Math.abs(p.balanceUSD).toFixed(2)}</span>
                      ) : (
                        <span className="text-emerald-700">له عندنا $ {p.balanceUSD.toFixed(2)}</span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-black text-sm font-mono">
                      {p.goldBalance21kGrams === 0 ? (
                        <span className="text-slate-400 font-sans font-normal">0 غرام</span>
                      ) : p.goldBalance21kGrams < 0 ? (
                        <span className="text-rose-700">{Math.abs(p.goldBalance21kGrams)} غ عليه</span>
                      ) : (
                        <span className="text-amber-800">{p.goldBalance21kGrams} غ له</span>
                      )}
                    </td>
                    <td className={`relative py-3 px-4 text-center ${activePartnerMenu?.id === p.id ? 'z-50' : 'z-0'}`}>
                      <button onClick={event => { event.stopPropagation(); handleOpenGoldDebt(p); }} className="ml-2 inline-flex items-center gap-1 rounded-sm border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] font-black text-amber-900 hover:bg-amber-100"><Coins className="h-3.5 w-3.5" />ذمة</button>
                      <button onClick={event => { event.stopPropagation(); setActivePartnerMenu(activePartnerMenu?.id === p.id ? null : p); }} aria-label={`إجراءات ${p.name}`} className="rounded-sm border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50"><MoreVertical className="h-4 w-4" /></button>
                      {activePartnerMenu?.id === p.id && <div onClick={event => event.stopPropagation()} className="absolute left-3 top-11 z-50 w-40 rounded-sm border border-slate-300 bg-white py-1 text-right text-xs shadow-xl"><button onClick={() => { setSelectedPartnerForStatement(p); setActivePartnerMenu(null); setTimeout(() => window.print(), 150); }} className="w-full px-3 py-2 text-right hover:bg-amber-50">طباعة</button><button onClick={() => { setSelectedPartnerForStatement(p); setActivePartnerMenu(null); setTimeout(() => window.print(), 150); }} className="w-full px-3 py-2 text-right hover:bg-amber-50">تصدير PDF</button><button onClick={() => handleSharePartner(p)} className="w-full px-3 py-2 text-right text-emerald-800 hover:bg-emerald-50">مشاركة واتساب</button><button onClick={() => handleOpenEdit(p)} className="w-full px-3 py-2 text-right hover:bg-slate-50">تعديل</button></div>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Partner Modal */}
      {showAddPartnerModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-sm border-2 border-slate-900 shadow-2xl max-w-md w-full p-6 text-right space-y-4">
            <h3 className="text-base font-black text-slate-900">
              {editingPartner ? 'تعديل بيانات الحساب' : 'إضافة عميل أو مورد جديد'}
            </h3>

            <form onSubmit={handleSavePartner} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">الاسم الكامل *</label>
                <input
                  type="text"
                  required
                  placeholder="اسم الشخص أو الشركة..."
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-medium"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">الصفة *</label>
                <select
                  value={formType}
                  onChange={e => setFormType(e.target.value as PartnerType)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-bold"
                >
                  <option value="customer">عميل / زبون</option>
                  <option value="supplier">مورد / تاجر صاغة</option>
                  <option value="both">عميل ومورد معاً</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">رقم الهاتف</label>
                <input
                  type="text"
                  placeholder="+963..."
                  value={formPhone}
                  onChange={e => setFormPhone(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm font-mono"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">العنوان والمنطقة</label>
                <input
                  type="text"
                  value={formAddress}
                  onChange={e => setFormAddress(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">ملاحظات</label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-sm"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddPartnerModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-sm font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-amber-400 text-slate-900 rounded-sm font-bold shadow-sm"
                >
                  حفظ الحساب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {debtPartner && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-sm border-2 border-amber-400 bg-white p-5 text-right shadow-2xl">
            <div className="mb-4 flex items-start justify-between border-b border-slate-200 pb-3"><div><h3 className="flex items-center gap-2 font-black text-slate-900"><Coins className="h-5 w-5 text-amber-600" />ذمة ذهب بالوزن</h3><p className="mt-1 text-[11px] text-slate-500">{debtPartner.name} - دون سعر أو قيمة مالية.</p></div><button onClick={() => setDebtPartner(null)} className="text-slate-500"><X className="h-5 w-5" /></button></div>
            <form onSubmit={handleSaveGoldDebt} className="space-y-3 text-xs">
              <div><label className="mb-1 block font-bold text-slate-700">اسم القطعة</label><input required value={debtItemName} onChange={event => setDebtItemName(event.target.value)} placeholder="مثال: سوار ذهب" className="w-full border border-slate-200 bg-slate-50 p-2" /></div>
              <div><label className="mb-1 block font-bold text-slate-700">الوزن بالغرام</label><input required type="number" min="0.01" step="0.01" value={debtWeight} onChange={event => setDebtWeight(event.target.value)} placeholder="0.00" className="w-full border border-slate-200 bg-slate-50 p-2 font-mono" /></div>
              <div><label className="mb-1 block font-bold text-slate-700">اتجاه الذمة</label><select value={debtDirection} onChange={event => setDebtDirection(event.target.value as GoldDebtEntry['direction'])} className="w-full border border-amber-300 bg-amber-50 p-2 font-bold"><option value="owed_to_partner">له علينا - نعيد له الذهب</option><option value="owed_by_partner">عليه لنا - يعيد لنا الذهب</option></select></div>
              {(debtPartner.goldDebtEntries || []).length > 0 && <div className="border-t border-slate-200 pt-3"><p className="mb-1 font-bold text-slate-600">آخر ذمم الذهب المسجلة</p><div className="space-y-1">{(debtPartner.goldDebtEntries || []).slice(-3).reverse().map(entry => <div key={entry.id} className="flex justify-between bg-slate-50 p-2 text-[11px]"><span>{entry.itemName} - {entry.direction === 'owed_to_partner' ? 'له علينا' : 'عليه لنا'}</span><b className={entry.direction === 'owed_to_partner' ? 'text-amber-800' : 'text-rose-700'}>{entry.direction === 'owed_to_partner' ? '+' : '-'}{entry.weightGrams.toFixed(2)} غ</b></div>)}</div></div>}
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3"><button type="button" onClick={() => setDebtPartner(null)} className="bg-slate-100 px-4 py-2 font-bold text-slate-700">إلغاء</button><button type="submit" className="bg-amber-400 px-5 py-2 font-black text-slate-900">حفظ الذمة</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Account Statement Printable Modal */}
      {selectedPartnerForStatement && (
        <PrintAccountStatementModal
          partner={selectedPartnerForStatement}
          onClose={() => setSelectedPartnerForStatement(null)}
          onSettleGoldDebt={handleSettleGoldDebt}
        />
      )}
    </div>
  );
};
