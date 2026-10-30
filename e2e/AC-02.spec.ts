import { test, expect } from './helpers/evidence-test';
import { captureScreenshot } from './helpers/screenshot';

function compact(text: string) {
  return String(text).replace(/\s+/g, '');
}

function hasOpeningHours(text: string) {
  const value = compact(text);
  const close = value.search(/(?:晚上|晚)(?:9|九)(?:点|[:：]00)|21[:：]00/);
  const open = value.search(/(?:早上|上午|早晨|每天|每日)?(?:9|九)(?:点|[:：]00)/);
  return open >= 0 && (close < 0 || open < close);
}

function hasClosingHours(text: string) {
  const value = compact(text);
  return /(?:晚上|晚)(?:9|九)(?:点|[:：]00)/.test(value) || /21[:：]00/.test(value) || /(?:09|9)[:：]00(?:-|~|到|至)21[:：]00/.test(value);
}

test('AC-02 customer chat: privacy consent -> Chinese message -> Chinese text reply', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);

  // Setup: create a merchant + site through the AC-01 backend, then exercise the
  // customer-facing window via its embed key. This keeps AC-02 independent of
  // a previous test run while reusing the AC-01 onboarding APIs.
  const email = `qa-ac02-${Date.now()}@example.test`;
  const password = 'TestPass123!';
  const register = await request.post('/api/v1/auth/register', {
    data: { email, password }
  });
  expect(register.status()).toBe(201);
  const registration = await register.json();
  expect(registration.token).toBeTruthy();

  const siteResponse = await request.post('/api/v1/sites', {
    headers: { authorization: `Bearer ${registration.token}` },
    data: { name: `QA AC-02 Site ${Date.now()}`, industry_template: 'restaurant' }
  });
  expect(siteResponse.status()).toBe(201);
  const { site } = await siteResponse.json();
  expect(site.embed_key).toBeTruthy();

  // The real-model acceptance must give the model grounded evidence to answer from.
  const upload = await request.post(`/api/v1/sites/${site.id}/kb/upload`, {
    headers: { authorization: `Bearer ${registration.token}` },
    data: {
      filename: 'hours.txt',
      title: '营业时间 / Store hours',
      content: '营业时间：每天 09:00-21:00。下班时间 21:00。'
    }
  });
  expect(upload.status()).toBe(201);
  const { document: draft } = await upload.json();
  const confirm = await request.post(`/api/v1/sites/${site.id}/kb/confirm`, {
    headers: { authorization: `Bearer ${registration.token}` },
    data: { document_id: draft.id }
  });
  expect(confirm.status()).toBe(200);
  expect((await confirm.json()).document.status).toBe('confirmed');

  await page.goto(`/chat.html?site=${encodeURIComponent(site.embed_key)}`);

  // Privacy consent must be visible and must be accepted before chatting.
  await expect(page.getByRole('heading', { name: /隐私提示|privacy notice/i })).toBeVisible();
  await expect(page.locator('#messageInput')).toBeDisabled();
  await captureScreenshot(page, testInfo, 'AC-02', 'step-privacy');

  await page.getByRole('button', { name: /同意|agree|consent/i }).click();
  await expect(page.locator('#messageInput')).toBeEnabled();
  await captureScreenshot(page, testInfo, 'AC-02', 'step-consent');

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/public/') &&
      response.request().method() === 'POST' &&
      response.url().endsWith('/messages')
  );

  await page.locator('#messageInput').fill('你们今天几点开门、几点关门？');
  await page.locator('#sendButton').click();

  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.status).toBe('replied');
  expect(body.reply.lang).toBe('zh');
  expect(body.reply.text).toMatch(/[\u4e00-\u9fff]/);

  // P0.5: this must be a real model answer, grounded in the uploaded hours,
  // and phrased as a natural conversation rather than a copied knowledge snippet.
  expect(body.reply.model).toBe('deepseek-flash');
  expect(body.reply.need_human).toBe(false);
  expect(body.reply.grounded).toBe(true);
  const replyText = body.reply.text as string;
  expect(hasOpeningHours(replyText)).toBe(true);
  expect(hasClosingHours(replyText)).toBe(true);
  expect(replyText.length).toBeGreaterThan(15);
  expect(replyText).toMatch(/[。！？!?～~]/);
  expect(replyText).not.toMatch(/我目前没有找到足够可靠|商家会尽快联系您|根据.*知识库|证据编号/);
  expect(replyText).not.toBe('营业时间：每天 09:00-21:00。下班时间 21:00。');

  const agentReply = page.locator('#messages [data-role="agent"]').last();
  await expect(agentReply).toBeVisible({ timeout: 10_000 });
  const bubbleText = await agentReply.innerText();
  expect(hasOpeningHours(bubbleText)).toBe(true);
  expect(hasClosingHours(bubbleText)).toBe(true);

  // AC-02 is text-only; there must be no audio/video player in the customer window.
  await expect(page.locator('audio, video')).toHaveCount(0);
  await captureScreenshot(page, testInfo, 'AC-02', 'final');
});
