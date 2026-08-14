import React, { useEffect, useState } from 'react';
import { MoreVertical, Phone, Plus, Search, Users } from 'lucide-react';
import type { Partner, PartnerType } from '../types';
import { useStore } from '../context/StoreContext';
import { PrintAccountStatementModal } from './PrintAccountStatementModal';
import { usePartnersModule } from '../hooks/usePartnersModule';
import { partnersApi, type ApiPartner } from '../services/partnersApi';
import { goldApi, type ApiGoldBalance } from '../services/goldApi';

const PAGE_SIZE = 20;

export const PartnersView: React.FC = () => {
  const { formatMoney, settings } = useStore();
  const [activeTab, setActiveTab] = useState<'all' | 'customers' | 'suppliers'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [showAddPartnerModal, setShowAddPartnerModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<ApiPartner | null>(null);
  const [selectedPartnerForStatement, setSelectedPartnerForStatement] = useState<Partner | null>(null);
  const [activePartnerMenu, setActivePartnerMenu] = useState<ApiPartner | null>(null);
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<PartnerType>('customer');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('حلب - سوريا');
  const [formNotes, setFormNotes] = useState('');
  const filterType = activeTab === 'customers' ? 'customer' : activeTab === 'suppliers' ? 'supplier' : undefined;
  const { partners, total, loading, error, mutate } = usePartnersModule({ type: filterType, search: searchQuery, page });
  // Weight obligations come from the gold ledger, per karat — the partner record only ever
  // held an opening figure, and grams of different karats are never added together.
  const [goldBalances, setGoldBalances] = useState<Record<string, ApiGoldBalance[]>>({});
  useEffect(() => {
    void goldApi.partnerBalances()
      .then(rows => setGoldBalances(Object.fromEntries(rows.filter(row => row.partnerId).map(row => [row.partnerId as string, row.balances]))))
      .catch(() => undefined);
  }, [partners]);

  const resetForm = () => { setFormName(''); setFormType('customer'); setFormPhone(''); setFormAddress('حلب - سوريا'); setFormNotes(''); setEditingPartner(null); };
  const switchTab = (tab: 'all' | 'customers' | 'suppliers') => { setActiveTab(tab); setPage(1); };
  const handleOpenEdit = (partner: ApiPartner) => { setEditingPartner(partner); setFormName(partner.name); setFormType(partner.type); setFormPhone(partner.phone); setFormAddress(partner.address); setFormNotes(partner.notes || ''); setShowAddPartnerModal(true); setActivePartnerMenu(null); };

  const handleSavePartner = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!formName.trim()) return;
    const input = { name: formName, type: formType, phone: formPhone, address: formAddress, notes: formNotes };
    const success = editingPartner
      ? await mutate(() => partnersApi.update(editingPartner.id, { ...input, version: editingPartner.version }))
      : await mutate(() => partnersApi.create(input));
    if (success) { setShowAddPartnerModal(false); resetForm(); }
  };

  const handleArchive = async (partner: ApiPartner) => {
    setActivePartnerMenu(null);
    if (!window.confirm(`أرشفة حساب «${partner.name}»؟ لن يتم حذفه نهائياً.`)) return;
    await mutate(() => partnersApi.archive(partner.id, partner.version));
  };

  const handleSharePartner = (partner: Partner) => {
    const balanceText = partner.balanceUSD < 0 ? `مطلوب منه: $ ${Math.abs(partner.balanceUSD).toFixed(2)}` : partner.balanceUSD > 0 ? `له عندنا: $ ${partner.balanceUSD.toFixed(2)}` : 'الحساب خالص';
    const balances = goldBalances[partner.id] ?? [];
    const goldText = balances.length ? balances.map(row => `عيار ${row.karat}: ${Math.abs(row.grams).toFixed(3)} غ ${row.grams > 0 ? 'عليه' : 'له'}`).join('\n') : 'لا توجد ذمم أوزان مفتوحة';
    const text = `${settings.storeName}\nكشف حساب الجهة: ${partner.name}\nالهاتف: ${partner.phone || '-'}\n${balanceText}\nذمم الأوزان:\n${goldText}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
    setActivePartnerMenu(null);
  };

  const totalReceivablesUSD = partners.filter(partner => partner.balanceUSD < 0).reduce((sum, partner) => sum + Math.abs(partner.balanceUSD), 0);
  const totalPayablesUSD = partners.filter(partner => partner.balanceUSD > 0).reduce((sum, partner) => sum + partner.balanceUSD, 0);
  // Karats cannot be summed as grams, so the headline figure is stated in fine gold.
  const totalGoldReceivablesPure = (Object.values(goldBalances) as ApiGoldBalance[][]).flat().filter(row => row.grams > 0).reduce((sum, row) => sum + row.pureGoldGrams, 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const Menu = ({ partner }: { partner: ApiPartner }) => <div onClick={event => event.stopPropagation()} className="absolute left-0 top-9 z-50 w-40 rounded-sm border border-slate-300 bg-white py-1 text-right text-xs shadow-xl">
    <button onClick={() => { setSelectedPartnerForStatement(partner); setActivePartnerMenu(null); setTimeout(() => window.print(), 150); }} className="w-full px-3 py-2 text-right hover:bg-amber-50">طباعة</button>
    <button onClick={() => { setSelectedPartnerForStatement(partner); setActivePartnerMenu(null); setTimeout(() => window.print(), 150); }} className="w-full px-3 py-2 text-right hover:bg-amber-50">تصدير PDF</button>
    <button onClick={() => handleSharePartner(partner)} className="w-full px-3 py-2 text-right text-emerald-800 hover:bg-emerald-50">مشاركة واتساب</button>
    <button onClick={() => handleOpenEdit(partner)} className="w-full px-3 py-2 text-right hover:bg-slate-50">تعديل</button>
    <button onClick={() => void handleArchive(partner)} className="w-full px-3 py-2 text-right text-rose-700 hover:bg-rose-50">أرشفة</button>
  </div>;

  return <div className="space-y-6">
    <div className="flex flex-col justify-between gap-4 rounded-sm border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center">
      <div><div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase text-amber-600"><Users className="h-4 w-4" /><span>إدارة الحسابات المالية والذمم والتجار</span></div><h2 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">العملاء والموردين (سجل الذمم)</h2></div>
      <button onClick={() => { resetForm(); setShowAddPartnerModal(true); }} className="flex items-center gap-2 rounded-sm bg-amber-400 px-4 py-2.5 text-xs font-bold text-slate-900 shadow transition hover:bg-amber-300"><Plus className="h-4 w-4" />إضافة عميل أو مورد جديد</button>
    </div>

    {(loading || error) && <div className={`rounded-sm border px-4 py-3 text-xs font-bold ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{error || 'جار تحميل بيانات العملاء والموردين من الخادم...'}</div>}

    <div className="grid grid-cols-3 gap-2 sm:gap-4">
      <Summary tone="border-r-rose-600" label="إجمالي ديون العملاء (لنا بالدولار)" value={formatMoney(totalReceivablesUSD)} />
      <Summary tone="border-r-amber-400" label="إجمالي ذمم الأوزان لنا (ذهب صافٍ)" value={`${totalGoldReceivablesPure.toFixed(2)} غ`} valueClass="text-amber-800" />
      <Summary tone="border-r-emerald-600" label="مستحقات الموردين (علينا للموردين)" value={formatMoney(totalPayablesUSD)} />
    </div>

    <div className="flex flex-col items-center justify-between gap-4 rounded-sm border border-slate-200 bg-white p-4 text-xs shadow-sm sm:flex-row">
      <div className="flex w-full gap-2 rounded-sm bg-slate-100 p-1 font-bold sm:w-auto">
        <Tab active={activeTab === 'all'} onClick={() => switchTab('all')}>الكل {activeTab === 'all' ? `(${total})` : ''}</Tab>
        <Tab active={activeTab === 'customers'} onClick={() => switchTab('customers')}>العملاء والزبائن {activeTab === 'customers' ? `(${total})` : ''}</Tab>
        <Tab active={activeTab === 'suppliers'} onClick={() => switchTab('suppliers')}>الموردين وتجار الذهب {activeTab === 'suppliers' ? `(${total})` : ''}</Tab>
      </div>
      <div className="relative w-full sm:w-72"><Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" /><input type="search" placeholder="ابحث بالاسم، رقم الهاتف، العنوان..." value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setPage(1); }} className="w-full rounded-sm border border-slate-200 bg-slate-50 py-2 pl-3 pr-9 font-medium text-slate-800 focus:border-amber-400 focus:outline-none" /></div>
    </div>

    <div className="space-y-2.5 md:hidden">
      {!loading && partners.length === 0 ? <Empty /> : partners.map(partner => <article key={partner.id} onClick={() => setSelectedPartnerForStatement(partner)} className={`relative cursor-pointer space-y-3 rounded-sm border border-slate-200 bg-white p-3 pl-14 shadow-sm ${activePartnerMenu?.id === partner.id ? 'z-50' : 'z-0'}`}>
        <div className="flex items-start justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><Avatar partner={partner} /><div className="min-w-0"><h3 className="truncate text-sm font-black text-slate-900">{partner.name}</h3>{partner.phone && <a onClick={event => event.stopPropagation()} href={`tel:${partner.phone}`} dir="ltr" className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500"><Phone className="h-3 w-3" />{partner.phone}</a>}</div></div><TypeBadge type={partner.type} /><div className="absolute left-3 top-3"><button onClick={event => { event.stopPropagation(); setActivePartnerMenu(activePartnerMenu?.id === partner.id ? null : partner); }} aria-label={`إجراءات ${partner.name}`} className="rounded-sm border border-slate-200 bg-white p-1.5 text-slate-700 shadow-sm"><MoreVertical className="h-4 w-4" /></button>{activePartnerMenu?.id === partner.id && <Menu partner={partner} />}</div></div>
        <BalanceGrid partner={partner} balances={goldBalances[partner.id] ?? []} />
      </article>)}
    </div>

    <div className="hidden overflow-visible rounded-sm border border-slate-200 bg-white shadow-sm md:block"><div className="overflow-visible"><table className="w-full text-right text-xs"><thead className="border-b border-slate-800 bg-slate-900 font-bold uppercase text-amber-400"><tr><th className="px-4 py-3.5">اسم العميل / المورد</th><th className="px-3 py-3.5">الصفة</th><th className="px-3 py-3.5">رقم الهاتف</th><th className="px-3 py-3.5">العنوان والموقع</th><th className="px-3 py-3.5">الرصيد المالي ($)</th><th className="px-3 py-3.5">ذمة الأوزان (غرام / عيار)</th><th className="px-4 py-3.5 text-center">الإجراءات</th></tr></thead><tbody className="divide-y divide-slate-200 font-medium text-slate-800">
      {!loading && partners.length === 0 ? <tr><td colSpan={7}><Empty /></td></tr> : partners.map(partner => <tr key={partner.id} onClick={() => setSelectedPartnerForStatement(partner)} className={`cursor-pointer transition hover:bg-amber-50/50 ${activePartnerMenu?.id === partner.id ? 'relative z-50' : ''}`}><td className="px-4 py-3 font-bold text-slate-900"><div className="flex items-center gap-2"><Avatar partner={partner} /><div><span>{partner.name}</span>{partner.notes && <p className="text-[10px] font-normal text-slate-400">{partner.notes}</p>}</div></div></td><td className="px-3 py-3"><TypeBadge type={partner.type} /></td><td className="px-3 py-3 font-mono font-bold text-slate-600" dir="ltr">{partner.phone || '-'}</td><td className="px-3 py-3 text-slate-600">{partner.address || '-'}</td><td className="px-3 py-3"><MoneyBalance partner={partner} /></td><td className="px-3 py-3"><GoldBalance balances={goldBalances[partner.id] ?? []} /></td><td className="relative px-4 py-3 text-center"><button onClick={event => { event.stopPropagation(); setActivePartnerMenu(activePartnerMenu?.id === partner.id ? null : partner); }} className="rounded-sm border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50"><MoreVertical className="h-4 w-4" /></button>{activePartnerMenu?.id === partner.id && <Menu partner={partner} />}</td></tr>)}
    </tbody></table></div></div>

    {total > PAGE_SIZE && <div className="flex items-center justify-center gap-3 text-xs font-bold text-slate-600"><button disabled={page <= 1} onClick={() => setPage(current => current - 1)} className="rounded-sm border border-slate-300 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50">السابق</button><span>صفحة {page} من {pages}</span><button disabled={page >= pages} onClick={() => setPage(current => current + 1)} className="rounded-sm border border-slate-300 bg-white px-3 py-2 disabled:cursor-not-allowed disabled:opacity-50">التالي</button></div>}

    {showAddPartnerModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"><div className="w-full max-w-md space-y-4 rounded-sm border-2 border-slate-900 bg-white p-6 text-right shadow-2xl"><h3 className="text-base font-black text-slate-900">{editingPartner ? 'تعديل بيانات الحساب' : 'إضافة عميل أو مورد جديد'}</h3><form onSubmit={event => void handleSavePartner(event)} className="space-y-3 text-xs"><Field label="الاسم الكامل *"><input required value={formName} onChange={event => setFormName(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5 font-medium" /></Field><Field label="الصفة *"><select value={formType} onChange={event => setFormType(event.target.value as PartnerType)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5 font-bold"><option value="customer">عميل / زبون</option><option value="supplier">مورد / تاجر صياغة</option><option value="both">عميل ومورد معاً</option></select></Field><Field label="رقم الهاتف"><input value={formPhone} onChange={event => setFormPhone(event.target.value)} placeholder="+963..." className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5 font-mono" /></Field><Field label="العنوان والمنطقة"><input value={formAddress} onChange={event => setFormAddress(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5" /></Field><Field label="ملاحظات"><textarea rows={2} value={formNotes} onChange={event => setFormNotes(event.target.value)} className="w-full rounded-sm border border-slate-200 bg-slate-50 p-2.5" /></Field><div className="flex items-center justify-end gap-3 border-t border-slate-200 pt-3"><button type="button" onClick={() => setShowAddPartnerModal(false)} className="rounded-sm bg-slate-100 px-4 py-2 font-bold text-slate-700">إلغاء</button><button type="submit" className="rounded-sm bg-amber-400 px-5 py-2 font-bold text-slate-900 shadow-sm">حفظ الحساب</button></div></form></div></div>}
    {selectedPartnerForStatement && <PrintAccountStatementModal partner={selectedPartnerForStatement} onClose={() => setSelectedPartnerForStatement(null)} />}
  </div>;
};

const Tab = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => <button onClick={onClick} className={`rounded-sm px-4 py-2 transition ${active ? 'bg-amber-400 text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>{children}</button>;
const Summary = ({ tone, label, value, valueClass = 'text-slate-900' }: { tone: string; label: string; value: string; valueClass?: string }) => <div className={`min-w-0 rounded-sm border border-slate-200 border-r-4 bg-white p-2.5 shadow-sm sm:p-4 ${tone}`}><span className="mb-1 block text-[10px] font-bold leading-4 text-slate-500 sm:text-xs">{label}</span><span className={`block text-sm font-black font-mono sm:text-2xl ${valueClass}`}>{value}</span></div>;
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <div><label className="mb-1 block font-bold text-slate-700">{label}</label>{children}</div>;
const Avatar = ({ partner }: { partner: Partner }) => <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-slate-900 font-bold text-amber-400">{partner.name.charAt(0)}</div>;
const TypeBadge = ({ type }: { type: PartnerType }) => <span className={`shrink-0 rounded-sm px-2 py-1 text-[10px] font-black ${type === 'customer' ? 'bg-blue-100 text-blue-900' : type === 'supplier' ? 'bg-emerald-100 text-emerald-900' : 'bg-purple-100 text-purple-900'}`}>{type === 'customer' ? 'عميل' : type === 'supplier' ? 'مورّد' : 'عميل ومورّد'}</span>;
const MoneyBalance = ({ partner }: { partner: Partner }) => <span className={`font-mono text-sm font-black ${partner.balanceUSD < 0 ? 'text-rose-700' : partner.balanceUSD > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>{partner.balanceUSD === 0 ? 'خالص ($0)' : partner.balanceUSD < 0 ? `مطلوب منه $ ${Math.abs(partner.balanceUSD).toFixed(2)}` : `له عندنا $ ${partner.balanceUSD.toFixed(2)}`}</span>;
// One line per karat: a positive balance is weight the partner owes the shop.
const GoldBalance = ({ balances }: { balances: ApiGoldBalance[] }) => (!balances.length
  ? <span className="font-mono text-sm font-black text-slate-400">0 غرام</span>
  : <span className="block">{balances.map(row => <span key={row.karat} className={`block font-mono text-sm font-black ${row.grams > 0 ? 'text-amber-800' : 'text-rose-700'}`}>{Math.abs(row.grams).toFixed(3)} غ ع{row.karat} {row.grams > 0 ? 'عليه' : 'له'}</span>)}</span>);
const BalanceGrid = ({ partner, balances }: { partner: Partner; balances: ApiGoldBalance[] }) => <div className="grid grid-cols-2 divide-x divide-x-reverse divide-slate-200 border-y border-slate-100 py-2 text-[11px]"><div className="pl-2"><p className="mb-0.5 text-slate-400">الرصيد المالي</p><MoneyBalance partner={partner} /></div><div className="pr-2"><p className="mb-0.5 text-slate-400">ذمة الأوزان</p><GoldBalance balances={balances} /></div></div>;
const Empty = () => <div className="py-10 text-center text-xs text-slate-400">لا يوجد نتائج مطابقة للبحث</div>;
