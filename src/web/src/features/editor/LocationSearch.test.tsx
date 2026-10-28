import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeafletMap, useMapEvents } from '../../components/LeafletMap';
import { LocationSearch } from './LocationSearch';
import { useEditorStore } from './store';

function MapClicks({ onClick }: { onClick: () => void }) {
  useMapEvents({ click: onClick });
  return null;
}

beforeEach(() => useEditorStore.getState().startNew());
afterEach(() => vi.unstubAllGlobals());

describe('LocationSearch', () => {
  it('keeps its clicks off the map, so picking a place starts the route there and nowhere else', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([{ lat: '60.305', lon: '24.5', display_name: 'Nuuksio, Espoo' }])),
    );
    const mapClick = vi.fn();
    render(
      <LeafletMap center={[50, 10]} zoom={4}>
        <MapClicks onClick={mapClick} />
        <LocationSearch />
      </LeafletMap>,
    );
    const user = userEvent.setup();

    // Enter clicks the Search button, which is a click in the panel too.
    await user.click(screen.getByLabelText('Search location'));
    await user.keyboard('Nuuksio{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Nuuksio, Espoo' }));

    expect(mapClick).not.toHaveBeenCalled();
    expect(useEditorStore.getState().points.map((p) => [p.lat, p.lon])).toEqual([[60.305, 24.5]]);
  });
});
