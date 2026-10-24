import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const i18n = fs.readFileSync(path.join(root, 'public', 'i18n.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

const supportedMatch = i18n.match(/const supported\s*=\s*\[([^\]]+)\]/);
const uiLocales = supportedMatch
  ? [...supportedMatch[1].matchAll(/['"]([A-Za-z-]+)['"]/g)].map((match) => match[1])
  : [];

const languagesMatch = app.match(/const languages\s*=\s*\[([\s\S]*?)\];/);
const dashboardLocales = languagesMatch
  ? [...languagesMatch[1].matchAll(/\[['"]([a-z-]+)['"]/g)].map((match) => match[1])
  : [];

const report = {
  generated_at: new Date().toISOString(),
  ui_locales: uiLocales,
  ui_locale_count: uiLocales.length,
  dashboard_language_options: dashboardLocales,
  dashboard_language_count: dashboardLocales.length,
  note: 'UI locale coverage is not the same as the language selector. Only UI locales with translated copy can be tested for translation completeness.'
};

const outputDir = path.join(root, 'artifacts', 'qa-matrix');
fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, 'locale-coverage.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, ...report }, null, 2));
