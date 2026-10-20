// scripts/merge-candidates.mjs — 合并多来源知识卡：去重、校验分类、输出统计
//
// 用法：
//   node scripts/merge-candidates.mjs --inputs raw_data/candidates.skills.jsonl,raw_data/candidates.lang.jsonl
//   node scripts/merge-candidates.mjs --inputs ... --out raw_data/candidates.merged.jsonl

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : fallback;
};

const CATEGORIES = [
  '物流与配送', '退货与退款', '商品与尺码', '支付与结算',
  '账号与安全', '广告与营销', '投诉与纠纷', '平台规则', '其他',
];

const inputs = arg('inputs', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const outPath = arg('out', 'raw_data/candidates.merged.jsonl');

if (!inputs.length) {
  console.error('usage: node scripts/merge-candidates.mjs --inputs a.jsonl,b.jsonl [--out merged.jsonl]');
  process.exit(2);
}

const normQ = (q) => String(q)
  .toLowerCase()
  .replace(/[？?！!。.\s"'“”‘’()（）【】\[\]]+/g, '')
  .trim();

const mapCategory = (raw) => {
  const cat = String(raw || '').trim();
  if (CATEGORIES.includes(cat)) return cat;
  const hit = CATEGORIES.find((c) => c !== '其他' && cat.includes(c));
  return hit || '其他';
};

const seen = new Map();
let total = 0;
const perSource = {};
const perCategory = {};

for (const rel of inputs) {
  const file = path.resolve(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.warn(`[skip] missing ${rel}`);
    continue;
  }
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  for (const line of rows) {
    let card;
    try { card = JSON.parse(line); } catch { continue; }
    if (!card.question || !card.answer) continue;
    total += 1;

    const key = normQ(card.question);
    const existing = seen.get(key);
    const score = (c) => (c.answer?.length || 0) + (c.tags?.length || 0) * 10;
    if (existing && score(existing) >= score(card)) continue;

    const source = String(card.source || '').replace(/\\/g, '/');
    // 受众推断：ecommerce-ai-skills 是卖家运营指南；其余语料（WebFAQ/bitext）服务买家。
    const inferredAudience = /ecommerce-ai-skills\/skills\//.test(source) || /ecommerce-ai-skills/.test(source)
      ? 'seller'
      : 'buyer';
    const clean = {
      question: String(card.question).trim(),
      answer: String(card.answer).trim(),
      tags: Array.isArray(card.tags) ? card.tags.slice(0, 8) : [],
      category: mapCategory(card.category),
      audience: card.audience === 'seller' || card.audience === 'buyer' ? card.audience : inferredAudience,
      source,
      chunk: card.chunk ?? null,
      model: card.model ?? null,
      at: card.at ?? null,
    };
    seen.set(key, clean);
    perSource[clean.source] = (perSource[clean.source] || 0) + 1;
  }
}

const cards = [...seen.values()];
for (const c of cards) perCategory[c.category] = (perCategory[c.category] || 0) + 1;

const full = path.resolve(ROOT, outPath);
fs.mkdirSync(path.dirname(full), { recursive: true });
fs.writeFileSync(full, cards.map((c) => JSON.stringify(c)).join('\n') + '\n');

console.log(`输入 ${total} 条 → 去重后 ${cards.length} 条（重复 ${total - cards.length}）`);
console.log(`输出：${outPath}`);
console.log('\n分类分布：');
for (const [k, v] of Object.entries(perCategory).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}
console.log('\n来源 Top 10：');
for (const [k, v] of Object.entries(perSource).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${v}  ${k}`);
}
