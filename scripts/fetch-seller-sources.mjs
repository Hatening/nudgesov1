#!/usr/bin/env node
/**
 * fetch-seller-sources.mjs — safe public seller-content collector
 *
 * Sources:
 *   - Shopify Blog: Marketing and Ecommerce (Sell Online) topic pages
 *   - Google Digital Garage / Grow with Google public course page
 *
 * Safety:
 *   - fetches and obeys robots.txt for every origin
 *   - only public HTML, no auth/cookies/login pages
 *   - same-origin article links, no query-string crawl traps
 *   - polite delay, bounded response size, limited pages
 *
 * Usage:
 *   node scripts/fetch-seller-sources.mjs                 # 5 Shopify articles + Google page (test batch)
 *   node scripts/fetch-seller-sources.mjs --limit 5
 *   node scripts/fetch-seller-sources.mjs --dry-run
 *   node scripts/fetch-seller-sources.mjs --all           # full topic-page article lists
 *   node scripts/fetch-seller-sources.mjs --no-google
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUT = path.join(ROOT, 'raw_data', 'seller_extra');
const USER_AGENT = 'RelayDeskSellerSourceBot/1.0 (+https://nudgeso.onrender.com)';
const MAX_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 35_000;

// 注意：Shopify 的列表页分页参数 ?page=N 被 robots.txt 的 `Disallow: *page=*` 禁止，
// 所以每个列表页只能抓第 1 页；退换货/物流/支付类文章供给不足时需要在报告里说明。
const LIST_PAGES = [
  { label: 'marketing', url: 'https://www.shopify.com/blog/topics/marketing', pages: 1, description: 'Shopify Blog — Marketing' },
  { label: 'ecommerce', url: 'https://www.shopify.com/blog/topics/sell-online', pages: 1, description: 'Shopify Blog — Ecommerce (Sell Online)' },
  { label: 'customer-experience', url: 'https://www.shopify.com/blog/topics/customer-experience', pages: 1, description: 'Shopify Blog — Customer Experience' },
];

// 抓取配额：按经营闭环分配（用户确认过的比例）
const CATEGORY_PLAN = [
  { key: 'aftersales', label: '售后与退换货', weight: 0.25, test: /return|refund|exchange|warranty|chargeback|dispute|complaint|damaged/i },
  { key: 'logistics', label: '物流与履约', weight: 0.20, test: /shipping|delivery|fulfil|warehouse|packaging|carrier|international-shipping|inventory/i },
  { key: 'support', label: '客户服务', weight: 0.15, test: /customer-service|customer-experience|support|live-chat|retention|loyalty|review|helpdesk|chatbot/i },
  { key: 'payments', label: '支付与财务', weight: 0.10, test: /payment|tax|billing|invoice|finance|checkout|pricing|currency|subscription/i },
  { key: 'marketing', label: '营销与流量', weight: 0.30, test: /.*/i },
];

/** 用 slug + 标题给文章归类；先匹配具体品类，最后兜底营销 */
function classifyArticle(title, path) {
  const haystack = `${title} ${path}`;
  for (const plan of CATEGORY_PLAN) {
    if (plan.test.test(haystack)) return plan;
  }
  return CATEGORY_PLAN[CATEGORY_PLAN.length - 1];
}

const GOOGLE_COURSE = {
  label: 'google-digital-garage',
  url: 'https://grow.google/certificates/digital-marketing-ecommerce/',
  description: 'Google Digital Garage / Grow with Google — Digital Marketing & Ecommerce',
};

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const argValue = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const LIMIT = hasFlag('all') ? Infinity : Math.max(1, Number(argValue('limit', '5')) || 5);
const TOTAL = Math.max(1, Number(argValue('total', '100')) || 100);
const PLAN_MODE = hasFlag('plan');
const DRY_RUN = hasFlag('dry-run') || PLAN_MODE;
const INCLUDE_GOOGLE = !hasFlag('no-google');
const OUT_DIR = path.resolve(ROOT, argValue('out', DEFAULT_OUT));
const DELAY_MS = Math.max(250, Number(argValue('delay', '1000')) || 1000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- HTTP + robots
const robotsCache = new Map();

function robotsPatternToRegex(pattern) {
  // robots.txt uses * as any sequence and $ as end-of-path.
  let value = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  value = value.replace(/\*/g, '.*');
  const anchored = value.endsWith('\\$');
  if (anchored) value = value.slice(0, -2);
  return new RegExp(`^${value}${anchored ? '$' : ''}`);
}

function parseRobots(text) {
  const groups = [];
  let current = null;
  for (let rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line || !line.includes(':')) continue;
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!current || current.agents.length > 0 && current.rules.length > 0) {
        current = { agents: [], rules: [], crawlDelay: 0 };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    if (key === 'allow' || key === 'disallow') {
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else if (key === 'crawl-delay') {
      const delay = Number(value);
      if (Number.isFinite(delay) && delay > 0) current.crawlDelay = delay * 1000;
    }
  }
  return groups;
}

function selectRobotsGroup(groups) {
  const star = groups.find((g) => g.agents.includes('*'));
  const exact = groups.find((g) => g.agents.some((a) => a !== '*' && USER_AGENT.toLowerCase().includes(a)));
  return exact || star || { agents: [], rules: [], crawlDelay: 0 };
}

async function getRobots(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const robotsUrl = new URL('/robots.txt', origin).href;
  const response = await fetchWithRetry(robotsUrl, { expectHtml: false });
  if (!response.ok) throw new Error(`robots.txt unavailable for ${origin}: HTTP ${response.status}`);
  const text = await readTextBounded(response);
  const info = { origin, groups: parseRobots(text), source: robotsUrl };
  robotsCache.set(origin, info);
  return info;
}

function robotsAllows(robots, url) {
  const u = new URL(url);
  const group = selectRobotsGroup(robots.groups);
  const target = `${u.pathname}${u.search}`;
  let winner = null;
  for (const rule of group.rules) {
    if (!robotsPatternToRegex(rule.pattern).test(target)) continue;
    if (!winner || rule.pattern.length > winner.pattern.length) winner = rule;
    else if (rule.pattern.length === winner.pattern.length && rule.allow) winner = rule;
  }
  return {
    allowed: winner ? winner.allow : true,
    crawlDelay: group.crawlDelay,
    rule: winner ? `${winner.allow ? 'Allow' : 'Disallow'}: ${winner.pattern}` : '(no matching rule)',
  };
}

async function fetchWithRetry(url, { expectHtml = true } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: {
          'user-agent': USER_AGENT,
          accept: expectHtml ? 'text/html,application/xhtml+xml' : 'text/plain,*/*',
          'accept-language': 'en-US,en;q=0.8',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after') || 0);
        await sleep(Math.max(1500, retryAfter * 1000));
        lastError = new Error(`HTTP ${response.status} from ${url}`);
        continue;
      }
      if (expectHtml && response.ok) {
        const type = (response.headers.get('content-type') || '').toLowerCase();
        if (!type.includes('text/html') && !type.includes('application/xhtml')) {
          throw new Error(`unexpected content-type for ${url}: ${type || '(missing)'}`);
        }
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError || new Error(`fetch failed: ${url}`);
}

async function readTextBounded(response) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_BYTES) throw new Error(`response too large: ${length} bytes`);
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error(`response too large: ${Buffer.byteLength(text)} bytes`);
  return text;
}

async function fetchPublicHtml(url) {
  const u = new URL(url);
  const robots = await getRobots(u.origin);
  const permission = robotsAllows(robots, url);
  if (!permission.allowed) throw new Error(`robots.txt blocks ${url} (${permission.rule})`);
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const finalUrl = response.url || url;
  const finalRobots = await getRobots(new URL(finalUrl).origin);
  const finalPermission = robotsAllows(finalRobots, finalUrl);
  if (!finalPermission.allowed) throw new Error(`robots.txt blocks redirect target ${finalUrl} (${finalPermission.rule})`);
  await sleep(Math.max(DELAY_MS, finalPermission.crawlDelay || 0));
  return { html: await readTextBounded(response), finalUrl, robots: finalRobots, rule: finalPermission.rule };
}

// ---------------------------------------------------------------- HTML helpers
const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…',
};

function decodeEntities(value = '') {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

function stripTags(value = '') {
  return decodeEntities(String(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function balancedElement(html, tagName, startIndex) {
  const tokenPattern = new RegExp(`<${tagName}\\b[^>]*>|<\\/${tagName}\\s*>`, 'gi');
  tokenPattern.lastIndex = startIndex;
  let depth = 0;
  let token;
  while ((token = tokenPattern.exec(html))) {
    if (token[0][1] !== '/') depth += 1;
    else depth -= 1;
    if (depth === 0) return html.slice(startIndex, tokenPattern.lastIndex);
  }
  return '';
}

function extractArticleContent(html, source) {
  if (source === 'shopify') {
    const marker = /<div\b[^>]*\bid=["']article-content["'][^>]*>/i.exec(html);
    if (marker) return balancedElement(html, 'div', marker.index);
  }
  const main = /<main\b[^>]*>/i.exec(html);
  if (main) return balancedElement(html, 'main', main.index);
  const article = /<article\b[^>]*>/i.exec(html);
  if (article) return balancedElement(html, 'article', article.index);
  return html;
}

function inlineMarkdown(value) {
  const text = String(value)
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text).replace(/[ \t]+/g, ' ').trim();
}

function htmlToMarkdown(rawHtml) {
  let html = String(rawHtml)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|iframe|form|nav|header|footer|aside|button)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|svg|iframe|link|meta)\b[^>]*\/?>/gi, '')
    .replace(/<\/?(?:div|section|span|article|main|figure|figcaption)\b[^>]*>/gi, '\n');

  html = html.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => `\n\n${'#'.repeat(Number(level))} ${inlineMarkdown(text)}\n\n`);
  html = html.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${inlineMarkdown(text)}`);
  html = html.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, text) => `\n\n> ${inlineMarkdown(text)}\n\n`);
  html = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, text) => `\n\n\`\`\`\n${stripTags(text)}\n\`\`\`\n\n`);
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<\/p>/gi, '\n\n').replace(/<p\b[^>]*>/gi, '');
  html = html.replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(html)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

function titleFromHtml(html) {
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) return stripTags(h1[1]);
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return title ? stripTags(title[1]) : '';
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'article';
}

// ---------------------------------------------------------------- Article discovery
function extractArticleLinks(html, baseUrl, category) {
  const base = new URL(baseUrl);
  const links = [];
  const seen = new Set();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href;
    try { href = new URL(decodeEntities(match[1]), base); } catch { continue; }
    if (href.origin !== base.origin) continue;
    if (!href.pathname.startsWith('/blog/')) continue;
    // Shopify 文章是单段 slug：/blog/<slug>；排除 /blog/topics 静态页与导航
    if (href.pathname === '/blog/topics') continue;
    if (!/^\/blog\/[a-z0-9][a-z0-9-]*$/i.test(href.pathname)) continue;
    if (/\/(?:search|account|login|signin|signup|cart|checkout)(?:\/|$)/i.test(href.pathname)) continue;
    const clean = new URL(href.pathname, base.origin);
    if (seen.has(clean.href)) continue;
    seen.add(clean.href);
    const title = stripTags(match[2]);
    if (title.length < 12) continue;
    if (/^(see all|view all|all topics|skip to|find an idea|starting up|marketing|ecommerce)$/i.test(title)) continue;
    links.push({ url: clean.href, path: clean.pathname, title, category: classifyArticle(title, href.pathname) });
  }
  return links;
}

function allocate(links, total) {
  const byKey = {};
  for (const link of links) {
    const key = link.category.key;
    (byKey[key] ||= []).push(link);
  }
  const plan = CATEGORY_PLAN.map((category) => ({
    ...category,
    quota: Math.round(category.weight * total),
    picked: [],
  }));

  let deficit = 0;
  for (const bucket of plan) {
    const pool = byKey[bucket.key] || [];
    bucket.picked = pool.slice(0, bucket.quota);
    deficit += bucket.quota - bucket.picked.length;
  }

  // 某个品类供给不足时，把余额补到营销（供给最充足）
  if (deficit > 0) {
    const marketing = plan.find((bucket) => bucket.key === 'marketing');
    const used = new Set(plan.flatMap((bucket) => bucket.picked.map((item) => item.url)));
    const extra = (byKey.marketing || []).filter((item) => !used.has(item.url)).slice(0, deficit);
    marketing.picked.push(...extra);
  }

  return plan;
}

// ---------------------------------------------------------------- Output
function markdownDocument({ title, sourceUrl, source, category, html }) {
  const content = htmlToMarkdown(extractArticleContent(html, source)).trim();
  if (content.length < 200) throw new Error(`extracted content too short (${content.length} chars) for ${sourceUrl}`);
  const fetchedAt = new Date().toISOString();
  return {
    content: `---\n`
      + `title: ${JSON.stringify(title)}\n`
      + `source: ${source}\n`
      + `source_url: ${sourceUrl}\n`
      + `category: ${category}\n`
      + `audience: seller\n`
      + `fetched_at: ${fetchedAt}\n`
      + `---\n\n`
      + `# ${title}\n\n`
      + `> Source: [${new URL(sourceUrl).hostname}](${sourceUrl}) · category: ${category} · audience: seller\n\n`
      + `${content}\n`,
    fetchedAt,
  };
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const targetTotal = hasFlag('limit') ? LIMIT : TOTAL;
  console.log(`[safety] User-Agent: ${USER_AGENT}`);
  console.log(`[output] ${path.relative(ROOT, OUT_DIR)}`);
  console.log(`[mode] ${PLAN_MODE ? 'plan-only' : DRY_RUN ? 'dry-run' : `write ${targetTotal} Shopify articles`}${INCLUDE_GOOGLE ? ' + Google course page' : ''}`);

  const groups = [];
  const allLinks = [];
  const seen = new Set();
  for (const page of LIST_PAGES) {
    const maxPages = page.pages || 1;
    let found = 0;
    for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
      const listUrl = pageNo === 1 ? page.url : `${page.url}?page=${pageNo}`;
      console.log(`\n[robots] ${listUrl}`);
      const fetched = await fetchPublicHtml(listUrl);
      console.log(`  allowed=${fetched.rule} final=${fetched.finalUrl}`);
      const links = extractArticleLinks(fetched.html, fetched.finalUrl, page.label);
      let added = 0;
      for (const link of links) {
        if (seen.has(link.url)) continue;
        seen.add(link.url);
        allLinks.push(link);
        added += 1;
      }
      found += added;
      console.log(`  ${page.description} p${pageNo}: ${links.length} links, ${added} new`);
      if (added === 0) break;
    }
    groups.push({ ...page, found });
  }

  const allocation = allocate(allLinks, targetTotal);
  const chosen = allocation.flatMap((bucket) => bucket.picked);
  if (!chosen.length) throw new Error('no public Shopify article links found');

  console.log(`\n[plan] 目标 ${targetTotal} 篇，实际可抓 ${chosen.length} 篇`);
  console.log('  分类                 权重   配额  供给  实取');
  for (const bucket of allocation) {
    const supply = allLinks.filter((link) => link.category.key === bucket.key).length;
    console.log(`  ${bucket.label.padEnd(10, '　')} ${String(Math.round(bucket.weight * 100)).padStart(4)}%  ${String(bucket.quota).padStart(4)}  ${String(supply).padStart(4)}  ${String(bucket.picked.length).padStart(4)}`);
  }

  console.log('\n[urls]');
  for (const bucket of allocation) {
    console.log(`\n# ${bucket.label}（${bucket.picked.length} 篇）`);
    for (const article of bucket.picked) {
      const robots = await getRobots(new URL(article.url).origin);
      const permission = robotsAllows(robots, article.url);
      const mark = permission.allowed ? 'OK ' : 'BLOCK';
      console.log(`  [${mark}] ${article.title}`);
      console.log(`         ${article.url}`);
    }
  }

  if (PLAN_MODE) {
    console.log('\n[plan-only] 未抓取任何文章；确认清单后加 --all 执行。');
    return;
  }

  const manifest = { generated_at: new Date().toISOString(), audience: 'seller', sources: [], articles: [] };

  if (!DRY_RUN) {
    for (const article of chosen) {
      console.log(`\n[fetch] ${article.url}`);
      const page = await fetchPublicHtml(article.url);
      const title = article.title || titleFromHtml(page.html);
      const doc = markdownDocument({ title, sourceUrl: page.finalUrl, source: 'shopify', category: article.category.label, html: page.html });
      const filename = `shopify-${article.category.key}-${slugify(article.path.split('/').pop())}.md`;
      await fs.writeFile(path.join(OUT_DIR, filename), doc.content, 'utf8');
      const entry = { file: filename, title, url: page.finalUrl, category: article.category.key, category_label: article.category.label, chars: doc.content.length, fetched_at: doc.fetchedAt, robots_rule: page.rule };
      manifest.articles.push(entry);
      console.log(`  wrote ${filename} (${doc.content.length} chars)`);
    }
  }

  if (INCLUDE_GOOGLE) {
    console.log(`\n[robots] ${GOOGLE_COURSE.url}`);
    const page = await fetchPublicHtml(GOOGLE_COURSE.url);
    console.log(`  allowed=${page.rule} final=${page.finalUrl}`);
    if (!DRY_RUN) {
      const title = titleFromHtml(page.html) || 'Google Digital Garage — Digital Marketing & Ecommerce';
      const doc = markdownDocument({ title, sourceUrl: page.finalUrl, source: 'google-digital-garage', category: 'course', html: page.html });
      const filename = 'google-digital-garage-digital-marketing-ecommerce.md';
      await fs.writeFile(path.join(OUT_DIR, filename), doc.content, 'utf8');
      manifest.articles.push({ file: filename, title, url: page.finalUrl, category: 'course', category_label: '营销与流量', chars: doc.content.length, fetched_at: doc.fetchedAt, robots_rule: page.rule });
      console.log(`  wrote ${filename} (${doc.content.length} chars)`);
    }
  }

  if (!DRY_RUN) {
    manifest.sources = groups.map((g) => ({ label: g.label, list_url: g.url, found: g.found }));
    manifest.plan = allocation.map((bucket) => ({ category: bucket.label, weight: bucket.weight, quota: bucket.quota, picked: bucket.picked.length }));
    await fs.writeFile(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log(`\n[done] ${manifest.articles.length} markdown file(s) in ${path.relative(ROOT, OUT_DIR)}`);
    console.log(`       manifest: ${path.relative(ROOT, path.join(OUT_DIR, 'manifest.json'))}`);
  } else {
    console.log('\n[dry-run] no files written');
  }
}

main().catch((error) => {
  console.error(`\n[fatal] ${error.message}`);
  process.exit(1);
});
