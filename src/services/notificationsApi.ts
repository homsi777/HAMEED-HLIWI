const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';
const request = async <T,>(path: string, options: RequestInit = {}) => {
  const response = await fetch(`${base}${path}`, { ...options, credentials: 'include', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  if (!response.ok) throw await response.json().catch(() => ({ message: 'تعذر تفعيل الإشعارات.' }));
  return response.json() as Promise<T>;
};
const fromBase64 = (value: string) => {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
};

export const enablePushNotifications = async () => {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('هذا المتصفح لا يدعم إشعارات الهاتف.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('يلزم السماح بإشعارات الهاتف أولاً.');
  const { publicKey } = await request<{ publicKey: string | null }>('/notifications/public-key');
  if (!publicKey) throw new Error('خدمة الإشعارات غير مهيأة على الخادم بعد.');
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64(publicKey) });
  await request('/notifications/subscribe', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
};
