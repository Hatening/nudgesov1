import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

async function registerAndSite(request: APIRequestContext) {
  const email = `xbrowser-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const registration = await request.post('/api/v1/auth/register', {
    data: { email, password: 'TestPass123!' }
  });
  expect(registration.status()).toBe(201);
  const auth = await registration.json();
  const token = auth.access_token || auth.token;
  const siteResponse = await request.post('/api/v1/sites', {
    headers: { authorization: `Bearer ${token}` },
    data: { name: 'Cross-browser Site', industry_template: 'retail' }
  });
  expect(siteResponse.status()).toBe(201);
  const { site } = await siteResponse.json();
  return { token, site };
}

async function check(page: Page, route: string, width: number) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.setViewportSize({ width, height: 844 });
  const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(200);
  expect(response?.status(), `${route} @ ${width}`).toBe(200);
  await expect(page.locator('h1').first(), `${route} @ ${width} h1`).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${route} @ ${width} overflow`).toBeLessThanOrEqual(1);
  expect(errors, `${route} @ ${width} page errors`).toEqual([]);
}

test.describe('Cross-browser smoke', () => {
  test('public and authenticated surfaces load without overflow or script errors', async ({ browser, request }) => {
    test.setTimeout(180_000);
    const { token, site } = await registerAndSite(request);
    const publicContext = await browser.newContext();
    const authContext = await browser.newContext();
    await authContext.addInitScript((value) => localStorage.setItem('relaydesk_token', value), token);
    const publicPage = await publicContext.newPage();
    const authPage = await authContext.newPage();

    for (const width of [390, 1440]) {
      for (const route of ['/landing.html', '/login.html', '/onboarding.html', '/404.html']) {
        await check(publicPage, route, width);
      }
      for (const route of ['/', '/queue.html', '/upload.html', `/chat.html?site=${encodeURIComponent(site.embed_key)}`]) {
        await check(authPage, route, width);
      }
    }

    await publicContext.close();
    await authContext.close();
  });
});
