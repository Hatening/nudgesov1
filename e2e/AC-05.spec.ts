import { test, expect } from './helpers/evidence-test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { captureScreenshot } from './helpers/screenshot';

test('AC-05 customer chat window has no ads or third-party ad requests', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);

  const email = `qa-ac05-${Date.now()}@example.test`;
  const password = 'TestPass123!';
  const register = await request.post('/api/v1/auth/register', {
    data: { email, password }
  });
  expect(register.status()).toBe(201);
  const registration = await register.json();

  const siteResponse = await request.post('/api/v1/sites', {
    headers: { authorization: `Bearer ${registration.token}` },
    data: { name: `QA AC-05 Site ${Date.now()}`, industry_template: 'retail' }
  });
  expect(siteResponse.status()).toBe(201);
  const { site } = await siteResponse.json();
  expect(site.embed_key).toBeTruthy();

  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto(`/chat.html?site=${encodeURIComponent(site.embed_key)}`);
  await expect(page.getByRole('heading', { name: /隐私提示|privacy notice/i })).toBeVisible();
  await page.getByRole('button', { name: /同意|agree|consent/i }).click();
  await expect(page.locator('#messageInput')).toBeEnabled();

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/public/') &&
      response.request().method() === 'POST' &&
      response.url().endsWith('/messages')
  );
  await page.locator('#messageInput').fill('你好，我想咨询一下。');
  await page.locator('#sendButton').click();
  await responsePromise;
  await expect(page.locator('#messages [data-role="agent"]').last()).toBeVisible({ timeout: 10_000 });

  // No ad containers, iframes, or ad labels in the customer chat window.
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(
    page.locator('ins.adsbygoogle, [data-ad], [data-ad-slot], .ad-slot, [class*="sponsor"], [class*="advert"], [id^="ad-"]')
  ).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Sponsored|赞助|广告位|广告/);

  // The customer window must only talk to its own origin; no ad network calls.
  const pageOrigin = new URL(page.url()).origin;
  const foreignRequests = requests.filter((value) => {
    try {
      return new URL(value).origin !== pageOrigin;
    } catch {
      return true;
    }
  });
  expect(foreignRequests).toEqual([]);

  const runDir = process.env.RUN_DIR || path.join(process.cwd(), 'artifacts', 'runs', process.env.RUN_ID || 'manual');
  await fs.mkdir(runDir, { recursive: true });
  const report = {
    page_url: page.url(),
    request_count: requests.length,
    requests: [...new Set(requests)].sort(),
    foreign_requests: foreignRequests,
    ad_iframes: 0,
    ad_slots: 0,
    ad_text_found: false,
    pass: foreignRequests.length === 0
  };
  await fs.writeFile(path.join(runDir, 'AC-05-network.json'), JSON.stringify(report, null, 2), 'utf8');
  await testInfo.attach('AC-05-network', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json'
  });

  await captureScreenshot(page, testInfo, 'AC-05', 'step-chat');
  await captureScreenshot(page, testInfo, 'AC-05', 'final');
});
