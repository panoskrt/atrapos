import type { RouteSummary, SyncState } from '../routes/api';

export type RouteView = 'cards' | 'list';
export type RouteSortKey = 'modified' | 'name' | 'distance' | 'ascent' | 'pois' | 'status';
export type SortDir = 'asc' | 'desc';
export interface RouteSort {
  key: RouteSortKey;
  dir: SortDir;
}
export type RouteFilter = 'all' | 'toPush' | 'synced' | 'attention';

export const SORT_LABELS: Record<RouteSortKey, string> = {
  modified: 'Last changed',
  name: 'Name',
  distance: 'Distance',
  ascent: 'Ascent',
  pois: 'POIs',
  status: 'Status',
};

export const FILTER_LABELS: Record<RouteFilter, string> = {
  all: 'All routes',
  toPush: 'Not pushed',
  synced: 'Synced',
  attention: 'Needs attention',
};

export const isRouteView = (v: unknown): v is RouteView => v === 'cards' || v === 'list';

export const isRouteSort = (v: unknown): v is RouteSort =>
  typeof v === 'object' &&
  v !== null &&
  Object.hasOwn(SORT_LABELS, (v as RouteSort).key) &&
  ((v as RouteSort).dir === 'asc' || (v as RouteSort).dir === 'desc');

/** The direction a column sorts in when first chosen: names A–Z, everything else biggest/newest first. */
export const defaultDir = (key: RouteSortKey): SortDir => (key === 'name' ? 'asc' : 'desc');

/** Clicking the current sort column flips it; another column starts in its natural direction. */
export function nextSort(current: RouteSort, key: RouteSortKey): RouteSort {
  return current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir(key) };
}

const ATTENTION: SyncState[] = ['conflict', 'remoteNewer', 'error'];
const LOCAL_PENDING: SyncState[] = ['localOnly', 'localChanges', 'error'];

/** Something here hasn't reached Suunto yet: the route itself or one of its POIs. */
export const needsPush = (r: RouteSummary) => LOCAL_PENDING.includes(r.syncState) || r.poisPending > 0;

/** Suunto and this app disagree, or the last push failed. */
export const needsAttention = (r: RouteSummary) => ATTENTION.includes(r.syncState);

export function matchesFilter(r: RouteSummary, filter: RouteFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'toPush':
      return needsPush(r);
    case 'synced':
      return r.syncState === 'synced' && r.poisPending === 0;
    case 'attention':
      return needsAttention(r);
  }
}

/** Case- and accent-insensitive, so "pefki" finds "Péfki". */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();

/** Most urgent first when sorting by status descending. */
const STATUS_RANK: Record<SyncState, number> = {
  conflict: 5,
  remoteNewer: 4,
  error: 3,
  localChanges: 2,
  localOnly: 1,
  synced: 0,
};

const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function compare(a: RouteSummary, b: RouteSummary, key: RouteSortKey): number {
  switch (key) {
    case 'modified':
      return Date.parse(a.localModifiedAt) - Date.parse(b.localModifiedAt);
    case 'name':
      return byName.compare(a.name, b.name);
    case 'distance':
      return a.distanceM - b.distanceM;
    case 'ascent':
      return a.ascentM - b.ascentM;
    case 'pois':
      return a.poiCount - b.poiCount;
    case 'status':
      return STATUS_RANK[a.syncState] - STATUS_RANK[b.syncState] || a.poisPending - b.poisPending;
  }
}

export function filterAndSort(
  routes: readonly RouteSummary[],
  {
    query,
    filter,
    sort,
    activity = null,
  }: { query: string; filter: RouteFilter; sort: RouteSort; /** Suunto activity id, or null for any. */ activity?: number | null },
): RouteSummary[] {
  const q = fold(query.trim());
  const sign = sort.dir === 'asc' ? 1 : -1;
  return routes
    .filter(
      (r) =>
        matchesFilter(r, filter) &&
        (activity === null || r.activityIds.includes(activity)) &&
        (!q || fold(r.name).includes(q)),
    )
    .sort((a, b) => sign * compare(a, b, sort.key) || byName.compare(a.name, b.name));
}

export interface ActivityOption {
  id: number;
  name: string;
  /** Routes tagged with it (a route can have several activities). */
  count: number;
}

/** The activities the library actually uses, A–Z, for the activity filter. */
export function activityOptions(routes: readonly RouteSummary[], nameOf: (id: number) => string | undefined): ActivityOption[] {
  const counts = new Map<number, number>();
  for (const r of routes) for (const id of new Set(r.activityIds)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts]
    .map(([id, count]) => ({ id, count, name: nameOf(id) ?? `Activity ${id}` }))
    .sort((a, b) => byName.compare(a.name, b.name));
}

export interface LibraryStats {
  routes: number;
  distanceM: number;
  ascentM: number;
  pois: number;
  toPush: number;
  attention: number;
}

export function summarize(routes: readonly RouteSummary[]): LibraryStats {
  return routes.reduce<LibraryStats>(
    (s, r) => ({
      routes: s.routes + 1,
      distanceM: s.distanceM + r.distanceM,
      ascentM: s.ascentM + r.ascentM,
      pois: s.pois + r.poiCount,
      toPush: s.toPush + (needsPush(r) ? 1 : 0),
      attention: s.attention + (needsAttention(r) ? 1 : 0),
    }),
    { routes: 0, distanceM: 0, ascentM: 0, pois: 0, toPush: 0, attention: 0 },
  );
}

/** "14:05" today, "12 Oct" this year, "12 Oct 2025" before that. */
export function formatChanged(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
