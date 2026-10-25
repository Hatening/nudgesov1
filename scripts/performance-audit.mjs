#!/usr/bin/env node
/**
 * Lightweight, repeatable performance evidence.
 *
 * This is not Lighthouse. It records real navigation/resource timings for the
 * current build and reports measured budgets. A failed budget is a warning here
 * until the product team approves a gate; the raw values are never fabricated.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.BASE_URL || 'http://127.0.0.1:3030';
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
const pages = [
  { name: 'landing', path: '/landing.html', auth: false },
  { name: 'login', path: '/login.html', auth: false },
  { name: 'onboarding', path: '/onboarding.html', auth: false },
  { name: 'insights', path: '/insights.html', auth: false },
  { name: 'privacy', path: '/privacy.html', auth: false },
  { name: 'terms', path: '/terms.html', auth: false },
  { name: 'workspace', path: '/', auth: true },
];

const email = `perf-${Date.now()}@example.test`;
const registration = await fetch(`${base}/api/v1/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'TestPass123!' }),
});
const auth = await registration.json();
const token = auth.access_token || auth.token;
const siteResponse = await fetch(`${base}/api/v1/sites`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: 'Perf Site', industry_template: 'retail' }),
});
const { site } = await siteResponse.json();

const browser = await chromium.launch({ headless: true, executablePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript((value) => localStorage.setItem('relaydesk_token', value), token);
const page = await context.newPage();
const results = [];

for (const item of pages) {
  const start = Date.now();
  const response = await page.goto(base + item.path, { waitUntil: 'load' });
  const wallMs = Date.now() - start;
  await page.waitForTimeout(150);
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const byType = {};
    for (const r of resources) {
      const type = r.initiatorType || 'other';
      byType[type] = byType[type] || { count: 0, transferBytes: 0, encodedBytes: 0 };
      byType[type].count += 1;
      byType[type].transferBytes += r.transferSize || 0;
      byType[type].encodedBytes += r.encodedBodySize || 0;
    }
    return {
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadMs: nav ? Math.round(nav.loadEventEnd) : null,
      transferBytes: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
      encodedBytes: resources.reduce((sum, r) => sum + (r.encodedBodySize || 0), 0),
      resourceCount: resources.length,
      byType,
    };
  });
  results.push({ name: item.name, path: item.path, status: response?.status() || null, wallMs, ...metrics });
}

await context.close();
await browser.close();

const outDir = path.join(process.cwd(), 'artifacts', 'quality');
fs.mkdirSync(outDir, { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  base,
  note: 'Custom navigation/resource measurements; Lighthouse is NOT RUN.',
  budgets: {
    loadMsWarning: 5000,
    transferBytesWarning: 3_000_000,
  },
  results,
};
fs.writeFileSync(path.join(outDir, 'performance.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  output: path.join(outDir, 'performance.json'),
  results: results.map((r) => ({
    name: r.name,
    status: r.status,
    dclMs: r.domContentLoadedMs,
    loadMs: r.loadMs,
    transferKB: Math.round(r.transferBytes / 1024),
    resources: r.resourceCount,
    warning: (r.loadMs || 0) > report.budgets.loadMsWarning || r.transferBytes > report.budgets.transferBytesWarning,
  })),
}, null, 2));
