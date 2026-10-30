import { test, expect } from './helpers/evidence-test';

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

  test('every supported locale renders without page overflow and correct direction', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
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
      const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      if (widths.scroll > widths.client + 1) {
        const offenders = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && getComputedStyle(el).position !== 'fixed' && r.right > window.innerWidth + 1;
        }).slice(0, 8).map((el) => ({ tag: el.tagName, className: String(el.className).slice(0, 80), right: Math.round(el.getBoundingClientRect().right), text: (el.textContent || '').trim().slice(0, 60) })));
        throw new Error(`${locale} overflow ${widths.scroll}/${widths.client}: ${JSON.stringify(offenders)}`);
      }
      expect(widths.scroll, locale).toBeLessThanOrEqual(widths.client + 1);
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

  test('demo canvas keeps a stable height while the reply is typed', async ({ page }) => {
    await page.goto('/landing.html');
    await page.locator('#demoCarousel').scrollIntoViewIfNeeded();
    await page.locator('#demoScenarios .demo-scenario').nth(3).click();
    const before = await page.locator('#demoCarousel').boundingBox();
    await page.waitForTimeout(1_200);
    const after = await page.locator('#demoCarousel').boundingBox();
    expect(before, 'bounding box should exist').not.toBeNull();
    expect(after, 'bounding box should exist').not.toBeNull();
    expect(Math.abs((after?.height || 0) - (before?.height || 0))).toBeLessThan(2);
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
    test.setTimeout(30_000);
    await page.goto('/landing.html');
    const wrap = page.locator('#demoCarousel');
    await wrap.scrollIntoViewIfNeeded();
    await expect(page.locator('#demoThread .bubble.ai-b')).toBeVisible();
    await page.waitForTimeout(11_000);
    await expect(page.locator('#demoScenarios .demo-scenario').nth(1)).toHaveAttribute('aria-selected', 'true');
  });

  test('keeps the brand orange while using the accessible primary orange', async ({ page }) => {
    await page.goto('/landing.html');
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        logo: style.getPropertyValue('--logo-orange').trim(),
        primary: style.getPropertyValue('--orange').trim(),
      };
    });
    expect(tokens.logo.toLowerCase()).toBe('#ee6e3a');
    expect(tokens.primary.toLowerCase()).toBe('#b84a1d');
    await expect(page.locator('img.brand-logo')).toHaveAttribute('src', '/img/logo-full.png');
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
