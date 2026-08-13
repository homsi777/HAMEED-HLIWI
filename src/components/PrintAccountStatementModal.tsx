import React from 'react';
import { Coins, FileSpreadsheet, Printer, X } from 'lucide-react';
import type { Partner } from '../types';
import { useStore } from '../context/StoreContext';

interface PrintAccountStatementModalProps { partner: Partner; onClose: () => void; }

export const PrintAccountStatementModal: React.FC<PrintAccountStatementModalProps> = ({ partner, onClose }) => {
  const { settings } = useStore();
  const balanceLabel = partner.balanceUSD < 0 ? '(مطلوب منه)' : partner.balanceUSD > 0 ? '(له عندنا)' : '(خالص)';
  return <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-hidden bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6">
    <div role="dialog" aria-modal="true" className="print-container relative max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-sm bg-white p-4 text-right text-slate-900 shadow-2xl sm:p-6">
      <div className="no-print flex items-center justify-between gap-3 border-b border-slate-200 pb-3"><div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-amber-600" /><h3 className="text-base font-bold text-slate-900">معاينة كشف الحساب التفصيلي</h3></div><div className="flex shrink-0 items-center gap-2"><button onClick={() => window.print()} className="hidden items-center gap-2 bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 shadow transition hover:bg-amber-400 sm:flex"><Printer className="h-4 w-4" />طباعة كشف الحساب</button><button onClick={onClose} aria-label="إغلاق كشف الحساب" className="bg-slate-100 p-2 text-slate-700"><X className="h-5 w-5" /></button></div></div>
      <div className="space-y-4 border border-amber-600/30 bg-gradient-to-b from-amber-50/20 via-white to-white p-3 sm:space-y-6 sm:p-6">
        <div className="flex items-center justify-between border-b-2 border-amber-500/20 pb-4"><div><div className="flex items-center gap-2"><Coins className="h-6 w-6 text-amber-600" /><h1 className="text-2xl font-black text-amber-900">{settings.storeName}</h1></div><p className="mt-1 text-xs text-slate-600">{settings.address} - حلب</p></div><div className="text-left"><span className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-black uppercase text-slate-950">كشف حساب مالية وذهب</span><p className="mt-1 text-xs text-slate-500">تاريخ الكشف: {new Date().toLocaleDateString('ar-SY')}</p></div></div>
        <div className="grid grid-cols-2 gap-3 border border-amber-200 bg-amber-50 p-3 text-xs sm:grid-cols-4 sm:p-4"><Info label="الاسم:" value={partner.name} /><Info label="رقم الهاتف:" value={partner.phone || '-'} ltr /><Info label="الرصيد المالي الحالي:" value={`$ ${Math.abs(partner.balanceUSD).toFixed(2)} ${balanceLabel}`} tone={partner.balanceUSD < 0 ? 'text-rose-700' : 'text-emerald-700'} /><Info label="ذمة الذهب عيار 21:" value={`${Math.abs(partner.goldBalance21kGrams)} غرام ${partner.goldBalance21kGrams < 0 ? '(عليه)' : '(له)'}`} tone="text-amber-900" /></div>
        <div><h4 className="mb-2 text-xs font-bold text-slate-800">سجل الحركات والفواتير</h4><div className="border border-dashed border-slate-200 p-5 text-center text-xs leading-6 text-slate-500">تم ترحيل بطاقة العميل/المورد فقط. الفواتير والسندات وذمم الأوزان ما زالت وحدات مستقلة ولم تُنسخ من بيانات المتصفح، لذلك لا يعرض هذا الكشف حركات غير موثقة من قاعدة البيانات.</div></div>
        <div className="flex justify-between border-t border-slate-200 pt-6 text-xs font-bold text-slate-500"><p>توقيع وسند المحاسب: ....................</p><p>ختم حميد حليوي لتجارة الذهب</p></div>
      </div>
    </div>
  </div>;
};

const Info = ({ label, value, tone = 'text-slate-900', ltr = false }: { label: string; value: string; tone?: string; ltr?: boolean }) => <div><span className="block text-slate-500">{label}</span><span dir={ltr ? 'ltr' : undefined} className={`text-sm font-black ${tone}`}>{value}</span></div>;
