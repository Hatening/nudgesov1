import path from 'node:path';
import fs from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Capture an explicit screenshot for SOP evidence and attach it to the
 * Playwright report.
 *
 * Required environment variables:
 *   RUN_ID   - e.g. RUN-20261019-211600-phase1
 *   RUN_DIR  - optional absolute/relative run directory; defaults to
 *              <cwd>/artifacts/runs/<RUN_ID>
 */
export async function captureScreenshot(
  page: Page,
  testInfo: TestInfo,
  acId: string,
  name: string,
  options: { fullPage?: boolean } = {}
): Promise<string> {
  const runId = process.env.RUN_ID;
  if (!runId) {
    throw new Error(
      'RUN_ID is required for screenshot evidence. Set RUN_ID/RUN_DIR before running Playwright (SOP 5.5).'
    );
  }

  const runDir = process.env.RUN_DIR
    ? path.resolve(process.env.RUN_DIR)
    : path.resolve(process.cwd(), 'artifacts', 'runs', runId);

  const screenshotDir = path.join(runDir, 'screenshots');
  await fs.mkdir(screenshotDir, { recursive: true });

  const safe = (value: string) =>
    String(value)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'capture';

  const file = path.join(screenshotDir, `${safe(acId)}-${safe(name)}.png`);

  await page.screenshot({
    path: file,
    fullPage: options.fullPage ?? true,
  });

  await testInfo.attach(`${acId}-${name}`, {
    path: file,
    contentType: 'image/png',
  });

  return file;
}
