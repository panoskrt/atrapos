import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '../../App';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function renderAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('legal pages', () => {
  it('shows privacy and terms to signed-out visitors without asking the server who they are', () => {
    renderAt('/privacy');

    expect(screen.getByRole('heading', { level: 1, name: 'Privacy and terms' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Terms' })).toBeInTheDocument();
    expect(screen.getByText(/last updated/i)).toHaveTextContent('Last updated 29 October 2026');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows the cookie list to signed-out visitors', () => {
    renderAt('/cookies');

    expect(screen.getByRole('heading', { level: 1, name: 'Cookies' })).toBeInTheDocument();
    expect(screen.getByText('rpm.session')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('links back to the app', () => {
    renderAt('/cookies');

    expect(screen.getByRole('link', { name: 'Atrapos' })).toHaveAttribute('href', '/');
  });
});
