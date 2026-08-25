import React from 'react';
import { ArrowRight, Recycle } from 'lucide-react';
import { UsedGoldPanel } from './UsedGoldPanel';

/**
 * كسر المقايضة — ذهب استُلم من الزبائن مقايضةً وقرار تحويله إلى مخزون مستعمل، بشاشة مستقلة.
 *
 * اللوحة تُحمّل بياناتها بنفسها وتُحدّثها بعد كل تحويل، فلم تعد بحاجة إلى إبلاغ صفحة الذمم:
 * تلك الصفحة تُعيد القراءة عند فتحها من جديد.
 */
export const UsedGoldView: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <div className="space-y-3">
    <div className="flex items-center gap-2.5 bg-white p-3 shadow-sm sm:p-4">
      <button onClick={onBack} aria-label="رجوع" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border-2 border-slate-200 text-slate-600 transition active:scale-95">
        <ArrowRight className="h-4 w-4" />
      </button>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-base font-black text-slate-900 sm:text-lg">
          <Recycle className="h-5 w-5 shrink-0 text-violet-600" />ذهب الكسر والخاشر تحت المعالجة
        </h2>
        <p className="mt-0.5 text-[11px] leading-4 text-slate-500">كسر المقايضة والخاشر المشتَرى محفوظان كذهب مستقل، ولا يتحولان إلى مخزون للبيع إلا بقرار مدير موثق.</p>
      </div>
    </div>

    <UsedGoldPanel />
  </div>
);
