import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { RouteSummary } from '../routes/api';
import { RouteMap } from './RouteViews';

const route: RouteSummary = {
  id: 'r1',
  name: 'Ridge loop',
  distanceM: 4200,
  ascentM: 120,
  activityIds: [11],
  source: 'drawn',
  syncState: 'localOnly',
  poiCount: 0,
  poisPending: 0,
  localModifiedAt: '2026-10-01T10:00:00Z',
  preview: [
    [24.4, 60.3],
    [24.5, 60.32],
    [24.6, 60.3],
  ],
};

describe('RouteMap', () => {
  it('shows a route’s details when its line is clicked, not only its start marker', () => {
    const { container } = render(
      <MemoryRouter>
        <RouteMap routes={[route]} />
      </MemoryRouter>,
    );

    // A plain click with coordinates: Leaflet copies the event to place it, and user-event's coordinates don't copy.
    fireEvent.click(container.querySelector('.leaflet-overlay-pane path.leaflet-interactive')!, { clientX: 400, clientY: 241 });

    expect(screen.getByRole('heading', { name: 'Ridge loop' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View route details' })).toHaveAttribute('href', '/routes/r1');
  });
});
