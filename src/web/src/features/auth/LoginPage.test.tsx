import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';

function renderAt(url: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
  const router = createMemoryRouter([{ path: '/login', element: <LoginPage /> }], { initialEntries: [url] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('LoginPage', () => {
  it('starts the Suunto sign-in through the backend', () => {
    renderAt('/login');
    expect(screen.getByRole('link', { name: /sign in with suunto/i })).toHaveAttribute('href', '/auth/login');
  });

  it('explains a denied consent', () => {
    renderAt('/login?error=access_denied');
    expect(screen.getByRole('alert')).toHaveTextContent(/access was not approved/i);
  });
});
