import { defineConfig, devices } from '@playwright/test';

const PORT = 5180;

/** End-to-end tests run against the local API (in-memory store, pinned seed date) and the Vite app. */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.001 } },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  updateSnapshots: 'missing',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: 'pnpm exec tsx scripts/dev-server.ts',
          url: 'http://localhost:8888/api/v1/healthz',
          reuseExistingServer: false,
          env: { DATA_STORE: 'memory', SEED_NOW: '2026-11-12T06:00:00.000Z', API_PORT: '8888' },
        },
        { command: `pnpm --filter web exec vite --port ${PORT} --strictPort`, url: `http://localhost:${PORT}/login`, reuseExistingServer: false },
      ],
});
