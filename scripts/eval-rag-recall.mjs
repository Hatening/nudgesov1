#!/usr/bin/env node
/**
 * 评测集 RAG 召回率：把生成的刁钻问题输入现有检索，统计命中率。
 * 命中定义：返回的 top-1/top-3/top-5 中包含 source_card_id。
 *
 * 用法：node scripts/eval-rag-recall.mjs
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { openDatabase, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { rankKnowledge } from '../src/core.js';

const ROOT = process.cwd();
const QUESTIONS = path.resolve('db/seed/eval_questions.jsonl');
const OUT_DIR = path.resolve('reports/eval');
const DB_PATH = path.resolve('.data/relaydesk.sqlite');
const TOP_K = 5;

const questions = fs.existsSync(QUESTIONS)
  ? fs.readFileSync(QUESTIONS, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : [];

const db = openDatabase(DB_PATH);
const dao = createDao(db);
const corpus = {
  seller: dao.listGlobalKnowledge('seller', { includeQuarantined: false, surface: 'seller_console' }),
  buyer: dao.listGlobalKnowledge('buyer', { includeQuarantined: false, surface: 'buyer_chat' }),
};
closeDatabase(db);

let top1 = 0;
let top3 = 0;
let top5 = 0;
let mrr = 0;
let evaluated = 0;
const byCategory = new Map();
const byAudience = new Map();

for (const q of questions) {
  const audience = q.audience === 'buyer' ? 'buyer' : 'seller';
  const hits = rankKnowledge(q.question, corpus[audience]).slice(0, TOP_K);
  const rank = hits.findIndex((h) => h.id === q.source_card_id) + 1;
  evaluated += 1;
  if (rank === 1) top1 += 1;
  if (rank > 0 && rank <= 3) top3 += 1;
  if (rank > 0 && rank <= TOP_K) top5 += 1;
  if (rank > 0) mrr += 1 / rank;

  const cat = q.category || '其他';
  if (!byCategory.has(cat)) byCategory.set(cat, { total: 0, top1: 0, top5: 0 });
  const c = byCategory.get(cat);
  c.total += 1; if (rank === 1) c.top1 += 1; if (rank > 0 && rank <= TOP_K) c.top5 += 1;

  if (!byAudience.has(audience)) byAudience.set(audience, { total: 0, top1: 0, top5: 0 });
  const a = byAudience.get(audience);
  a.total += 1; if (rank === 1) a.top1 += 1; if (rank > 0 && rank <= TOP_K) a.top5 += 1;
}

const pct = (n, d) => Number(((n / Math.max(1, d)) * 100).toFixed(2));
const summary = {
  questions: questions.length,
  evaluated,
  top1_hit_rate: pct(top1, evaluated),
  top3_hit_rate: pct(top3, evaluated),
  top5_hit_rate: pct(top5, evaluated),
  mrr: Number((mrr / Math.max(1, evaluated)).toFixed(4)),
  corpus: { seller: corpus.seller.length, buyer: corpus.buyer.length },
  by_audience: Object.fromEntries([...byAudience].map(([k, v]) => [k, { total: v.total, top1: pct(v.top1, v.total), top5: pct(v.top5, v.total) }])),
  by_category: Object.fromEntries([...byCategory].map(([k, v]) => [k, { total: v.total, top1: pct(v.top1, v.total), top5: pct(v.top5, v.total) }])),
};

await fsp.mkdir(OUT_DIR, { recursive: true });
await fsp.writeFile(path.join(OUT_DIR, 'rag-recall.json'), JSON.stringify(summary, null, 2));
const lines = [
  '# RAG 召回率评测（防幻觉刁钻问题集）',
  '',
  `- 题目数：${summary.questions}（有效评估 ${summary.evaluated}）`,
  `- Top-1 命中率：**${summary.top1_hit_rate}%**`,
  `- Top-3 命中率：**${summary.top3_hit_rate}%**`,
  `- Top-5 命中率：**${summary.top5_hit_rate}%**`,
  `- MRR：${summary.mrr}`,
  `- 语料：seller ${summary.corpus.seller} / buyer ${summary.corpus.buyer}`,
  '',
  '## 分类目 Top-5',
  '',
  '| 类目 | 题数 | Top-1 | Top-5 |',
  '|---|---|---|---|',
  ...Object.entries(summary.by_category).map(([k, v]) => `| ${k} | ${v.total} | ${v.top1}% | ${v.top5}% |`),
  '',
];
await fsp.writeFile(path.join(OUT_DIR, 'rag-recall.md'), lines.join('\n') + '\n');
console.log(JSON.stringify(summary, null, 2));
