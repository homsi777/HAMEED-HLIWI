import React, { useEffect, useState } from 'react';
import { ArrowRight, Loader2, PencilLine } from 'lucide-react';
import { goldApi, type ApiGoldTransaction } from '../services/goldApi';

/**
 * سجل الأرصدة الافتتاحية وتعديلات وزن المحل.
 *
 * الموظفون طلبوا صفحة يقفزون إليها مباشرة كما يقلّبون دفتراً ورقياً إلى صفحة بعينها، بدل ضبط
 * مرشّحات في قائمة عامة. فهذه الشاشة لا تفعل شيئاً سوى عرض حركات النوع الواحد مرتّبة.
 *
 * حركتان مختلفتان تحملان النوع `opening` نفسه في الدفتر: تعديل على ذهب المحل (بلا طرف)، ورصيد
 * افتتاحي على عميل أو مورّد. تمييزهما هنا بوجود `partnerId` من عدمه — لأن خلطهما على الشاشة هو
 * بالضبط سوء الفهم الذي يجعل أحدهم يقيّد ذهب المحل على حساب زبون.
 */
const dateTime = (value: string) => new Date(value).toLocaleString('ar-SY', { hour12: false });

export const GoldOpeningsView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [rows, setRows] = useState<ApiGoldTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scope, setScope] = useState<'company' | 'partner'>('company');

  useEffect(() => {
    void goldApi.transactions({ type: 'opening', limit: 200 })
      .then(result => { setRows(result.items); setError(''); })
      .catch((reason: any) => setError(reason?.message || 'تعذر تحميل سجل الأرصدة الافتتاحية.'))
      .finally(() => setLoading(false));
  }, []);

  const shown = rows.filter(row => (scope === 'company' ? !row.partnerId : !!row.partnerId));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 bg-white p-3 shadow-sm sm:p-4">
        <button onClick={onBack} aria-label="رجوع" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border-2 border-slate-200 text-slate-600 transition active:scale-95">
          <ArrowRight className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-black text-slate-900 sm:text-lg">
            <PencilLine className="h-5 w-5 shrink-0 text-amber-600" />سجل الأرصدة الافتتاحية
          </h2>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">كل تعديل يدوي على وزن ذهب المحل، وكل رصيد أوزان افتتاحي سُجّل على طرف تجاري.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {([['company', 'ذهب المحل'], ['partner', 'أطراف تجارية']] as const).map(([value, label]) => (
          <button key={value} onClick={() => setScope(value)}
            className={`h-11 rounded-sm border-2 text-xs font-black transition ${scope === value ? 'border-amber-400 bg-amber-50 text-slate-900' : 'border-slate-200 bg-white text-slate-600'}`}>
            {label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="border-r-4 border-rose-500 bg-rose-50 p-3 text-sm font-bold text-rose-700">{error}</p>}

      {loading ? (
        <div className="grid place-items-center bg-white p-8 text-slate-400 shadow-sm"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : !shown.length ? (
        <p className="border border-dashed border-slate-300 bg-white p-6 text-center text-xs font-bold text-slate-500 sm:p-8">
          {scope === 'company' ? 'لم يُسجَّل أي تعديل يدوي على وزن ذهب المحل بعد.' : 'لا توجد أرصدة أوزان افتتاحية على أطراف تجارية.'}
        </p>
      ) : (
        <div className="space-y-2">
          {shown.map(row => (
            <div key={row.id} className={`border-r-4 bg-white p-3 shadow-sm ${row.status === 'reversed' ? 'border-slate-300 text-slate-400' : 'border-amber-400'}`}>
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="font-mono text-[11px] font-black text-slate-700">{row.transactionNumber}</span>
                <span className="text-[10px] text-slate-400">{row.date}</span>
              </div>
              <p className={`mt-1.5 text-xs font-bold leading-5 text-slate-800 ${row.status === 'reversed' ? 'line-through' : ''}`}>{row.description}</p>
              {row.userNote && <p className="mt-1 rounded-sm bg-slate-50 px-2 py-1.5 text-[11px] font-bold leading-5 text-slate-600">{row.userNote}</p>}
              <p className="mt-1.5 text-[10px] font-bold text-slate-400">{row.createdBy} · {dateTime(row.createdAt)}</p>
              {row.status === 'reversed' && <p className="mt-1.5 rounded-sm bg-slate-100 px-2 py-1 text-[10px] font-black text-slate-600">حركة معكوسة</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
