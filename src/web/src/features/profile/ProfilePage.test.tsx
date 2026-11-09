import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '../../lib/theme';
import type { UserSettings } from '../../lib/userPreferences';
import { ProfilePage } from './ProfilePage';

const settings: UserSettings = {
  defaultMap: 'topo',
  units: 'metric',
  theme: 'dark',
  design: 'classic',
  favoriteActivityIds: [],
  defaultRoutingProfile: null,
  menuPosition: 'left',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function renderPage(saveStatus = 200) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/me') return json({ username: 'test-user', suuntoMode: 'Live', suuntoConnected: true });
    if (url === '/api/settings' && init?.method === 'PUT')
      return saveStatus === 200 ? json(JSON.parse(String(init.body))) : json({ title: 'Nope' }, saveStatus);
    if (url === '/api/settings') return json(settings);
    return json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider>
        <MemoryRouter>
          <ProfilePage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return fetchMock;
}

const savedBodies = (fetchMock: ReturnType<typeof renderPage>) =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === '/api/settings' && init?.method === 'PUT')
    .map(([, init]) => JSON.parse(String(init!.body)) as UserSettings);

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.menu;
});

describe('ProfilePage menu position', () => {
  it('moves the menu to the top at once and saves it with the other preferences', async () => {
    const fetchMock = renderPage();
    const select = await screen.findByRole('combobox', { name: 'Menu position' });
    expect(select).toHaveValue('left');
    expect(document.documentElement.dataset.menu).toBe('left');

    await waitFor(() => expect(select).toBeEnabled());
    await userEvent.setup().selectOptions(select, 'top');

    expect(document.documentElement.dataset.menu).toBe('top');
    await waitFor(() => expect(savedBodies(fetchMock)).toEqual([{ ...settings, menuPosition: 'top' }]));
    expect(localStorage.getItem('rpm.menu')).toBe('top');
  });

  it('puts the menu back when saving fails', async () => {
    renderPage(500);
    const select = await screen.findByRole('combobox', { name: 'Menu position' });
    await waitFor(() => expect(select).toBeEnabled());
    await userEvent.setup().selectOptions(select, 'top');

    await screen.findByText(/Couldn’t save preferences/);
    expect(document.documentElement.dataset.menu).toBe('left');
  });
});
