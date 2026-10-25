import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const AXE_PATH = path.join(process.cwd(), 'test-support', 'axe', 'axe.min.js');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function registerAndSite(request: APIRequestContext) {
  const email = `a11y-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const registration = await request.post('/api/v1/auth/register', {
    data: { email, password: 'TestPass123!' }
  });
  expect(registration.status()).toBe(201);
  const auth = await registration.json();
  const token = auth.access_token || auth.token;
  const siteResponse = await request.post('/api/v1/sites', {
    headers: { authorization: `Bearer ${token}` },
    data: { name: 'A11y Matrix Site', industry_template: 'retail' }
  });
  expect(siteResponse.status()).toBe(201);
  const { site } = await siteResponse.json();
  return { token, site };
}

async function scan(page: Page) {
  await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async (tags) => {
    const results = await (window as any).axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations']
    });
    return results.violations.map((v: any) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      description: v.description,
      nodes: v.nodes.slice(0, 8).map((n: any) => ({ target: n.target, summary: n.failureSummary?.slice(0, 600) }))
    }));
  }, TAGS);
}

async function scanContext(context: BrowserContext, routes: Array<{ route: string; name: string }>) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  const out: any[] = [];
  for (const { route, name } of routes) {
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), name).toBe(200);
    await page.waitForTimeout(250);
    const violations = await scan(page);
    out.push({ name, route, violations });
  }
  await page.close();
  return out;
}

test.describe('Accessibility — axe WCAG 2A/AA core surfaces', () => {
  test('no critical or serious axe violations on public and authenticated surfaces', async ({ browser, request }) => {
    test.setTimeout(240_000);
    const { token, site } = await registerAndSite(request);

    const publicContext = await browser.newContext();
    const authContext = await browser.newContext();
    await authContext.addInitScript((value) => localStorage.setItem('relaydesk_token', value), token);

    const results = [
      ...(await scanContext(publicContext, [
        { route: '/landing.html', name: 'landing' },
        { route: '/login.html', name: 'login' },
        { route: '/onboarding.html', name: 'onboarding' },
        { route: '/404.html', name: '404' },
        { route: '/privacy.html', name: 'privacy' },
        { route: '/terms.html', name: 'terms' },
        { route: `/chat.html?site=${encodeURIComponent(site.embed_key)}`, name: 'customer-chat' }
      ])),
      ...(await scanContext(authContext, [
        { route: '/insights.html', name: 'insights' },
        { route: '/', name: 'workspace' },
        { route: '/queue.html', name: 'queue' },
        { route: '/upload.html', name: 'upload' },
        { route: '/manual.html', name: 'manual' }
      ]))
    ];

    await publicContext.close();
    await authContext.close();

    const outDir = path.join(process.cwd(), 'artifacts', 'quality');
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, 'axe-results.json'), JSON.stringify({
      generatedAt: new Date().toISOString(),
      axeVersion: '4.14.0',
      tags: TAGS,
      results
    }, null, 2));

    const serious = results.flatMap((entry) => entry.violations
      .filter((v: any) => v.impact === 'critical' || v.impact === 'serious')
      .map((v: any) => ({ surface: entry.name, ...v })));

    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
  });
});
