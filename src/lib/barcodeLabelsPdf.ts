import { jsPDF } from 'jspdf';
import JsBarcode from 'jsbarcode';

type BarcodeItem = { code: string };

// One PDF page equals one thermal label: 20 mm wide × 10 mm high.
export const downloadBarcodeLabelsPdf = (items: BarcodeItem[]) => {
  if (!items.length) return;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [20, 10], compress: true });
  items.forEach((item, index) => {
    if (index) pdf.addPage([20, 10], 'landscape');
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, item.code, { format: 'CODE128', displayValue: false, margin: 0, width: 1.35, height: 30 });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 1, 0.7, 18, 6.1, undefined, 'FAST');
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(7);
    pdf.text(item.code, 10, 9.1, { align: 'center' });
  });
  pdf.save(`gold-barcodes-${new Date().toISOString().slice(0, 10)}.pdf`);
};
