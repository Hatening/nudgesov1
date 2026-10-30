import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

/**
 * Phase D0 — read-only QA Agent explorer.
 *
 * This does not click destructive controls and does not modify product data.
 * It registers a disposable fixture account in the local test database to
 * reach authenticated read surfaces. Run it only against a disposable server.
 */
const baseUrl = (process.env.BASE_URL || 'http://127.0.0.1:3030').replace(/\/$/, '');
if (/onrender\.com/i.test(baseUrl)) {
  throw new Error('D0 creates a disposable fixture account/site and must not write production data. Run against local or an approved staging server.');
}
const root = process.cwd();
const outDir = path.resolve(root, process.env.AGENT_OUT_DIR || 'artifacts/quality/agent/latest');
const registry = JSON.parse(await fs.readFile(path.join(root, 'docs/product/page-registry.json'), 'utf8'));
const screenshotDir = path.join(outDir, 'screenshots');
await fs.mkdir(screenshotDir, { recursive: true });

const email = `d0-agent-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
const password = 'TestPass123!';
const api = (p, options = {}) => fetch(`${baseUrl}${p}`, {
  ...options,
  headers: { 'content-type': 'application/json', ...(options.headers || {}) }
});
const register = await api('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
if (!register.ok) throw new Error(`D0 fixture registration failed: HTTP ${register.status}`);
const registration = await register.json();
const token = registration.token || registration.access_token;
const siteResponse = await api('/api/v1/sites', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}` },
  body: JSON.stringify({ name: `D0 Explorer ${Date.now()}`, industry_template: 'retail' })
});
if (!siteResponse.ok) throw new Error(`D0 fixture site failed: HTTP ${siteResponse.status}`);
const { site } = await siteResponse.json();

const routeFor = (page) => {
  if (page.id === 'workspace') return '/';
  if (page.id === 'customer-chat') return `/chat.html?site=${encodeURIComponent(site.embed_key)}`;
  if (page.id === 'landing') return '/landing.html?lang=en';
  if (page.id === 'insights') return '/insights.html?lang=en';
  if (page.id === 'onboarding') return '/onboarding.html?lang=en';
  return page.route.replace('<embed_key>', site.embed_key).replace('<id>', '');
};

const publicPages = new Set(['landing', 'login', 'privacy-draft', 'terms-draft', 'customer-chat']);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined
});
const nodes = [];
const edges = [];
const notRun = [];

async function explore(context, registryPage) {
  if (registryPage.notRunWhenNoFixture) {
    notRun.push({ page: registryPage.id, reason: 'No seeded insight-detail fixture in D0.' });
    return;
  }
  const route = routeFor(registryPage);
  const url = new URL(route, baseUrl).toString();
  const page = await context.newPage();
  const errors = [];
  const consoleErrors = [];
  const httpErrors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('response', (response) => {
    const responseUrl = response.url();
    if (responseUrl.startsWith(baseUrl) && response.status() >= 500) {
      httpErrors.push(`${response.status()} ${responseUrl}`);
    }
  });
  let response;
  try {
    response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(700);
  } catch (error) {
    errors.push(`navigation: ${error.message}`);
  }
  const observed = await page.evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const controls = Array.from(document.querySelectorAll('button, input, select, textarea, a[href]'))
      .filter(visible)
      .slice(0, 120)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('value') || el.getAttribute('href') || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      }));
    const links = Array.from(document.querySelectorAll('a[href]'))
      .map((el) => el.href)
      .filter((href) => href.startsWith(location.origin) && !href.startsWith('javascript:'))
      .filter((href, index, list) => list.indexOf(href) === index);
    return {
      finalUrl: location.href,
      title: document.title,
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      textLength: (document.body.innerText || '').trim().length,
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      controls,
      links,
      hasHeading: Boolean(document.querySelector('h1, h2'))
    };
  }).catch(() => ({ finalUrl: page.url(), error: 'evaluate failed' }));
  const screenshot = path.join(screenshotDir, `${registryPage.id}.png`);
  await page.screenshot({ path: screenshot, fullPage: false }).catch(() => {});
  await page.close();

  const observedStatus = response?.status() || 0;
  const unexpectedLogin = observed.finalUrl?.includes('/login.html') && registryPage.id !== 'login';
  const status = errors.length || httpErrors.length || unexpectedLogin || observed.overflow ? 'FAIL' : consoleErrors.length ? 'WARN' : 'PASS';
  const node = {
    id: registryPage.id,
    registryRoute: registryPage.route,
    exploredUrl: url,
    finalUrl: observed.finalUrl,
    title: observed.title,
    lang: observed.lang,
    dir: observed.dir,
    criticality: registryPage.criticality,
    roles: registryPage.roles,
    observedStatus,
    unexpectedLogin,
    status,
    overflow: observed.overflow,
    textLength: observed.textLength,
    hasHeading: observed.hasHeading,
    controls: observed.controls || [],
    consoleErrors,
    pageErrors: errors,
    httpErrors,
    screenshot: path.relative(outDir, screenshot)
  };
  nodes.push(node);
  for (const link of observed.links || []) {
    const parsed = new URL(link);
    if (parsed.origin !== new URL(baseUrl).origin) continue;
    edges.push({ from: registryPage.id, to: parsed.pathname + parsed.search });
  }
  return node;
}

const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const authed = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await authed.addInitScript((value) => {
  localStorage.setItem('relaydesk_token', value);
  localStorage.setItem('relaydesk_locale', 'en');
}, token);

for (const registryPage of registry.pages) {
  const context = publicPages.has(registryPage.id) ? guest : authed;
  await explore(context, registryPage);
}
await guest.close();
await authed.close();
await browser.close();

const failed = nodes.filter((node) => node.status === 'FAIL');
const warned = nodes.filter((node) => node.status === 'WARN');
const coverage = {
  phase: 'D0',
  generatedAt: new Date().toISOString(),
  baseUrl,
  fixture: { email, siteId: site.id },
  summary: {
    registryPages: registry.pages.length,
    explored: nodes.length,
    pass: nodes.filter((node) => node.status === 'PASS').length,
    warn: warned.length,
    fail: failed.length,
    notRun: notRun.length
  },
  nodes: nodes.map((node) => ({
    id: node.id,
    status: node.status,
    finalUrl: node.finalUrl,
    criticality: node.criticality,
    consoleErrors: node.consoleErrors.length,
    pageErrors: node.pageErrors.length,
    httpErrors: node.httpErrors.length,
    overflow: node.overflow
  })),
  notRun
};
const model = {
  phase: 'D0',
  generatedAt: new Date().toISOString(),
  baseUrl,
  roles: registry.roles,
  viewports: registry.viewports,
  pages: nodes,
  edges,
  coverage
};
await fs.writeFile(path.join(outDir, 'site-model.json'), JSON.stringify(model, null, 2));
await fs.writeFile(path.join(outDir, 'coverage.json'), JSON.stringify(coverage, null, 2));
const report = [
  '# Phase D0 — read-only site model',
  '',
  `Generated: ${model.generatedAt}`,
  `Base URL: ${baseUrl}`,
  '',
  '## Summary',
  '',
  `- registry pages: ${coverage.summary.registryPages}`,
  `- explored: ${coverage.summary.explored}`,
  `- PASS: ${coverage.summary.pass}`,
  `- WARN: ${coverage.summary.warn}`,
  `- FAIL: ${coverage.summary.fail}`,
  `- NOT RUN: ${coverage.summary.notRun}`,
  '',
  '## Pages',
  '',
  '| Page | Status | Final URL | Console errors | Overflow |',
  '|---|---|---|---:|---|',
  ...nodes.map((node) => `| ${node.id} | ${node.status} | ${node.finalUrl || ''} | ${node.consoleErrors.length} | ${node.overflow ? 'yes' : 'no'} |`),
  '',
  '## NOT RUN',
  '',
  ...(notRun.length ? notRun.map((item) => `- ${item.page}: ${item.reason}`) : ['- none']),
  '',
  '## Scope',
  '',
  'This is a read-only discovery pass. It does not click destructive controls, submit forms, create conversations, change settings, trigger payment, send email, or test external channels.',
  ''
].join('\n');
await fs.writeFile(path.join(outDir, 'report.md'), report);
console.log(JSON.stringify({ outputDir: outDir, summary: coverage.summary, failed: failed.map((node) => node.id) }, null, 2));
if (failed.length) process.exitCode = 1;
