const base = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '/api/v1';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...options,
    credentials: 'include',
    headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
  });
  if (!response.ok) throw { status: response.status, ...(await response.json().catch(() => ({})) as object) };
  return response.json() as Promise<T>;
}

export type BackupRun = {
  id: string; fileName: string; sizeBytes: number; kind: 'scheduled' | 'manual';
  status: 'running' | 'completed' | 'failed'; startedAt: string; completedAt: string | null;
  errorMessage: string | null; available: boolean;
};
export type BackupHealth = {
  lastSuccessfulAt: string | null; lastSuccessfulSizeBytes: number | null;
  hoursSinceLastSuccess: number | null; stale: boolean; recentFailures: number;
  /** TASK 20 §8: false until a copy lives somewhere other than the server it protects. */
  offServerCopy: boolean;
};

export const backupsApi = {
  list: () => request<{ health: BackupHealth; runs: BackupRun[] }>('/backups'),
  create: () => request<{ id: string; fileName: string; sizeBytes: number }>('/backups', { method: 'POST' }),
  ticket: (id: string) => request<{ token: string; fileName: string; sizeBytes: number; expiresInSeconds: number }>(`/backups/${id}/ticket`, { method: 'POST' }),
  /**
   * TASK 20 §17: the download is a real navigation, not a script-built blob.
   *
   * Blob downloads are the least reliable path on mobile and the first thing to stop working
   * inside an installed PWA. Navigating to an authenticated URL lets the browser itself hand the
   * file to the Files app on iOS or Downloads on Android, which is what a phone actually needs.
   */
  downloadUrl: (token: string) => `${base}/backups/download/${token}`,
};
