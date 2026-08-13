import React from 'react';
import { GoldDebtEntry, Partner } from '../types';
import { useStore } from '../context/StoreContext';
import { Printer, X, Coins, MapPin, Phone, FileSpreadsheet } from 'lucide-react';

interface PrintAccountStatementModalProps {
  partner: Partner;
  onClose: () => void;
  onSettleGoldDebt: (entry: GoldDebtEntry) => void;
}

export const PrintAccountStatementModal: React.FC<PrintAccountStatementModalProps> = ({ partner, onClose, onSettleGoldDebt }) => {
  const { settings, invoices, vouchers, formatMoney } = useStore();

  const handlePrint = () => {
    window.print();
  };

  // Gather partner's invoices and vouchers
  const partnerInvoices = invoices.filter(i => i.customerOrSupplierId === partner.id);
  const partnerVouchers = vouchers.filter(v => v.partnerId === partner.id);

  // Combine into timeline
  const transactions = [
    ...partnerInvoices.map(inv => ({
      date: inv.date,
      type: inv.type === 'sale' ? 'فاتورة بيع ذهب' : 'فاتورة شراء ذهب',
      ref: inv.invoiceNumber,
      statement: `فاتورة ${inv.type === 'sale' ? 'بيع' : 'شراء'} بقيمة $${inv.finalTotalUSD}`,
      debitUSD: inv.type === 'sale' ? inv.remainingDebtUSD : 0, // عليه
      creditUSD: inv.type === 'purchase' ? inv.remainingDebtUSD : 0, // له
       gold21kGrams: 0,
       goldDebtEntry: undefined
    })),
    ...partnerVouchers.map(vch => ({
      date: vch.date,
      type: vch.type === 'receipt' ? 'سند قبض مالي' : 'سند صرف مالي',
      ref: vch.voucherNumber,
      statement: vch.statement,
      debitUSD: vch.type === 'payment' ? vch.amountUSD : 0,
      creditUSD: vch.type === 'receipt' ? vch.amountUSD : 0,
       gold21kGrams: vch.goldWeight21kGrams || 0,
       goldDebtEntry: undefined
    })),
    ...(partner.goldDebtEntries || []).map(entry => ({
      date: entry.date,
      type: entry.direction === 'owed_to_partner' ? 'ذمة ذهب له علينا' : 'ذمة ذهب عليه لنا',
      ref: 'ذمة ذهب',
      statement: `${entry.itemName} - ${entry.direction === 'owed_to_partner' ? 'نعيدها للعميل' : 'يعيدها العميل لنا'}`,
      debitUSD: 0,
      creditUSD: 0,
       gold21kGrams: entry.direction === 'owed_to_partner' ? entry.weightGrams : -entry.weightGrams,
       goldDebtEntry: entry
    }))
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-hidden bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6">
      <div role="dialog" aria-modal="true" className="relative max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-sm bg-white p-4 text-right text-slate-900 shadow-2xl print-container sm:p-6">
        {/* Controls Bar (No Print) */}
        <div className="flex items-center justify-between gap-3 no-print border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-amber-600" />
            <h3 className="font-bold text-slate-900 text-base">معاينة كشف الحساب التفصيلي</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handlePrint}
              className="hidden bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 shadow transition hover:bg-amber-400 sm:flex sm:items-center sm:gap-2"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة كشف الحساب</span>
            </button>
            <button onClick={onClose} aria-label="إغلاق كشف الحساب" className="bg-slate-100 p-2 text-slate-700">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* PRINTABLE BODY */}
        <div className="space-y-4 border border-amber-600/30 bg-gradient-to-b from-amber-50/20 via-white to-white p-3 sm:space-y-6 sm:p-6">
          {/* Header */}
          <div className="flex items-center justify-between border-b-2 border-amber-500/20 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Coins className="w-6 h-6 text-amber-600" />
                <h1 className="text-2xl font-black text-amber-900">{settings.storeName}</h1>
              </div>
              <p className="text-xs text-slate-600 mt-1">{settings.address} - حلب</p>
            </div>
            <div className="text-left">
              <span className="bg-amber-500 text-slate-950 text-xs font-black px-3 py-1 rounded-lg uppercase">
                كشف حساب مالية وذهب
              </span>
              <p className="text-xs text-slate-500 mt-1">تاريخ الكشف: {new Date().toLocaleDateString('ar-SY')}</p>
            </div>
          </div>

          {/* Partner Info Summary */}
          <div className="grid grid-cols-2 gap-3 border border-amber-200 bg-amber-50 p-3 text-xs sm:grid-cols-4 sm:p-4">
            <div>
              <span className="text-slate-500 block">الاسم:</span>
              <span className="font-black text-slate-900 text-sm">{partner.name}</span>
            </div>
            <div>
              <span className="text-slate-500 block">رقم الهاتف:</span>
              <span className="font-bold text-slate-800" dir="ltr">{partner.phone}</span>
            </div>
            <div>
              <span className="text-slate-500 block">الرصيد المالي الحالي:</span>
              <span className={`font-black text-sm ${partner.balanceUSD < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                $ {Math.abs(partner.balanceUSD).toFixed(2)} {partner.balanceUSD < 0 ? '(مطلوب منه)' : '(له عندنا)'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block">ذمة الذهب عيار 21:</span>
              <span className="font-black text-sm text-amber-900">
                {Math.abs(partner.goldBalance21kGrams)} غرام {partner.goldBalance21kGrams < 0 ? '(عليه)' : '(له)'}
              </span>
            </div>
          </div>

          {/* Mobile transaction lines: each operation is independently scannable. */}
          <div className="space-y-2 sm:hidden print:hidden">
            <h4 className="mb-2 text-xs font-bold text-slate-800">سجل الحركات والفواتير</h4>
            {transactions.length === 0 ? (
              <div className="border border-dashed border-slate-200 p-5 text-center text-xs text-slate-400">لا توجد حركات مسجلة لهذا الحساب بعد</div>
            ) : (
              transactions.map((transaction, index) => (
                <article key={`${transaction.ref}-${index}`} className="border-r-4 border-amber-400 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black text-slate-900">{transaction.type}</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">{transaction.ref} • {transaction.date}</p>
                    </div>
                    <span className="shrink-0 text-xs font-black text-amber-900">{transaction.gold21kGrams ? `${transaction.gold21kGrams} غ` : '—'}</span>
                  </div>
                   <p className="mt-2 text-[11px] leading-5 text-slate-600">{transaction.statement}</p>
                   {transaction.goldDebtEntry && !transaction.goldDebtEntry.settledAt && (
                     <button onClick={() => onSettleGoldDebt(transaction.goldDebtEntry!)} className="mt-2 w-full border border-emerald-600 bg-emerald-50 px-3 py-2 text-[11px] font-black text-emerald-800">تسوية الذمة</button>
                   )}
                   {transaction.goldDebtEntry?.settledAt && <p className="mt-2 text-[11px] font-bold text-emerald-700">تمت التسوية: {transaction.goldDebtEntry.settledAt}</p>}
                  <div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-200 pt-2 text-[11px] font-bold">
                    <span className="text-rose-700">عليه: {transaction.debitUSD ? `$ ${transaction.debitUSD.toFixed(2)}` : '—'}</span>
                    <span className="text-emerald-700">له: {transaction.creditUSD ? `$ ${transaction.creditUSD.toFixed(2)}` : '—'}</span>
                  </div>
                </article>
              ))
            )}
          </div>

          {/* Transactions Ledger Table */}
          <div className="hidden sm:block">
            <h4 className="font-bold text-xs text-slate-800 mb-2">سجل الحركات والفواتير المتبادلة:</h4>
            <table className="hidden w-full overflow-hidden border border-slate-200 text-right text-xs sm:table">
              <thead className="bg-slate-900 text-amber-300 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">التاريخ</th>
                  <th className="py-2.5 px-3">النوع والمرجع</th>
                  <th className="py-2.5 px-4">البيان والشرح</th>
                  <th className="py-2.5 px-3 text-center">مدين ($ عليه)</th>
                  <th className="py-2.5 px-3 text-center">دائن ($ له)</th>
                  <th className="py-2.5 px-3 text-center">ذهب 21 (غ)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium text-slate-800">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      لا يوجد حركات مسجلة لهذا الحساب بعد
                    </td>
                  </tr>
                ) : (
                  transactions.map((t, idx) => (
                    <tr key={idx}>
                      <td className="py-2.5 px-3 text-slate-500 font-mono">{t.date}</td>
                      <td className="py-2.5 px-3 font-bold text-amber-900">
                        <div>{t.type} ({t.ref})</div>
                        {t.goldDebtEntry && !t.goldDebtEntry.settledAt && <button onClick={() => onSettleGoldDebt(t.goldDebtEntry!)} className="no-print mt-1 border border-emerald-600 bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-800">تسوية</button>}
                        {t.goldDebtEntry?.settledAt && <span className="no-print mt-1 block text-[11px] text-emerald-700">تمت التسوية</span>}
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">{t.statement}</td>
                      <td className="py-2.5 px-3 text-center text-rose-700 font-bold">
                        {t.debitUSD > 0 ? `$ ${t.debitUSD.toFixed(2)}` : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-center text-emerald-700 font-bold">
                        {t.creditUSD > 0 ? `$ ${t.creditUSD.toFixed(2)}` : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-center font-bold text-amber-800">
                        {t.gold21kGrams !== 0 ? `${t.gold21kGrams} غ` : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer Signature */}
          <div className="pt-6 border-t border-slate-200 flex justify-between text-xs text-slate-500 font-bold">
            <p>توقيع وسند المحاسب: ....................</p>
            <p>ختم حميد حليوي لتجارة الذهب</p>
          </div>
        </div>
      </div>
    </div>
  );
};
