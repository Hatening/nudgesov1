import { test, expect } from './helpers/evidence-test';

test('dashboard auth: landing/login gate, login unlocks navigation', async ({ page, request }) => {
  test.setTimeout(60_000);
  const email = `dashboard-${Date.now()}@example.test`;
  const password = 'TestPass123!';
  const registration = await request.post('/api/v1/auth/register', { data: { email, password } });
  expect(registration.status()).toBe(201);

  // Unauthenticated root now goes to the public landing page, then sign-in.
  await page.goto('/');
  await expect(page).toHaveURL(/landing\.html/);
  await expect(page.getByRole('link', { name: /Sign in|登录/i }).first()).toBeVisible();
  await page.goto('/login.html');
  await expect(page.getByRole('heading', { name: /Welcome back/i })).toBeVisible();
  await expect(page.locator('#email')).toBeVisible();
  await expect(page.locator('#password')).toBeVisible();

  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.locator('#loginBtn').click();

  await page.waitForURL(/\/$/);
  await expect(page.locator('.app-shell')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.nav-item[data-page="overview"]')).toBeVisible();

  await page.evaluate(() => document.querySelector('.nav-item[data-page="languages"]')?.click());
  await expect(page.locator('#page h1')).toContainText('Languages');
  await page.evaluate(() => document.querySelector('.nav-item[data-page="inbox"]')?.click());
  await expect(page.locator('#page h1')).toContainText('Customer messages');
  await page.evaluate(() => document.querySelector('.nav-item[data-page="knowledge"]')?.click());
  await expect(page.locator('#page h1')).toContainText('My store info');
  await expect(page.locator('#page')).not.toContainText(/Unauthorized|Unable to connect/i);
});
