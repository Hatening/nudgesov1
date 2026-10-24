import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const HTML_PAGES = [
  '/landing.html',
  '/login.html',
  '/onboarding.html',
  '/upload.html',
  '/manual.html',
  '/insights.html',
  '/insight.html',
  '/queue.html',
  '/chat.html',
];

const DASHBOARD_VIEWS = ['overview', 'inbox', 'assistant', 'knowledge', 'glossary', 'channels', 'languages', 'analytics', 'tests', 'growth', 'settings'];

async function registerAndSite(request: APIRequestContext) {
  const email = `phase13-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const registration = await request.post('/api/v1/auth/register', {
    data: { email, password: 'TestPass123!' }
  });
  expect(registration.status()).toBe(201);
  const auth = await registration.json();
  const token = auth.access_token || auth.token;
  const siteResponse = await request.post('/api/v1/sites', {
    headers: { authorization: `Bearer ${token}` },
    data: { name: 'Phase 13 UI Site', industry_template: 'retail' }
  });
  expect(siteResponse.status()).toBe(201);
  const { site } = await siteResponse.json();
  return { token, site };
}

async function setLocale(page: Page, locale: string) {
  await page.addInitScript((value) => localStorage.setItem('relaydesk_locale', value), locale);
}

async function firstInsightPath(request: APIRequestContext) {
  const response = await request.get('/api/insights?limit=1');
  if (response.status() !== 200) return null;
  const data = await response.json();
  const id = data?.items?.[0]?.id;
  return id ? `/insight.html?id=${encodeURIComponent(id)}` : null;
}

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
  expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe('Phase 13 — UI link, language and layout matrix', () => {
  test('all independent pages load with auth, no JS errors and no 390px overflow', async ({ page, request }) => {
    test.setTimeout(120_000);
    const { token, site } = await registerAndSite(request);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.addInitScript((value) => localStorage.setItem('relaydesk_token', value), token);
    await page.setViewportSize({ width: 390, height: 844 });

    const insightPath = await firstInsightPath(request);
    const routes = HTML_PAGES.filter((route) => route !== '/insight.html');
    if (insightPath) routes.splice(5, 0, insightPath);

    for (const route of routes) {
      const url = route === '/chat.html' ? `${route}?site=${encodeURIComponent(site.embed_key)}&lang=en` : route;
      const response = await page.goto(url);
      expect(response?.status(), route).toBe(200);
      await expect(page.locator('h1').first(), route).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }

    await page.addInitScript((value) => localStorage.setItem('relaydesk_token', value), token);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.locator('.app-shell')).toBeVisible();
    await page.locator('details.advanced-fold').evaluate((details) => { details.open = true; });
    for (const view of DASHBOARD_VIEWS) {
      await page.locator(`.nav-item[data-page="${view}"]`).click();
      await expect(page.locator('#page h1').first(), view).toBeVisible();
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('all internal links resolve (page + asset + health links)', async ({ request }) => {
    test.setTimeout(120_000);
    const { token, site } = await registerAndSite(request);
    const headers = { authorization: `Bearer ${token}` };
    const pages = [
      '/', '/landing.html', '/login.html', '/onboarding.html', '/upload.html',
      '/manual.html', '/insights.html', '/insight.html', '/queue.html',
      `/chat.html?site=${encodeURIComponent(site.embed_key)}`
    ];
    const seen = new Set<string>();
    for (const pagePath of pages) {
      const response = await request.get(pagePath, { headers });
      expect(response.status(), pagePath).toBe(200);
      const html = await response.text();
      for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
        const raw = match[1];
        if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue;
        const url = new URL(raw, process.env.BASE_URL || 'http://127.0.0.1:3030');
        if (url.origin !== new URL(process.env.BASE_URL || 'http://127.0.0.1:3030').origin) continue;
        if (url.pathname.startsWith('/api/') && url.pathname !== '/api/health') continue;
        if (url.pathname === '/insight.html') continue; // dynamic id link is covered by INSIGHTS.spec.ts
        if (seen.has(url.href)) continue;
        seen.add(url.href);
        const checked = await request.get(url.pathname + url.search, { headers });
        expect(checked.status(), url.href).toBeLessThan(400);
      }
    }
    expect(seen.size).toBeGreaterThan(8);
  });

  test('zh / en / ar onboarding have correct direction and no CJK leak in English/Arabic', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto('/onboarding.html?lang=en');
    await expect(page.locator('.intro .eyebrow')).toHaveText('4 steps · about 5 minutes');
    await expect(page.locator('.step-tag').first()).toHaveText('Step 1 of 4');
    await expect(page.locator('#siteName')).toHaveAttribute('placeholder', 'e.g. Northstar Goods');
    const enText = await page.evaluate(() => {
      document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('hidden'));
      return document.querySelector('main')?.innerText || '';
    });
    expect(enText).not.toMatch(/[\u4e00-\u9fff]/);

    await page.goto('/onboarding.html?lang=ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    const arText = await page.evaluate(() => {
      document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('hidden'));
      return document.querySelector('main')?.innerText || '';
    });
    expect(arText).not.toMatch(/[\u4e00-\u9fff]/);

    await page.goto('/onboarding.html?lang=zh');
    await expect(page.locator('.intro .eyebrow')).toContainText('4 步');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  test('queue and chat render English/Arabic without Chinese leftovers', async ({ page, request }) => {
    const { token, site } = await registerAndSite(request);
    const messageResponse = await request.post(`/api/v1/public/${site.embed_key}/messages`, {
      data: { message: '我要退款' }
    });
    expect(messageResponse.status()).toBe(200);
    const messageBody = await messageResponse.json();
    expect(messageBody.escalation_id, JSON.stringify(messageBody)).toBeTruthy();
    await page.addInitScript((value) => localStorage.setItem('relaydesk_token', value), token);
    await page.goto('/queue.html?lang=en');
    await expect(page.locator('#escalationRows .urgent-row')).toHaveCount(1);
    const queueChrome = await page.evaluate(() => {
      const clone = document.querySelector('main')?.cloneNode(true) as HTMLElement | undefined;
      clone?.querySelectorAll('.message-cell').forEach((cell) => { cell.textContent = ''; });
      return clone?.textContent || '';
    });
    expect(queueChrome).not.toMatch(/[\u4e00-\u9fff]/);
    await page.screenshot({ path: path.join(process.env.RUN_DIR || 'artifacts', 'phase13-queue-en.png'), fullPage: true });

    await page.goto('/queue.html?lang=ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#escalationRows .urgent-row')).toHaveCount(1);
    const queueChromeAr = await page.evaluate(() => {
      const clone = document.querySelector('main')?.cloneNode(true) as HTMLElement | undefined;
      clone?.querySelectorAll('.message-cell').forEach((cell) => { cell.textContent = ''; });
      return clone?.textContent || '';
    });
    expect(queueChromeAr).not.toMatch(/[\u4e00-\u9fff]/);

    await page.goto(`/chat.html?site=${encodeURIComponent(site.embed_key)}&lang=ar`);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('#consentButton')).toBeVisible();
    await page.screenshot({ path: path.join(process.env.RUN_DIR || 'artifacts', 'phase13-chat-ar.png'), fullPage: true });
  });

  test('10 high-value locales load without CJK leakage (European) and stay within 390px', async ({ page }) => {
    const runDir = process.env.RUN_DIR || 'artifacts';
    await fs.mkdir(runDir, { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const locale of ['es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'ru']) {
      await page.goto(`/onboarding.html?lang=${locale}`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('.intro h1')).not.toBeEmpty();
      await assertNoHorizontalOverflow(page);
      const text = await page.evaluate(() => {
        document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('hidden'));
        return document.querySelector('main')?.innerText || '';
      });
      if (locale !== 'ja' && locale !== 'ko') {
        expect(text, locale).not.toMatch(/[\u4e00-\u9fff]/);
      }
      await page.screenshot({ path: path.join(runDir, `phase13-onboarding-${locale}.png`), fullPage: true });
    }
  });

  test('capture zh/en/ar onboarding visual evidence', async ({ page }) => {
    const runDir = process.env.RUN_DIR || 'artifacts';
    await fs.mkdir(runDir, { recursive: true });
    for (const locale of ['zh', 'en', 'ar']) {
      await page.goto(`/onboarding.html?lang=${locale}`);
      await expect(page.locator('.intro h1')).toBeVisible();
      await page.screenshot({
        path: path.join(runDir, `phase13-onboarding-${locale}.png`),
        fullPage: true
      });
    }
  });
});
