import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export type SyncState = 'localOnly' | 'synced' | 'localChanges' | 'remoteNewer' | 'conflict' | 'error';
export type RouteSource = 'drawn' | 'gpx' | 'fitCourse' | 'fitActivity' | 'suunto';

export const syncStates: { id: SyncState; label: string }[] = [
  { id: 'localOnly', label: 'Local only' },
  { id: 'synced', label: 'Synced' },
  { id: 'localChanges', label: 'Local changes' },
  { id: 'remoteNewer', label: 'Remote newer' },
  { id: 'conflict', label: 'Conflict' },
  { id: 'error', label: 'Error' },
];

export const routeSources: { id: RouteSource; label: string }[] = [
  { id: 'drawn', label: 'Drawn' },
  { id: 'gpx', label: 'GPX' },
  { id: 'fitCourse', label: 'FIT course' },
  { id: 'fitActivity', label: 'FIT activity' },
  { id: 'suunto', label: 'Suunto' },
];

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminStats {
  users: number;
  routes: number;
  pois: number;
  deletedPois: number;
  sourceFiles: number;
  sourceFileBytes: number;
  syncLogEntries: number;
  errorLogEntries: number;
  errorsLast24h: number;
  databaseBytes: number;
  routesBySyncState: Record<string, number>;
  poisBySyncState: Record<string, number>;
}

export interface AdminUser {
  id: string;
  suuntoUsername: string | null;
  googleAccount: boolean;
  suuntoConnected: boolean;
  createdAt: string;
  lastSuuntoRefreshAt: string | null;
  defaultMap: string;
  units: string;
  theme: string;
  design: string;
  routeCount: number;
  poiCount: number;
}

export interface AdminRouteRow {
  id: string;
  userId: string;
  owner: string | null;
  name: string;
  source: RouteSource;
  syncState: SyncState;
  distanceM: number;
  ascentM: number;
  descentM: number;
  poiCount: number;
  suuntoRouteId: string | null;
  createdAt: string;
  localModifiedAt: string;
}

export interface AdminSourceFile {
  id: string;
  routeId: string;
  routeName: string | null;
  fileName: string;
  kind: RouteSource;
  sizeBytes: number;
  uploadedAt: string;
}

export interface AdminRouteDetail {
  row: AdminRouteRow;
  description: string | null;
  activityIds: number[];
  turnWaypointsEnabled: boolean;
  routingProfile: string;
  simplifyToleranceM: number;
  hasElevation: boolean;
  geometryPoints: number;
  controlPointCount: number;
  suuntoRevision: number | null;
  suuntoModifiedAt: string | null;
  lastPushedAt: string | null;
  lastPushedHash: string | null;
  sourceFiles: AdminSourceFile[];
}

export interface AdminPoiRow {
  id: string;
  userId: string;
  owner: string | null;
  routeId: string | null;
  routeName: string | null;
  name: string;
  poiType: number;
  lat: number;
  lon: number;
  elevationM: number | null;
  distanceAlongM: number | null;
  syncState: SyncState;
  suuntoPoiKey: string | null;
  createdAt: string;
  localModifiedAt: string;
  deletedAt: string | null;
}

export interface AdminPoiDetail {
  row: AdminPoiRow;
  description: string | null;
  activityId: number | null;
  suuntoModifiedAt: string | null;
  lastPushedAt: string | null;
  lastPushedHash: string | null;
}

export interface AdminSyncLog {
  id: number;
  userId: string;
  owner: string | null;
  entity: string;
  entityId: string | null;
  operation: string;
  httpStatus: number | null;
  message: string | null;
  at: string;
}

export interface AdminErrorLog {
  id: number;
  at: string;
  userId: string | null;
  username: string | null;
  operation: string;
  exceptionType: string | null;
  message: string;
  httpStatus: number | null;
  requestPath: string | null;
}

export interface EditableSetting {
  value: string;
  configuredValue: string;
  overridden: boolean;
}

export interface AdminConfig {
  allowedGoogleEmails: EditableSetting;
  allowedSuuntoUsernames: EditableSetting;
  adminGoogleEmails: string;
  adminSuuntoUsernames: string;
  entries: { key: string; value: string | null; secret: boolean }[];
}

type Params = Record<string, string | number | boolean | undefined | null>;

export function queryString(params: Params): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export const adminPath = (path: string, params: Params = {}) => `/api/admin/${path}${queryString(params)}`;

/** A page of any admin collection; keeps the previous page on screen while the next one loads. */
export function useAdminPage<T>(path: string, params: Params) {
  return useQuery({
    queryKey: ['admin', path, params],
    queryFn: () => api.get<Paged<T>>(adminPath(path, params)),
    placeholderData: keepPreviousData,
  });
}

export function useAdminItem<T>(path: string | null) {
  return useQuery({
    queryKey: ['admin', path],
    queryFn: () => api.get<T>(adminPath(path!)),
    enabled: path !== null,
  });
}

/** A write to the admin API; every admin query is refreshed afterwards. */
export function useAdminMutation<TResult = void, TBody = void>(
  run: (body: TBody) => Promise<TResult>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  });
}

export const adminApi = {
  put: <T>(path: string, body: unknown) => api.put<T>(adminPath(path), body),
  post: <T>(path: string, body?: unknown) => api.post<T>(adminPath(path), body),
  delete: (path: string) => api.delete<void>(adminPath(path)),
};

export function useLookups() {
  const poiTypes = useQuery({
    queryKey: ['lookups', 'poi-types'],
    queryFn: () => api.get<{ id: number; name: string }[]>('/api/lookups/poi-types'),
    staleTime: Infinity,
  });
  const activities = useQuery({
    queryKey: ['lookups', 'activity-types'],
    queryFn: () => api.get<{ id: number; name: string }[]>('/api/lookups/activity-types'),
    staleTime: Infinity,
  });
  const profiles = useQuery({
    queryKey: ['lookups', 'routing-profiles'],
    queryFn: () => api.get<{ id: string; label: string; group: string }[]>('/api/routing/profiles'),
    staleTime: Infinity,
  });
  return {
    poiTypes: poiTypes.data ?? [],
    activities: activities.data ?? [],
    profiles: profiles.data ?? [],
  };
}
