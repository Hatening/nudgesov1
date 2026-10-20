import { test, expect } from '@playwright/test';
import { captureScreenshot } from './helpers/screenshot';

test.use({ viewport: { width: 390, height: 844 } });

test('P3-07 UI: customer chat, onboarding and queue fit 390px without horizontal overflow', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
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
  await request.post(`/api/v1/public/${site.embed_key}/messages`, {
    data: { message: '我要退款，订单号 390' }
  });

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
  await expect(page.getByRole('heading', { name: /商家登录|merchant|onboarding/i }).first()).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
  await captureScreenshot(page, testInfo, 'UI-390', 'onboarding');

  await page.addInitScript((token) => localStorage.setItem('relaydesk_token', token), auth.token);
  await page.goto('/queue.html');
  await expect(page.getByRole('heading', { name: /升级队列|escalation queue/i })).toBeVisible();
  await expect(page.locator('#escalationRows [data-escalation-id]')).toHaveCount(1, { timeout: 10_000 });
  expect(await overflow()).toBeLessThanOrEqual(1);
  await captureScreenshot(page, testInfo, 'UI-390', 'queue');
});
