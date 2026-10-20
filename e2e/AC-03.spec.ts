import { test, expect } from '@playwright/test';
import { captureScreenshot } from './helpers/screenshot';

test('AC-03 refund/complaint -> safe template + escalation queue', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);

  const email = `qa-ac03-${Date.now()}@example.test`;
  const password = 'TestPass123!';
  const register = await request.post('/api/v1/auth/register', {
    data: { email, password }
  });
  expect(register.status()).toBe(201);
  const registration = await register.json();
  expect(registration.token).toBeTruthy();

  const siteResponse = await request.post('/api/v1/sites', {
    headers: { authorization: `Bearer ${registration.token}` },
    data: { name: `QA AC-03 Site ${Date.now()}`, industry_template: 'retail' }
  });
  expect(siteResponse.status()).toBe(201);
  const { site } = await siteResponse.json();
  expect(site.embed_key).toBeTruthy();

  await page.goto(`/chat.html?site=${encodeURIComponent(site.embed_key)}`);
  await page.getByRole('button', { name: /同意|agree|consent/i }).click();
  await expect(page.locator('#messageInput')).toBeEnabled();

  async function send(message: string) {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/public/') &&
        response.request().method() === 'POST' &&
        response.url().endsWith('/messages')
    );
    await page.locator('#messageInput').fill(message);
    await page.locator('#sendButton').click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    return response.json();
  }

  const refund = await send('我要退款，订单号 12345');
  expect(refund.reply.need_human).toBe(true);
  expect(refund.reply.text).toMatch(/已收到/);
  expect(refund.reply.text).toMatch(/商家会尽快联系|商家会尽快处理/);
  expect(refund.reply.text).not.toMatch(/可以退款|保证退款|今天处理|赔偿/);
  expect(refund.escalation_id).toBeTruthy();
  await captureScreenshot(page, testInfo, 'AC-03', 'step-safe-template');

  await expect(page.locator('#messageInput')).toBeEnabled();
  const complaint = await send('我要投诉你们');
  expect(complaint.reply.need_human).toBe(true);
  expect(complaint.reply.text).toMatch(/已收到/);
  expect(complaint.reply.text).not.toMatch(/可以退款|保证退款|今天处理|赔偿/);
  expect(complaint.escalation_id).toBeTruthy();

  // Merchant admin queue: use the same test merchant token.
  await page.addInitScript((token) => {
    localStorage.setItem('relaydesk_token', token);
  }, registration.token);
  await page.goto('/queue.html');

  const rows = page.locator('#escalationRows [data-escalation-id]');
  await expect(rows).toHaveCount(2, { timeout: 10_000 });
  await expect(page.locator('#escalationRows')).toContainText('我要退款');
  await expect(page.locator('#escalationRows')).toContainText('我要投诉');
  for (let index = 0; index < 2; index++) {
    await expect(rows.nth(index)).toHaveAttribute('data-risk', 'high');
    await expect(rows.nth(index)).toHaveAttribute('data-status', 'pending');
  }
  await captureScreenshot(page, testInfo, 'AC-03', 'step-escalation-queue');
  await captureScreenshot(page, testInfo, 'AC-03', 'final');
});
