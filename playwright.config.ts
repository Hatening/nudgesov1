import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the SME NudgeSo Phase 1 acceptance runs.
 *
 * Important:
 * - workers: 1 enforces the SOP single-AC execution discipline.
 * - retries: 0; do not retry failures to green.
 * - screenshot: 'off' on purpose: every AC must call the explicit
 *   captureScreenshot() helper so evidence is deliberate, not incidental.
 * - The harness timeout is an upper bound only; AC timing assertions
 *   (e.g. AC-04 P95 <= 30s) must still be asserted in the test code.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 15 * 60 * 1000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'artifacts/playwright/report' }],
  ],
  outputDir: 'artifacts/playwright/test-results',
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:3030',
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
