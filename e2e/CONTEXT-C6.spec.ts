import { test, expect } from './helpers/evidence-test';

async function register(request) {
  const response = await request.post('/api/v1/auth/register', {
    data: { email: `c6-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`, password: 'TestPass123!' }
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test.describe('C6 query and filter context', () => {
  test('insights category survives refresh, back/forward and keeps other query params', async ({ page, request }) => {
    const registration = await register(request);
    const token = registration.token || registration.access_token;
    await page.goto('/login.html');
    await page.evaluate((value) => localStorage.setItem('relaydesk_token', value), token);
    await page.goto('/insights.html?lang=en&utm=test&category=%E5%95%86%E4%B8%9A%E7%AD%96%E7%95%A5');
    await expect(page.locator('#filters')).toBeVisible();
    await expect(page.locator('#filters [data-cat="商业策略"]')).toHaveClass(/on/);
    expect(new URL(page.url()).searchParams.get('lang')).toBe('en');
    expect(new URL(page.url()).searchParams.get('utm')).toBe('test');

    await page.locator('#filters [data-cat="行业洞察"]').click();
    await expect(page).toHaveURL(/category=%E8%A1%8C%E4%B8%9A%E6%B4%9E%E5%AF%9F/);
    await expect(page.locator('#filters [data-cat="行业洞察"]')).toHaveClass(/on/);
    expect(new URL(page.url()).searchParams.get('lang')).toBe('en');
    expect(new URL(page.url()).searchParams.get('utm')).toBe('test');

    await page.reload();
    await expect(page.locator('#filters [data-cat="行业洞察"]')).toHaveClass(/on/);
    expect(new URL(page.url()).searchParams.get('category')).toBe('行业洞察');

    await page.goBack();
    await expect(page.locator('#filters [data-cat="商业策略"]')).toHaveClass(/on/);
    await page.goForward();
    await expect(page.locator('#filters [data-cat="行业洞察"]')).toHaveClass(/on/);
  });

  test('invalid category normalizes to all without losing other params', async ({ page, request }) => {
    const registration = await register(request);
    const token = registration.token || registration.access_token;
    await page.goto('/login.html');
    await page.evaluate((value) => localStorage.setItem('relaydesk_token', value), token);
    await page.goto('/insights.html?lang=ar&category=not-a-category');
    await expect(page.locator('#filters [data-cat="all"]')).toHaveClass(/on/);
    await expect(page).not.toHaveURL(/category=/);
    expect(new URL(page.url()).searchParams.get('lang')).toBe('ar');
  });
});
