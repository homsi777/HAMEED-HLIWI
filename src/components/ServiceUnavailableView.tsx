import { RefreshCw, ServerOff } from 'lucide-react';

export function ServiceUnavailableView({ connecting = false }: { connecting?: boolean }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900" dir="rtl">
      <section className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center border-t-4 border-amber-400 bg-white p-7 text-center shadow-sm">
        <div className="mb-5 flex h-14 w-14 items-center justify-center bg-slate-900 text-amber-400"><ServerOff className="h-7 w-7" /></div>
        <h1 className="text-xl font-black">{connecting ? 'جارٍ الاتصال بالخدمة' : 'الخدمة غير متاحة مؤقتاً'}</h1>
        <p className="mt-3 text-sm leading-7 text-slate-600">{connecting ? 'يتم التحقق من الجلسة والخدمة بشكل آمن.' : 'تعذر الاتصال بخدمة النظام. حفاظاً على بيانات العمل، تم إيقاف العمليات حتى تعود الخدمة.'}</p>
        {!connecting && <button type="button" onClick={() => window.location.reload()} className="mt-6 inline-flex items-center gap-2 bg-slate-900 px-4 py-2.5 text-sm font-bold text-amber-400 transition hover:bg-slate-800">
          <RefreshCw className="h-4 w-4" /> إعادة المحاولة
        </button>}
      </section>
    </main>
  );
}
