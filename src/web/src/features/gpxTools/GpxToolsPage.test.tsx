import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
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
});
