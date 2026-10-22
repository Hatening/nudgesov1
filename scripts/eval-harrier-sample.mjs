#!/usr/bin/env node
/** Harrier 召回快速样本（默认每 10 题取 1，约 200 题），Float32 余弦。 */
import fs from 'node:fs';
import { canonicalKnowledgeId } from '../src/like-retrieval.js';

const INDEX = '.data/harrier-index.json';
const QA = 'db/seed/qa_eval_set.jsonl';
const LIMIT = Number(process.argv.includes('--limit') ? process.argv[process.argv.indexOf('--limit') + 1] : 200);
const BATCH = 16;
const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const cards = index.cards;
const vectors = cards.map((c) => Float32Array.from(c.vector));
const questions = fs.readFileSync(QA, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const stride = Math.max(1, Math.floor(questions.length / LIMIT));
const sample = questions.filter((_, i) => i % stride === 0).slice(0, LIMIT);

async function embed(texts) {
  const res = await fetch('http://192.168.3.227:3679/v1/embeddings', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-harrier-27b', input: texts }), signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data.map((d) => Float32Array.from(d.embedding));
}
let top1 = 0, top5 = 0;
for (let i = 0; i < sample.length; i += BATCH) {
  const batch = sample.slice(i, i + BATCH);
  const qs = await embed(batch.map((q) => q.question));
  for (let j = 0; j < batch.length; j += 1) {
    const q = batch[j]; const qv = qs[j];
    const scored = [];
    for (let ci = 0; ci < vectors.length; ci += 1) {
      const cv = vectors[ci]; let dot = 0;
      for (let k = 0; k < qv.length; k += 1) dot += qv[k] * cv[k];
      scored.push({ ci, dot });
    }
    scored.sort((a, b) => b.dot - a.dot);
    const top = []; const seen = new Set();
    for (const s of scored) {
      const canonical = canonicalKnowledgeId(cards[s.ci].id);
      if (seen.has(canonical)) continue;
      seen.add(canonical); top.push(s);
      if (top.length >= 5) break;
    }
    const target = canonicalKnowledgeId(q.source_card_id);
    const rank = top.findIndex((s) => canonicalKnowledgeId(cards[s.ci].id) === target) + 1;
    if (rank === 1) top1 += 1;
    if (rank > 0 && rank <= 5) top5 += 1;
  }
  console.log(`[harrier-sample] ${Math.min(i + BATCH, sample.length)}/${sample.length}`);
}
const n = sample.length;
console.log(JSON.stringify({ questions: n, top1: +((top1 / n) * 100).toFixed(2), top5: +((top5 / n) * 100).toFixed(2) }, null, 2));
