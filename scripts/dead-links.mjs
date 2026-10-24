import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const base = (process.env.BASE_URL || 'http://127.0.0.1:3030').replace(/\/$/, '');
const outputDir = path.join(root, 'artifacts', 'qa-matrix');
const htmlFiles = fs.readdirSync(publicDir).filter((name) => name.endsWith('.html')).sort();

function localHrefs(text) {
  return [...text.matchAll(/href=["']([^"']+)["']/g)]
    .map((match) => match[1].replaceAll('&amp;', '&'))
    .filter((href) => href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:'))
    .filter((href) => !href.includes("' +") && !href.includes('${'))
    .filter((href) => {
      try {
        return new URL(href, base).origin === new URL(base).origin;
      } catch {
        return false;
      }
    });
}

const links = new Map();
for (const file of htmlFiles) {
  const text = fs.readFileSync(path.join(publicDir, file), 'utf8');
  for (const href of localHrefs(text)) {
    const url = new URL(href, base);
    links.set(url.href, { href, source: `/${file}` });
  }
}

const results = [];
for (const [url, meta] of links) {
  if (url.endsWith('/insight.html') && !url.includes('?')) continue;
  try {
    const response = await fetch(url, { redirect: 'follow' });
    results.push({ ...meta, url, status: response.status, ok: response.status < 400 });
  } catch (error) {
    results.push({ ...meta, url, status: 0, ok: false, error: String(error) });
  }
}

const dead = results.filter((row) => !row.ok);
fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, 'dead-links.json');
fs.writeFileSync(output, JSON.stringify({
  generated_at: new Date().toISOString(),
  base,
  checked: results.length,
  dead: dead.length,
  results
}, null, 2));
console.log(JSON.stringify({ output, checked: results.length, dead: dead.length, failures: dead }, null, 2));
process.exitCode = dead.length ? 1 : 0;
