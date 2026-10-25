import { test, expect } from '@playwright/test';

const ALL_LOCALES = ['en', 'en-AU', 'ar', 'az', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'es', 'fa', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sv', 'sw', 'th', 'tr', 'uk', 'ur', 'vi', 'zh-CN', 'zh-TW'];

test.describe('Landing demo carousel', () => {
  test('renders multiple scenarios, supports manual navigation and pause', async ({ page }) => {
    await page.goto('/landing.html');
    await expect(page.locator('#demoScenarios .demo-scenario')).toHaveCount(4);
    await expect(page.locator('#demoPlayPause .pause-bars')).toBeVisible();
    await expect(page.locator('#demoThread .bubble.cust')).toBeVisible();
    const first = await page.locator('#demoThread .bubble.cust').innerText();

    await page.locator('#demoScenarios .demo-scenario').nth(1).click();
    await expect(page.locator('#demoThread .bubble.cust')).not.toHaveText(first);
    await expect(page.locator('#demoThread .bubble.ai-b')).toBeVisible();

    await page.locator('#demoNext').click();
    await expect(page.locator('#demoScenarios .demo-scenario').nth(2)).toHaveAttribute('aria-selected', 'true');

    const pause = page.locator('#demoPlayPause');
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'false');
  });

  test('every supported locale renders non-empty demo copy and correct direction', async ({ page }) => {
    await page.goto('/landing.html');
    const select = page.locator('#siteLang');
    await expect(select.locator('option')).toHaveCount(ALL_LOCALES.length);
    for (const locale of ALL_LOCALES) {
      await select.selectOption(locale);
      await expect(page.locator('.chat-demo-wrap')).toHaveAttribute('data-locale', locale);
      await expect(page.locator('.hero h1')).not.toBeEmpty();
      await expect(page.locator('#demoThread .bubble.cust')).not.toBeEmpty();
      await expect(page.locator('#demoTitle')).not.toBeEmpty();
      await expect(page.locator('#demoSubtitle')).not.toBeEmpty();
      await expect(page.locator('#demoScenarios .demo-scenario').first()).not.toBeEmpty();
      await expect(page.locator('#demoReply')).not.toBeEmpty();
      if (!['en', 'en-AU'].includes(locale)) {
        await expect(page.locator('#demoTitle')).not.toHaveText('Watch NudgeSo draft the reply');
      }
      const dir = await page.locator('.chat-demo-wrap').getAttribute('dir');
      expect(dir, locale).toBe(['ar', 'he', 'fa', 'ur'].includes(locale) ? 'rtl' : 'ltr');
    }
  });

  test('falls back to a static readable demo when motion is reduced', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/landing.html');
    await expect(page.locator('.chat-demo-wrap')).toHaveAttribute('data-autoplay', 'off');
    await expect(page.locator('#demoThread .bubble.cust')).toBeVisible();
    await context.close();
  });

  test('fits the landing demo at 390px without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/landing.html');
    await expect(page.locator('.chat-demo-wrap')).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  });

  test('auto-advances to the next conversation when visible and playing', async ({ page }) => {
    test.setTimeout(20_000);
    await page.goto('/landing.html');
    const wrap = page.locator('#demoCarousel');
    await wrap.scrollIntoViewIfNeeded();
    await expect(page.locator('#demoThread .bubble.ai-b')).toBeVisible();
    await page.waitForTimeout(8_500);
    await expect(page.locator('#demoScenarios .demo-scenario').nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('global language selector localizes the landing page and the demo together', async ({ page }) => {
    await page.goto('/landing.html');
    const select = page.locator('#siteLang');
    await expect(select.locator('option')).toHaveCount(ALL_LOCALES.length);
    const englishTitle = await page.locator('.hero h1').innerText();
    await select.selectOption('es');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('.chat-demo-wrap')).toHaveAttribute('data-locale', 'es');
    await expect(page.locator('.hero h1')).not.toHaveText(englishTitle);
    await expect(page.locator('.nav-links a').first()).not.toHaveText('Product');
    await expect(page.locator('#proBilling')).toContainText('mes');
    await expect(page.locator('.pricing-grid .price-card').first().locator('.billing')).not.toHaveText('For a small business trying it out');
    await select.selectOption('ar');
    await expect(page.locator('.chat-demo-wrap')).toHaveAttribute('dir', 'rtl');
    await select.selectOption('en');
    await expect(page.locator('.hero h1')).toHaveText(englishTitle);
  });
});
