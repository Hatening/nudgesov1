import { test as base, expect, request } from '@playwright/test';

export { expect, request };
export type { APIRequestContext, BrowserContext, Page } from '@playwright/test';

/**
 * Evidence fixture used by every Playwright spec.
 * It captures a final screenshot after the test body and attaches it to the
 * Playwright result, so a skipped/failed/aborted test cannot silently omit
 * evidence. The reporter then exports the attachment paths to JSON for the
 * Word report builder.
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await use(page);
    try {
      if (!page.isClosed()) {
        const screenshotPath = testInfo.outputPath('final-screenshot.png');
        await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 5_000, animations: 'disabled', caret: 'hide' });
        await testInfo.attach('final-screenshot', {
          path: screenshotPath,
          contentType: 'image/png'
        });
      }
    } catch {
      // A test may intentionally close or crash its page. The result still
      // carries the test status and any trace captured by Playwright.
    }
  }
});
