import { test, expect } from '@playwright/test';

/**
 * Cross-page context contract:
 * the language selected on the marketing page must survive navigation into
 * onboarding, and it must not silently fall back to the Chinese default.
 */
test.describe('Language context across the pricing → onboarding boundary', () => {
  test('default English pricing keeps every onboarding entry in English', async ({ page }) => {
    await page.goto('/landing.html');
    await expect(page.locator('.hero h1')).toHaveText('Calm Customer Support for small businesses');

    const links = page.locator('a[href*="/onboarding.html"]');
    const count = await links.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(links.nth(i)).toHaveAttribute('href', /[?&]lang=en(?:&|$)/);
    }

    await page.locator('.price-card.pro a').click();
    await expect(page).toHaveURL(/\/onboarding\.html\?.*lang=en/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('body')).toHaveAttribute('data-page', 'onboarding');
    await expect(page.locator('h1').first()).not.toContainText('跟着走');
    await expect(page.locator('h1').first()).not.toContainText('一步步');
  });

  test('Spanish selection survives the preview CTA and refresh', async ({ page }) => {
    await page.goto('/landing.html');
    await page.locator('#siteLang').selectOption('es');
    await expect(page.locator('.hero h1')).not.toHaveText('Calm Customer Support for small businesses');

    const links = page.locator('a[href*="/onboarding.html"]');
    const count = await links.count();
    for (let i = 0; i < count; i += 1) {
      await expect(links.nth(i)).toHaveAttribute('href', /[?&]lang=es(?:&|$)/);
    }

    await page.reload();
    await expect(page.locator('#siteLang')).toHaveValue('es');
    await page.locator('.price-card.pro a').click();
    await expect(page).toHaveURL(/\/onboarding\.html\?.*lang=es/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('h1').first()).not.toContainText('跟着走');
  });

  test('Arabic selection carries RTL into onboarding', async ({ page }) => {
    await page.goto('/landing.html');
    await page.locator('#siteLang').selectOption('ar');
    await page.locator('a[href*="/onboarding.html"]').first().click();
    await expect(page).toHaveURL(/\/onboarding\.html\?.*lang=ar/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
