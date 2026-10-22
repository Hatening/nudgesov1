import { test, expect } from '@playwright/test';
import { captureScreenshot } from './helpers/screenshot';

test.use({ viewport: { width: 390, height: 844 } });

const VIEWS = ['overview', 'inbox', 'assistant', 'knowledge', 'glossary', 'channels', 'languages', 'analytics', 'tests', 'growth', 'settings'];

test('P3-07 UI: 390px chat, onboarding, 11 views, queue and public pages fit without horizontal overflow', async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const email = `qa-ui390-${Date.now()}@example.test`;
  const password = 'TestPass123!';
  const registration = await request.post('/api/v1/auth/register', { data: { email, password } });
  expect(registration.status()).toBe(201);
  const auth = await registration.json();
  const siteResponse = await request.post('/api/v1/sites', {
    headers: { authorization: `Bearer ${auth.token}` },
    data: { name: `QA UI390 Site ${Date.now()}`, industry_template: 'retail' }
  });
  expect(siteResponse.status()).toBe(201);
  const { site } = await siteResponse.json();
  await request.post(`/api/v1/public/${site.embed_key}/messages`, { data: { message: '我要退款，订单号 390' } });

  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  await page.goto(`/chat.html?site=${encodeURIComponent(site.embed_key)}`);
  await expect(page.getByRole('heading', { name: /隐私提示|privacy notice/i })).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
  await captureScreenshot(page, testInfo, 'UI-390', 'chat-privacy');
  await page.getByRole('button', { name: /同意|agree|consent/i }).click();
  await expect(page.locator('#messageInput')).toBeEnabled();
  expect(await overflow()).toBeLessThanOrEqual(1);
  await captureScreenshot(page, testInfo, 'UI-390', 'chat');

  await page.goto('/onboarding.html');
  await expect(page.getByRole('heading', { name: /一步步把客服装好|onboarding/i }).first()).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
  await captureScreenshot(page, testInfo, 'UI-390', 'onboarding');

  await page.addInitScript((token) => localStorage.setItem('relaydesk_token', token), auth.token);
  await page.goto('/');
  await page.waitForSelector('.app-shell');
  await expect(page.locator('#hamburger')).toBeVisible();
  await page.locator('#hamburger').click();
  expect(await overflow()).toBeLessThanOrEqual(1);

  for (const view of VIEWS) {
    await page.evaluate((name) => document.querySelector(`.nav-item[data-page="${name}"]`)?.click(), view);
    await expect(page.locator('#page h1').first()).toBeVisible();
    expect(await overflow(), `${view} overflows at 390px`).toBeLessThanOrEqual(1);
  }
  await captureScreenshot(page, testInfo, 'UI-390', 'dashboard-views');

  await page.goto('/queue.html');
  await expect(page.getByRole('heading', { name: /需要你处理的问题|escalation queue/i })).toBeVisible();
  await expect(page.locator('#escalationRows [data-escalation-id]')).toHaveCount(1, { timeout: 10_000 });
  expect(await overflow()).toBeLessThanOrEqual(1);
  await captureScreenshot(page, testInfo, 'UI-390', 'queue');

  for (const path of ['/insights.html', '/upload.html', '/manual.html']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
    expect(await overflow(), `${path} overflows at 390px`).toBeLessThanOrEqual(1);
    await captureScreenshot(page, testInfo, 'UI-390', path.replace(/[^a-z]/gi, '-'));
  }
});
