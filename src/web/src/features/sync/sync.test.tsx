import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteDetail } from '../routes/api';
import { pushRoute, summarizeRefresh, type RoutePushResponse } from './api';
import { ConflictDialog } from './ConflictDialog';
import { PushResultDialog } from './PushResultDialog';

const route = { name: 'Ridge', distanceM: 18300, pois: [{}, {}, {}] } as unknown as RouteDetail;

afterEach(() => vi.unstubAllGlobals());

describe('sync', () => {
  it('treats a 409 from push as a conflict outcome, not an error', async () => {
    const body: RoutePushResponse = { outcome: 'conflict', reason: 'remote_changed', remote: null, route };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 409, headers: { 'Content-Type': 'application/json' } })));

    await expect(pushRoute('r1')).resolves.toMatchObject({ outcome: 'conflict', reason: 'remote_changed' });
  });

  it('offers three resolutions for a route changed in the Suunto app', async () => {
    const onResolve = vi.fn();
    render(
      <ConflictDialog
        conflict={{ outcome: 'conflict', reason: 'remote_changed', remote: { name: 'Ridge', distanceM: 17900, modified: null }, route }}
        busy={false}
        onResolve={onResolve}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByText('18.3 km')).toBeInTheDocument();
    expect(screen.getByText('17.9 km')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /save mine as a new route/i }));
    expect(onResolve).toHaveBeenCalledWith('saveCopy');
    expect(screen.getByRole('button', { name: /keep mine/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load the suunto version/i })).toBeInTheDocument();
  });

  it('explains a route deleted in the Suunto app', () => {
    render(
      <ConflictDialog conflict={{ outcome: 'conflict', reason: 'remote_missing', remote: null, route }} busy={false} onResolve={vi.fn()} onClose={() => undefined} />,
    );
    expect(screen.getByRole('heading', { name: /deleted in the suunto app/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload again/i })).toBeInTheDocument();
  });

  it('retries a failed POI on its own', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ results: [{ id: 'b', name: 'Hut', status: 'created', message: null }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    render(
      <PushResultDialog
        results={[
          { id: 'a', name: 'Spring', status: 'created', message: null },
          { id: 'b', name: 'Hut', status: 'failed', message: 'Suunto returned 500' },
        ]}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: /pushed with problems/i })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/POI "Hut" created/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('summarizes a refresh', () => {
    const base = { routesAdded: 0, routesUpdated: 0, routeConflicts: 0, poisAdded: 0, poisUpdated: 0, poiConflicts: 0, refreshedAt: '' };
    expect(summarizeRefresh(base)).toBe('Everything is up to date with Suunto.');
    expect(summarizeRefresh({ ...base, routesAdded: 2, routeConflicts: 1, poisAdded: 1 })).toBe(
      'From Suunto: 2 new routes, 1 with conflicts, 1 new POI.',
    );
  });
});
