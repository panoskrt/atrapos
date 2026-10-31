import type { SyncState } from './api';
import { syncStates } from './api';

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '–' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export const fmtKm = (m: number) => `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;

export const syncLabel = (s: SyncState) => syncStates.find((x) => x.id === s)?.label ?? s;

/** Google accounts have no readable name in the database, so they are identified by a short id. */
export function ownerLabel(owner: string | null | undefined, userId: string): string {
  return owner ?? `Google user ${userId.slice(0, 8)}`;
}

export const shortId = (id: string) => id.slice(0, 8);
