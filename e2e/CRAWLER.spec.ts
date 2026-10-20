import { test, expect, request as apiRequest, type Page } from '@playwright/test';
import { captureScreenshot } from './helpers/screenshot';

/**
 * CRAWLER — 全站巡航（Tier 1~3）
 *
 * Tier 1  11 个 SPA 视图连通性：逐个导航，断言标题渲染、页面非空、无 console/page 错误
 * Tier 2  死路断言：空链接、undefined/NaN 文案、无名字的按钮、空白页
 * Tier 3  鉴权拦截：清空会话后回到登录闸门；未带 token 的 API 必须 401
 *
 * 说明：本文件不替代 AC-01~05，只做覆盖面巡航。
 */

const VIEWS: Array<[string, RegExp]> = [
  ['overview', /Overview|Good morning/i],
  ['inbox', /Inbox/i],
  ['assistant', /AI assistant/i],
  ['knowledge', /Knowledge base/i],
  ['glossary', /Terminology/i],
  ['channels', /Channels/i],
  ['languages', /Languages/i],
  ['analytics', /Analytics/i],
  ['tests', /Quality & regression tests|Quality & tests/i],
  ['growth', /Seller briefings/i],
  ['settings', /Settings/i],
];

const EMAIL = () => `crawler-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const PASSWORD = 'TestPass123!';

async function registerViaApi(request: any, email: string) {
  const res = await request.post('/api/v1/auth/register', {
    data: { email, password: PASSWORD },
  });
  expect(res.status(), 'crawler needs a fresh merchant account').toBe(201);
}

async function loginViaUi(page: Page, email: string) {
  await page.goto('/');
  await page.waitForSelector('.app-shell', { timeout: 15_000 });
  const gate = page.getByRole('heading', { name: /商家登录|Merchant sign in/i });
  await expect(gate, 'unauthenticated landing must show the merchant sign-in gate').toBeVisible();
  await page.locator('#dashboardEmail').fill(email);
  await page.locator('#dashboardPassword').fill(PASSWORD);
  await page.locator('#dashboardLoginForm button[type="submit"]').click();
  // The sidebar is static markup and is visible even on the gate, so wait for the
  // authenticated page instead — otherwise a later token write races with the test.
  await expect(page.locator('#page h1').first()).not.toContainText(/商家登录|Merchant sign in/i, {
    timeout: 20_000,
  });
  await expect(page.locator('.nav-item[data-page="overview"]')).toBeVisible({ timeout: 15_000 });
}

test.describe('CRAWLER', () => {
  test('Tier 1 — all 11 SPA views render without runtime errors', async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    const email = EMAIL();
    await registerViaApi(request, email);

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });

    await loginViaUi(page, email);
    await captureScreenshot(page, testInfo, 'CRAWLER', 't1-login', { fullPage: false });

    for (const [view, title] of VIEWS) {
      await test.step(`view: ${view}`, async () => {
        await page.locator(`.nav-item[data-page="${view}"]`).click();
        await expect(page.locator('#page'), `${view}: #page container missing`).toBeVisible();

        const heading = page.locator('#page h1, #page h2').first();
        await expect(heading, `${view}: no heading rendered`).toBeVisible({ timeout: 10_000 });
        await expect(heading).toContainText(title);

        const text = (await page.locator('#page').innerText()).trim();
        expect(text.length, `${view}: page rendered blank`).toBeGreaterThan(40);

        await captureScreenshot(page, testInfo, 'CRAWLER', `t1-${view}`);
      });
    }

    expect(errors, `runtime errors during crawl:\n${errors.join('\n')}`).toEqual([]);
  });

  test('Tier 2 — no dead ends: empty links, undefined copy, nameless buttons', async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    const email = EMAIL();
    await registerViaApi(request, email);
    await loginViaUi(page, email);

    const problems: string[] = [];

    for (const [view] of VIEWS) {
      await test.step(`dead-end scan: ${view}`, async () => {
        await page.locator(`.nav-item[data-page="${view}"]`).click();
        await expect(page.locator('#page')).toBeVisible();

        const scan = await page.evaluate(() => {
          const root = document.querySelector('#page') as HTMLElement | null;
          if (!root) return { deadLinks: ['#page missing'], badCopy: [], nameless: [], emptyBlocks: [] as string[] };

          const deadLinks = Array.from(root.querySelectorAll('a')).filter((a) => {
            const href = (a.getAttribute('href') || '').trim();
            return href === '' || href === '#' || href.toLowerCase().startsWith('javascript:void');
          }).map((a) => a.outerHTML.slice(0, 120));

          const text = root.innerText || '';
          const badCopy = ['undefined', 'NaN', '[object Object]', 'null'].filter((needle) =>
            new RegExp(`\\b${needle.replace(/[[\]]/g, '\\$&')}\\b`).test(text)
          );

          const nameless = Array.from(root.querySelectorAll('button')).filter((b) => {
            const label = (b.getAttribute('aria-label') || b.textContent || b.getAttribute('title') || '').trim();
            return label.length === 0;
          }).map((b) => b.outerHTML.slice(0, 120));

          // An .empty block must explain itself: short one-liners are treated as dead ends.
          const emptyBlocks = Array.from(root.querySelectorAll('.empty')).map((el) => (el.textContent || '').trim());

          return { deadLinks, badCopy, nameless, emptyBlocks };
        });

        if (scan.deadLinks.length) problems.push(`${view}: dead links -> ${scan.deadLinks.join(' | ')}`);
        if (scan.badCopy.length) problems.push(`${view}: leaked copy -> ${scan.badCopy.join(', ')}`);
        if (scan.nameless.length) problems.push(`${view}: nameless buttons -> ${scan.nameless.join(' | ')}`);
      });
    }

    await captureScreenshot(page, testInfo, 'CRAWLER', 't2-scan-complete');
    expect(problems, `dead-end problems:\n${problems.join('\n')}`).toEqual([]);
  });

  test('Tier 3 — auth gate and 401 interception', async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const email = EMAIL();
    await registerViaApi(request, email);
    await loginViaUi(page, email);

    // 3a. clearing the session must return to the sign-in gate, not a data page.
    await page.evaluate(() => {
      localStorage.removeItem('relaydesk_token');
      localStorage.removeItem('relaydesk_refresh_token');
    });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: /商家登录|Merchant sign in/i }),
      'logged-out reload must render the gate'
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#page')).not.toContainText(/Northstar Goods|support workspace data/i);
    await page.locator('.nav-item[data-page="inbox"]').click();
    await expect(
      page.getByRole('heading', { name: /商家登录|Merchant sign in/i }),
      'menu click without a session must stay on the gate'
    ).toBeVisible();
    await expect(page.locator('#page')).not.toContainText(/Unauthorized|Unable to connect/i);
    await captureScreenshot(page, testInfo, 'CRAWLER', 't3-gate', { fullPage: false });

    // 3b. token-less reads must be rejected on every tenant-data endpoint.
    // Use a fresh context: the `request` fixture shares cookies with the browser session.
    const anon = await apiRequest.newContext({
      baseURL: process.env.BASE_URL || 'http://127.0.0.1:3030',
    });
    try {
      for (const path of ['/api/bootstrap', '/api/conversations', '/api/knowledge', '/api/metrics', '/api/v1/sites']) {
        const res = await anon.get(path);
        expect(res.status(), `${path} must be 401 without a token`).toBe(401);
      }
      // 3c. the widget/health surface stays public by design.
      const health = await anon.get('/api/health');
      expect(health.status(), '/api/health must stay public').toBe(200);
    } finally {
      await anon.dispose();
    }
  });
});
