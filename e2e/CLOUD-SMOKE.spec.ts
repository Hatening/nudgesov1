import { test, expect } from '@playwright/test';

// Read-only check for the deployed Render URL. Local `npm run test:ui`
// skips this suite; run it with `npm run test:ui:cloud`.
const enabled = process.env.CLOUD_SMOKE === '1';

test.describe('Deployed UI smoke (read-only)', () => {
  test.skip(!enabled, 'cloud-only: run npm run test:ui:cloud');

  test('static pages, health and English/Arabic onboarding are reachable', async ({ page, request }) => {
    test.setTimeout(60_000);
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    const body = await health.json();
    expect(body.ok).toBe(true);

    const pages = ['/landing.html', '/login.html', '/upload.html', '/manual.html', '/insights.html', '/queue.html', '/chat.html'];
    for (const route of pages) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(200);
    }

    await page.goto('/onboarding.html?lang=en');
    await expect(page.locator('.intro .eyebrow')).toHaveText('4 steps · about 5 minutes');
    const enText = await page.evaluate(() => {
      document.querySelectorAll('.panel').forEach((panel) => panel.classList.remove('hidden'));
      return document.querySelector('main')?.innerText || '';
    });
    expect(enText).not.toMatch(/[\u4e00-\u9fff]/);

    await page.goto('/onboarding.html?lang=ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});
