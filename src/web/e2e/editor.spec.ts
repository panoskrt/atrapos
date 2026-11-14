import { expect, test } from '@playwright/test';
import { clickMap, newRoute, saveChanges, saveDraft, showMapTools, signIn, uniqueUser } from './helpers';

const distance = (page: import('@playwright/test').Page) =>
  page.locator('dl div').filter({ hasText: 'Distance' }).locator('dd');

test('draw, drag, undo, reverse and save a route', async ({ page }) => {
  await signIn(page, uniqueUser('draw'));
  await newRoute(page);

  await clickMap(page, 0.3, 0.7);
  await clickMap(page, 0.5, 0.5);
  await clickMap(page, 0.7, 0.35);
  await expect(page.locator('.leaflet-marker-icon[title^="Point 3."]')).toBeVisible();
  await saveDraft(page);
  const routeUrl = page.url();
  const drawn = await distance(page).textContent();
  expect(drawn).toMatch(/km$/);

  // Drag the middle point: the route gets longer.
  await showMapTools(page);
  await page.getByRole('button', { name: 'Select and drag points' }).click();
  const middle = page.locator('.leaflet-marker-icon[title^="Point 2."]');
  const box = (await middle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 160, { steps: 8 });
  await page.mouse.up();
  await expect(distance(page)).not.toHaveText(drawn!);

  // Undo puts it back.
  await page.keyboard.press('Control+z');
  await expect(distance(page)).toHaveText(drawn!);

  // Reverse keeps the length; the start marker moves to the other end.
  const startBefore = await page.locator('.leaflet-marker-icon[title^="Point 1."]').boundingBox();
  await page.getByRole('button', { name: 'Reverse route direction' }).click();
  await expect(distance(page)).toHaveText(drawn!);
  const startAfter = await page.locator('.leaflet-marker-icon[title^="Point 1."]').boundingBox();
  expect(startAfter!.x).toBeGreaterThan(startBefore!.x + 50);

  await page.getByLabel('Route name').fill('E2E ridge');
  await expect(page.getByRole('status').filter({ hasText: /^Unsaved changes$/ })).toBeVisible();
  await saveChanges(page);
  await page.reload();
  await expect(page.getByLabel('Route name')).toHaveValue('E2E ridge');
  await expect(distance(page)).toHaveText(drawn!);

  await page.getByLabel('Route name').fill('Discard this edit');
  await page.getByRole('link', { name: 'Library', exact: true }).first().click();
  const leaveDialog = page.getByRole('dialog', { name: 'Unsaved changes' });
  await leaveDialog.getByRole('button', { name: 'No', exact: true }).click();
  await expect(page).toHaveURL('/');
  await page.goto(routeUrl);
  await expect(page.getByLabel('Route name')).toHaveValue('E2E ridge');
});

test('POIs: place on the route, rename, push route and POIs to Suunto', async ({ page }) => {
  await signIn(page, uniqueUser('poi'));
  await newRoute(page);
  await clickMap(page, 0.3, 0.6);
  await clickMap(page, 0.7, 0.6);
  await saveDraft(page);

  // Click right next to the line: the POI snaps onto it and is on the route. The saved route reopens fitted to
  // the line, so find the line by its end points (once the map has settled) rather than where it was drawn.
  const lineEnds = () =>
    Promise.all(
      ['Point 1.', 'Point 2.'].map(async (title) => {
        const box = (await page.locator(`.leaflet-marker-icon[title^="${title}"]`).boundingBox())!;
        return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
      }),
    );
  let ends = await lineEnds();
  await expect
    .poll(async () => {
      const before = JSON.stringify(await lineEnds());
      await page.waitForTimeout(500);
      ends = await lineEnds();
      return JSON.stringify(ends) === before;
    })
    .toBe(true);
  await showMapTools(page);
  await page.getByRole('button', { name: 'Add POI (click the map)' }).click();
  await page.mouse.click((ends[0]!.x + ends[1]!.x) / 2, (ends[0]!.y + ends[1]!.y) / 2 + 8);
  const card = page.getByRole('region', { name: /Edit POI/ });
  await expect(card).toBeVisible();
  await expect(card.getByText('On route at')).toBeVisible();

  await card.getByLabel('Name').fill('Kettle spring');
  await card.getByLabel('Suunto POI type (watch icon)').selectOption({ label: 'Water' });
  await page.keyboard.press('Tab');
  await expect(page.getByRole('tab', { name: /POIs 1/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Kettle spring/ })).toBeVisible();
  await saveChanges(page);

  await page.getByRole('button', { name: 'Push route' }).click();
  const routeResult = page.getByRole('dialog', { name: 'Pushed to Suunto' });
  await expect(routeResult.getByText('Route "Untitled route" pushed')).toBeVisible();
  await routeResult.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('Synced', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Push 1 POI' }).click();
  const result = page.getByRole('dialog', { name: 'Pushed to Suunto' });
  await expect(result.getByText('POI "Kettle spring" created')).toBeVisible();
  await result.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('All pushed')).toBeVisible();

  // The library card reflects both.
  await page.getByRole('link', { name: 'Library', exact: true }).first().click();
  const cardInLibrary = page.getByRole('listitem').filter({ hasText: 'Untitled route' });
  await expect(cardInLibrary.getByText('Synced', { exact: true })).toBeVisible();
  await expect(cardInLibrary.getByText('1 synced')).toBeVisible();
});

test('new route drafts require a map point and offer cancel, discard, and save when leaving', async ({ page }) => {
  await signIn(page, uniqueUser('draft'));
  await newRoute(page);

  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  await page.getByRole('link', { name: 'Library', exact: true }).first().click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Draw your first route')).toBeVisible();

  await newRoute(page);
  await clickMap(page, 0.4, 0.6);
  await expect(save).toBeEnabled();

  await page.getByRole('link', { name: 'Library', exact: true }).first().click();
  const leaveDialog = page.getByRole('dialog', { name: 'Unsaved changes' });
  await expect(leaveDialog.getByText('Do you want to save your changes before returning to the dashboard?')).toBeVisible();
  await leaveDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(/\/routes\/new$/);

  await page.getByRole('link', { name: 'Library', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Unsaved changes' }).getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Untitled route' })).toBeVisible();
});
