import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

export type SegmentMode = 'snap' | 'freehand';
export type SyncState = 'localOnly' | 'synced' | 'localChanges' | 'remoteNewer' | 'conflict' | 'error';
export type RouteSource = 'drawn' | 'gpx' | 'fitCourse' | 'fitActivity' | 'suunto';

export interface ControlPointDto {
  lon: number;
  lat: number;
  modeToNext: SegmentMode;
  /** Cached line from this point to the next: [lon, lat, ele|null][] */
  segment?: (number | null)[][] | null;
}

export interface RouteDetail {
  id: string;
  name: string;
  description: string | null;
  activityIds: number[];
  turnWaypointsEnabled: boolean;
  routingProfile: string;
  source: RouteSource;
  syncState: SyncState;
  suuntoRouteId: string | null;
  distanceM: number;
  ascentM: number;
  descentM: number;
  hasElevation: boolean;
  controlPoints: ControlPointDto[];
  pois: PoiDto[];
  createdAt: string;
  localModifiedAt: string;
}

export interface PoiDto {
  id: string;
  name: string;
  description: string | null;
  poiType: number;
  lon: number;
  lat: number;
  ele: number | null;
  distanceAlongM: number | null;
  syncState: SyncState;
  suuntoPoiKey: string | null;
}

export interface PoiInput {
  id: string;
  name: string;
  description: string | null;
  poiType: number;
  lon: number;
  lat: number;
  ele: number | null;
}

export interface RouteSummary {
  id: string;
  name: string;
  distanceM: number;
  ascentM: number;
  activityIds: number[];
  source: RouteSource;
  syncState: SyncState;
  poiCount: number;
  /** POIs not (or not fully) on Suunto. */
  poisPending: number;
  localModifiedAt: string;
  preview: [number, number][];
}

export interface UpdateRouteRequest {
  name: string;
  description: string | null;
  activityIds: number[];
  turnWaypointsEnabled: boolean;
  routingProfile: string;
  controlPoints: ControlPointDto[];
  pois: PoiInput[];
}

export interface RoutingProfile {
  id: string;
  label: string;
  group: string;
}

export function useRoutingProfiles() {
  return useQuery({
    queryKey: ['lookups', 'routing-profiles'],
    queryFn: () => api.get<RoutingProfile[]>('/api/routing/profiles'),
    staleTime: Infinity,
  });
}

export interface ActivityType {
  id: number;
  name: string;
  watchSupported: boolean;
}

export const routeKeys = {
  all: ['routes'] as const,
  detail: (id: string) => ['routes', id] as const,
};

export function useRoutes() {
  return useQuery({ queryKey: routeKeys.all, queryFn: () => api.get<RouteSummary[]>('/api/routes') });
}

export function useRoute(id: string) {
  return useQuery({
    queryKey: routeKeys.detail(id),
    queryFn: () => api.get<RouteDetail>(`/api/routes/${id}`),
    // The editor owns the state after loading; never refetch underneath it.
    staleTime: Infinity,
    gcTime: 0,
  });
}

export function useCreateRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateRouteRequest) => api.post<RouteDetail>('/api/routes', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: routeKeys.all, exact: true }),
  });
}

export function useDeleteRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/routes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: routeKeys.all, exact: true }),
  });
}

/** Deletes several routes (and their POIs) locally; Suunto keeps any it already has. */
export function useDeleteRoutes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<{ deleted: number }>('/api/routes/delete', { ids }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: routeKeys.all, exact: true });
      void qc.invalidateQueries({ queryKey: ['pois'] });
    },
  });
}

export function splitRoute(id: string, pointIndex: number) {
  return api.post<{ route: RouteDetail; created: RouteDetail }>(`/api/routes/${id}/split`, { pointIndex });
}

export function gpxDownloadUrl(id: string) {
  return `/api/routes/${id}/gpx`;
}

export function saveRoute(id: string, body: UpdateRouteRequest) {
  return api.put<RouteDetail>(`/api/routes/${id}`, body);
}

export function useActivityTypes() {
  return useQuery({
    queryKey: ['lookups', 'activity-types'],
    queryFn: () => api.get<ActivityType[]>('/api/lookups/activity-types'),
    staleTime: Infinity,
  });
}

/** Activities offered as one-tap chips; everything else is in the "More" list. */
export const COMMON_ACTIVITY_IDS = [11, 22, 1, 70, 10, 2, 0, 99, 31, 3];

export const syncStateLabel: Record<SyncState, string> = {
  localOnly: 'Local only',
  synced: 'Synced',
  localChanges: 'Changed locally',
  remoteNewer: 'Newer on Suunto',
  conflict: 'Conflict',
  error: 'Push failed',
};
