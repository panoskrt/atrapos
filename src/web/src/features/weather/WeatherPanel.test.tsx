import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeatherPanel } from './WeatherPanel';

afterEach(() => vi.unstubAllGlobals());

function renderPanel(isDraft = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WeatherPanel routeId="route-1" isDraft={isDraft} />
    </QueryClientProvider>,
  );
}

describe('WeatherPanel', () => {
  it('displays seven daily forecasts and route-wide weather ranges', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            available: true,
            reason: null,
            timeZoneId: 'Europe/Helsinki',
            forecast: Array.from({ length: 7 }, (_, i) => ({
                date: `2026-10-${String(16 + i).padStart(2, '0')}`,
                weatherCode: i === 0 ? 61 : 0,
                minTemperatureC: 4.6,
                maxTemperatureC: 13.4,
                precipitationProbabilityPercent: 70,
                windSpeedKmh: 22,
                hours: Array.from({ length: 8 }, (_, hour) => ({
                  time: `2026-10-${String(16 + i).padStart(2, '0')}T${String(hour * 3).padStart(2, '0')}:00:00Z`,
                  weatherCode: 61,
                  minTemperatureC: 6,
                  maxTemperatureC: 8,
                  precipitationProbabilityPercent: 40,
                  windSpeedKmh: 12,
                })),
              })),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    renderPanel();

    expect(await screen.findByText('Rain')).toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(7);
    expect(screen.getAllByText('5°C – 13°C')).toHaveLength(7);
    expect(screen.getByText(/Europe\/Helsinki/)).toBeInTheDocument();
    expect(screen.getAllByText(/03:00/)).toHaveLength(7);
    expect(screen.getAllByText('6°C–8°C')).toHaveLength(56);
    expect(screen.getAllByText('70%')).toHaveLength(7);
    expect(screen.getAllByText('22 km/h')).toHaveLength(7);
    expect(screen.getByRole('link', { name: 'Open-Meteo' })).toHaveAttribute('href', 'https://open-meteo.com/');
  });

  it('asks users to save a draft before showing weather', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderPanel(true);

    expect(screen.getByText('Save the route to see the forecast. Weather is based on the saved route geometry.')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
