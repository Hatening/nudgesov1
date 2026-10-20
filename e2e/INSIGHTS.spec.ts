import { test, expect } from '@playwright/test';

test('INSIGHTS: list → detail jump renders markdown and keeps both ad slots', async ({ page, request }) => {
  // 自建数据，避免依赖开发库里的演示卡
  const email = `qa-insights-${Date.now()}@example.test`;
  const register = await request.post('/api/v1/auth/register', {
    data: { email, password: 'TestPass123!' },
  });
  expect(register.status()).toBe(201);
  const { token } = await register.json();
  const headers = { authorization: `Bearer ${token}` };

  const article = await request.post('/api/knowledge', {
    headers,
    data: {
      title: 'ACOS 优化：把预算拆成两条线',
      content: '## 为什么要拆分预算\n\n防守线锁定品牌词，测试线只占总预算的 15%。\n\n- 第一步：否词\n- 第二步：降价\n- 第三步：分时竞价\n\n> 先保住转化，再谈增长。',
      language: 'zh',
      audience: 'seller',
      category: '行业洞察',
      tags: ['ACOS', '预算分配'],
    },
  });
  expect(article.status()).toBe(201);

  await page.goto('/insights.html');
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });

  // 两个广告位都在
  await expect(page.locator('.ad-728')).toBeVisible();
  await expect(page.locator('.ad-300')).toBeVisible();

  const card = page.locator('.card').first();
  const title = (await card.locator('h2').innerText()).trim();
  await card.locator('.more').click();

  await page.waitForURL(/insight\.html\?id=/);
  await expect(page.locator('#title')).toHaveText(title);
  await expect(page.locator('#body h2')).toBeVisible();

  const bodyHtml = await page.locator('#body').innerHTML();
  expect(bodyHtml).not.toContain('##');
  expect(bodyHtml).toContain('<h2>');
  expect(bodyHtml).toContain('<li>');

  // 正文底部广告位
  await expect(page.locator('.ad-bottom .ad-slot')).toBeVisible();

  // 未知 id → 404
  const missing = await request.get('/api/insights/kb_missing_id');
  expect(missing.status()).toBe(404);
});

test('INSIGHTS: detail page fits 390px without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/insights.html');
  await expect(page.locator('.card').first()).toBeVisible({ timeout: 10000 });
  await page.locator('.card .more').first().click();
  await page.waitForURL(/insight\.html\?id=/);
  await expect(page.locator('#title')).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
