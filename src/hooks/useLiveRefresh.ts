import { useEffect, useRef } from 'react';

/**
 * Keeps a manager screen current without a manual refresh.
 *
 * The backend emits realtime events after every commit, but the production edge does not
 * reliably upgrade WebSocket connections, so the screen also refreshes on a light interval.
 * Polling pauses while the tab is hidden and fires once immediately when it comes back, so a
 * phone left in a pocket does not spend the morning re-querying.
 */
export function useLiveRefresh(refresh: () => void | Promise<void>, intervalMs = 20000, enabled = true) {
  const saved = useRef(refresh);
  saved.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const tick = () => { if (document.visibilityState === 'visible') void saved.current(); };
    const start = () => { stop(); timer = setInterval(tick, intervalMs); };
    const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { void saved.current(); start(); }
      else stop();
    };
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [intervalMs, enabled]);
}
