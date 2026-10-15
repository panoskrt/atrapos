import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the running stack (API + built SPA + mock Suunto):
 *   docker compose -f docker-compose.yml -f docker-compose.e2e.yml up --build -d
 *   npm run e2e
 * Each test signs in as its own mock Suunto user, so tests don't see each other's data.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
