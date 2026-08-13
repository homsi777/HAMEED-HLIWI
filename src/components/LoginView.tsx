import { useState, type FormEvent } from 'react';
import { LockKeyhole, LogIn } from 'lucide-react';
import { infrastructureApi } from '../services/infrastructureApi';

export function LoginView({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError('');
    try { await infrastructureApi.login(username.trim(), password); await onLoggedIn(); }
    catch (reason: any) { setError(reason?.message || 'تعذر تسجيل الدخول. تحقق من البيانات وحاول مجدداً.'); }
    finally { setLoading(false); }
  };
  return <main dir="rtl" className="min-h-screen bg-slate-950 px-4 py-10 flex items-center justify-center font-sans"><section className="w-full max-w-sm border border-slate-700 bg-slate-900 p-6 shadow-2xl"><div className="mb-6 text-center"><div className="mx-auto mb-3 grid h-12 w-12 place-items-center border-2 border-amber-400 text-amber-400"><LockKeyhole className="h-6 w-6" /></div><h1 className="text-xl font-black text-amber-400">حميد حليوي للمجوهرات</h1><p className="mt-1 text-xs text-slate-400">تسجيل الدخول إلى النظام</p></div><form onSubmit={submit} className="space-y-4"><label className="block text-xs font-bold text-slate-300">اسم المستخدم<input required autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} className="mt-1.5 w-full border border-slate-600 bg-slate-800 p-3 text-right text-sm text-white outline-none focus:border-amber-400" /></label><label className="block text-xs font-bold text-slate-300">كلمة المرور<input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1.5 w-full border border-slate-600 bg-slate-800 p-3 text-right text-sm text-white outline-none focus:border-amber-400" /></label>{error && <p className="border-r-2 border-rose-500 bg-rose-950/40 p-2 text-xs text-rose-200">{error}</p>}<button disabled={loading} className="flex w-full items-center justify-center gap-2 bg-amber-400 py-3 text-sm font-black text-slate-950 disabled:opacity-60"><LogIn className="h-4 w-4" />{loading ? 'جارٍ التحقق...' : 'دخول'}</button></form></section></main>;
}
