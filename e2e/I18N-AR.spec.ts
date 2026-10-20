import { test, expect } from '@playwright/test';
import { captureScreenshot } from './helpers/screenshot';

test('P3-08 i18n: Arabic RTL for chat, onboarding and queue', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  const overflow = async () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  const email = `qa-i18n-${Date.now()}@example.test`;
  const registration = await request.post('/api/v1/auth/register', {
    data: { email, password: 'TestPass123!' }
  });
  expect(registration.status()).toBe(201);
  const auth = await registration.json();
  const siteResponse = await request.post('/api/v1/sites', {
    headers: { authorization: `Bearer ${auth.token}` },
    data: { name: `QA i18n Site ${Date.now()}`, industry_template: 'retail' }
  });
  expect(siteResponse.status()).toBe(201);
  const { site } = await siteResponse.json();

  await page.goto(`/chat.html?site=${encodeURIComponent(site.embed_key)}&lang=ar`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'إشعار الخصوصية' })).toBeVisible();
  await expect(page.locator('#consentButton')).toContainText('أوافق وأتابع');
  await expect(page.locator('.language-switch')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
  await captureScreenshot(page, testInfo, 'I18N-AR', 'chat-privacy');
  await page.locator('#consentButton').click();
  await expect(page.locator('#messageInput')).toBeEnabled();
  await expect(page.locator('#messageInput')).toHaveAttribute('placeholder', 'اكتب رسالة…');
  await expect(page.locator('.chat-footer')).toContainText('ردود نصية فقط');
  await captureScreenshot(page, testInfo, 'I18N-AR', 'chat');

  await page.goto('/onboarding.html?lang=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: /أطلق موقع الدعم/ })).toBeVisible();
  await expect(page.locator('#authTitle')).toContainText('تسجيل');
  await expect(page.locator('.steps li').first()).toContainText('الحساب');
  await expect(page.locator('.language-switch')).toBeVisible();
  expect(await overflow()).toBeLessThanOrEqual(1);
  await captureScreenshot(page, testInfo, 'I18N-AR', 'onboarding');

  await request.post(`/api/v1/public/${site.embed_key}/messages`, {
    data: { message: '我要退款，订单号 12345' }
  });

  await page.addInitScript((token) => localStorage.setItem('relaydesk_token', token), auth.token);
  await page.goto('/queue.html?lang=ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'قائمة التصعيد' })).toBeVisible();
  await expect(page.locator('#refreshButton')).toContainText('تحديث');
  await expect(page.locator('#escalationRows [data-escalation-id]')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.locator('#escalationRows [data-action="resolve"]')).toContainText('تحديد');
  expect(await overflow()).toBeLessThanOrEqual(1);
  await captureScreenshot(page, testInfo, 'I18N-AR', 'queue');
});
