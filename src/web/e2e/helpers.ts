import { expect, type Page } from '@playwright/test';

/** A fresh mock Suunto user per test keeps tests independent. */
export function uniqueUser(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

/** Map tiles come from public servers; the tests don't need them. */
export async function blockTiles(page: Page) {
  await page.route(/tile\.openstreetmap|opentopomap|cyclosm/, (route) => route.abort());
}

/** Signs in through the app's real OAuth flow against the mock Suunto authorize page. */
export async function signIn(page: Page, username: string) {
  await blockTiles(page);
  // Start every test at a predictable map view (Nuuksio, zoom 13).
  await page.addInitScript(() => {
    try {
      localStorage.setItem('rpm.mapView', JSON.stringify({ lat: 60.305, lon: 24.5, zoom: 13 }));
      localStorage.setItem('rpm.theme', 'dark');
    } catch {
      // ignore
    }
  });
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Sign in with Suunto' }).click();

  await expect(page.getByRole('heading', { name: 'Authorize app access' })).toBeVisible();
  await page.getByLabel('Suunto username').fill(username);
  await page.getByRole('button', { name: 'Allow' }).click();

  await expect(page.getByRole('heading', { name: 'My routes' })).toBeVisible();
}

/** Clicks the map at a fraction of its size (avoiding the overlays near the edges). */
export async function clickMap(page: Page, fx: number, fy: number) {
  const box = (await page.locator('.leaflet-container').boundingBox())!;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

export async function newRoute(page: Page) {
  await page.getByRole('button', { name: 'New route' }).click();
  await expect(page).toHaveURL(/\/routes\//);
  await expect(page.locator('.leaflet-container')).toBeVisible();
  // Tests draw freehand: snap-to-trail would call the public BRouter server.
  await page.getByRole('button', { name: 'Freehand', exact: true }).click();
}

export async function saveDraft(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).not.toHaveURL(/\/routes\/new$/);
  await expectSaved(page);
}

export async function expectSaved(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Saved$/ })).toBeVisible();
}
