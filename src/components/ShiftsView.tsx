import React, { useState } from 'react';
import { useStore } from '../context/StoreContext';
import { Clock3, Eye, Receipt, X } from 'lucide-react';
import { WorkShift } from '../types';

export const ShiftsView: React.FC = () => {
  const { shifts, invoices } = useStore();
  const [selectedShift, setSelectedShift] = useState<WorkShift | null>(null);

  const getShiftInvoices = (shift: WorkShift) => invoices.filter(invoice => invoice.shiftId === shift.id);
  const getSummary = (shift: WorkShift) => {
    const shiftInvoices = getShiftInvoices(shift);
    return { count: shiftInvoices.length, total: shiftInvoices.filter(invoice => invoice.type === 'sale').reduce((sum, invoice) => sum + invoice.finalTotalUSD, 0), weight: shiftInvoices.filter(invoice => invoice.type === 'sale').reduce((sum, invoice) => sum + invoice.items.reduce((weight, item) => weight + item.netWeightGrams, 0), 0) };
  };

  return <div className="space-y-4">
    <div className="flex items-center gap-2 rounded-sm border border-slate-200 bg-white p-4 shadow-sm"><Clock3 className="h-5 w-5 text-amber-600" /><div><h2 className="font-black text-slate-900">سجل الورديات</h2><p className="text-[11px] text-slate-500">متابعة بدء وإنهاء ورديات الموظفين وفواتير كل وردية.</p></div></div>
    <div className="space-y-2">
      {shifts.length === 0 ? <div className="border border-dashed border-slate-300 bg-white p-8 text-center text-xs text-slate-500">لا توجد ورديات مسجلة بعد.</div> : shifts.map(shift => {
        const summary = getSummary(shift);
        return <button key={shift.id} onClick={() => setSelectedShift(shift)} className={`w-full border-r-4 p-3 text-right shadow-sm transition ${shift.endedAt ? 'border-r-slate-400 bg-white hover:bg-slate-50' : 'border-r-emerald-500 bg-emerald-50 hover:bg-emerald-100/60'}`}><div className="flex items-start justify-between gap-3"><div><p className="font-black text-slate-900">{shift.userName}</p><p className="mt-0.5 text-[10px] text-slate-500">بدأت: {new Date(shift.startedAt).toLocaleString('ar-SY')}</p></div><span className={`px-2 py-1 text-[10px] font-black ${shift.endedAt ? 'bg-slate-100 text-slate-700' : 'bg-emerald-600 text-white'}`}>{shift.endedAt ? 'مغلقة' : 'مفتوحة'}</span></div><div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-200 pt-2 text-[11px]"><span>الفواتير: <b>{summary.count}</b></span><span>المبيعات: <b>$ {summary.total.toFixed(2)}</b></span><span>الوزن: <b>{summary.weight.toFixed(2)} غ</b></span></div></button>;
      })}
    </div>
    {selectedShift && (() => { const summary = getSummary(selectedShift); const shiftInvoices = getShiftInvoices(selectedShift); return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-sm border-2 border-amber-400 bg-white p-4 text-right shadow-2xl"><div className="flex items-center justify-between border-b border-slate-200 pb-3"><div><h3 className="font-black text-slate-900">وردية {selectedShift.userName}</h3><p className="text-[10px] text-slate-500">{new Date(selectedShift.startedAt).toLocaleString('ar-SY')} {selectedShift.endedAt ? `— ${new Date(selectedShift.endedAt).toLocaleString('ar-SY')}` : '— مفتوحة'}</p></div><button onClick={() => setSelectedShift(null)}><X className="h-5 w-5 text-slate-500" /></button></div><div className="my-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="bg-slate-50 p-2">فواتير<br /><b>{summary.count}</b></div><div className="bg-emerald-50 p-2">مبيعات<br /><b>$ {summary.total.toFixed(2)}</b></div><div className="bg-amber-50 p-2">وزن<br /><b>{summary.weight.toFixed(2)} غ</b></div></div><div className="space-y-2">{shiftInvoices.length === 0 ? <p className="p-4 text-center text-xs text-slate-500">لا توجد فواتير ضمن هذه الوردية.</p> : shiftInvoices.map(invoice => <div key={invoice.id} className="flex items-center justify-between border-r-4 border-r-amber-400 bg-slate-50 p-2 text-xs"><div><p className="font-bold text-slate-900">{invoice.invoiceNumber} — {invoice.customerOrSupplierName}</p><p className="text-[10px] text-slate-500">{invoice.items.length} قطعة</p></div><b>$ {invoice.finalTotalUSD.toFixed(2)}</b></div>)}</div></div></div>; })()}
  </div>;
};
