# E2E / Playwright — Phase 1

This directory is prepared for the five Phase 1 acceptance tests. **No AC test
has been written yet**, per the execution instruction to stop after environment
setup.

## Rules

- One AC per spec file: `AC-01.spec.ts` ... `AC-05.spec.ts`.
- One AC per run; do not run multiple AC specs together.
- Every AC must explicitly capture at least two screenshots using
  `captureScreenshot()`; do not rely on Playwright's automatic failure screenshot.
- Set `RUN_ID` and (optionally) `RUN_DIR` before running.

## Screenshot helper

```ts
import { test } from '@playwright/test';
import { captureScreenshot } from './helpers/screenshot';

test('AC-01 ...', async ({ page }, testInfo) => {
  await page.goto('/');
  await captureScreenshot(page, testInfo, 'AC-01', 'step-template');
  // ... assertions ...
  await captureScreenshot(page, testInfo, 'AC-01', 'final');
});
```

Run:

```powershell
$env:RUN_ID = 'RUN-20261019-211600-phase1'
$env:RUN_DIR = "artifacts\runs\$env:RUN_ID"
npx playwright test e2e/AC-01.spec.ts --project=chromium --workers=1
```

Screenshots are written to:

```text
artifacts/runs/<RUN_ID>/screenshots/AC-01-<name>.png
```

## Configuration

`playwright.config.ts` at the project root provides:

- `workers: 1`
- Chromium project
- `baseURL: http://127.0.0.1:3030`
- `retries: 0` and `forbidOnly: true`
- explicit-screenshot policy (`screenshot: 'off'`; use the helper)
