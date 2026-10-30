import { test, expect } from './helpers/evidence-test';

const API = 'http://127.0.0.1:3030';
const PAGES = ['overview', 'inbox', 'assistant', 'knowledge', 'glossary', 'channels', 'languages', 'analytics', 'tests', 'growth', 'settings'];

test('NudgeSo UI: login, 11 views render, independent pages load without errors', async ({ page, request }) => {
  test.setTimeout(120_000);
  const email = `ui-regression-${Date.now()}@example.test`;
  const password = 'TestPass123!';
  const registration = await request.post('/api/v1/auth/register', { data: { email, password } });
  expect(registration.status()).toBe(201);
  const auth = await registration.json();
  const token = auth.access_token || auth.token;

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('fonts.googleapis')) errors.push(message.text());
  });

  await page.addInitScript((value) => localStorage.setItem('relaydesk_token', value), token);
  await page.goto('/');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.locator('#page h1').first()).toContainText(/Hello|欢迎/i);

  for (const name of PAGES) {
    await page.evaluate((value) => document.querySelector(`[data-page="${value}"]`)?.click(), name);
    await expect(page.locator('#page h1').first()).toBeVisible();
  }
  expect(errors, errors.join('\n')).toEqual([]);

  for (const path of ['/insights.html', '/queue.html', '/upload.html', '/manual.html']) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
  }
});

test('English onboarding has no Chinese leftovers', async ({ page }) => {
  await page.goto('/onboarding.html?lang=en');
  await expect(page.locator('.intro h1')).toContainText('Launch your support site');
  await expect(page.locator('.intro .eyebrow')).toHaveText('4 steps · about 5 minutes');
  await expect(page.locator('.step-tag').first()).toHaveText('Step 1 of 4');
  await expect(page.locator('#siteName')).toHaveAttribute('placeholder', 'e.g. Northstar Goods');
  const text = await page.evaluate(() => {
    document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('hidden'));
    return document.querySelector('main')?.innerText || '';
  });
  expect(text).not.toMatch(/[\u4e00-\u9fff]/);
});
