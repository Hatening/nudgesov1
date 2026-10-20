import { test, expect } from '@playwright/test';

test('dashboard auth: unauthenticated menu stays on sign-in, login unlocks navigation', async ({ page, request }) => {
  test.setTimeout(60_000);
  const email = `dashboard-${Date.now()}@example.test`;
  const password = 'TestPass123!';
  const registration = await request.post('/api/v1/auth/register', {
    data: { email, password }
  });
  expect(registration.status()).toBe(201);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /商家登录|Merchant sign in/i })).toBeVisible();

  // Clicking a menu without a session must not turn into a raw Unauthorized page.
  await page.locator('.nav-item[data-page="languages"]').click();
  await expect(page.getByRole('heading', { name: /商家登录|Merchant sign in/i })).toBeVisible();
  await expect(page.locator('#page')).not.toContainText(/Unauthorized|Unable to connect/i);

  await page.locator('#dashboardEmail').fill(email);
  await page.locator('#dashboardPassword').fill(password);
  await page.locator('#dashboardLoginForm button[type="submit"]').click();

  // The pre-login menu choice is intentional: after login the selected page opens.
  await expect(page.getByRole('heading', { name: 'Languages' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.nav-item[data-page="inbox"]').click();
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await page.locator('.nav-item[data-page="knowledge"]').click();
  await expect(page.getByRole('heading', { name: 'Knowledge base' })).toBeVisible();
  await expect(page.locator('#page')).not.toContainText(/Unauthorized|Unable to connect/i);
});
