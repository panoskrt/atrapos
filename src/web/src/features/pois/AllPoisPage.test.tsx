import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { PoiDto } from '../routes/api';
import type { PoiListItem } from '../sync/api';
import { AllPoisPage } from './AllPoisPage';

const poi = (p: Partial<PoiDto> & Pick<PoiDto, 'id' | 'name'>): PoiDto => ({
  description: null,
  poiType: 26,
  lon: 24.0,
  lat: 60.0,
  ele: null,
  distanceAlongM: null,
  syncState: 'localOnly',
  suuntoPoiKey: null,
  ...p,
});

const items: PoiListItem[] = [
  {
    poi: poi({ id: 'p1', name: 'Spring', description: 'Cold water\nall year', poiType: 12, lon: 24.01, lat: 60.002, ele: 412, syncState: 'synced' }),
    routeId: 'r1',
    routeName: 'Ridge loop',
  },
  { poi: poi({ id: 'p2', name: 'Viewpoint', lon: 24.2, lat: 60.1 }), routeId: 'r1', routeName: 'Ridge loop' },
  { poi: poi({ id: 'p3', name: 'Hut', lon: 25.0, lat: 61.0 }), routeId: null, routeName: null },
];

function renderPage(suuntoConnected = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body =
        url === '/api/me'
          ? { username: 'test-user', suuntoMode: 'Live', suuntoConnected }
          : url === '/api/pois'
            ? items
            : [{ id: 12, name: 'Water' }, { id: 26, name: 'POI' }];
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AllPoisPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Each test clicks at most one pin: Leaflet turns two quick clicks on the map into a double-click, which jsdom
// (no layout, no pointer coordinates) can't place.
const pin = (name: string) => screen.getByRole('button', { name });

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('AllPoisPage', () => {
  it('shows a POI description in the list when it has one', async () => {
    renderPage();
    const spring = (await screen.findByText('Spring')).closest('li')!;
    expect(within(spring).getByText(/Cold water\s+all year/)).toBeInTheDocument();
    const viewpoint = screen.getByText('Viewpoint').closest('li')!;
    expect(viewpoint.textContent).not.toMatch(/Cold water/);
  });

  it('shows every shown POI on the map, and remembers the choice', async () => {
    renderPage();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Map' }));

    const map = screen.getByRole('region', { name: 'POI map' });
    expect(within(map).getAllByRole('button', { name: /^(Spring|Viewpoint|Hut)$/ })).toHaveLength(3);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(localStorage.getItem('rpm.pois.view')).toBe('"map"');
  });

  it('only maps the POIs that match the search', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Map' }));
    await user.type(screen.getByLabelText('Search POIs'), 'hut');

    expect(pin('Hut')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Spring' })).not.toBeInTheDocument();
  });

  it('opens a POI’s details from its map pin', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Map' }));
    await user.click(pin('Spring'));

    const details = screen.getByRole('region', { name: 'Spring' });
    // The type names arrive separately from the POIs.
    await within(details).findByText('Water');
    expect(within(details).getByText(/Cold water\s+all year/)).toBeInTheDocument();
    const facts = Object.fromEntries(
      within(details)
        .getAllByRole('term')
        .map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]),
    );
    expect(facts).toEqual({
      Type: 'Water',
      Elevation: '412 m',
      Route: 'Ridge loop',
      Sync: 'Synced',
      Coordinates: '60.00200, 24.01000',
    });
    expect(within(details).getByRole('link', { name: 'Ridge loop' })).toHaveAttribute('href', '/routes/r1');
  });

  it('shows what a standalone POI lacks, and closes its details', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Map' }));
    await user.click(pin('Hut'));
    const hut = screen.getByRole('region', { name: 'Hut' });
    expect(within(hut).getByText('Not on a route')).toBeInTheDocument();
    expect(within(hut).getByText('Unknown')).toBeInTheDocument();
    expect(within(hut).getByText('Not pushed')).toBeInTheDocument();

    await user.click(within(hut).getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('region', { name: 'Hut' })).not.toBeInTheDocument();
  });

  it('highlights the POIs selected in the list, and selects from the map too', async () => {
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: 'Select Viewpoint' }));
    await user.click(screen.getByRole('button', { name: 'Map' }));

    const isOutlined = (name: string) => pin(name).className.includes('pinSelected');
    expect(isOutlined('Viewpoint')).toBe(true);
    expect(isOutlined('Spring')).toBe(false);

    await user.click(pin('Spring'));
    await user.click(within(screen.getByRole('region', { name: 'Spring' })).getByRole('checkbox', { name: 'Select Spring' }));
    expect(isOutlined('Spring')).toBe(true);
    expect(screen.getByText(/2 POIs selected/i)).toBeInTheDocument();
  });

  it('leaves out Suunto type and sync state when Suunto is not connected', async () => {
    renderPage(false);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Map' }));
    await user.click(pin('Spring'));

    const details = screen.getByRole('region', { name: 'Spring' });
    const terms = within(details)
      .getAllByRole('term')
      .map((dt) => dt.textContent);
    expect(terms).toEqual(['Elevation', 'Route', 'Coordinates']);
  });
});
