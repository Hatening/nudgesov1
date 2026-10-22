import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';

const EMBED_URL = (process.env.EMBEDDING_URL || 'http://192.168.3.227:3679/v1/embeddings').replace(/\/$/, '');
const MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-bge-m3';
const CACHE = process.env.SEMANTIC_INDEX_PATH || '.data/semantic-index.json';
const BATCH = 32;
const WORKERS = 4;

function textOf(card) {
  return `${card.title || ''}\n${String(card.content || '').slice(0, 1800)}\n${(card.tags || []).join(' ')}`;
}
function hash(text) {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}
function norm(v) {
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum) || 1;
  return v.map((x) => x / len);
}

async function embed(texts) {
  const res = await fetch(EMBED_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`embedding HTTP ${res.status}`);
  const data = await res.json();
  return data.data.map((d) => norm(d.embedding));
}

export async function buildSemanticIndex(cards, { force = false } = {}) {
  const entries = cards.map((card) => ({ id: card.id, hash: hash(textOf(card)), text: textOf(card) }));
  if (!force) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
      if (cached.model === MODEL && cached.cards?.length === entries.length
        && cached.cards.every((c, i) => c.id === entries[i].id && c.hash === entries[i].hash)) {
        return { index: cached, cached: true };
      }
    } catch { /* rebuild */ }
  }
  const vectors = new Array(entries.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor; cursor += 1;
      const start = i * BATCH;
      if (start >= entries.length) return;
      const batch = entries.slice(start, start + BATCH);
      const vecs = await embed(batch.map((e) => e.text));
      vecs.forEach((v, j) => { vectors[start + j] = v; });
      if (start % 320 === 0) console.log(`[semantic-index] ${start}/${entries.length}`);
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, () => worker()));
  const index = { model: MODEL, dim: vectors[0]?.length || 0, built_at: new Date().toISOString(), cards: entries.map((e, i) => ({ id: e.id, hash: e.hash, vector: vectors[i] })) };
  await fsp.mkdir('.data', { recursive: true });
  await fsp.writeFile(CACHE, JSON.stringify(index));
  return { index, cached: false };
}

let loaded = null;
export function loadSemanticIndex() {
  if (loaded) return loaded;
  try {
    const index = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    const map = new Map(index.cards.map((c) => [c.id, c.vector]));
    loaded = { index, map };
    return loaded;
  } catch {
    return null;
  }
}

export async function semanticSearch(question, cards, { limit = 15 } = {}) {
  const cached = loadSemanticIndex();
  if (!cached) return [];
  try {
    const [qv] = await embed([String(question || '')]);
    const scored = [];
    for (const card of cards) {
      const cv = cached.map.get(card.id);
      if (!cv) continue;
      let dot = 0;
      for (let i = 0; i < qv.length; i += 1) dot += qv[i] * cv[i];
      scored.push({ card, score: dot });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => ({ ...s.card, score: Number(s.score.toFixed(3)), semantic_score: Number(s.score.toFixed(4)) }));
  } catch {
    return [];
  }
}

/** 语义 top-N 优先，再接词法结果去重，最多 limit 条。 */
export function mergeHits(semanticHits, lexicalHits, limit = 5) {
  const merged = [];
  const seen = new Set();
  for (const hit of [...semanticHits, ...lexicalHits]) {
    if (!hit?.id || seen.has(hit.id)) continue;
    seen.add(hit.id);
    merged.push(hit);
    if (merged.length >= limit) break;
  }
  return merged;
}
