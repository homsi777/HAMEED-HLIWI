import React, { useEffect, useState } from 'react';
import { Fingerprint, LockKeyhole, ShieldCheck } from 'lucide-react';

const encode = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
const supported = () => window.isSecureContext && 'PublicKeyCredential' in window && !!navigator.credentials;

export const BiometricGate: React.FC<{ userId: string; children: React.ReactNode }> = ({ userId, children }) => {
  const credentialKey = `HAMEED_BIOMETRIC_CREDENTIAL_${userId}`;
  const dismissedKey = `HAMEED_BIOMETRIC_DISMISSED_${userId}`;
  const [credentialId, setCredentialId] = useState(() => localStorage.getItem(credentialKey));
  const [showSetup, setShowSetup] = useState(() => supported() && !localStorage.getItem(credentialKey) && !localStorage.getItem(dismissedKey));
  const [locked, setLocked] = useState(() => !!localStorage.getItem(credentialKey));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const lockWhenHidden = () => { if (document.visibilityState === 'hidden' && credentialId) setLocked(true); };
    document.addEventListener('visibilitychange', lockWhenHidden);
    return () => document.removeEventListener('visibilitychange', lockWhenHidden);
  }, [credentialId]);

  const enroll = async () => {
    if (!supported()) return setMessage('هذا الجهاز أو المتصفح لا يدعم البصمة أو Face ID.');
    setBusy(true); setMessage('');
    try {
      const result = await navigator.credentials.create({ publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'حميد حليوي للذهب والمجوهرات', id: location.hostname },
        user: { id: new TextEncoder().encode(userId), name: `user-${userId}`, displayName: 'مستخدم حميد حليوي' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, timeout: 60000, attestation: 'none',
      } }) as PublicKeyCredential | null;
      if (!result) throw new Error('لم يتم إنشاء اعتماد البصمة.');
      const id = encode(result.rawId); localStorage.setItem(credentialKey, id); localStorage.removeItem(dismissedKey);
      setCredentialId(id); setShowSetup(false); setLocked(false);
    } catch (error: any) { setMessage(error?.name === 'NotAllowedError' ? 'تم إلغاء التحقق بالبصمة أو Face ID.' : 'تعذر تفعيل قفل الجهاز.'); }
    finally { setBusy(false); }
  };

  const unlock = async () => {
    if (!credentialId) return;
    setBusy(true); setMessage('');
    try {
      const result = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id: decode(credentialId).buffer }], userVerification: 'required', timeout: 60000 } }) as PublicKeyCredential | null;
      if (!result || encode(result.rawId) !== credentialId) throw new Error('التحقق غير صالح.');
      setLocked(false);
    } catch { setMessage('تعذر فتح التطبيق. استخدم بصمة أو Face ID المسجل على هذا الجهاز.'); }
    finally { setBusy(false); }
  };

  const later = () => { localStorage.setItem(dismissedKey, '1'); setShowSetup(false); };
  if (!supported()) return <>{children}</>;
  return <>{children}{(showSetup || locked) && <div className="fixed inset-0 z-[200] grid place-items-center bg-slate-950/90 p-5 text-center backdrop-blur-sm"><div className="w-full max-w-sm border-2 border-amber-400 bg-white p-6 shadow-2xl"><div className="mx-auto mb-4 grid h-16 w-16 place-items-center bg-slate-900 text-amber-400"><Fingerprint className="h-9 w-9" /></div><h2 className="text-lg font-black text-slate-900">{locked ? 'التطبيق مقفل' : 'حماية هذا الجهاز'}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{locked ? 'استخدم البصمة أو Face ID لفتح التطبيق.' : 'فعّل قفل البصمة أو Face ID لهذا الجهاز لحماية الحساب عند فتح التطبيق أو العودة إليه.'}</p>{message && <p className="mt-3 text-xs font-bold text-rose-600">{message}</p>}<button disabled={busy} onClick={() => void (locked ? unlock() : enroll())} className="mt-5 flex w-full items-center justify-center gap-2 bg-amber-400 px-4 py-3 text-sm font-black text-slate-900 disabled:opacity-60"><ShieldCheck className="h-5 w-5" />{busy ? 'جارٍ التحقق...' : locked ? 'فتح بالبصمة أو Face ID' : 'تفعيل البصمة أو Face ID'}</button>{!locked && <button disabled={busy} onClick={later} className="mt-3 text-xs font-bold text-slate-500">ليس الآن</button>}<div className="mt-4 flex items-center justify-center gap-1 text-[10px] text-slate-400"><LockKeyhole className="h-3 w-3" />يُحفظ اعتماد البصمة داخل هذا الجهاز فقط</div></div></div>}</>;
};
