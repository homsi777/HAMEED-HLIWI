import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Database, Download, ShieldAlert } from 'lucide-react';
import { backupsApi, type BackupHealth, type BackupRun } from '../services/backupsApi';

// TASK 20: the backup panel.
//
// It is deliberately plain. The only things a manager needs from this screen are: did a backup
// run, can I take one now, and can I keep a copy. There is no restore button — a restore replaces
// the entire database, and behind a tap on a phone that is a "destroy everything" button with a
// friendly label and no undo. Recovery is a written procedure, not a control.

const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} م.ب` : `${Math.round(bytes / 1024)} ك.ب`;
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('ar-EG') : '—';

export const BackupPanel: React.FC = () => {
  const [health, setHealth] = useState<BackupHealth | null>(null);
  const [runs, setRuns] = useState<BackupRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try { const data = await backupsApi.list(); setHealth(data.health); setRuns(data.runs); setError(''); }
    catch (reason: any) { setError(reason?.status === 403 ? 'النسخ الاحتياطي متاح للمدير العام فقط.' : reason?.message || 'تعذر قراءة حالة النسخ الاحتياطي.'); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const take = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await backupsApi.create();
      setNotice(`تم إنشاء نسخة بحجم ${size(created.sizeBytes)}.`);
      await load();
    } catch (reason: any) {
      setError(reason?.message || 'تعذر إنشاء النسخة الاحتياطية.');
    } finally { setBusy(false); }
  };

  const download = async (run: BackupRun) => {
    setError(''); setNotice('');
    // §20: the size is stated before anything starts, because a manager on mobile data deserves
    // to know what they are about to pull down.
    if (!window.confirm(`تنزيل «${run.fileName}» بحجم ${size(run.sizeBytes)}؟\n\nهذا الملف يحوي كامل بيانات المحل — كل عميل ورصيد وسعر. احفظه في مكان تسيطر عليه.`)) return;
    try {
      const ticket = await backupsApi.ticket(run.id);
      // §17/§21: a real navigation. iOS puts the file in «الملفات» and Android in «التنزيلات»;
      // the browser handles it, which a script-built blob cannot be relied on to do in a PWA.
      window.location.href = backupsApi.downloadUrl(ticket.token);
      setNotice('بدأ التنزيل — على آيفون يُحفظ في تطبيق «الملفات»، وعلى أندرويد في «التنزيلات».');
    } catch (reason: any) {
      setError(reason?.message || 'تعذر تجهيز رابط التنزيل.');
    }
  };

  return (
    <section className="rounded-sm border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Database className="h-4 w-4 text-amber-600" />
        <h3 className="text-sm font-black text-slate-900">النسخ الاحتياطي والاستعادة</h3>
      </div>

      {error && <p className="mb-3 rounded-sm border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-bold text-rose-700">{error}</p>}
      {notice && <p className="mb-3 rounded-sm border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-800">{notice}</p>}

      {health && (
        <div className="mb-3 space-y-2">
          <div className={`rounded-sm border px-3 py-2.5 text-[11px] font-bold ${health.stale ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
            {health.lastSuccessfulAt
              ? <>آخر نسخة ناجحة: {when(health.lastSuccessfulAt)}{health.stale && ' — مضى عليها أكثر من يومين'}</>
              : 'لا توجد نسخة ناجحة بعد.'}
            {health.recentFailures > 0 && <span className="block mt-1">محاولات فاشلة خلال أسبوع: {health.recentFailures}</span>}
          </div>

          {/* §8: the honest one. A copy on the machine it protects survives a bad migration and
              not a dead disk, and pretending otherwise would be the most dangerous thing here. */}
          {!health.offServerCopy && (
            <div className="flex items-start gap-2 rounded-sm border border-amber-300 bg-amber-50 px-3 py-2.5 text-[11px] font-bold text-amber-900">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>النسخ محفوظة على الخادم نفسه فقط. هذا يحميك من خطأ في التحديث، ولا يحميك من تعطّل الخادم — احتفظ بنسخة خارجه.</span>
            </div>
          )}
        </div>
      )}

      <button onClick={() => void take()} disabled={busy}
        className="mb-3 w-full rounded-sm bg-slate-900 px-4 py-2.5 text-xs font-black text-amber-400 disabled:opacity-60">
        {busy ? 'جارٍ إنشاء النسخة...' : 'إنشاء نسخة احتياطية الآن'}
      </button>

      <div className="space-y-1.5">
        {runs.length === 0 && <p className="rounded-sm bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-400">لا توجد نسخ مسجّلة بعد.</p>}
        {runs.map(run => (
          <div key={run.id} className={`flex items-center justify-between gap-2 border-r-4 ${run.status === 'failed' ? 'border-r-rose-500' : run.kind === 'scheduled' ? 'border-r-slate-300' : 'border-r-amber-400'} bg-white px-2.5 py-2 shadow-sm`}>
            <div className="min-w-0">
              <p className="truncate font-mono text-[11px] font-black text-slate-800">{run.fileName}</p>
              <p className="text-[10px] font-bold text-slate-400">
                {when(run.startedAt)} · {run.kind === 'scheduled' ? 'مجدولة' : 'يدوية'}
                {run.status === 'completed' ? ` · ${size(run.sizeBytes)}` : run.status === 'failed' ? ' · فشلت' : ' · قيد التنفيذ'}
              </p>
            </div>
            {run.available
              ? <button onClick={() => void download(run)} aria-label={`تنزيل ${run.fileName}`}
                  className="shrink-0 rounded-sm border border-slate-200 bg-white p-2 text-slate-700"><Download className="h-4 w-4" /></button>
              : <span className="shrink-0 text-[10px] font-bold text-slate-300">غير متاحة</span>}
          </div>
        ))}
      </div>

      {/* §24: recovery is a documented procedure, never a control on this screen. */}
      <p className="mt-3 flex items-start gap-1.5 text-[10px] font-bold text-slate-400">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
        <span>الاستعادة إجراء موثّق يُنفَّذ على الخادم، وليست زراً هنا — لأنها تستبدل قاعدة البيانات كاملة بلا تراجع.</span>
      </p>
    </section>
  );
};
