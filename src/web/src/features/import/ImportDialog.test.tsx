import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportPreview } from './api';
import { ImportDialog } from './ImportDialog';

const preview: ImportPreview = {
  fileName: 'lapland-day2.fit',
  kind: 'fitCourse',
  name: 'Lapland day 2',
  suggestedActivityIds: [11],
  baseToleranceM: 1,
  tracks: [
    {
      name: 'Lapland day 2',
      originalPointCount: 200,
      distanceM: 2200,
      hasElevation: true,
      // 2 m zig-zag noise along a straight line: simplifies to 2 points at 5 m.
      coordinates: Array.from({ length: 200 }, (_, i) => [24 + i * 0.0001, 60 + (i % 2 ? 0.000018 : -0.000018), 100]),
    },
  ],
  waypoints: [
    { name: 'Rova spring', sourceType: 'Water', poiType: 12, include: true, lon: 24.01, lat: 60, ele: null, description: null },
    { name: 'Turn left', sourceType: 'Left', poiType: 26, include: false, lon: 24.015, lat: 60, ele: null, description: null },
    { name: 'Far hut', sourceType: 'Shelter', poiType: 9, include: true, lon: 24.01, lat: 60.05, ele: null, description: null },
  ],
};

function renderDialog(suuntoConnected = false) {
  const fetch = vi.fn(async (url: string) => {
    const body = url === '/api/me'
      ? { username: 'test-user', suuntoMode: 'Live', suuntoConnected }
      : url.includes('/api/imports/preview')
        ? preview
        : url.includes('poi-types')
          ? [
              { id: 9, name: 'Lodging' },
              { id: 12, name: 'Water' },
              { id: 26, name: 'POI' },
            ]
          : url.includes('activity-types')
            ? [{ id: 11, name: 'Hiking', watchSupported: true }]
            : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetch);
  const file = new File(['x'], 'lapland-day2.fit');
  const router = createMemoryRouter([{ path: '/', element: <ImportDialog file={file} onClose={() => undefined} /> }]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

describe('ImportDialog', () => {
  it('shows the parsed file, live simplification and POI choices', async () => {
    const fetch = renderDialog();

    expect(await screen.findByText('lapland-day2.fit')).toBeInTheDocument();
    expect(screen.getByLabelText(/route name/i)).toHaveValue('Lapland day 2');
    // 5 m default tolerance removes the 2 m noise.
    expect(screen.getByText('after simplify').nextSibling).toHaveTextContent('2');

    fireEvent.change(screen.getByLabelText(/simplify tolerance/i), { target: { value: '0' } });
    expect(screen.getByText('after simplify').nextSibling).toHaveTextContent('200');

    // Turn instructions start unchecked; the far waypoint is flagged.
    expect(screen.getByLabelText('Import Turn left')).not.toBeChecked();
    expect(screen.getByLabelText('Import Rova spring')).toBeChecked();
    expect(screen.getByText(/2 of 3 selected/)).toBeInTheDocument();
    expect(screen.getByText(/km off route/)).toBeInTheDocument();
    expect(screen.queryByText('Suunto activities')).not.toBeInTheDocument();
    expect(screen.queryByText('Suunto type')).not.toBeInTheDocument();
    const requestedUrls = fetch.mock.calls.map(([url]) => url);
    expect(requestedUrls).not.toContain('/api/lookups/activity-types');
    expect(requestedUrls).not.toContain('/api/lookups/poi-types');
  });

  it('keeps the Suunto-specific import options when connected', async () => {
    renderDialog(true);

    expect(await screen.findByText('Suunto activities')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Suunto type for Rova spring' })).toBeInTheDocument();
  });
});
