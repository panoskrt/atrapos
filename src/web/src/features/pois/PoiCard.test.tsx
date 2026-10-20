import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmHost } from '../../components/ConfirmDialog';
import { cumulativeDistances, type Coord } from '../editor/geo';
import { useEditorStore } from '../editor/store';
import type { RouteDetail } from '../routes/api';
import type { PoiLocation } from './placement';
import { PoiCard } from './PoiCard';

const line: Coord[] = [
  [24.0, 60.0, 100],
  [24.02, 60.0, 200],
];

function loadRouteWithPoi(suuntoPoiKey: string | null = null) {
  const route: RouteDetail = {
    id: 'r1',
    name: 'R',
    description: null,
    activityIds: [11],
    turnWaypointsEnabled: false,
    routingProfile: 'hiking-mountain',
    source: 'drawn',
    syncState: 'localOnly',
    suuntoRouteId: null,
    distanceM: 0,
    ascentM: 0,
    descentM: 0,
    hasElevation: true,
    controlPoints: [],
    pois: [
      {
        id: 'poi-1',
        name: 'Spring',
        description: null,
        poiType: 12,
        lon: 24.01,
        lat: 60.002,
        ele: null,
        distanceAlongM: null,
        syncState: suuntoPoiKey ? 'synced' : 'localOnly',
        suuntoPoiKey,
      },
    ],
    createdAt: '',
    localModifiedAt: '',
  };
  useEditorStore.getState().load(route);
  useEditorStore.getState().selectPoi('poi-1');
}

function renderCard(location: PoiLocation, suuntoConnected = true) {
  const fetch = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url === '/api/me'
            ? { username: 'test-user', suuntoMode: 'Live', suuntoConnected }
            : [{ id: 12, name: 'Water' }, { id: 22, name: 'Sight' }, { id: 26, name: 'POI' }],
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetch);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PoiCard line={line} cumulative={cumulativeDistances(line)} locations={new Map([['poi-1', location]])} />
      <ConfirmHost />
    </QueryClientProvider>,
  );
  return fetch;
}

beforeEach(() => loadRouteWithPoi());
afterEach(() => vi.unstubAllGlobals());

describe('PoiCard', () => {
  it('commits a rename on leaving the field, as one undo step', async () => {
    renderCard({ alongM: null, offsetM: 222 });
    const user = userEvent.setup();
    const steps = useEditorStore.temporal.getState().pastStates.length;

    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Kettle spring');
    expect(useEditorStore.getState().pois[0]!.name).toBe('Spring'); // still a draft while typing
    await user.tab();

    expect(useEditorStore.getState().pois[0]!.name).toBe('Kettle spring');
    expect(useEditorStore.temporal.getState().pastStates).toHaveLength(steps + 1);
  });

  it('moves an off-route POI onto the route, taking the route elevation', async () => {
    renderCard({ alongM: null, offsetM: 222 });
    expect(screen.getByText('Off route: POI only')).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Move onto route' }));

    const poi = useEditorStore.getState().pois[0]!;
    expect(poi.lat).toBeCloseTo(60.0, 6);
    expect(poi.ele).toBeCloseTo(150, 0);
  });

  it('asks before deleting a POI that is already on Suunto', async () => {
    loadRouteWithPoi('5e3be95baba83c5b1781593a');
    renderCard({ alongM: 500, offsetM: 10 });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /delete poi/i }));
    expect(await screen.findByRole('heading', { name: /delete poi here only/i })).toBeInTheDocument();
    expect(screen.getByText(/stays in your suunto app/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(useEditorStore.getState().pois).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /delete poi/i }));
    await user.click(await screen.findByRole('button', { name: 'Delete locally' }));
    expect(useEditorStore.getState().pois).toHaveLength(0);
  });

  it('deletes a POI that was never pushed without asking', async () => {
    renderCard({ alongM: 500, offsetM: 10 });

    await userEvent.setup().click(screen.getByRole('button', { name: /delete poi/i }));

    expect(useEditorStore.getState().pois).toHaveLength(0);
  });

  it('hides Suunto POI settings and skips the Suunto type lookup when disconnected', async () => {
    const fetch = renderCard({ alongM: 500, offsetM: 10 }, false);

    expect(await screen.findByText('Edit POI')).toBeInTheDocument();
    expect(screen.queryByText('Suunto POI type (watch icon)')).not.toBeInTheDocument();
    expect(screen.queryByText('Suunto POI')).not.toBeInTheDocument();
    expect(screen.queryByText('Waypoint in route')).not.toBeInTheDocument();
    const requestedUrls = fetch.mock.calls.map(([url]) => url);
    expect(requestedUrls).not.toContain('/api/lookups/poi-types');
  });
});
