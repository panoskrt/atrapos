import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { signIn, uniqueUser } from './helpers';

async function openPicker(page: Page) {
  await page.getByRole('button', { name: /Import (GPX \/ FIT|a file)/ }).first().click();
  await expect(page.getByRole('dialog', { name: 'Import a route file' })).toBeVisible();
}

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'two-lakes.gpx');

test('import a GPX file with waypoints as a route with POIs', async ({ page }) => {
  await signIn(page, uniqueUser('import'));

  await openPicker(page);
  await page.locator('input[type=file]').setInputFiles(fixture);
  const dialog = page.getByRole('dialog', { name: 'Import route file' });
  await expect(dialog.getByText('two-lakes.gpx')).toBeVisible();
  await expect(dialog.getByLabel('Route name')).toHaveValue('Two lakes');
  await expect(dialog.getByText('2 of 3 selected')).toBeVisible(); // the Begin marker starts unchecked

  // Simplify harder: fewer points.
  const after = dialog.locator('dt', { hasText: 'after simplify' }).locator('xpath=following-sibling::dd');
  const atDefault = Number((await after.textContent())!.replace(/,/g, ''));
  await dialog.getByLabel('Simplify tolerance').fill('20');
  await expect.poll(async () => Number((await after.textContent())!.replace(/,/g, ''))).toBeLessThan(atDefault);

  await dialog.getByRole('button', { name: 'Import & open editor' }).click();
  await expect(page).toHaveURL(/\/routes\//);
  await expect(page.getByLabel('Route name')).toHaveValue('Two lakes');
  await expect(page.getByRole('tab', { name: /POIs 2/ })).toBeVisible();
});

test('a file that is not GPX or FIT is refused', async ({ page }) => {
  await signIn(page, uniqueUser('badfile'));

  await openPicker(page);
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });

  await expect(page.getByRole('dialog', { name: 'Import a route file' }).getByRole('alert')).toHaveText(/isn't a GPX or FIT file/);
});
