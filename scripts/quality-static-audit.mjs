/**
 * Static quality audit for NudgeSo.
 *
 * No browser, no network, no writes to product data. It produces a machine
 * readable JSON report and a human readable Markdown summary under
 * artifacts/quality/.
 *
 * Hard failures are limited to findings that make a release unreliable:
 * missing local assets, duplicate DOM ids, broken locale structure and
 * committed high-confidence secrets. Softer findings stay warnings so they
 * can be triaged without turning this script into a false-positive machine.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const outDir = path.join(root, 'artifacts', 'quality');
fs.mkdirSync(outDir, { recursive: true });

const report = {
  generatedAt: new Date().toISOString(),
  root,
  pages: [],
  locales: {},
  assets: { checked: 0, missing: [] },
  html: { duplicateIds: [], controlsWithoutNames: [], imagesWithoutAlt: [], externalResources: [] },
  secrets: [],
  api: {},
  tests: {},
  hardFailures: [],
  warnings: [],
  notRun: [
    'Native-speaker semantic review',
    'Real iOS/Android hardware pass',
    'Manual keyboard and screen-reader review',
    'Lighthouse performance budget (custom measurement only)',
    'Approved visual baselines for non-onboarding pages',
    'Production write / payment / destructive-data tests (forbidden)',
  ],
};

function readPublic(rel) {
  return fs.readFileSync(path.join(publicDir, rel), 'utf8');
}

function addHard(message, details) {
  report.hardFailures.push({ message, details });
}
function addWarning(message, details) {
  report.warnings.push({ message, details });
}

/* ------------------------------------------------------------------ */
/* HTML pages and local assets                                         */
/* ------------------------------------------------------------------ */

const htmlFiles = fs.readdirSync(publicDir)
  .filter((name) => name.endsWith('.html'))
  .sort();

const referencedAssets = new Set();

for (const file of htmlFiles) {
  const html = readPublic(file);
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,''])[1].trim();
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((m) => m[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  report.html.duplicateIds.push(...duplicates.map((id) => ({ file, id })));

  const imgs = [...html.matchAll(/<img\b([^>]*)>/gi)].map((m) => m[1]);
  for (const attrs of imgs) {
    const src = (attrs.match(/\bsrc=["']([^"']+)["']/i) || [,''])[1];
    const alt = attrs.match(/\balt=["']([^"']*)["']/i);
    if (src) {
      const clean = src.split('?')[0].split('#')[0];
      if (!/^(https?:|data:)/.test(clean)) {
        referencedAssets.add(clean);
        const local = path.join(publicDir, clean.replace(/^\//, ''));
        if (!fs.existsSync(local)) report.assets.missing.push({ file, src: clean });
      }
    }
    if (!alt) report.html.imagesWithoutAlt.push({ file, src });
  }

  for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const url = (attrs.match(/\b(?:src|href)=["']([^"']+)["']/i) || [,''])[1];
    if (!url || url.startsWith('#') || url.startsWith('data:')) continue;
    if (/^https?:/i.test(url)) {
      report.html.externalResources.push({ file, tag, url });
      continue;
    }
    const clean = url.split('?')[0].split('#')[0];
    referencedAssets.add(clean);
    const local = path.join(publicDir, clean.replace(/^\//, ''));
    if (!fs.existsSync(local)) report.assets.missing.push({ file, src: clean });
  }

  // Controls without an accessible name are a warning, not a hard fail:
  // a custom component may supply its name at runtime.
  for (const match of html.matchAll(/<(button|input|select|textarea)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    if (tag === 'input' && /\btype=["']hidden["']/i.test(attrs)) continue;
    if (tag === 'button' && />[^<]{1,}<\/button>/i.test(match[0])) continue;
    const hasName = /\b(aria-label|aria-labelledby|title|placeholder)=["'][^"']+["']/i.test(attrs)
      || (tag !== 'button' && /\bid=["'][^"']+["']/i.test(attrs) && new RegExp(`<label[^>]+for=["']${(attrs.match(/\bid=["']([^"']+)["']/i) || [,''])[1]}["']`, 'i').test(html));
    if (!hasName) report.html.controlsWithoutNames.push({ file, tag, attrs: attrs.trim().slice(0, 180) });
  }

  report.pages.push({
    file,
    route: `/${file}`,
    title,
    h1s,
    htmlLang: (html.match(/<html\b[^>]*\blang=["']([^"']+)["']/i) || [,''])[1],
    ids: [...new Set(ids)].length,
    duplicateIds: duplicates,
    imageCount: imgs.length,
    localAssetCount: new Set([...html.matchAll(/(?:src|href)=["'](\/?(?!https?:|data:|#)[^"']+)["']/gi)].map((m) => m[1].split('?')[0].split('#')[0])).size,
    hasInlineScript: /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html),
    hasForm: /<form\b/i.test(html),
  });
}

report.assets.checked = referencedAssets.size;
if (report.assets.missing.length) addHard('One or more referenced local assets are missing.', report.assets.missing);
if (report.html.duplicateIds.length) addHard('Duplicate DOM ids found in static HTML.', report.html.duplicateIds);

/* UI primary color must not silently regress to the old bright orange.
 * The logo token and logo image assets are intentionally exempt; the old
 * primary is otherwise a hard failure. */
const oldPrimaryPattern = /#EE6E3A|#C8541F|rgba\(\s*238\s*,\s*110\s*,\s*58/gi;
const colorFiles = [];
for (const dir of ['public']) {
  const walk = (folder) => {
    for (const name of fs.readdirSync(folder)) {
      const absolute = path.join(folder, name);
      const stat = fs.statSync(absolute);
      if (stat.isDirectory()) {
        if (name !== 'img' && name !== 'qa') walk(absolute);
      } else if (/\.(css|html)$/i.test(name) && name !== 'tailwind.vendor.js') {
        colorFiles.push(absolute);
      }
    }
  };
  walk(path.join(root, dir));
}
for (const absolute of colorFiles) {
  const rel = path.relative(root, absolute);
  const text = fs.readFileSync(absolute, 'utf8');
  text.split(/\r?\n/).forEach((line, index) => {
    if (!oldPrimaryPattern.test(line)) return;
    oldPrimaryPattern.lastIndex = 0;
    if (/--logo-orange|logo-orange/.test(line)) return;
    report.warnings.push({ message: 'Old UI primary orange remains in a production style/HTML file.', details: { file: rel, line: index + 1, text: line.trim().slice(0, 180) } });
  });
  oldPrimaryPattern.lastIndex = 0;
}
if (report.warnings.some((warning) => warning.message.startsWith('Old UI primary orange'))) {
  addHard('Old bright orange remains in UI CSS/HTML outside the logo token.', report.warnings.filter((warning) => warning.message.startsWith('Old UI primary orange')));
}

// Same-origin links are checked by qa:links at runtime; keep this report honest.
report.api.linksCheckedBy = 'npm run qa:links';

/* ------------------------------------------------------------------ */
/* Locale bundles: structure, empties, placeholders and fallback       */
/* ------------------------------------------------------------------ */

function loadWindowBundle(rel) {
  const sandbox = { window: {} };
  vm.runInNewContext(readPublic(rel), sandbox, { filename: rel });
  return sandbox.window;
}

function flatten(value, prefix = '', out = {}) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach((key) => flatten(value[key], prefix ? `${prefix}.${key}` : key, out));
  } else {
    out[prefix] = value;
  }
  return out;
}

function placeholders(value) {
  return [...String(value).matchAll(/\{[a-zA-Z0-9_]+\}/g)].map((m) => m[0]).sort();
}

function auditLocaleBundle(label, bundles, englishKey = 'en') {
  const codes = Object.keys(bundles);
  const base = bundles[englishKey] || bundles[Object.keys(bundles)[0]];
  if (!base) {
    addHard(`${label}: no base locale found.`);
    return;
  }
  const baseFlat = flatten(base);
  const result = {
    label,
    localeCount: codes.length,
    codes,
    englishKey,
    keyCount: Object.keys(baseFlat).length,
    missingKeys: {},
    emptyValues: {},
    placeholderMismatch: {},
    nonStringValues: {},
  };
  for (const code of codes) {
    const flat = flatten(bundles[code]);
    const missing = Object.keys(baseFlat).filter((key) => !(key in flat));
    const empty = Object.keys(flat).filter((key) => typeof flat[key] === 'string' && !flat[key].trim());
    const nonString = Object.keys(flat).filter((key) => typeof flat[key] !== 'string');
    const mismatch = Object.keys(baseFlat).filter((key) => {
      if (typeof baseFlat[key] !== 'string' || typeof flat[key] !== 'string') return false;
      return placeholders(baseFlat[key]).join('|') !== placeholders(flat[key]).join('|');
    });
    if (missing.length) result.missingKeys[code] = missing;
    if (empty.length) result.emptyValues[code] = empty;
    if (nonString.length) result.nonStringValues[code] = nonString;
    if (mismatch.length) result.placeholderMismatch[code] = mismatch;
  }
  if (result.missingKeys && Object.keys(result.missingKeys).length) addHard(`${label}: locale key mismatch.`, result.missingKeys);
  if (result.emptyValues && Object.keys(result.emptyValues).length) addHard(`${label}: empty locale values.`, result.emptyValues);
  if (result.nonStringValues && Object.keys(result.nonStringValues).length) addHard(`${label}: non-string locale values.`, result.nonStringValues);
  if (result.placeholderMismatch && Object.keys(result.placeholderMismatch).length) addWarning(`${label}: placeholder mismatch.`, result.placeholderMismatch);
  report.locales[label] = result;
}

for (const [label, rel, key] of [
  ['ui', 'ui-locales.js', 'en'],
  ['landing', 'landing-locales.js', 'en'],
  ['demo', 'demo-locales.js', 'en'],
]) {
  try {
    const win = loadWindowBundle(rel);
    const bundles = label === 'ui' ? win.NS_UI_LOCALES : label === 'landing' ? win.NS_LANDING_LOCALES : win.NS_DEMO_LOCALES;
    if (!bundles) throw new Error('bundle global is missing');
    auditLocaleBundle(label, bundles, key);
  } catch (error) {
    addHard(`${label}: could not load locale bundle (${error.message}).`);
  }
}

// The UI shell has a zh default plus 39 generated locale bundles. If this
// changes, the coverage matrix must change with it.
if (report.locales.ui && report.locales.ui.localeCount < 39) addWarning('UI generated-locale bundle count is below the 39-bundle baseline.', { count: report.locales.ui.localeCount });
if (report.locales.landing && report.locales.landing.localeCount < 39) addWarning('Landing locale count is below the 39-locale baseline.', { count: report.locales.landing.localeCount });
if (report.locales.demo && report.locales.demo.localeCount < 39) addWarning('Demo locale count is below the 39-locale baseline.', { count: report.locales.demo.localeCount });
if (report.html.controlsWithoutNames.length) addWarning('Static HTML controls without a static accessible name need runtime/custom-component review.', { count: report.html.controlsWithoutNames.length });

/* ------------------------------------------------------------------ */
/* Committed secret scan                                               */
/* ------------------------------------------------------------------ */

const secretPatterns = [
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Generic bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{32,}\b/ },
  { name: 'Generic API key assignment', re: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*["'][A-Za-z0-9._~+/=-]{24,}["']/i },
];
let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
} catch {
  addWarning('git ls-files was unavailable; secret scan skipped.');
}
const scanExtensions = /\.(js|mjs|cjs|ts|tsx|jsx|json|ya?ml|env|md|html|css|sh|ps1)$/i;
for (const rel of tracked) {
  if (!scanExtensions.test(rel) || rel.startsWith('artifacts/') || rel.startsWith('node_modules/') || rel.startsWith('raw_data/')) continue;
  const absolute = path.join(root, rel);
  let text;
  try { text = fs.readFileSync(absolute, 'utf8'); } catch { continue; }
  if (text.length > 1_000_000) continue;
  for (const rule of secretPatterns) {
    const match = text.match(rule.re);
    if (match) {
      const line = text.slice(0, match.index).split(/\r?\n/).length;
      report.secrets.push({ file: rel, line, rule: rule.name, sample: match[0].slice(0, 12) + '…' });
    }
  }
}
if (report.secrets.length) addHard('High-confidence secret-shaped values found in tracked files.', report.secrets);

/* ------------------------------------------------------------------ */
/* API and test inventory                                              */
/* ------------------------------------------------------------------ */

const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const apiPaths = [...server.matchAll(/['"](\/api\/[A-Za-z0-9_./:-]+)['"]/g)].map((m) => m[1]);
report.api = {
  uniqueLiteralPaths: [...new Set(apiPaths)].sort(),
  health: /\/api\/health/.test(server),
  authRegistration: /\/api\/v1\/auth\/register/.test(server),
  rateLimitModule: fs.existsSync(path.join(root, 'src', 'rate-limit.js')),
  piiModule: fs.existsSync(path.join(root, 'src', 'privacy.js')),
  dataDirConfigurable: /DATA_DIR/.test(server),
  dbPathConfigurable: /DB_PATH/.test(server),
  linksCheckedBy: 'npm run qa:links',
};
if (!report.api.health) addHard('No /api/health endpoint found.');
if (!report.api.authRegistration) addHard('No /api/v1/auth/register endpoint found.');

function countTests() {
  const result = { unitFiles: 0, unitTests: 0, e2eFiles: 0, e2eTests: 0 };
  for (const dir of ['test']) {
    const walk = (folder) => {
      for (const name of fs.readdirSync(folder)) {
        const p = path.join(folder, name);
        const stat = fs.statSync(p);
        if (stat.isDirectory()) walk(p);
        else if (name.endsWith('.test.js')) {
          result.unitFiles += 1;
          const text = fs.readFileSync(p, 'utf8');
          result.unitTests += (text.match(/^\s*test\(/gm) || []).length;
        }
      }
    };
    if (fs.existsSync(path.join(root, dir))) walk(path.join(root, dir));
  }
  const e2eDir = path.join(root, 'e2e');
  for (const name of fs.readdirSync(e2eDir)) {
    if (!name.endsWith('.spec.ts')) continue;
    result.e2eFiles += 1;
    const text = fs.readFileSync(path.join(e2eDir, name), 'utf8');
    result.e2eTests += (text.match(/^\s*test\(/gm) || []).length;
  }
  return result;
}
report.tests = countTests();

/* ------------------------------------------------------------------ */
/* Persist JSON and Markdown                                           */
/* ------------------------------------------------------------------ */

const status = report.hardFailures.length ? 'FAIL' : 'PASS';
const summary = {
  status,
  generatedAt: report.generatedAt,
  pages: report.pages.length,
  localAssetsChecked: report.assets.checked,
  missingAssets: report.assets.missing.length,
  duplicateDomIds: report.html.duplicateIds.length,
  imagesWithoutAlt: report.html.imagesWithoutAlt.length,
  controlsWithoutNames: report.html.controlsWithoutNames.length,
  locales: Object.fromEntries(Object.entries(report.locales).map(([key, value]) => [key, value.localeCount])),
  secrets: report.secrets.length,
  unitTests: report.tests.unitTests,
  e2eTests: report.tests.e2eTests,
  hardFailures: report.hardFailures.length,
  warnings: report.warnings.length,
  notRun: report.notRun,
};
report.summary = summary;

fs.writeFileSync(path.join(outDir, 'static-audit.json'), JSON.stringify(report, null, 2));

const lines = [
  '# NudgeSo static quality audit',
  '',
  `Generated: ${report.generatedAt}`,
  `Gate: **${status}**`,
  '',
  '## Summary',
  '',
  '| Check | Result |',
  '|---|---|',
  `| HTML pages | ${report.pages.length} |`,
  `| Local assets checked | ${report.assets.checked} |`,
  `| Missing local assets | ${report.assets.missing.length} |`,
  `| Duplicate DOM ids | ${report.html.duplicateIds.length} |`,
  `| Images without alt | ${report.html.imagesWithoutAlt.length} |`,
  `| Controls without static accessible name | ${report.html.controlsWithoutNames.length} |`,
  `| Locale bundles | ${Object.entries(report.locales).map(([k, v]) => `${k}:${v.localeCount}`).join(', ')} |`,
  `| High-confidence secrets | ${report.secrets.length} |`,
  `| Unit test declarations | ${report.tests.unitTests} across ${report.tests.unitFiles} files |`,
  `| E2E test declarations | ${report.tests.e2eTests} across ${report.tests.e2eFiles} files |`,
  `| Hard failures | ${report.hardFailures.length} |`,
  `| Warnings | ${report.warnings.length} |`,
  '',
  '## Hard failures',
  '',
  ...(report.hardFailures.length ? report.hardFailures.map((failure) => `### ${failure.message}\n\n\`\`\`json\n${JSON.stringify(failure.details, null, 2).slice(0, 12000)}\n\`\`\``) : ['None.']),
  '',
  '## Warnings',
  '',
  ...(report.warnings.length ? report.warnings.map((warning) => `- ${warning.message}${warning.details ? `: \`${JSON.stringify(warning.details).slice(0, 500)}\`` : ''}`) : ['None.']),
  '',
  '## Not run / residual risk',
  '',
  ...report.notRun.map((item) => `- NOT RUN: ${item}`),
  '',
  '## Notes',
  '',
  '- Static controls-without-names are warnings because custom components may supply names at runtime.',
  '- The placeholder check is a warning because the source dictionary may legitimately use different ICU structures.',
  '- Link resolution is checked separately by `npm run qa:links` against a running app.',
  '',
];
fs.writeFileSync(path.join(outDir, 'static-audit.md'), lines.join('\n'));

console.log(JSON.stringify({ status, json: path.join(outDir, 'static-audit.json'), markdown: path.join(outDir, 'static-audit.md'), summary }, null, 2));
process.exit(status === 'PASS' ? 0 : 1);
