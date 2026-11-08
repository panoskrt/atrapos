import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImportPreview } from '../import/api';
import { GpxToolsPage } from './GpxToolsPage';

const preview: ImportPreview = {
  fileName: 'ridge.fit',
  kind: 'fitCourse',
  name: 'Ridge',
  suggestedActivityIds: [11],
  baseToleranceM: 1,
  tracks: [
    {
      name: 'Ridge',
      originalPointCount: 1200,
      distanceM: 2200,
      hasElevation: true,
      // 2 m zig-zag along a straight line: 2 points at 5 m, many more at 1 m.
      coordinates: Array.from({ length: 200 }, (_, i) => [24 + i * 0.0001, 60 + (i % 2 ? 0.000018 : -0.000018), 100]),
    },
  ],
  waypoints: [],
};

function renderPage(path = '/gpx-tools') {
  const router = createMemoryRouter([{ path: '/gpx-tools', element: <GpxToolsPage /> }], { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('GpxToolsPage', () => {
  it('shows one tool at a time, picked from the tiles', async () => {
    const router = renderPage();
    const user = userEvent.setup();

    expect(screen.getByRole('tab', { name: /merge/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('heading', { name: 'Merge GPX files' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Convert FIT and GPX' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /shrink/i }));
    expect(screen.getByRole('heading', { name: 'Shrink a GPX or FIT file' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Merge GPX files' })).not.toBeInTheDocument();
    expect(router.state.location.search).toBe('?tool=shrink');

    fireEvent.keyDown(screen.getByRole('tab', { name: /shrink/i }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /convert/i })).toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Convert FIT and GPX' })).toBeInTheDocument();
  });

  it('previews the point reduction and downloads the shrunk file', async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/imports/limits'))
        return new Response(JSON.stringify({ maxFileBytes: 3 * 1024 * 1024 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/api/imports/preview'))
        return new Response(JSON.stringify(preview), { status: 200, headers: { 'Content-Type': 'application/json' } });
      expect((init?.body as FormData).get('toleranceM')).toBe('5');
      return new Response(new Blob(['fit'.repeat(40)]), {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.ant.fit', 'Content-Disposition': 'attachment; filename=ridge-shrunk.fit' },
      });
    });
    vi.stubGlobal('fetch', fetch);
    URL.createObjectURL = vi.fn(() => 'blob:ridge');
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    renderPage('/gpx-tools?tool=shrink');
    const user = userEvent.setup();

    // The limit comes from the API (Uploads:MaxFileSizeMb).
    expect(await screen.findByText('Choose one GPX or FIT file (up to 3 MB).')).toBeInTheDocument();
    const input = document.querySelector<HTMLInputElement>('input[type=file][accept*=".fit"]')!;
    await user.upload(input, new File([new Uint8Array(4000)], 'ridge.fit'));

    expect(await screen.findByText('1,200 →')).toBeInTheDocument();
    expect(screen.getByText('2', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('slider'), { target: { value: '1' } });
    expect(screen.queryByText('2', { selector: 'strong' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider'), { target: { value: '5' } });

    await user.click(screen.getByRole('button', { name: 'Shrink and download' }));
    expect(await screen.findByText(/Downloaded ridge-shrunk\.fit/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/imports/shrink', expect.objectContaining({ method: 'POST' }));
    expect(click).toHaveBeenCalledOnce();
  });

  it('creates downloadable GPX parts at the chosen distance interval', async () => {
    renderPage('/gpx-tools?tool=split');
    const user = userEvent.setup();
    const routePoints = Array.from({ length: 10 }, (_, index) => `<rtept lat="0" lon="${index * 0.001}" />`).join('');
    const input = document.querySelector<HTMLInputElement>('input[type=file]:not([multiple])')!;
    await user.upload(
      input,
      new File([`<gpx xmlns="http://www.topografix.com/GPX/1/1"><rte>${routePoints}</rte></gpx>`], 'ridge.gpx'),
    );

    await user.click(screen.getByRole('radio', { name: 'Split by distance' }));
    fireEvent.change(document.querySelector('input[type=number]')!, { target: { value: '0.2' } });
    await user.click(screen.getByRole('checkbox', { name: 'Create a route in the app for each split part' }));
    await user.click(screen.getByRole('button', { name: 'Split GPX' }));

    const parts = await screen.findByRole('list', { name: 'Split GPX parts' });
    expect(parts.querySelectorAll('li')).toHaveLength(4);
    expect(parts).toHaveTextContent('Split route - Part 1.gpx');
    expect(parts).toHaveTextContent('Split route - Part 4.gpx');
    const completionDialog = await screen.findByRole('dialog', { name: 'Split complete' });
    expect(within(completionDialog).getByRole('status')).toHaveTextContent('Created 4 GPX files, ready to download.');
    expect(screen.getByRole('list', { name: 'Created GPX files' }).querySelectorAll('li')).toHaveLength(4);
  });

  it('confirms when all split parts have been created as routes', async () => {
    let imported = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/api/imports/limits'))
          return new Response(JSON.stringify({ maxFileBytes: 3 * 1024 * 1024 }), { status: 200 });
        if (url.includes('/api/imports/preview'))
          return new Response(JSON.stringify(preview), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (url === '/api/me') return new Response(null, { status: 401 });
        if (url === '/api/imports' && init?.method === 'POST') {
          imported++;
          return new Response(JSON.stringify({ id: `route-${imported}`, name: `Created part ${imported}` }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(null, { status: 404 });
      }),
    );
    renderPage('/gpx-tools?tool=split');
    const user = userEvent.setup();
    const routePoints = Array.from({ length: 10 }, (_, index) => `<rtept lat="0" lon="${index * 0.001}" />`).join('');
    const input = document.querySelector<HTMLInputElement>('input[type=file]:not([multiple])')!;
    await user.upload(
      input,
      new File([`<gpx xmlns="http://www.topografix.com/GPX/1/1"><rte>${routePoints}</rte></gpx>`], 'ridge.gpx'),
    );
    await user.click(screen.getByRole('radio', { name: 'Split by distance' }));
    fireEvent.change(document.querySelector('input[type=number]')!, { target: { value: '0.2' } });
    await user.click(screen.getByRole('button', { name: 'Split and create routes' }));

    for (let index = 0; index < 4; index++) {
      await user.click(await screen.findByRole('button', { name: 'Import & open editor' }));
    }

    const completionDialog = await screen.findByRole('dialog', { name: 'Split complete' });
    expect(within(completionDialog).getByRole('status')).toHaveTextContent('Created 4 new routes in your library.');
    expect(screen.getByRole('list', { name: 'Created routes' }).querySelectorAll('li')).toHaveLength(4);
  });
});
