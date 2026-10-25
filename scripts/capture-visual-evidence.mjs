#!/usr/bin/env node
/**
 * Capture acceptance screenshots for human review.
 * These are evidence artifacts, not approved visual baselines.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = process.env.BASE_URL || 'http://127.0.0.1:3030';
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
const outDir = path.join(process.cwd(), 'artifacts', 'quality', 'visual-evidence');
fs.mkdirSync(outDir, { recursive: true });

const email = `visual-${Date.now()}@example.test`;
const registration = await fetch(`${base}/api/v1/auth/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'TestPass123!' }),
});
const auth = await registration.json();
const token = auth.access_token || auth.token;
const siteResponse = await fetch(`${base}/api/v1/sites`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: 'Visual Site', industry_template: 'retail' }),
});
const { site } = await siteResponse.json();

const browser = await chromium.launch({ headless: true, executablePath });
const publicContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const authContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await authContext.addInitScript((value) => localStorage.setItem('relaydesk_token', value), token);
const publicPage = await publicContext.newPage();
const authPage = await authContext.newPage();
const page = authPage;
const files = [];

async function capture(name, url, width, height = 900, authenticated = false) {
  const target = authenticated ? authPage : publicPage;
  await target.setViewportSize({ width, height });
  await target.goto(url, { waitUntil: 'load' });
  await target.waitForTimeout(250);
  await target.addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important;}' });
  const filename = `${name}-${width}.png`;
  await target.screenshot({ path: path.join(outDir, filename), fullPage: true });
  files.push({ name, url, width, filename, authenticated });
}

const publicPages = [
  ['landing-en', '/landing.html'],
  ['landing-ar', '/landing.html?lang=ar'],
  ['landing-zh', '/landing.html?lang=zh-CN'],
  ['login', '/login.html'],
  ['onboarding', '/onboarding.html'],
  ['insights', '/insights.html'],
  ['404', '/404.html'],
  ['privacy', '/privacy.html'],
  ['terms', '/terms.html'],
];
for (const [name, url] of publicPages) {
  await capture(name, base + url, 1440);
  await capture(name, base + url, 390, 844);
}

const authPages = [
  ['queue', '/queue.html'],
  ['upload', '/upload.html'],
  ['manual', '/manual.html'],
];
for (const [name, url] of authPages) {
  await capture(name, base + url, 1440, 900, true);
  await capture(name, base + url, 390, 844, true);
}
await capture('customer-chat', `${base}/chat.html?site=${encodeURIComponent(site.embed_key)}`, 390, 844);

// Workspace views.
const views = ['overview', 'inbox', 'assistant', 'knowledge', 'glossary', 'channels', 'languages', 'analytics', 'tests', 'growth', 'settings'];
for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForSelector('.app-shell');
  if (width === 390) await page.locator('#hamburger').click();
  for (const view of views) {
    await page.evaluate((name) => document.querySelector(`.nav-item[data-page="${name}"]`)?.click(), view);
    await page.waitForTimeout(180);
    const filename = `workspace-${view}-${width}.png`;
    await page.screenshot({ path: path.join(outDir, filename), fullPage: true });
    files.push({ name: `workspace-${view}`, url: `${base}/#${view}`, width, filename });
  }
}

await publicContext.close();
await authContext.close();
await browser.close();

const gallery = `<!doctype html><meta charset="utf-8"><title>NudgeSo acceptance screenshots</title>
<style>body{font-family:system-ui,sans-serif;background:#f7f4ec;color:#262b33;margin:24px}h1{font-size:24px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:20px}.card{background:#fff;border:1px solid #e2d9c6;border-radius:12px;padding:12px}.card img{display:block;width:100%;height:auto;border:1px solid #eee;border-radius:8px}.meta{font-size:12px;color:#5b6470;margin-bottom:8px}</style>
<h1>NudgeSo acceptance screenshots</h1><p>Evidence only. These are not approved visual baselines.</p><div class="grid">
${files.map((f) => `<div class="card"><div class="meta">${f.name} · ${f.width}px · <a href="${f.filename}">open</a></div><a href="${f.filename}"><img src="${f.filename}" loading="lazy"></a></div>`).join('\n')}
</div>`;
fs.writeFileSync(path.join(outDir, 'index.html'), gallery);
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), base, files, note: 'Evidence only; not an approved baseline.' }, null, 2));
console.log(JSON.stringify({ output: path.join(outDir, 'index.html'), screenshots: files.length }, null, 2));
