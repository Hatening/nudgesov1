#!/usr/bin/env node
/** 评测 Harrier 27B 向量索引的召回率（2000 道 QA）。 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { canonicalKnowledgeId } from '../src/like-retrieval.js';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const INDEX = arg('index', '.data/harrier-index.json');
const QUESTIONS = arg('questions', 'db/seed/qa_eval_set.jsonl');
const OUT = arg('out', 'reports/eval/harrier-recall.json');
const BASE = (process.env.HARRIER_EMBED_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const MODEL = process.env.HARRIER_MODEL || 'harrier-oss-v1-27b';
const BATCH = Number(arg('batch', '4'));
const LIMIT = Number(arg('limit', '0'));

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
let questions = fs.readFileSync(QUESTIONS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
if (LIMIT > 0) questions = questions.slice(0, LIMIT);
const vectors = index.cards;

async function embed(texts) {
  const res = await fetch(`${BASE}/embeddings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, input: texts }), signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data.map((d) => d.embedding);
}
const norm = (v) => { let s = 0; for (const x of v) s += x * x; const l = Math.sqrt(s) || 1; return v.map((x) => x / l); };

let top1 = 0, top3 = 0, top5 = 0;
const misses = [];
const byCategory = new Map();
for (let i = 0; i < questions.length; i += BATCH) {
  const batch = questions.slice(i, i + BATCH);
  const qvecs = await embed(batch.map((q) => q.question));
  for (let j = 0; j < batch.length; j += 1) {
    const q = batch[j]; const qv = norm(qvecs[j]);
    const scored = vectors.map((c) => {
      let dot = 0; for (let k = 0; k < qv.length; k += 1) dot += qv[k] * c.vector[k];
      return { id: c.id, score: dot };
    }).sort((a, b) => b.score - a.score);
    const top = []; const seen = new Set();
    for (const s of scored) {
      const canonical = canonicalKnowledgeId(s.id);
      if (seen.has(canonical)) continue;
      seen.add(canonical); top.push(s);
      if (top.length >= 5) break;
    }
    const target = canonicalKnowledgeId(q.source_card_id);
    const rank = top.findIndex((s) => canonicalKnowledgeId(s.id) === target) + 1;
    if (rank === 1) top1 += 1;
    if (rank > 0 && rank <= 3) top3 += 1;
    if (rank > 0 && rank <= 5) top5 += 1;
    if (!rank) misses.push({ question: q.question, source_card_id: q.source_card_id, category: q.category, top5: top.map((s) => s.id) });
    const cat = q.category || '其他';
    if (!byCategory.has(cat)) byCategory.set(cat, { total: 0, top1: 0, top5: 0 });
    const c = byCategory.get(cat); c.total += 1; if (rank === 1) c.top1 += 1; if (rank > 0 && rank <= 5) c.top5 += 1;
  }
  console.log(`[harrier-eval] ${Math.min(i + BATCH, questions.length)}/${questions.length}`);
}
const n = questions.length;
const pct = (x) => +((x / Math.max(1, n)) * 100).toFixed(2);
const summary = {
  model: index.model, cards: vectors.length, questions: n,
  top1_hit_rate: pct(top1), top3_hit_rate: pct(top3), top5_hit_rate: pct(top5),
  by_category: Object.fromEntries([...byCategory].map(([k, v]) => [k, { total: v.total, top1: +((v.top1 / v.total) * 100).toFixed(2), top5: +((v.top5 / v.total) * 100).toFixed(2) }])),
  misses,
};
await fsp.mkdir('reports/eval', { recursive: true });
await fsp.writeFile(OUT, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, misses: undefined }, null, 2));
