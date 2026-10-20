#!/usr/bin/env node
/**
 * fetch-seller-bc-shipbob.mjs — 补抓 BigCommerce / ShipBob 卖家运营文章
 *
 * 实测结论（写死在代码里，避免重复踩坑）：
 *   - ShipBob：6 个分类页可抓（fulfillment / inventory / supply-chain /
 *     warehouse-management / logistics / case-studies），robots 允许。
 *   - BigCommerce：博客是 Next.js 客户端渲染，分类页 HTML 无文章链接，
 *     /blog/feed、/sitemap.xml 均 404 → 跳过并记录原因。
 *
 * 用法：
 *   node scripts/fetch-seller-bc-shipbob.mjs --total 24
 *   node scripts/fetch-seller-bc-shipbob.mjs --plan        # 只列清单
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'raw_data', 'seller_extra2');
const UA = 'RelayDeskSellerSourceBot/1.0 (+https://nudgeso.onrender.com)';
const DELAY_MS = 700;

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const hasFlag = (name) => argv.includes(`--${name}`);
const TOTAL = Math.max(1, Number(arg('total', '24')) || 24);
const PLAN_ONLY = hasFlag('plan');

const SHIPBOB_CATEGORIES = [
  { label: 'logistics', url: 'https://www.shipbob.com/blog/category/logistics/' },
  { label: 'fulfillment', url: 'https://www.shipbob.com/blog/category/fulfillment/' },
  { label: 'inventory', url: 'https://www.shipbob.com/blog/category/inventory/' },
  { label: 'supply-chain', url: 'https://www.shipbob.com/blog/category/supply-chain/' },
  { label: 'warehouse-management', url: 'https://www.shipbob.com/blog/category/warehouse-management/' },
  { label: 'shipping', url: 'https://www.shipbob.com/blog/category/shipping/' },
];

const BIGCOMMERCE_STATUS = {
  source: 'bigcommerce',
  status: 'skipped',
  reason: 'blog is client-rendered (Next.js); category HTML has no article links, /blog/feed and /sitemap.xml return 404',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- robots
const robotsCache = new Map();

function patternToRegex(pattern) {
  let value = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  value = value.replace(/\*/g, '.*');
  const anchored = value.endsWith('\\$');
  if (anchored) value = value.slice(0, -2);
  return new RegExp(`^${value}${anchored ? '$' : ''}`);
}

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line.includes(':')) continue;
    const [key, ...rest] = line.split(':');
    const name = key.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (name === 'user-agent') {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (name === 'disallow' || name === 'allow') && value) {
      current.rules.push({ allow: name === 'allow', pattern: value });
    }
  }
  return groups;
}

async function robotsFor(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const res = await fetch(`${origin}/robots.txt`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  const info = res.ok ? parseRobots(await res.text()) : [];
  robotsCache.set(origin, info);
  return info;
}

async function robotsAllows(url) {
  const origin = new URL(url).origin;
  const groups = await robotsFor(origin);
  const group = groups.find((g) => g.agents.includes('*')) || { rules: [] };
  const target = new URL(url).pathname + new URL(url).search;
  let winner = null;
  for (const rule of group.rules) {
    if (!patternToRegex(rule.pattern).test(target)) continue;
    if (!winner || rule.pattern.length > winner.pattern.length || (rule.pattern.length === winner.pattern.length && rule.allow)) {
      winner = rule;
    }
  }
  return !winner || winner.allow;
}

async function fetchHtml(url) {
  if (!(await robotsAllows(url))) throw new Error(`robots.txt blocks ${url}`);
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  await sleep(DELAY_MS);
  return { html: await res.text(), finalUrl: res.url || url };
}

// ---------------------------------------------------------------- HTML → Markdown
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };

function decode(value) {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const hex = e[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(e.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function inline(value) {
  return decode(String(value).replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').trim();
}

function balanced(html, tag, start) {
  const re = new RegExp(`<${tag}\\b[^>]*>|<\\/${tag}\\s*>`, 'gi');
  re.lastIndex = start;
  let depth = 0, token;
  while ((token = re.exec(html))) {
    depth += token[0][1] === '/' ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return '';
}

function extractMain(html) {
  for (const tag of ['article', 'main']) {
    const m = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(html);
    if (m) {
      const block = balanced(html, tag, m.index);
      if (block.length > 800) return block;
    }
  }
  return html;
}

function toMarkdown(rawHtml) {
  let html = String(rawHtml)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|iframe|form|nav|header|footer|aside|button)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, l, t) => `\n\n${'#'.repeat(Number(l))} ${inline(t)}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${inline(t)}`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => `\n\n> ${inline(t)}\n\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');
  return decode(html).replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function titleOf(html) {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return h1 ? inline(h1[1]) : (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
}

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// ---------------------------------------------------------------- main
async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  console.log(`[mode] ${PLAN_ONLY ? 'plan-only' : `fetch up to ${TOTAL} articles`}`);
  console.log(`[bigcommerce] ${BIGCOMMERCE_STATUS.status}: ${BIGCOMMERCE_STATUS.reason}`);

  const collected = [];
  const seen = new Set();
  for (const category of SHIPBOB_CATEGORIES) {
    console.log(`\n[list] ${category.url}`);
    const { html, finalUrl } = await fetchHtml(category.url);
    let added = 0;
    for (const m of html.matchAll(/href=["']([^"']+)["']/g)) {
      let u;
      try { u = new URL(m[1], finalUrl); } catch { continue; }
      if (!/^\/blog\/[a-z0-9-]+\/$/i.test(u.pathname)) continue;
      if (u.pathname.startsWith('/blog/category/')) continue;
      const url = `https://www.shipbob.com${u.pathname}`;
      if (seen.has(url)) continue;
      seen.add(url);
      collected.push({ url, category: category.label, source: 'shipbob' });
      added += 1;
    }
    console.log(`  ${category.label}: +${added} (total ${collected.length})`);
    if (collected.length >= TOTAL * 2) break;
  }

  const chosen = collected.slice(0, TOTAL);
  console.log(`\n[plan] ${chosen.length} article(s)`);
  for (const item of chosen) console.log(`  [${item.category}] ${item.url}`);
  if (PLAN_ONLY) {
    console.log('\n[plan-only] 未写文件');
    return;
  }

  const manifest = { generated_at: new Date().toISOString(), audience: 'seller', sources: [BIGCOMMERCE_STATUS], articles: [] };

  for (const item of chosen) {
    try {
      console.log(`\n[fetch] ${item.url}`);
      const { html, finalUrl } = await fetchHtml(item.url);
      const content = toMarkdown(extractMain(html));
      if (content.length < 400) throw new Error(`content too short (${content.length})`);
      const title = titleOf(html) || slugify(item.url);
      const filename = `shipbob-${item.category}-${slugify(new URL(item.url).pathname.replace('/blog/', ''))}.md`;
      const doc = `---\ntitle: ${JSON.stringify(title)}\nsource: shipbob\nsource_url: ${finalUrl}\ncategory: ${item.category}\naudience: seller\nfetched_at: ${manifest.generated_at}\n---\n\n# ${title}\n\n> Source: [www.shipbob.com](${finalUrl}) · category: ${item.category} · audience: seller\n\n${content}\n`;
      await fs.writeFile(path.join(OUT_DIR, filename), doc, 'utf8');
      manifest.articles.push({ file: filename, title, url: finalUrl, category: item.category, chars: content.length });
      console.log(`  wrote ${filename} (${content.length} chars)`);
    } catch (error) {
      console.error(`  [skip] ${item.url}: ${error.message}`);
      manifest.errors = [...(manifest.errors || []), { url: item.url, error: error.message }];
    }
  }

  await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`\n[done] ${manifest.articles.length} article(s) → ${path.relative(ROOT, OUT_DIR)}`);
}

main().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exit(1);
});
