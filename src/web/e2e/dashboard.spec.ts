import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn, uniqueUser } from './helpers';

const CSRF = { 'X-RPM-CSRF': '1' };

/** Seeds a route (and optional POIs) through the API, as the editor would save it. */
async function seedRoute(page: Page, name: string, lat: number, pois: string[] = [], activityIds = [11]) {
  const created = await page.request.post('/api/routes', {
    headers: CSRF,
    data: {
      name,
      description: null,
      activityIds,
      turnWaypointsEnabled: false,
      routingProfile: 'hiking-mountain',
      controlPoints: [
        { lon: 24.48, lat, modeToNext: 'freehand', segment: [[24.48, lat, null], [24.5, lat + 0.004, null]] },
        { lon: 24.5, lat: lat + 0.004, modeToNext: 'freehand' },
      ],
      pois: pois.map((poiName, i) => ({
        id: crypto.randomUUID(),
        name: poiName,
        description: null,
        poiType: 26,
        lon: 24.485 + i * 0.005,
        lat: lat + 0.001 + i * 0.001,
        ele: null,
      })),
    },
  });
  expect(created.ok(), `Route creation returned ${created.status()}`).toBe(true);
}

async function expectNoBlockingA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('library: boxes and list views, search, sort and bulk delete', async ({ page }) => {
  await signIn(page, uniqueUser('dash'));
  await seedRoute(page, 'Alpha ridge', 60.30);
  await seedRoute(page, 'Bravo lakes', 60.31, ['Spring', 'Hut']);
  await seedRoute(page, 'Charlie coast', 60.32, [], [11, 22]);
  await page.reload();

  // Boxes by default, with a summary that doubles as a filter.
  await expect(page.getByRole('heading', { name: 'Alpha ridge' })).toBeVisible();
  const summary = page.getByRole('region', { name: 'Library summary' });
  await expect(summary).toContainText('3Routes');
  await expect(summary).toContainText('2POIs');
  await summary.getByRole('button', { name: /Not pushed/ }).click();
  await expect(page.getByText('Showing 3 of 3 routes')).toBeVisible();
  await summary.getByRole('button', { name: /Not pushed/ }).click();

  // Activity filter: only activities in use, with counts.
  const activity = page.getByRole('combobox', { name: 'Activity' });
  await expect(activity.locator('option')).toHaveText(['All activities', 'Hiking (3)', 'Trail running (1)']);
  await activity.selectOption({ label: 'Trail running (1)' });
  await expect(page.getByText('Showing 1 of 3 routes')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Charlie coast' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Alpha ridge' })).toBeHidden();
  await activity.selectOption({ label: 'All activities' });

  // List view: sortable columns; the choice is remembered.
  await page.getByRole('button', { name: 'List' }).click();
  const table = page.getByRole('table');
  await table.getByRole('button', { name: 'Name' }).click();
  await expect(table.locator('tbody tr').first()).toContainText('Alpha ridge');
  await table.getByRole('button', { name: 'Name' }).click();
  await expect(table.locator('tbody tr').first()).toContainText('Charlie coast');
  await expect(table.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'descending');
  await page.reload();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');

  // Search narrows the list; select-all only takes what's shown.
  await page.getByRole('searchbox', { name: 'Search routes' }).fill('bravo');
  await expect(page.getByText('Showing 1 of 3 routes')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select all routes shown' }).check();
  await expect(page.getByRole('region', { name: 'Selection' })).toContainText('1 route selected');
  await page.getByRole('searchbox', { name: 'Search routes' }).fill('');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Selection' })).toBeHidden();

  // Pick two, then delete them together.
  await page.getByRole('checkbox', { name: 'Select Alpha ridge' }).check();
  await page.getByRole('checkbox', { name: 'Select Charlie coast' }).check();
  const bar = page.getByRole('region', { name: 'Selection' });
  await expect(bar).toContainText('2 routes selected');
  await expectNoBlockingA11y(page);
  await bar.getByRole('button', { name: 'Delete 2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete 2 routes?' });
  await expect(dialog).toContainText("can't be undone");
  await dialog.getByRole('button', { name: 'Delete 2 routes' }).click();

  await expect(page.getByText('Deleted 2 routes.')).toBeVisible();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Bravo lakes' })).toBeVisible();
  await expect(bar).toBeHidden();

  // Boxes view selects too.
  await page.getByRole('button', { name: 'Boxes' }).click();
  await page.getByRole('checkbox', { name: 'Select Bravo lakes' }).check();
  await expect(bar).toContainText('1 route selected');
  await expectNoBlockingA11y(page);
});

test('loaders show while Suunto is being called', async ({ page }) => {
  await signIn(page, uniqueUser('loaders'));
  await seedRoute(page, 'Foxtrot', 60.30, ['Spring', 'Hut']);
  await page.reload();

  // Hold Suunto calls until the test has looked at the loaders.
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route(/\/api\/(suunto\/refresh|pois\/push)$/, async (route) => {
    await held;
    await route.continue();
  });

  await page.getByRole('button', { name: 'Refresh from Suunto' }).click();
  const busyButton = page.getByRole('button', { name: 'Refreshing…' });
  await expect(busyButton).toBeDisabled();
  await expect(page.getByRole('progressbar', { name: 'Fetching routes and POIs from Suunto…' })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('status')).toContainText('Fetching routes and POIs from Suunto…');
  release();
  await expect(page.getByRole('progressbar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Refresh from Suunto' })).toBeEnabled();
  await expect(page.getByRole('banner').getByRole('status')).toContainText('Mock Suunto');

  // Pushing POIs from the All POIs page: spinner on the button that was pressed, and the global bar.
  let releasePush!: () => void;
  const heldPush = new Promise<void>((r) => (releasePush = r));
  await page.unroute(/\/api\/(suunto\/refresh|pois\/push)$/);
  await page.route(/\/api\/pois\/push$/, async (route) => {
    await heldPush;
    await route.continue();
  });
  await page.getByRole('link', { name: 'All POIs' }).click();
  await page.getByRole('button', { name: 'Push 2 to Suunto' }).click();
  await expect(page.getByRole('button', { name: 'Pushing 2…' })).toBeDisabled();
  await expect(page.getByRole('progressbar', { name: 'Pushing POIs to Suunto…' })).toBeVisible();
  releasePush();
  await expect(page.getByRole('dialog', { name: 'Pushed to Suunto' })).toBeVisible();
  await expect(page.getByRole('progressbar')).toBeHidden();
});

test('all POIs: select by group and delete in bulk', async ({ page }) => {
  await signIn(page, uniqueUser('poibulk'));
  await seedRoute(page, 'Delta', 60.30, ['Spring', 'Hut', 'Viewpoint']);
  await seedRoute(page, 'Echo', 60.32, ['Bridge']);
  await page.getByRole('link', { name: 'All POIs' }).click();
  await expect(page.getByRole('heading', { name: 'All POIs' })).toBeVisible();

  await page.getByRole('checkbox', { name: 'Select all POIs in Delta' }).check();
  await page.getByRole('checkbox', { name: 'Select Hut' }).uncheck();
  const groupBox = page.getByRole('checkbox', { name: 'Select all POIs in Delta' });
  await expect(groupBox).toHaveJSProperty('indeterminate', true);
  const bar = page.getByRole('region', { name: 'Selection' });
  await expect(bar).toContainText('2 POIs selected');
  await expectNoBlockingA11y(page);

  // Never pushed, so nothing on Suunto to warn about.
  await bar.getByRole('button', { name: 'Delete 2' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete 2 POIs?' });
  await expect(dialog).toContainText('None of them were pushed');
  await dialog.getByRole('button', { name: 'Delete 2 POIs' }).click();

  await expect(page.getByText('Deleted 2 POIs.')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /^Select (Spring|Viewpoint)$/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Select Hut' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select Bridge' })).toBeVisible();

  // Search covers route names as well.
  await page.getByRole('searchbox', { name: 'Search POIs' }).fill('echo');
  await expect(page.getByRole('checkbox', { name: /^Select (?!all)/ })).toHaveCount(1);
});
