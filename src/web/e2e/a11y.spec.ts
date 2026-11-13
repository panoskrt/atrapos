import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { blockTiles, clickMap, newRoute, saveDraft, signIn, uniqueUser } from './helpers';

/** Serious and critical WCAG 2.x A/AA problems fail the test; minor ones are reported in the output. */
async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  console.log(`[axe ${label}] ${results.passes.length} rules pass, ${results.violations.length} violations, ${results.incomplete.length} need review`);
  for (const v of results.violations)
    console.log(`[axe ${label}] ${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  expect(blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `${label} has blocking a11y issues`).toEqual([]);
}

for (const theme of ['dark', 'light'] as const) {
  test(`pages are accessible (${theme} theme)`, async ({ page }) => {
    await blockTiles(page);
    await page.addInitScript((t) => localStorage.setItem('rpm.theme', t), theme);
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in with Suunto' })).toBeVisible();
    await expectAccessible(page, `login/${theme}`);

    await signIn(page, uniqueUser(`a11y-${theme}`));
    await page.evaluate((t) => localStorage.setItem('rpm.theme', t), theme);
    await page.reload();
    await expectAccessible(page, `library-empty/${theme}`);

    await newRoute(page);
    await clickMap(page, 0.3, 0.6);
    await clickMap(page, 0.7, 0.6);
    await page.getByRole('button', { name: 'Add POI (click the map)' }).click();
    await clickMap(page, 0.5, 0.6);
    await saveDraft(page);
    await expectAccessible(page, `editor/${theme}`);

    await page.getByRole('link', { name: 'All POIs' }).click();
    await expect(page.getByRole('heading', { name: 'All POIs' })).toBeVisible();
    await expectAccessible(page, `all-pois/${theme}`);
  });
}

test('keyboard: skip link and dialogs', async ({ page }) => {
  await signIn(page, uniqueUser('keys'));

  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await expect(skip).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();

  // The account menu opens and closes with the keyboard; disconnect asks in a modal dialog.
  await page.getByRole('button', { name: 'Account menu' }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Disconnect Suunto' }).click();
  const dialog = page.getByRole('dialog', { name: 'Disconnect Suunto?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'My routes' })).toBeVisible();
});
