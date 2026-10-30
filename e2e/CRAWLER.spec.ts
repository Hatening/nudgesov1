import { test, expect, request as apiRequest, type Page } from './helpers/evidence-test';
import { captureScreenshot } from './helpers/screenshot';

/**
 * CRAWLER — 全站巡航（Tier 1~3）
 *
 * Tier 1  11 个 SPA 视图连通性：逐个导航，断言标题渲染、页面非空、无 console/page 错误
 * Tier 2  猴子测试：把页面上每个 button / submit / select 都点一遍（写接口全部 mock），
 *         断言每次点击都有可观察反应，且不产生 JS 报错
 * Tier 3  鉴权拦截：清空会话后回到登录闸门；未带 token 的 API 必须 401
 *
 * Tier 2 的写操作安全策略：page.route 拦截所有 POST/PUT/PATCH/DELETE，
 * 统一返回 200 {"ok":true}，GET 请求放行，因此不会污染 .data 数据库。
 */

const VIEWS: Array<[string, RegExp]> = [
  ['overview', /Hello/i],
  ['inbox', /Customer messages/i],
  ['assistant', /Try the AI helper/i],
  ['knowledge', /My store info/i],
  ['glossary', /Product words/i],
  ['channels', /Where customers write/i],
  ['languages', /Languages/i],
  ['analytics', /How support is going/i],
  ['tests', /Check answer quality/i],
  ['growth', /Seller briefings/i],
  ['settings', /Settings/i],
];

const EMAIL = () => `crawler-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const PASSWORD = 'TestPass123!';
const MAX_CLICKS_PER_VIEW = 40;

async function registerViaApi(request: any, email: string) {
  const res = await request.post('/api/v1/auth/register', { data: { email, password: PASSWORD } });
  expect(res.status(), 'crawler needs a fresh merchant account').toBe(201);
}

async function loginViaUi(page: Page, email: string) {
  await page.goto('/login.html');
  await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('#loginBtn').click();
  await page.waitForURL(/\/$/, { timeout: 20_000 });
  await page.waitForSelector('.app-shell', { timeout: 15_000 });
  await expect(page.locator('.nav-item[data-page="overview"]')).toBeVisible({ timeout: 15_000 });
}

async function gotoView(page: Page, view: string) {
  await page.keyboard.press('Escape').catch(() => {});
  // Advanced nav items live inside a closed <details>; programmatic click works.
  await page.evaluate((name) => document.querySelector(`.nav-item[data-page="${name}"]`)?.click(), view);
  await expect(page.locator('#page')).toBeVisible();
  await page.waitForTimeout(200);
}

/** 页面可交互控件的快照（只取 #page 内部、可见、未禁用） */
async function controlsOnPage(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('#page') as HTMLElement | null;
    if (!root) return [];
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const style = getComputedStyle(el as HTMLElement);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const list: Array<{ sel: string; label: string; kind: string }> = [];
    const nodes = Array.from(root.querySelectorAll('button, input[type="submit"], select')) as HTMLElement[];
    nodes.forEach((el, i) => {
      if (!visible(el)) return;
      if ((el as HTMLButtonElement).disabled) return;
      if (el.closest('.nav-item')) return;
      const tag = el.tagName.toLowerCase();
      const kind = tag === 'select' ? 'select' : tag === 'input' ? 'submit-input' : 'button';
      const label =
        (el.getAttribute('aria-label') || el.innerText || el.getAttribute('value') || el.getAttribute('data-action') || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 40) || `${kind}#${i}`;
      el.setAttribute('data-crawler-id', String(i));
      list.push({ sel: `[data-crawler-id="${i}"]`, label, kind });
    });
    return list;
  });
}

async function domFingerprint(page: Page) {
  return page.evaluate(() => {
    const text = (document.body as HTMLElement).innerText || '';
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    const toastEl = document.querySelector('#toast') as HTMLElement | null;
    const selects = Array.from(document.querySelectorAll('#page select')) as HTMLSelectElement[];
    const inputs = Array.from(document.querySelectorAll('#page input, #page textarea')) as HTMLInputElement[];
    return {
      bodyHash: h,
      toasts: (window as any).__toastCount ?? 0,
      fields: document.querySelectorAll('#page input, #page textarea, #page select').length,
      fieldValues: inputs.map((i) => i.value).join('|'),
      checked: document.querySelectorAll('#page input:checked').length,
      selectValues: selects.map((s) => s.value).join(','),
      toast: toastEl ? `${toastEl.className}|${toastEl.textContent}` : '',
      dialogs: document.querySelectorAll('.modal, .dialog, .toast, [role="dialog"], [aria-live]').length,
      url: location.href,
    };
  });
}

test.describe('CRAWLER', () => {
  test('Tier 1 — all 11 SPA views render without runtime errors', async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    const email = EMAIL();
    await registerViaApi(request, email);

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });

    await loginViaUi(page, email);
    await captureScreenshot(page, testInfo, 'CRAWLER', 't1-login', { fullPage: false });

    for (const [view, title] of VIEWS) {
      await test.step(`view: ${view}`, async () => {
        await gotoView(page, view);
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

  test('Tier 2 — monkey: every control reacts, writes mocked, no JS errors', async ({ page, request }, testInfo) => {
    test.setTimeout(600_000);
    const email = EMAIL();
    await registerViaApi(request, email);
    await loginViaUi(page, email);

    // --- 写操作全部拦截，避免污染数据库 ---
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    // Headless Chromium 的剪贴板写入可能永不 resolve，导致 toast 不触发。
    // 这里只断言 UI 反应，因此把 clipboard 换成即时 resolve 的 stub。
    await page.evaluate(() => { (window as any).__toastCount = 0; const el = document.querySelector('#toast'); if (el) { new MutationObserver(() => { (window as any).__toastCount += 1; }).observe(el, { childList: true, characterData: true, subtree: true, attributes: true }); } }).catch(() => {});
    // 全局 DOM 变更计数：捕获瞬时反应（按钮变 "Generating…"、重新渲染等）
    await page.evaluate(() => {
      (window as any).__mut = 0;
      new MutationObserver((records) => { (window as any).__mut += records.length; })
        .observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    }).catch(() => {});
    // Headless Chromium 的剪贴板写入会被拒绝；这里只断言 UI 反应，故 stub 掉原型方法。
    await page.evaluate(() => { try { const proto = Object.getPrototypeOf(navigator.clipboard); proto.writeText = async () => {}; proto.readText = async () => ''; } catch { /* ignore */ } }).catch(() => {});

    const mocked: string[] = [];
    await page.route('**/api/**', async (route) => {
      const method = route.request().method();
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const path = new URL(route.request().url()).pathname;
        mocked.push(`${method} ${path}`);
        // 按端点返回形状合理的 payload，避免前端因缺字段而静默无反应
        let body = '{"ok":true}';
        if (path === '/api/chat' || path === '/api/chat/stream') {
          body = JSON.stringify({
            result: {
              answer: 'Mocked answer: your package arrives in 3-5 business days.',
              model: 'mock-model',
              grounded: true,
              confidence: 0.91,
              needsHuman: false,
              language: 'en',
              evidence: [{ title: 'Shipping policy', snippet: 'Standard delivery 5-8 business days.' }],
            },
            reply: {
              answer: 'Mocked answer: your package arrives in 3-5 business days.',
              model: 'mock-model',
              grounded: true,
              confidence: 0.91,
              needsHuman: false,
              evidence: [{ title: 'Shipping policy', snippet: 'Standard delivery 5-8 business days.' }],
            },
          });
        } else if (path === '/api/test/run') {
          body = JSON.stringify({ runs: [{ at: Date.now(), passed: 5, total: 5 }], passed: 5, total: 5 });
        } else if (path.startsWith('/api/knowledge')) {
          body = JSON.stringify({ ok: true, items: [], id: 'mock-id' });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body });
      }
      return route.continue();
    });

    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(`pageerror: ${e.message}`));
    page.on('console', (msg) => { if (msg.type() === 'error') jsErrors.push(`console: ${msg.text()}`); });

    let dialogCount = 0;
    let popupCount = 0;
    let downloadCount = 0;
    page.on('dialog', async (d) => { dialogCount += 1; await d.dismiss().catch(() => {}); });
    page.on('popup', () => { popupCount += 1; });
    page.on('download', (d) => { downloadCount += 1; d.delete().catch(() => {}); });

    const problems: string[] = [];
    let clickedTotal = 0;

    for (const [view] of VIEWS) {
      await test.step(`monkey: ${view}`, async () => {
        await gotoView(page, view);
        const selector = '#page button, #page input[type="submit"], #page select';
        const total = Math.min(await page.locator(selector).count(), MAX_CLICKS_PER_VIEW);

        for (let i = 0; i < total; i++) {
          // 每次点击前回到该视图并重新按索引定位（视图重渲染会丢失任何临时属性）
          await gotoView(page, view);
          const target = page.locator(selector).nth(i);
          if (!(await target.count())) continue;
          if (!(await target.isVisible().catch(() => false))) continue;
          if (await target.isDisabled().catch(() => false)) continue;

          const label = ((await target.innerText().catch(() => '')) || (await target.getAttribute('data-action')) || `#${i}`)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 40);
          const kind = await target.evaluate((el) => el.tagName.toLowerCase());

          const before = await domFingerprint(page);
          await page.evaluate(() => { (window as any).__mut = 0; }).catch(() => {});
          const dialogsBefore = dialogCount;
          const popupsBefore = popupCount;
          const downloadsBefore = downloadCount;
          let clickError: string | null = null;

          try {
            if (kind === 'select') {
              const options = await target.locator('option').count();
              if (options <= 1) continue;
              await target.selectOption({ index: Math.min(1, options - 1) });
            } else {
              await target.click({ timeout: 3_000 });
            }
          } catch (e: any) {
            clickError = String(e?.message || e).split('\n')[0];
          }
          clickedTotal += 1;

          await page.waitForTimeout(300);
          const after = await domFingerprint(page);
          const mutations = await page.evaluate(() => (window as any).__mut ?? 0).catch(() => 0);

          const reacted = mutations > 0 ||
            after.toasts !== before.toasts ||
            after.bodyHash !== before.bodyHash ||
            after.fields !== before.fields ||
            after.fieldValues !== before.fieldValues ||
            after.checked !== before.checked ||
            after.selectValues !== before.selectValues ||
            after.toast !== before.toast ||
            after.dialogs !== before.dialogs ||
            dialogCount > dialogsBefore ||
            popupCount > popupsBefore ||
            downloadCount > downloadsBefore;

          if (clickError) {
            // 被遮挡/不可点属于测试侧问题，记录但不判失败
            problems.push(`${view} / "${label}": click failed (${clickError})`);
          } else if (!reacted) {
            const nativeInvalid = await page.evaluate(() => {
              const el = document.activeElement as HTMLElement | null;
              const form = el?.closest?.('form') as HTMLFormElement | null;
              return !!(form && typeof form.checkValidity === 'function' && !form.checkValidity());
            });
            if (!nativeInvalid) problems.push(`${view} / "${label}": no visible reaction`);
          }
        }
      });
    }

    await captureScreenshot(page, testInfo, 'CRAWLER', 't2-monkey-complete');
    // eslint-disable-next-line no-console
    console.log(`[tier2] clicked=${clickedTotal} mocked-writes=${new Set(mocked).size} unique endpoints`);

    expect(jsErrors, `JS errors during monkey test:\n${jsErrors.join('\n')}`).toEqual([]);
    expect(problems, `controls without feedback:\n${problems.join('\n')}`).toEqual([]);
  });

  test('Tier 3 — auth gate and 401 interception', async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    const email = EMAIL();
    await registerViaApi(request, email);
    await loginViaUi(page, email);

    await page.evaluate(() => {
      localStorage.removeItem('relaydesk_token');
      localStorage.removeItem('relaydesk_refresh_token');
    });
    await page.reload();
    await expect(page).toHaveURL(/landing\.html/, { timeout: 15_000 });
    await expect(
      page.getByRole('heading', { name: /Calm Customer Support/i }),
      'logged-out reload must render the public gate'
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).not.toContainText(/Northstar Goods|support workspace data/i);
    await expect(page.locator('body')).not.toContainText(/Unauthorized|Unable to connect/i);
    await captureScreenshot(page, testInfo, 'CRAWLER', 't3-gate', { fullPage: false });

    const anon = await apiRequest.newContext({ baseURL: process.env.BASE_URL || 'http://127.0.0.1:3030' });
    try {
      for (const path of ['/api/bootstrap', '/api/conversations', '/api/knowledge', '/api/metrics', '/api/v1/sites']) {
        const res = await anon.get(path);
        expect(res.status(), `${path} must be 401 without a token`).toBe(401);
      }
      const health = await anon.get('/api/health');
      expect(health.status(), '/api/health must stay public').toBe(200);
    } finally {
      await anon.dispose();
    }
  });
});
