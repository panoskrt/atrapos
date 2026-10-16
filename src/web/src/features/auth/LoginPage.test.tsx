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
  it('starts the Suunto sign-in in a popup window', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => ({ closed: false } as Window));

    renderAt('/login');
    screen.getByRole('button', { name: /sign in with suunto/i }).click();

    expect(open).toHaveBeenCalledWith('/auth/login', 'suunto-login', 'width=520,height=720');
  });

  it('starts the Google sign-in in a popup window', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => ({ closed: false } as Window));

    renderAt('/login');
    screen.getByRole('button', { name: /sign in with google/i }).click();

    expect(open).toHaveBeenCalledWith('/auth/google', 'google-login', 'width=520,height=720');
  });

  it('explains a denied consent', () => {
    renderAt('/login?error=access_denied');
    expect(screen.getByRole('alert')).toHaveTextContent(/access was not approved/i);
  });
});
