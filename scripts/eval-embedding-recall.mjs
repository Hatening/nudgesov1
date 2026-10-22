#!/usr/bin/env node
/**
 * 语义召回评测（bge-m3 embedding，多语言跨语种）
 * 输入：db/seed/qa_eval_set.jsonl
 * 输出：reports/eval/embedding-recall.json
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const EMBED_URL = 'http://192.168.3.227:3679/v1/embeddings';
const MODEL = 'text-embedding-bge-m3';
const QUESTIONS = 'db/seed/qa_eval_set.jsonl';
const OUT = 'reports/eval/embedding-recall.json';
const BATCH = 32;
const WORKERS = 4;

const questions = fs.readFileSync(QUESTIONS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const db = new DatabaseSync('.data/relaydesk.sqlite');
const cards = db.prepare("SELECT id,title,content,tags_json,category,audience FROM knowledge WHERE status='confirmed' AND scope='global'").all().map((r) => ({
  id: r.id, title: r.title, content: r.content, tags: JSON.parse(r.tags_json || '[]'), category: r.category, audience: r.audience,
  text: `${r.title}\n${String(r.content).slice(0, 1800)}\n${r.tags_json}`,
}));
db.close();

async function embed(texts) {
  const res = await fetch(EMBED_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`embed HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.data.map((d) => d.embedding);
}
function norm(v) { let s = 0; for (const x of v) s += x * x; s = Math.sqrt(s) || 1; return v.map((x) => x / s); }
async function embedAll(texts, label) {
  const batches = [];
  for (let i = 0; i < texts.length; i += BATCH) batches.push(texts.slice(i, i + BATCH));
  const out = new Array(texts.length);
  let cursor = 0, done = 0;
  const worker = async () => {
    while (true) {
      const i = cursor; cursor += 1;
      if (i >= batches.length) return;
      const vecs = await embed(batches[i]);
      vecs.forEach((v, j) => { out[i * BATCH + j] = norm(v); });
      done += vecs.length;
      if (done % 320 < BATCH) console.log(`[${label}] ${done}/${texts.length}`);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, () => worker()));
  return out;
}

const cardVecs = await embedAll(cards.map((c) => c.text), 'cards');
const qVecs = await embedAll(questions.map((q) => q.question), 'questions');
console.log(`embedded cards=${cardVecs.length} questions=${qVecs.length}`);

const cardIndex = new Map(cards.map((c, i) => [c.id, i]));
let top1 = 0, top3 = 0, top5 = 0;
const byCategory = new Map();
for (let qi = 0; qi < questions.length; qi += 1) {
  const q = questions[qi];
  const targetIndex = cardIndex.get(q.source_card_id);
  if (targetIndex === undefined) continue;
  const qv = qVecs[qi];
  const scored = cardVecs.map((cv, ci) => {
    let dot = 0;
    for (let k = 0; k < qv.length; k += 1) dot += qv[k] * cv[k];
    return { ci, score: dot };
  }).sort((a, b) => b.score - a.score).slice(0, 5);
  const rank = scored.findIndex((s) => s.ci === targetIndex) + 1;
  if (rank === 1) top1 += 1;
  if (rank > 0 && rank <= 3) top3 += 1;
  if (rank > 0 && rank <= 5) top5 += 1;
  const cat = q.category || '其他';
  if (!byCategory.has(cat)) byCategory.set(cat, { total: 0, top1: 0, top5: 0 });
  const c = byCategory.get(cat);
  c.total += 1; if (rank === 1) c.top1 += 1; if (rank > 0 && rank <= 5) c.top5 += 1;
}
const n = questions.length;
const pct = (x) => Number(((x / Math.max(1, n)) * 100).toFixed(2));
const summary = {
  questions: n, cards: cards.length,
  top1_hit_rate: pct(top1), top3_hit_rate: pct(top3), top5_hit_rate: pct(top5),
  by_category: Object.fromEntries([...byCategory].map(([k, v]) => [k, { total: v.total, top1: Number(((v.top1 / v.total) * 100).toFixed(2)), top5: Number(((v.top5 / v.total) * 100).toFixed(2)) }])),
};
await fsp.mkdir('reports/eval', { recursive: true });
await fsp.writeFile(OUT, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
