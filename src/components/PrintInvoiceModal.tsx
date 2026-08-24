import React, { useEffect } from 'react';
import { Invoice } from '../types';
import { useStore } from '../context/StoreContext';
import { Printer, X } from 'lucide-react';

interface PrintInvoiceModalProps {
  invoice: Invoice;
  onClose: () => void;
  /** On small screens the invoice's financial trail lives inside this preview rather than
   *  in a second floating panel, so the phone shows one surface only. */
  financialTrail?: React.ReactNode;
}

const invoiceTypeLabel = (type: Invoice['type']) => type === 'sale' ? 'فاتورة بيع' : type === 'purchase' ? 'فاتورة شراء' : 'فاتورة مرتجع';

export const PrintInvoiceModal: React.FC<PrintInvoiceModalProps> = ({ invoice, onClose, financialTrail }) => {
  const { settings } = useStore();
  const isPurchaseInvoice = invoice.type === 'purchase';
  const blankRowCount = Math.max(0, (isPurchaseInvoice ? 10 : 6) - invoice.items.length - (invoice.scrapGoldItems?.length || 0));
  const remainingDebtUSD = Math.max(0, invoice.remainingDebtUSD ?? (invoice.finalTotalUSD - invoice.paidUSD));

  useEffect(() => {
    const pageStyle = document.createElement('style');
    pageStyle.dataset.invoiceA5Page = 'true';
    pageStyle.textContent = `@page { size: A5 ${isPurchaseInvoice ? 'portrait' : 'landscape'}; margin: 0; }`;
    document.head.appendChild(pageStyle);
    document.body.classList.add('invoice-a5-print-active');
    if (isPurchaseInvoice) document.body.classList.add('invoice-a5-print-portrait');

    return () => {
      pageStyle.remove();
      document.body.classList.remove('invoice-a5-print-active');
      document.body.classList.remove('invoice-a5-print-portrait');
    };
  }, [isPurchaseInvoice]);

  return (
    <div className="invoice-print-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overflow-x-hidden bg-slate-950/80 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="invoice-print-preview my-3 w-full max-w-5xl bg-white p-2 shadow-2xl sm:my-6 sm:p-4">
        <div className="no-print mb-3 flex items-center justify-between gap-2 border-b border-slate-200 pb-3 sm:mb-4" dir="rtl">
          <div className="flex min-w-0 items-center gap-2"><Printer className="h-5 w-5 shrink-0 text-amber-600" /><h3 className="truncate text-xs font-bold text-slate-900 sm:text-base">معاينة {invoiceTypeLabel(invoice.type)} A5 {isPurchaseInvoice ? 'عامودي' : 'عرضي'}</h3></div>
          <div className="flex shrink-0 items-center gap-2"><button onClick={() => window.print()} className="flex items-center gap-2 bg-amber-400 px-2 py-2 text-[11px] font-black text-slate-900 sm:px-4 sm:text-xs"><Printer className="h-4 w-4" /><span className="hidden sm:inline">طباعة أو تصدير PDF</span><span className="sm:hidden">طباعة</span></button><button onClick={onClose} aria-label="إغلاق" className="bg-slate-100 p-2 text-slate-700"><X className="h-5 w-5" /></button></div>
        </div>

        <section className={`invoice-print-sheet${isPurchaseInvoice ? ' invoice-print-sheet-portrait' : ''}`} dir="rtl">
          <header className="invoice-paper-header">
            <div className="invoice-contact" dir="ltr">
              <b>{settings.phone1 || '021 263 6064'}</b>
              <b>{settings.phone2 || '0944 866 362'}</b>
              <small>{settings.address || 'حلب - سوريا'}</small>
            </div>
            <div className="invoice-logo-mark"><img src="/logo-transparent.png" alt="شعار مجوهرات حليوي" /></div>
            <div className="invoice-brand"><small>مجوهرات</small><strong>حليوي</strong><span>عبد الحميد معين</span></div>
          </header>

          <div className="invoice-paper-meta">
            <span><b>الاسم:</b> {invoice.customerOrSupplierName || '........................'}</span>
            <span><b>التاريخ:</b> {invoice.date}</span>
            <span><b>رقم:</b> <em>{invoice.invoiceNumber}</em></span>
            <span><b>النوع:</b> {invoiceTypeLabel(invoice.type)}</span>
          </div>

          <table className="invoice-paper-table">
            <thead><tr><th>مواصفات البضاعة</th><th>الوزن</th><th>العدد</th><th>عيار</th><th>سعر غ الذهب</th><th>أجرة الصياغة</th><th>الإجمالي</th></tr></thead>
            <tbody>
              {invoice.items.map((item, index) => (
                <tr key={`${item.itemId || item.itemName}-${index}`}>
                  <td>{item.itemName}</td><td>{item.netWeightGrams.toFixed(2)} غ</td><td>1</td><td>{item.karat}</td><td>$ {item.pricePerGramUSD.toFixed(2)}</td><td>$ {item.laborFeeUSDPerGram.toFixed(2)}</td><td>$ {item.totalPriceUSD.toFixed(2)}</td>
                </tr>
              ))}
              {Array.from({ length: blankRowCount }, (_, index) => <tr key={`blank-${index}`} className="invoice-paper-blank"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>)}
              {invoice.scrapGoldItems?.map((item, index) => (
                <tr key={`trade-in-${index}`} className="invoice-paper-tradein-row">
                  <td>ذهب مستعمل عيار {item.karat}</td><td>-{item.weightGrams.toFixed(2)} غ</td><td>1</td><td>{item.karat}</td><td>$ {item.pricePerGramUSD.toFixed(2)}</td><td>-</td><td>-$ {item.totalScrapValueUSD.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="invoice-paper-bottom">
            {invoice.notes && <p className="invoice-paper-notes">{invoice.notes}</p>}
            {invoice.scrapGoldItems && invoice.scrapGoldItems.length > 0 && <p className="invoice-paper-tradein-note">ملاحظة مقايضة: تم استلام ذهب كسر {invoice.scrapGoldItems.map(item => `عيار ${item.karat} بوزن ${item.weightGrams.toFixed(2)} غ`).join('، ')}، وخصم قيمته من الحساب.</p>}
            <div className="invoice-paper-totals"><span>المجموع: <b>$ {invoice.finalTotalUSD.toFixed(2)}</b></span>{invoice.scrapTotalValueUSD > 0 && <span>مقايضة كسر: -$ {invoice.scrapTotalValueUSD.toFixed(2)}</span>}{invoice.discountUSD > 0 && <span>الحسم: $ {invoice.discountUSD.toFixed(2)}</span>}<span>المدفوع: $ {invoice.paidUSD.toFixed(2)}</span>{invoice.paidSYP > 0 && <span>مدفوع ل.س: {invoice.paidSYP.toLocaleString('ar-SY')}</span>}</div>
            <div className="invoice-paper-remaining">المتبقي على الحساب: $ {remainingDebtUSD.toFixed(2)}</div>
            <div className="invoice-paper-footer"><span>مجوهرات حليوي</span><span>{settings.phone1} {settings.phone2 ? `- ${settings.phone2}` : ''}</span><span>شكراً لثقتكم بنا</span></div>
          </div>
          <p className="invoice-paper-disclaimer">لسنا مسؤولين عن قياس الذهب بعد الاستعمال، تفقد القطعة صياغتها بعد الاستلام.</p>
        </section>

        {/* Phone only: the financial trail as a stacked section of this same surface. */}
        {financialTrail && (
          <div className="no-print mt-3 border-t-2 border-slate-900 pt-3 text-right text-[11px]" dir="rtl">{financialTrail}</div>
        )}
      </div>
    </div>
  );
};
