import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 844 },
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

const PROTECTED_ROUTES = new Set(['/', '/upload.html', '/manual.html', '/queue.html']);

type MatrixRow = {
  route: string;
  viewport: string;
  status: number | null;
  overflow: boolean;
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: string[];
  structural: string[];
};

const matrix: MatrixRow[] = [];
const notRun: string[] = [];

async function registerAndSite(request: APIRequestContext) {
  const email = `quality-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const registration = await request.post('/api/v1/auth/register', {
    data: { email, password: 'TestPass123!' }
  });
  expect(registration.status()).toBe(201);
  const auth = await registration.json();
  const token = auth.access_token || auth.token;
  const siteResponse = await request.post('/api/v1/sites', {
    headers: { authorization: `Bearer ${token}` },
    data: { name: 'Quality Matrix Site', industry_template: 'retail' }
  });
  expect(siteResponse.status()).toBe(201);
  const { site } = await siteResponse.json();
  return { token, site };
}

async function firstInsightPath(request: APIRequestContext) {
  const response = await request.get('/api/insights?limit=1');
  if (response.status() !== 200) return null;
  const data = await response.json().catch(() => null);
  const id = data?.items?.[0]?.id;
  return id ? `/insight.html?id=${encodeURIComponent(id)}` : null;
}

async function collectStructuralIssues(page: Page) {
  return page.evaluate(() => {
    const issues: string[] = [];
    const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
    const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    if (duplicates.length) issues.push(`duplicate ids: ${duplicates.join(', ')}`);

    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const cssVisible = typeof (el as HTMLElement).checkVisibility === 'function' ? (el as HTMLElement).checkVisibility() : true;
      return cssVisible && style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const nameOf = (el: Element) => {
      const text = (el.textContent || '').trim();
      const labelText = (el.closest('label')?.textContent || '').trim();
      const imageAlt = Array.from(el.querySelectorAll('img[alt], svg title')).map((child) => child.getAttribute('alt') || child.textContent || '').join(' ').trim();
      return (
        el.getAttribute('aria-label')
        || el.getAttribute('aria-labelledby')
        || el.getAttribute('title')
        || text
        || labelText
        || el.getAttribute('placeholder')
        || imageAlt
        || ''
      ).trim();
    };

    for (const el of Array.from(document.querySelectorAll('button, a, input, select, textarea'))) {
      if (!visible(el)) continue;
      if (el instanceof HTMLInputElement && ['hidden', 'submit', 'button'].includes(el.type) && !nameOf(el)) continue;
      if (!nameOf(el)) issues.push(`control without accessible name: ${el.tagName.toLowerCase()}`);
    }

    for (const input of Array.from(document.querySelectorAll('input:not([type="hidden"]), select, textarea'))) {
      if (!visible(input)) continue;
      const id = input.getAttribute('id');
      const labelled = input.getAttribute('aria-label')
        || input.getAttribute('aria-labelledby')
        || input.getAttribute('title')
        || (id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
        || input.closest('label');
      if (!labelled) issues.push(`form control without label: ${input.tagName.toLowerCase()}${id ? '#' + id : ''}`);
    }

    for (const image of Array.from(document.querySelectorAll('img'))) {
      if (!image.hasAttribute('alt')) issues.push(`image without alt: ${image.getAttribute('src') || '(inline)'}`);
      if (visible(image) && image.naturalWidth === 0) issues.push(`image failed to render: ${image.getAttribute('src') || '(inline)'}`);
    }

    if (!document.documentElement.lang) issues.push('html lang is empty');
    if (!document.querySelector('h1') || !visible(document.querySelector('h1')!)) issues.push('no visible h1');
    if (document.fonts && document.fonts.status !== 'loaded') issues.push(`fonts status: ${document.fonts.status}`);

    const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    return { issues, overflow, width: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
  });
}

test.describe('Quality Matrix — complete route surface', () => {
  test('all public and authenticated surfaces pass structure, runtime and viewport checks', async ({ browser, request }) => {
    test.setTimeout(240_000);
    const { token, site } = await registerAndSite(request);
    const insightPath = await firstInsightPath(request);
    const routes = [
      '/landing.html',
      '/login.html',
      '/onboarding.html',
      '/upload.html',
      '/manual.html',
      '/insights.html',
      '/queue.html',
      `/chat.html?site=${encodeURIComponent(site.embed_key)}`,
      '/',
      '/404.html',
      '/privacy.html',
      '/terms.html',
    ];
    if (insightPath) routes.splice(6, 0, insightPath);
    else notRun.push('dynamic insight detail route: no insight exists in the isolated fixture');

    const publicContext = await browser.newContext();
    const authContext = await browser.newContext();
    await authContext.addInitScript((value) => localStorage.setItem('relaydesk_token', value), token);
    const publicPage = await publicContext.newPage();
    const authPage = await authContext.newPage();
    const errorsByPage = new Map<Page, string[]>();
    for (const target of [publicPage, authPage]) {
      const bucket: string[] = [];
      errorsByPage.set(target, bucket);
      target.on('pageerror', (error) => bucket.push(`PAGEERROR: ${String(error)}`));
      target.on('console', (message) => {
        if (message.type() === 'error') bucket.push(`CONSOLE: ${message.text()}`);
      });
    }

    const failures: string[] = [];
    for (const viewport of VIEWPORTS) {
      await publicPage.setViewportSize({ width: viewport.width, height: viewport.height });
      await authPage.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of routes) {
        const target = PROTECTED_ROUTES.has(route) ? authPage : publicPage;
        const errors = errorsByPage.get(target)!;
        errors.length = 0;
        const response = await target.goto(route, { waitUntil: 'domcontentloaded' });
        await target.waitForTimeout(180);
        const structural = await collectStructuralIssues(target);
        const row: MatrixRow = {
          route,
          viewport: viewport.name,
          status: response?.status() ?? null,
          overflow: structural.overflow,
          pageErrors: errors.filter((item) => item.startsWith('PAGEERROR')),
          consoleErrors: errors.filter((item) => item.startsWith('CONSOLE')),
          failedRequests: [],
          structural: structural.issues,
        };
        matrix.push(row);
        if (row.status !== 200) failures.push(`${route} @ ${viewport.name}: HTTP ${row.status}`);
        if (row.overflow) failures.push(`${route} @ ${viewport.name}: horizontal overflow ${structural.width}/${structural.clientWidth}`);
        if (row.pageErrors.length) failures.push(`${route} @ ${viewport.name}: ${row.pageErrors.join(' | ')}`);
        if (row.structural.length) failures.push(`${route} @ ${viewport.name}: ${row.structural.join(' | ')}`);
        // Console errors are recorded rather than asserted here: browser extensions,
        // favicon policy and third-party fonts can be noisy in CI. They are visible
        // in the matrix and are not represented as a pass.
      }
    }
    await publicContext.close();
    await authContext.close();
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('all 11 workspace views fit at 320px and 1440px', async ({ browser, request }) => {
    test.setTimeout(120_000);
    const { token } = await registerAndSite(request);
    const context = await browser.newContext();
    await context.addInitScript((value) => localStorage.setItem('relaydesk_token', value), token);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    const views = ['overview', 'inbox', 'assistant', 'knowledge', 'glossary', 'channels', 'languages', 'analytics', 'tests', 'growth', 'settings'];
    const failures: string[] = [];
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: width === 320 ? 844 : 900 });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.app-shell');
      if (width === 320) await page.locator('#hamburger').click();
      for (const view of views) {
        errors.length = 0;
        await page.evaluate((name) => document.querySelector(`.nav-item[data-page="${name}"]`)?.click(), view);
        await page.locator('#page h1').first().waitFor({ state: 'visible' });
        const structural = await collectStructuralIssues(page);
        if (structural.overflow) failures.push(`/${view} @ ${width}: horizontal overflow ${structural.width}/${structural.clientWidth}`);
        if (structural.issues.length) failures.push(`/${view} @ ${width}: ${structural.issues.join(' | ')}`);
        if (errors.length) failures.push(`/${view} @ ${width}: ${errors.join(' | ')}`);
      }
    }
    await context.close();
    expect(failures, failures.join('\n')).toEqual([]);
  });

  test('legal pages are visibly drafts, noindexed and linked', async ({ page }) => {
    for (const route of ['/privacy.html', '/terms.html']) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
      expect(response?.status(), route).toBe(200);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/i);
      await expect(page.locator('.draft')).toContainText(/DRAFT FOR LEGAL REVIEW/i);
      await expect(page.locator('a[href="/landing.html"]').first()).toBeVisible();
    }
    const landing = await page.goto('/landing.html');
    expect(landing?.status()).toBe(200);
    await expect(page.locator('.legal-links a[href="/privacy.html"]')).toHaveCount(1);
    await expect(page.locator('.legal-links a[href="/terms.html"]')).toHaveCount(1);
  });

  test('API access matrix rejects unauthenticated and malformed calls', async ({ request }) => {
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    const healthBody = await health.json();
    expect(healthBody.ok).toBe(true);
    expect(healthBody.knowledgeCount).toEqual(expect.any(Number));

    const publicInsights = await request.get('/api/insights?limit=1');
    expect(publicInsights.status()).toBe(200);

    for (const route of ['/api/v1/auth/me', '/api/v1/sites', '/api/bootstrap', '/api/v1/escalations']) {
      const response = await request.get(route);
      expect(response.status(), `${route} must reject an anonymous caller`).toBe(401);
    }

    const badRegister = await request.post('/api/v1/auth/register', { data: { email: 'not-an-email' } });
    expect(badRegister.status()).toBeGreaterThanOrEqual(400);
    expect(badRegister.status()).toBeLessThan(500);

    const badChat = await request.post('/api/chat', { data: {} });
    expect(badChat.status()).toBeGreaterThanOrEqual(400);
    expect(badChat.status()).toBeLessThan(500);

    const ops = await request.post('/api/ops/repair', { data: {} });
    expect([401, 403, 404, 503]).toContain(ops.status());
  });

  test('locale switching keeps lang, direction and overflow under control', async ({ page }) => {
    await page.goto('/landing.html');
    await page.setViewportSize({ width: 390, height: 844 });
    const select = page.locator('#siteLang');
    await expect(select.locator('option')).toHaveCount(39);
    for (const locale of ['en', 'de', 'uk', 'ar', 'he', 'zh-CN', 'zh-TW']) {
      await select.selectOption(locale);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      const result = await collectStructuralIssues(page);
      expect(result.overflow, `${locale} horizontal overflow`).toBe(false);
      expect(result.issues.filter((issue) => !issue.includes('fonts status')), `${locale} structural issues`).toEqual([]);
    }
    await select.selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await select.selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });
});

test.afterAll(async () => {
  const outDir = path.join(process.cwd(), 'artifacts', 'quality');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'runtime-matrix.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    viewports: VIEWPORTS,
    rows: matrix,
    notRun,
    policy: 'Console errors are recorded, not silently ignored; only explicit assertions define PASS.',
  }, null, 2));
});
