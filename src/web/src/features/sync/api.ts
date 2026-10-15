import { useQuery } from '@tanstack/react-query';
import { ApiError, api, apiFetch } from '../../lib/api';
import { withSuunto } from '../../lib/suuntoActivity';
import type { PoiDto, RouteDetail } from '../routes/api';

export type ConflictStrategy = 'keepMine' | 'takeTheirs' | 'saveCopy';

export interface RemoteRoute {
  name: string | null;
  distanceM: number;
  modified: string | null;
}

export interface RoutePushResponse {
  outcome: 'pushed' | 'conflict';
  reason: 'remote_changed' | 'remote_missing' | null;
  remote: RemoteRoute | null;
  route: RouteDetail;
}

export interface PoiPushResult {
  id: string;
  name: string;
  status: 'created' | 'updated' | 'failed';
  message: string | null;
}

export interface RefreshSummary {
  routesAdded: number;
  routesUpdated: number;
  routeConflicts: number;
  poisAdded: number;
  poisUpdated: number;
  poiConflicts: number;
  refreshedAt: string;
}

export interface PoiListItem {
  poi: PoiDto;
  routeId: string | null;
  routeName: string | null;
}

/** A 409 from push is an expected outcome (conflict), not an error. */
export function pushRoute(id: string): Promise<RoutePushResponse> {
  return withSuunto('Pushing the route to Suunto…', async () => {
    try {
      return await api.post<RoutePushResponse>(`/api/routes/${id}/push`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.body) return e.body as RoutePushResponse;
      throw e;
    }
  });
}

export function resolveConflict(id: string, strategy: ConflictStrategy) {
  return withSuunto('Updating the route with Suunto…', () =>
    api.post<{ result: RoutePushResponse; copyId: string | null }>(`/api/routes/${id}/resolve`, { strategy }),
  );
}

export function pushRoutePois(id: string) {
  return withSuunto('Pushing POIs to Suunto…', () =>
    api.post<{ results: PoiPushResult[]; pois: PoiDto[] }>(`/api/routes/${id}/pois/push`),
  );
}

export function pushPois(ids: string[] | null) {
  const what = ids === null ? 'POIs' : ids.length === 1 ? '1 POI' : `${ids.length} POIs`;
  return withSuunto(`Pushing ${what} to Suunto…`, () => api.post<{ results: PoiPushResult[] }>('/api/pois/push', { ids }));
}

export function refreshFromSuunto() {
  return withSuunto('Fetching routes and POIs from Suunto…', () =>
    apiFetch<RefreshSummary>('/api/suunto/refresh', { method: 'POST' }),
  );
}

export function deletePoi(id: string) {
  return api.delete<void>(`/api/pois/${id}`);
}

/** Deletes several POIs locally (tombstones); Suunto keeps any it already has. */
export function deletePois(ids: string[]) {
  return api.post<{ deleted: number }>('/api/pois/delete', { ids });
}

export const allPoisKey = ['pois'] as const;

export function useAllPois() {
  return useQuery({ queryKey: allPoisKey, queryFn: () => api.get<PoiListItem[]>('/api/pois') });
}

/** Human message for sync errors, including "sign in again". */
export function syncErrorMessage(e: unknown): { message: string; signIn: boolean } {
  if (e instanceof ApiError) {
    if (e.code === 'suunto_reauth' || e.status === 401) return { message: 'Your Suunto sign-in has expired.', signIn: true };
    return { message: e.message, signIn: false };
  }
  return { message: e instanceof Error ? e.message : 'Something went wrong.', signIn: false };
}

export function summarizeRefresh(s: RefreshSummary): string {
  const parts = [
    s.routesAdded && `${s.routesAdded} new ${s.routesAdded === 1 ? 'route' : 'routes'}`,
    s.routesUpdated && `${s.routesUpdated} updated`,
    s.routeConflicts && `${s.routeConflicts} with conflicts`,
    s.poisAdded && `${s.poisAdded} new ${s.poisAdded === 1 ? 'POI' : 'POIs'}`,
    s.poisUpdated && `${s.poisUpdated} POIs updated`,
    s.poiConflicts && `${s.poiConflicts} POI conflicts`,
  ].filter(Boolean);
  return parts.length ? `From Suunto: ${parts.join(', ')}.` : 'Everything is up to date with Suunto.';
}
