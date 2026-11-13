import { expect, test, type Page } from '@playwright/test';
import { expectSaved, saveChanges, signIn, uniqueUser } from './helpers';

const CSRF = { 'X-RPM-CSRF': '1' };
const LAT = 60.305;
const LONS = [24.48, 24.49, 24.5, 24.51];

/** A recorded (imported) leg: bends off the straight line, as a real track does. */
const curvedLeg = (a: number, b: number) => [
  [a, LAT, 20],
  [(a + b) / 2, LAT + 0.002, 25],
  [b, LAT, 30],
];

async function seedImportedRoute(page: Page) {
  const res = await page.request.post('/api/routes', {
    headers: CSRF,
    data: {
      name: 'Imported track',
      description: null,
      activityIds: [11],
      turnWaypointsEnabled: false,
      routingProfile: 'hiking-mountain',
      controlPoints: LONS.map((lon, i) => ({
        lon,
        lat: LAT,
        modeToNext: 'track',
        segment: i < LONS.length - 1 ? curvedLeg(lon, LONS[i + 1]!) : null,
      })),
      pois: [],
    },
  });
  expect(res.ok(), `Route creation returned ${res.status()}`).toBe(true);
  return ((await res.json()) as { id: string }).id;
}

/** Answers snap-to-trail requests in the browser, so the test doesn't depend on the public BRouter server. */
async function fakeRouter(page: Page) {
  const state = { fail: false, requests: 0 };
  await page.route('**/api/routing/segment', async (route) => {
    state.requests++;
    const { from, to } = route.request().postDataJSON() as { from: number[]; to: number[] };
    if (state.fail) {
      return route.fulfill({
        status: 422,
        contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'A point is too far from any trail.', status: 422, code: 'no_route' }),
      });
    }
    const mid = [(from[0]! + to[0]!) / 2, (from[1]! + to[1]!) / 2 - 0.001];
    return route.fulfill({ json: { coordinates: [[...from, 20], [...mid, 22], [...to, 24]], distanceM: 1 } });
  });
  return state;
}

async function savedModes(page: Page, id: string) {
  const route = (await (await page.request.get(`/api/routes/${id}`)).json()) as {
    controlPoints: { modeToNext: string; segment: unknown[] | null }[];
  };
  return route.controlPoints.slice(0, -1).map((cp) => (cp.segment ? cp.modeToNext : `${cp.modeToNext}:no-line`));
}

/** Where a point is once the map has stopped moving (opening a route animates the zoom to it). */
async function settledBox(page: Page, n: number) {
  const marker = page.locator(`.leaflet-marker-icon[title^="Point ${n}."]`);
  let last = '';
  await expect
    .poll(async () => {
      const box = JSON.stringify(await marker.boundingBox());
      const settled = box === last;
      last = box;
      return settled;
    })
    .toBe(true);
  return (await marker.boundingBox())!;
}

async function dragPoint(page: Page, n: number, dx: number, dy: number) {
  const box = await settledBox(page, n);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await page.mouse.up();
}

test('moving a point of an imported track re-routes its two legs and keeps the rest', async ({ page }) => {
  await signIn(page, uniqueUser('track'));
  const router = await fakeRouter(page);
  const id = await seedImportedRoute(page);
  await page.goto(`/routes/${id}`);
  await expect(page.locator('.leaflet-marker-icon[title^="Point 4."]')).toBeVisible();
  expect(router.requests).toBe(0);

  await dragPoint(page, 2, 0, 80);
  await expect.poll(() => router.requests).toBe(2);
  await saveChanges(page);
  expect(await savedModes(page, id)).toEqual(['snap', 'snap', 'track']);
});

test('a leg that cannot be snapped stays a snap leg until the user chooses a straight line', async ({ page }) => {
  await signIn(page, uniqueUser('snapfail'));
  const router = await fakeRouter(page);
  const id = await seedImportedRoute(page);
  await page.goto(`/routes/${id}`);
  await expect(page.locator('.leaflet-marker-icon[title^="Point 4."]')).toBeVisible();

  // Dropped where there is no trail: a notice, a dashed stand-in, and the route can still be saved.
  router.fail = true;
  await dragPoint(page, 3, 0, 80);
  const notice = page.getByRole('alert').filter({ hasText: 'too far from any trail' });
  await expect(notice).toBeVisible();
  await saveChanges(page);
  expect(await savedModes(page, id)).toEqual(['track', 'snap:no-line', 'snap:no-line']);

  // Moved onto a trail: routed again, and the notice goes away by itself.
  router.fail = false;
  await dragPoint(page, 3, 0, -40);
  await expect(notice).toBeHidden();
  await saveChanges(page);
  expect(await savedModes(page, id)).toEqual(['track', 'snap', 'snap']);

  // Failing again, the user can choose a straight line instead.
  router.fail = true;
  await dragPoint(page, 3, 0, 60);
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Use a straight line' }).click();
  await expect(notice).toBeHidden();
  await saveChanges(page);
  await expectSaved(page);
  expect(await savedModes(page, id)).toEqual(['track', 'freehand', 'freehand']);
});
