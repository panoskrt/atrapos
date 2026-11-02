import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

export interface RouteWeatherDay {
  date: string;
  weatherCode: number;
  minTemperatureC: number;
  maxTemperatureC: number;
  precipitationProbabilityPercent: number;
  windSpeedKmh: number;
  hours: RouteWeatherHour[];
}

export interface RouteWeatherHour {
  time: string;
  weatherCode: number;
  minTemperatureC: number;
  maxTemperatureC: number;
  precipitationProbabilityPercent: number;
  windSpeedKmh: number;
}

export interface RouteWeather {
  available: boolean;
  reason: string | null;
  timeZoneId: string | null;
  forecast: RouteWeatherDay[];
}

export const routeWeatherKeys = {
  detail: (id: string) => ['weather', 'route', id] as const,
};

export function useRouteWeather(routeId: string) {
  return useQuery({
    queryKey: routeWeatherKeys.detail(routeId),
    queryFn: () => api.get<RouteWeather>(`/api/routes/${routeId}/weather`),
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });
}
