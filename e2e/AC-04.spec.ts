import { test, expect } from './helpers/evidence-test';
import fs from 'node:fs/promises';
import path from 'node:path';
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
  const samples = 1600; // 0.2 seconds, silent
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

test('AC-04 P2: ASR network fallback -> WAV upload -> soothing/RAG hours + package + high-risk', async ({ page, request }, testInfo) => {
  test.setTimeout(5 * 60_000);

  const email = `qa-ac04p2fix-${Date.now()}@example.test`;
  const password = 'TestPass123!';
  const register = await request.post('/api/v1/auth/register', { data: { email, password } });
  expect(register.status()).toBe(201);
  const registration = await register.json();

  const siteResponse = await request.post('/api/v1/sites', {
    headers: { authorization: `Bearer ${registration.token}` },
    data: { name: `QA AC-04 P2 Fix Site ${Date.now()}`, industry_template: 'retail' }
  });
  expect(siteResponse.status()).toBe(201);
  const { site } = await siteResponse.json();

  const addKnowledge = async (filename: string, title: string, content: string) => {
    const uploadResponse = await request.post(`/api/v1/sites/${site.id}/kb/upload`, {
      headers: { authorization: `Bearer ${registration.token}` },
      data: { filename, title, content }
    });
    expect(uploadResponse.status()).toBe(201);
    const { document: draft } = await uploadResponse.json();
    const confirmResponse = await request.post(`/api/v1/sites/${site.id}/kb/confirm`, {
      headers: { authorization: `Bearer ${registration.token}` },
      data: { document_id: draft.id }
    });
    expect(confirmResponse.status()).toBe(200);
    expect((await confirmResponse.json()).document.status).toBe('confirmed');
  };

  await addKnowledge('store-hours.txt', '营业时间 / Store hours', '营业时间：每天 09:00-21:00。下班时间 21:00。');
  await addKnowledge('logistics.txt', '物流时效 / Logistics', '物流：标准快递通常需要 3-5 个工作日送达。');

  // Simulate the real-browser failure: Web Speech API reports network.
  await page.addInitScript(() => {
    const MockSpeechRecognition = function () {};
    MockSpeechRecognition.prototype.start = function (this: any) {
      setTimeout(() => {
        if (this.onerror) this.onerror({ error: 'network' });
      }, 5);
    };
    (window as any).SpeechRecognition = MockSpeechRecognition;
    (window as any).webkitSpeechRecognition = MockSpeechRecognition;
  });

  await page.goto(`/chat.html?site=${encodeURIComponent(site.embed_key)}`);
  await expect(page.getByRole('heading', { name: /隐私提示|privacy notice/i })).toBeVisible();
  await page.getByRole('button', { name: /同意|agree|consent/i }).click();
  await expect(page.locator('#messageInput')).toBeEnabled();
  await expect(page.locator('#uploadVoiceButton')).toBeVisible();

  // Network error must produce a friendly degradation message, not a raw failure.
  await page.locator('#voiceButton').click();
  await expect(page.locator('#chatError')).toContainText(/网络语音不可用/);
  await expect(page.locator('#uploadVoiceButton')).toBeEnabled();

  await page.evaluate((text) => {
    (window as any).__ASR_FIXTURE__ = text;
  }, '你们每天几点开门、几点关门？');

  const samples = 20;
  const durations: number[] = [];
  let contentChecks: Record<string, boolean> | null = null;

  for (let index = 0; index < samples; index++) {
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/public/') &&
        response.request().method() === 'POST' &&
        response.url().endsWith('/messages')
    );

    const startedAt = Date.now();
    const filePayload = {
      name: `hours-${String(index + 1).padStart(2, '0')}.wav`,
      mimeType: 'audio/wav',
      buffer: makeWavBuffer()
    };
    if (index === 0) {
      // Exercise the visible .wav upload fallback, not only the hidden test input.
      const chooserPromise = page.waitForEvent('filechooser');
      await page.locator('#uploadVoiceButton').click();
      const chooser = await chooserPromise;
      await chooser.setFiles(filePayload);
    } else {
      await page.locator('#voiceFile').setInputFiles(filePayload);
    }
    const response = await responsePromise;
    durations.push(Date.now() - startedAt);

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.input_type).toBe('voice');
    expect(body.reply.lang).toBe('zh');
    expect(body.reply.need_human).toBe(false);
    expect(body.reply.model).toBe('deepseek-flash');
    expect(body.reply.grounded).toBe(true);
    expect(body.reply.text).toMatch(/理解|抱歉|着急/);
    expect(body.reply.text).toMatch(/(营业时间|开门|关门|几点)/);
    expect(body.reply.text).toMatch(/(对吗|确认|想问|是不是)/);
    expect(hasOpeningHours(body.reply.text)).toBe(true);
    expect(hasClosingHours(body.reply.text)).toBe(true);
    expect(body.reply.text.length).toBeGreaterThan(20);
    expect(body.reply.text).toMatch(/[。！？!?～~]/);
    expect(body.reply.text).not.toMatch(/我目前没有找到足够可靠|根据.*知识库|证据编号/);
    expect(body.reply.text).not.toBe('营业时间：每天 09:00-21:00。下班时间 21:00。');
    expect(body.reply.text).not.toContain('商家会尽快联系您');
    expect(Array.isArray(body.reply.segments)).toBe(true);
    expect(body.reply.segments.map((segment: any) => segment.type)).toEqual([
      'soothing',
      'confirm',
      'answer'
    ]);

    if (!contentChecks) {
      contentChecks = {
        soothing: /理解|抱歉|着急/.test(body.reply.text),
        confirmation: /(营业时间|开门|关门|几点)/.test(body.reply.text) && /(对吗|确认|想问|是不是)/.test(body.reply.text),
        opening_hours: hasOpeningHours(body.reply.text),
        closing_hours: hasClosingHours(body.reply.text),
        natural_conversation: body.reply.text.length > 20 && /[。！？!?～~]/.test(body.reply.text),
        no_dispatch_phrase: !body.reply.text.includes('商家会尽快联系您')
      };
    }

    const answerBubble = page.locator('#messages [data-role="agent"]').last();
    const answerText = await answerBubble.innerText();
    expect(hasOpeningHours(answerText)).toBe(true);
    expect(hasClosingHours(answerText)).toBe(true);
    await expect(page.locator('audio, video')).toHaveCount(0);

    if (index === 0) {
      await captureScreenshot(page, testInfo, 'AC-04', 'step-hours-answer');
    }
  }

  // Package RAG: the same site must answer from injected logistics knowledge.
  await page.evaluate(() => {
    (window as any).__ASR_FIXTURE__ = '我的包裹什么时候能到？';
  });
  const packageResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/public/') &&
      response.request().method() === 'POST' &&
      response.url().endsWith('/messages')
  );
  await page.locator('#voiceFile').setInputFiles({
    name: 'package.wav',
    mimeType: 'audio/wav',
    buffer: makeWavBuffer()
  });
  const packageResponse = await packageResponsePromise;
  expect(packageResponse.status()).toBe(200);
  const packageBody = await packageResponse.json();
  expect(packageBody.reply.need_human).toBe(false);
  expect(packageBody.reply.model).toBe('deepseek-flash');
  expect(packageBody.reply.grounded).toBe(true);
  expect(packageBody.reply.text).toMatch(/3\s*(?:-|到|~|至)\s*5\s*个?工作日/);
  expect(packageBody.reply.text).toMatch(/(物流|包裹|快递|送达|进度)/);
  expect(packageBody.reply.text).toMatch(/您|你/);
  expect(packageBody.reply.text).toMatch(/(帮您|方便|建议|哦|～|！|。)/);
  expect(packageBody.reply.text.length).toBeGreaterThan(18);
  expect(packageBody.reply.text).not.toMatch(/我目前没有找到足够可靠|根据.*知识库|证据编号/);
  expect(packageBody.reply.text).not.toBe('物流：标准快递通常需要 3-5 个工作日送达。');
  expect(packageBody.reply.text).not.toContain('商家会尽快联系您');
  if (contentChecks) contentChecks.package_answer = /3\s*(?:-|到|~|至)\s*5\s*个?工作日/.test(packageBody.reply.text);
  await expect(page.locator('#messages [data-role="agent"]').last()).toContainText(/3\s*(?:-|到|~|至)\s*5/);
  await captureScreenshot(page, testInfo, 'AC-04', 'step-package-answer');

  // High-risk voice must intercept before RAG and create an escalation.
  await page.evaluate(() => {
    (window as any).__ASR_FIXTURE__ = '我要退款，订单号 12345';
  });
  const riskResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/public/') &&
      response.request().method() === 'POST' &&
      response.url().endsWith('/messages')
  );
  await page.locator('#voiceFile').setInputFiles({
    name: 'high-risk.wav',
    mimeType: 'audio/wav',
    buffer: makeWavBuffer()
  });
  const riskResponse = await riskResponsePromise;
  expect(riskResponse.status()).toBe(200);
  const riskBody = await riskResponse.json();
  expect(riskBody.status).toBe('transferred_to_human');
  expect(riskBody.reply.need_human).toBe(true);
  expect(riskBody.reply.text).toContain('人工专员');
  expect(riskBody.reply.text).toContain('专员会尽快');
  expect(riskBody.reply.text).not.toMatch(/可以退款|保证退款|今天处理|赔偿/);
  expect(riskBody.escalation_id).toBeTruthy();
  await expect(page.locator('#messages [data-role="agent"]').last()).toContainText('人工专员');
  await expect(page.locator('audio, video')).toHaveCount(0);
  await captureScreenshot(page, testInfo, 'AC-04', 'step-high-risk');

  const sorted = [...durations].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(0.95 * samples) - 1];
  const summary = {
    samples,
    durations_ms: durations,
    sorted_ms: sorted,
    p95_ms: p95,
    threshold_ms: 30000,
    content_checks: contentChecks,
    high_risk: {
      need_human: riskBody.reply.need_human,
      safe_template: riskBody.reply.text,
      escalation_id: riskBody.escalation_id
    },
    pass: p95 <= 30000 && Boolean(contentChecks && Object.values(contentChecks).every(Boolean))
  };

  const runDir = process.env.RUN_DIR || path.join(process.cwd(), 'artifacts', 'runs', process.env.RUN_ID || 'manual');
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'AC-04-timings.json'), JSON.stringify(summary, null, 2), 'utf8');
  await testInfo.attach('AC-04-timings', {
    body: JSON.stringify(summary, null, 2),
    contentType: 'application/json'
  });

  expect(p95).toBeLessThanOrEqual(30000);
  expect(contentChecks).not.toBeNull();
  expect(Object.values(contentChecks as Record<string, boolean>).every(Boolean)).toBe(true);
  await captureScreenshot(page, testInfo, 'AC-04', 'final');
});
