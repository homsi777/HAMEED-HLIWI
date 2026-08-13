import React, { useEffect, useState } from 'react';
import { Coins, FileSpreadsheet, Printer, X } from 'lucide-react';
import type { Partner } from '../types';
import { useStore } from '../context/StoreContext';
import { financeApi, type ApiStatement } from '../services/financeApi';

interface PrintAccountStatementModalProps { partner: Partner; onClose: () => void; }

export const PrintAccountStatementModal: React.FC<PrintAccountStatementModalProps> = ({ partner, onClose }) => {
  const { settings } = useStore();
  const [statement, setStatement] = useState<ApiStatement | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // The statement is rebuilt from the backend subledger on every open, so it always
  // reflects the same facts the invoices, vouchers and returns recorded.
  useEffect(() => {
    let active = true;
    financeApi.partnerStatement(partner.id)
      .then(result => { if (active) { setStatement(result); setLoading(false); } })
      .catch((reason: any) => { if (active) { setError(reason?.message || 'تعذر تحميل كشف الحساب من الخادم.'); setLoading(false); } });
    return () => { active = false; };
  }, [partner.id]);

  const closing = statement?.closingBalanceUSD ?? 0;
  const balanceLabel = closing > 0 ? '(مطلوب منه)' : closing < 0 ? '(له عندنا)' : '(خالص)';

  return <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-hidden bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6">
    <div role="dialog" aria-modal="true" className="print-container relative max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-sm bg-white p-4 text-right text-slate-900 shadow-2xl sm:p-6">
      <div className="no-print flex items-center justify-between gap-3 border-b border-slate-200 pb-3"><div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-amber-600" /><h3 className="text-base font-bold text-slate-900">معاينة كشف الحساب التفصيلي</h3></div><div className="flex shrink-0 items-center gap-2"><button onClick={() => window.print()} className="hidden items-center gap-2 bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 shadow transition hover:bg-amber-400 sm:flex"><Printer className="h-4 w-4" />طباعة كشف الحساب</button><button onClick={onClose} aria-label="إغلاق كشف الحساب" className="bg-slate-100 p-2 text-slate-700"><X className="h-5 w-5" /></button></div></div>
      <div className="space-y-4 border border-amber-600/30 bg-gradient-to-b from-amber-50/20 via-white to-white p-3 sm:space-y-6 sm:p-6">
        <div className="flex items-center justify-between border-b-2 border-amber-500/20 pb-4"><div><div className="flex items-center gap-2"><Coins className="h-6 w-6 text-amber-600" /><h1 className="text-2xl font-black text-amber-900">{settings.storeName}</h1></div><p className="mt-1 text-xs text-slate-600">{settings.address} - حلب</p></div><div className="text-left"><span className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-black uppercase text-slate-950">كشف حساب مالية وذهب</span><p className="mt-1 text-xs text-slate-500">تاريخ الكشف: {new Date().toLocaleDateString('ar-SY')}</p></div></div>
        <div className="grid grid-cols-2 gap-3 border border-amber-200 bg-amber-50 p-3 text-xs sm:grid-cols-4 sm:p-4"><Info label="الاسم:" value={partner.name} /><Info label="رقم الهاتف:" value={partner.phone || '-'} ltr /><Info label="الرصيد المالي الحالي:" value={`$ ${Math.abs(closing).toFixed(2)} ${balanceLabel}`} tone={closing > 0 ? 'text-rose-700' : 'text-emerald-700'} /><Info label="ذمة الذهب عيار 21:" value={`${Math.abs(partner.goldBalance21kGrams)} غرام ${partner.goldBalance21kGrams < 0 ? '(عليه)' : '(له)'}`} tone="text-amber-900" /></div>

        <div>
          <h4 className="mb-2 text-xs font-bold text-slate-800">سجل الحركات والفواتير</h4>
          {loading && <div className="border border-dashed border-slate-200 p-5 text-center text-xs text-slate-500">جارٍ تحميل كشف الحساب من قاعدة البيانات...</div>}
          {error && <div className="border border-rose-200 bg-rose-50 p-5 text-center text-xs font-bold text-rose-700">{error}</div>}
          {statement && !loading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full border border-slate-200 text-[11px]">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="border border-slate-200 p-1.5 text-right font-bold">التاريخ</th>
                    <th className="border border-slate-200 p-1.5 text-right font-bold">نوع المستند</th>
                    <th className="border border-slate-200 p-1.5 text-right font-bold">الرقم</th>
                    <th className="border border-slate-200 p-1.5 text-right font-bold">البيان</th>
                    <th className="border border-slate-200 p-1.5 text-right font-bold">العملة</th>
                    <th className="border border-slate-200 p-1.5 text-right font-bold">المبلغ الأصلي</th>
                    <th className="border border-slate-200 p-1.5 text-right font-bold">مدين $</th>
                    <th className="border border-slate-200 p-1.5 text-right font-bold">دائن $</th>
                    <th className="border border-slate-200 p-1.5 text-right font-bold">الرصيد $</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-amber-50 font-bold">
                    <td className="border border-slate-200 p-1.5" colSpan={8}>الرصيد الافتتاحي</td>
                    <td className="border border-slate-200 p-1.5 font-mono">{statement.openingBalanceUSD.toFixed(2)}</td>
                  </tr>
                  {statement.rows.map(row => (
                    <tr key={row.id} className="odd:bg-white even:bg-slate-50">
                      <td className="border border-slate-200 p-1.5 font-mono">{row.date}</td>
                      <td className="border border-slate-200 p-1.5">{row.documentType}</td>
                      <td className="border border-slate-200 p-1.5 font-mono">{row.documentNumber || '—'}</td>
                      <td className="border border-slate-200 p-1.5">{row.description}</td>
                      <td className="border border-slate-200 p-1.5">{row.currency}</td>
                      <td className="border border-slate-200 p-1.5 font-mono">{row.originalAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
                      <td className="border border-slate-200 p-1.5 font-mono text-rose-700">{row.debitUSD ? row.debitUSD.toFixed(2) : '—'}</td>
                      <td className="border border-slate-200 p-1.5 font-mono text-emerald-700">{row.creditUSD ? row.creditUSD.toFixed(2) : '—'}</td>
                      <td className="border border-slate-200 p-1.5 font-mono font-bold">{row.runningBalanceUSD.toFixed(2)}</td>
                    </tr>
                  ))}
                  {!statement.rows.length && <tr><td className="border border-slate-200 p-4 text-center text-slate-500" colSpan={9}>لا توجد حركات مسجلة على هذا الحساب بعد.</td></tr>}
                  <tr className="bg-slate-900 font-black text-white">
                    <td className="border border-slate-700 p-1.5" colSpan={8}>الرصيد الختامي {closing > 0 ? '(مطلوب من الطرف)' : closing < 0 ? '(مستحق للطرف)' : ''}</td>
                    <td className="border border-slate-700 p-1.5 font-mono">{closing.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex justify-between border-t border-slate-200 pt-6 text-xs font-bold text-slate-500"><p>توقيع وسند المحاسب: ....................</p><p>ختم حميد حليوي لتجارة الذهب</p></div>
      </div>
    </div>
  </div>;
};

const Info = ({ label, value, tone = 'text-slate-900', ltr = false }: { label: string; value: string; tone?: string; ltr?: boolean }) => <div><span className="block text-slate-500">{label}</span><span dir={ltr ? 'ltr' : undefined} className={`text-sm font-black ${tone}`}>{value}</span></div>;
