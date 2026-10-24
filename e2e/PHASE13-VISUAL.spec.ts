import { test, expect } from '@playwright/test';

// Opt-in local pixel gate. Baselines are generated on the release workstation;
// CI keeps the cross-platform DOM/geometry gates instead of pretending a
// Windows screenshot baseline is valid on Linux.
const enabled = process.env.VISUAL_TEST === '1';

test.describe('Phase 13 — onboarding visual regression', () => {
  test.skip(!enabled, 'opt-in: run npm run test:visual');

  for (const locale of ['zh', 'en', 'ar']) {
    test(`onboarding ${locale} matches its visual baseline`, async ({ page }) => {
      await page.goto(`/onboarding.html?lang=${locale}`);
      await expect(page.locator('.intro h1')).toBeVisible();
      await expect(page).toHaveScreenshot(`onboarding-${locale}.png`, {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixelRatio: 0.02
      });
    });
  }
});
