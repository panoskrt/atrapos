import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface SurfaceAmount {
  distanceKm: number;
  percent: number;
}

export interface RouteSurface {
  totalDistanceKm: number;
  asphalt: SurfaceAmount;
  offRoad: SurfaceAmount;
  path: SurfaceAmount;
  unclassifiedDistanceKm: number;
  unclassifiedPercent: number;
}

export const routeSurfaceKeys = {
  detail: (id: string) => ['surface', 'route', id] as const,
};

export function useRouteSurface(routeId: string, enabled: boolean) {
  return useQuery({
    queryKey: routeSurfaceKeys.detail(routeId),
    queryFn: () => api.get<RouteSurface>(`/api/routes/${routeId}/surface`),
    enabled,
    staleTime: 12 * 60 * 60 * 1000,
    retry: 1,
  });
}
