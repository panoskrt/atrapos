import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SurfacePanel } from './SurfacePanel';

afterEach(() => vi.unstubAllGlobals());

function renderPanel(isDraft = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SurfacePanel routeId="route-1" isDraft={isDraft} />
    </QueryClientProvider>,
  );
}

describe('SurfacePanel', () => {
  it('shows each surface distance and percentage from OpenStreetMap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        totalDistanceKm: 10,
        asphalt: { distanceKm: 4.25, percent: 42.5 },
        offRoad: { distanceKm: 3.5, percent: 35 },
        path: { distanceKm: 1.25, percent: 12.5 },
        unclassifiedDistanceKm: 1,
        unclassifiedPercent: 10,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    ));

    renderPanel();

    expect(await screen.findByText('4.3 km · 42.5%')).toBeInTheDocument();
    expect(screen.getByText('3.5 km · 35.0%')).toBeInTheDocument();
    expect(screen.getByText('1.3 km · 12.5%')).toBeInTheDocument();
    expect(screen.getByText('1.0 km · 10.0%')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OpenStreetMap' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/copyright',
    );
  });

  it('requires a saved route and does not make a request for drafts', () => {
    renderPanel(true);

    expect(screen.getByText('Save the route to calculate its surface breakdown.')).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
