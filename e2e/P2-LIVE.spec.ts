import { test, expect } from '@playwright/test';
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

function makeWavBuffer() {
  const sampleRate = 8000;
  const samples = 1600;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

test('P2 live-compatible: package 3-5 days and hours 09:00-21:00', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  let key = process.env.LIVE_EMBED_KEY || '';
  if (!key) {
    const email = `qa-p2live-${Date.now()}@example.test`;
    const registration = await request.post('/api/v1/auth/register', {
      data: { email, password: 'TestPass123!' }
    });
    expect(registration.status()).toBe(201);
    const auth = await registration.json();
    const siteResponse = await request.post('/api/v1/sites', {
      headers: { authorization: `Bearer ${auth.token}` },
      data: { name: `QA P2 Live Site ${Date.now()}`, industry_template: 'retail' }
    });
    expect(siteResponse.status()).toBe(201);
    const { site } = await siteResponse.json();
    key = site.embed_key;
    const addKnowledge = async (filename: string, title: string, content: string) => {
      const upload = await request.post(`/api/v1/sites/${site.id}/kb/upload`, {
        headers: { authorization: `Bearer ${auth.token}` },
        data: { filename, title, content }
      });
      expect(upload.status()).toBe(201);
      const draft = (await upload.json()).document;
      const confirm = await request.post(`/api/v1/sites/${site.id}/kb/confirm`, {
        headers: { authorization: `Bearer ${auth.token}` },
        data: { document_id: draft.id }
      });
      expect(confirm.status()).toBe(200);
    };
    await addKnowledge('hours.txt', '营业时间 / Store hours', '营业时间：每天 09:00-21:00。下班时间 21:00。');
    await addKnowledge('logistics.txt', '物流时效 / Logistics', '物流：标准快递通常需要 3-5 个工作日送达。');
  }

  await page.goto(`/chat.html?site=${encodeURIComponent(key)}`);
  await expect(page.getByRole('heading', { name: /隐私提示|privacy notice/i })).toBeVisible();
  await page.getByRole('button', { name: /同意|agree|consent/i }).click();
  await expect(page.locator('#uploadVoiceButton')).toBeVisible();

  const packagePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/public/') &&
      response.request().method() === 'POST' &&
      response.url().endsWith('/messages')
  );
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('#uploadVoiceButton').click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'package.wav', mimeType: 'audio/wav', buffer: makeWavBuffer() });
  const packageResponse = await packagePromise;
  expect(packageResponse.status()).toBe(200);
  const packageBody = await packageResponse.json();
  expect(packageBody.reply.need_human).toBe(false);
  expect(packageBody.reply.text).toMatch(/3\s*(?:-|到|~|至)\s*5\s*个?工作日/);
  expect(packageBody.reply.text).not.toContain('商家会尽快联系您');
  await expect(page.locator('#messages [data-role="agent"]').last()).toContainText(/3\s*(?:-|到|~|至)\s*5/);
  await captureScreenshot(page, testInfo, 'P2-LIVE', 'step-package');

  // Use a complete hours question so the real model has both opening and closing
  // facts to ground; the same file-upload path is still exercised.
  await page.evaluate(() => {
    (window as any).__ASR_FIXTURE__ = '你们每天几点开门、几点关门？';
  });
  const hoursPromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/public/') &&
      response.request().method() === 'POST' &&
      response.url().endsWith('/messages')
  );
  await page.locator('#voiceFile').setInputFiles({ name: 'hours.wav', mimeType: 'audio/wav', buffer: makeWavBuffer() });
  const hoursResponse = await hoursPromise;
  expect(hoursResponse.status()).toBe(200);
  const hoursBody = await hoursResponse.json();
  expect(hoursBody.reply.need_human).toBe(false);
  expect(typeof hoursBody.reply.model).toBe('string');
  expect(hoursBody.reply.model.length).toBeGreaterThan(0);
  expect(hasOpeningHours(hoursBody.reply.text)).toBe(true);
  expect(hasClosingHours(hoursBody.reply.text)).toBe(true);
  const hoursBubble = page.locator('#messages [data-role="agent"]').last();
  const hoursBubbleText = await hoursBubble.innerText();
  expect(hasOpeningHours(hoursBubbleText)).toBe(true);
  expect(hasClosingHours(hoursBubbleText)).toBe(true);
  await captureScreenshot(page, testInfo, 'P2-LIVE', 'final');
});
