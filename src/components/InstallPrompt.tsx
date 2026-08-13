import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

export function InstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => { event.preventDefault(); setInstallEvent(event as InstallPromptEvent); };
    const clearPrompt = () => setInstallEvent(null);
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', clearPrompt);
    return () => { window.removeEventListener('beforeinstallprompt', onBeforeInstall); window.removeEventListener('appinstalled', clearPrompt); };
  }, []);

  if (!installEvent || dismissed) return null;
  const install = async () => { await installEvent.prompt(); setInstallEvent(null); };

  return <div className="fixed bottom-4 inset-x-3 z-40 mx-auto max-w-sm rounded-sm bg-slate-900 text-white border border-slate-700 shadow-2xl p-3 no-print" dir="rtl">
    <button onClick={() => setDismissed(true)} aria-label="إغلاق" className="absolute left-2 top-2 p-1 text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
    <p className="font-black text-xs text-amber-400">ثبّت النظام على هاتفك</p>
    <p className="mt-1 text-[11px] text-slate-300">استخدمه كتطبيق مستقل من الشاشة الرئيسية.</p>
    <button onClick={install} className="mt-3 w-full bg-amber-400 hover:bg-amber-300 text-slate-900 py-2 rounded-sm text-xs font-black flex justify-center items-center gap-1.5"><Download className="w-4 h-4" />تثبيت التطبيق</button>
  </div>;
}
