#!/usr/bin/env node
/** 纯 Qwen 改写 + SQL LIKE 召回评测（无向量）。 */
import fs from 'node:fs';
import { openDatabase, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { rewriteQuery } from '../src/qwen-rewrite.js';
import { rankByTerms, canonicalKnowledgeId } from '../src/like-retrieval.js';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i > -1 && args[i + 1] ? args[i + 1] : fallback; };
const FILE = arg('file', 'db/seed/qa_eval_set.jsonl');
const LIMIT = Number(arg('limit', '100'));
const questions = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(0, LIMIT);

const db = openDatabase('.data/relaydesk.sqlite');
const dao = createDao(db);
let top1 = 0, top3 = 0, top5 = 0;
const misses = [];
const started = Date.now();
for (let i = 0; i < questions.length; i += 1) {
  const q = questions[i];
  const terms = await rewriteQuery(q.question);
  const candidates = dao.searchKnowledgeByTerms(q.audience === 'buyer' ? 'buyer' : 'seller', terms, { includeQuarantined: false, surface: q.audience === 'buyer' ? 'buyer_chat' : 'seller_console' });
  const ranked = rankByTerms(candidates, terms, 5);
  const target = canonicalKnowledgeId(q.source_card_id);
  const rank = ranked.findIndex((h) => canonicalKnowledgeId(h.id) === target) + 1;
  if (rank === 1) top1 += 1;
  if (rank > 0 && rank <= 3) top3 += 1;
  if (rank > 0 && rank <= 5) top5 += 1;
  if (!rank) misses.push({ question: q.question, terms, source: q.source_card_id, top: ranked.map((h) => h.id) });
  if ((i + 1) % 10 === 0) console.log(`[like-eval] ${i + 1}/${questions.length}`);
}
closeDatabase(db);
const n = questions.length;
const summary = {
  questions: n, top1_hit_rate: +((top1 / n) * 100).toFixed(2), top3_hit_rate: +((top3 / n) * 100).toFixed(2), top5_hit_rate: +((top5 / n) * 100).toFixed(2),
  duration_ms: Date.now() - started, misses,
};
fs.mkdirSync('reports/eval', { recursive: true });
fs.writeFileSync('reports/eval/like-recall.json', JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, misses: undefined }, null, 2));
