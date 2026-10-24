import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const outputDir = path.join(root, 'artifacts', 'qa-matrix');
const htmlFiles = fs.readdirSync(publicDir)
  .filter((name) => name.endsWith('.html'))
  .sort();

function attrs(text, name) {
  return [...text.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((match) => match[1]);
}

const inventory = {
  generated_at: new Date().toISOString(),
  pages: [],
  totals: { pages: 0, links: 0, buttons: 0, inputs: 0, language_switches: 0 }
};

for (const file of htmlFiles) {
  const text = fs.readFileSync(path.join(publicDir, file), 'utf8');
  const links = attrs(text, 'href')
    .filter((href) => href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:'))
    .map((href) => href.replaceAll('&amp;', '&'));
  const buttonTags = [...text.matchAll(/<button\b[^>]*>/gi)].map((match) => match[0]);
  const buttons = buttonTags.map((tag) => ({
    id: attrs(tag, 'id')[0] || null,
    action: attrs(tag, 'data-action')[0] || null,
    page: attrs(tag, 'data-page')[0] || null
  }));
  const inputs = [...text.matchAll(/<input\b|<select\b|<textarea\b/gi)].length;
  const hasLanguageSwitch = /language-switch|data-page="languages"|lang=/.test(text);

  inventory.pages.push({
    path: `/${file}`,
    bytes: Buffer.byteLength(text),
    links,
    buttons,
    inputs,
    language_switch: hasLanguageSwitch
  });
  inventory.totals.links += links.length;
  inventory.totals.buttons += buttons.length;
  inventory.totals.inputs += inputs;
  inventory.totals.language_switches += hasLanguageSwitch ? 1 : 0;
}
inventory.totals.pages = inventory.pages.length;

fs.mkdirSync(outputDir, { recursive: true });
const output = path.join(outputDir, 'ui-inventory.json');
fs.writeFileSync(output, JSON.stringify(inventory, null, 2));
console.log(JSON.stringify({ output, totals: inventory.totals }, null, 2));
