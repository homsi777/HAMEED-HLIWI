import React, { useEffect } from 'react';
import { Printer, X } from 'lucide-react';
import type { GeneralSettings } from '../types';
import type { ApiVoucher } from '../services/financeApi';

interface PrintVoucherModalProps {
  voucher: ApiVoucher;
  settings: GeneralSettings;
  onClose: () => void;
}

const voucherTitle = (type: ApiVoucher['type']) => {
  if (type === 'receipt') return 'سند قبض مالي';
  if (type === 'payment') return 'سند صرف مالي';
  return 'سند مصروف تشغيلي';
};

const formatAmount = (value: number, digits = 2) => value.toLocaleString('en-US', {
  minimumFractionDigits: digits,
  maximumFractionDigits: digits,
});

export const PrintVoucherModal: React.FC<PrintVoucherModalProps> = ({ voucher, settings, onClose }) => {
  const isReceipt = voucher.type === 'receipt';
  const companyName = settings.storeName?.trim() || 'حميد حليوي لتجارة الذهب والمجوهرات';
  const companySubtitle = settings.storeSubtitle?.trim() || 'بيع وشراء وصياغة الذهب والمجوهرات';

  useEffect(() => {
    const pageStyle = document.createElement('style');
    pageStyle.dataset.voucherPrintPage = 'true';
    pageStyle.textContent = '@page { size: A5 portrait; margin: 8mm; }';
    document.head.appendChild(pageStyle);
    document.body.classList.add('voucher-print-active');
    return () => {
      pageStyle.remove();
      document.body.classList.remove('voucher-print-active');
    };
  }, []);

  return (
    <div className="voucher-print-overlay fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/80 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="voucher-print-preview my-3 w-full max-w-2xl bg-white p-2 shadow-2xl sm:my-6 sm:p-4">
        <div className="no-print mb-3 flex items-center justify-between gap-2 border-b border-slate-200 pb-3" dir="rtl">
          <div className="flex min-w-0 items-center gap-2"><Printer className="h-5 w-5 shrink-0 text-amber-600" /><h3 className="truncate text-sm font-black text-slate-900">معاينة {voucherTitle(voucher.type)}</h3></div>
          <div className="flex shrink-0 items-center gap-2"><button onClick={() => window.print()} className="flex items-center gap-2 bg-amber-400 px-3 py-2 text-xs font-black text-slate-900"><Printer className="h-4 w-4" /> طباعة أو تصدير PDF</button><button onClick={onClose} aria-label="إغلاق" className="bg-slate-100 p-2 text-slate-700"><X className="h-5 w-5" /></button></div>
        </div>
        <section className={`voucher-print-sheet ${isReceipt ? 'voucher-print-receipt' : 'voucher-print-payment'}`} dir="rtl">
          <header className="voucher-paper-header">
            <div className="voucher-paper-contact">{settings.phone1 && <b dir="ltr">{settings.phone1}</b>}{settings.phone2 && <b dir="ltr">{settings.phone2}</b>}<small>{settings.address || settings.branchName || 'حلب - سوريا'}</small></div>
            <img src="/logo-transparent.png" alt="شعار الشركة" className="voucher-paper-logo" />
            <div className="voucher-paper-brand"><strong>{companyName}</strong><span>{companySubtitle}</span>{settings.branchName && <small>{settings.branchName}</small>}</div>
          </header>
          <div className="voucher-paper-title"><span>{voucherTitle(voucher.type)}</span><b>{isReceipt ? 'قبض' : 'صرف'}</b></div>
          <div className="voucher-paper-meta"><span><b>رقم السند:</b> {voucher.voucherNumber}</span><span><b>التاريخ:</b> {voucher.date}</span><span><b>الصندوق:</b> {voucher.cashboxName}</span></div>
          <div className="voucher-paper-body">
            <div className="voucher-paper-row voucher-paper-party"><b>{isReceipt ? 'استلمنا من السيد/ة:' : 'صرفنا إلى السيد/ة:'}</b><strong>{voucher.partnerName || voucher.category || 'حساب عام'}</strong></div>
            <div className="voucher-paper-amounts"><div><span>المبلغ المقبوض / المصروف</span><b>{voucher.currency === 'USD' ? `$ ${formatAmount(voucher.amount)}` : `${formatAmount(voucher.amount, 0)} ل.س`}</b></div><div><span>ما يعادله بالدولار</span><b>$ {formatAmount(voucher.amountUSD)}</b></div><div><span>ما يعادله بالليرة السورية</span><b>{formatAmount(voucher.amountSYP, 0)} ل.س</b></div></div>
            <div className="voucher-paper-row voucher-paper-statement"><b>البيان:</b><span>{voucher.statement || voucher.systemNote || 'سند مالي'}</span></div>
            {voucher.sourceDocumentNumber && <div className="voucher-paper-source">المرجع: {voucher.sourceDocumentNumber}</div>}
          </div>
          <footer className="voucher-paper-signatures"><div><b>{isReceipt ? 'توقيع المستلم' : 'توقيع الدافع'}</b><span /></div><div><b>توقيع وختم المحاسب</b><span /></div><div><b>اعتماد الإدارة</b><span /></div></footer>
          <p className="voucher-paper-footer">هذا السند وثيقة مالية معتمدة — {companyName}</p>
        </section>
      </div>
    </div>
  );
};
