#!/usr/bin/env node
/**
 * Harrier 27B 离线向量索引（单并发，断点续跑）。
 *
 * 用法：
 *   node scripts/build-harrier-index.mjs
 *   node scripts/build-harrier-index.mjs --all
 *   node scripts/build-harrier-index.mjs --limit 20 --force
 *
 * 环境变量：
 *   HARRIER_EMBED_URL   默认 http://192.168.3.227:3679/v1
 *   HARRIER_MODEL       默认 harrier-oss-v1-27b
 *   HARRIER_BATCH       默认 4（单并发下批大小，不是并发）
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const has = (n) => args.includes(`--${n}`);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const BASE = (process.env.HARRIER_EMBED_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const MODEL = process.env.HARRIER_MODEL || 'text-embedding-harrier-27b';
const BATCH = Math.max(1, Number(arg('batch', process.env.HARRIER_BATCH || '4')));
const LIMIT = Number(arg('limit', '0'));
const ALL = has('all');
const FORCE = has('force');
const OUT = path.resolve(arg('out', '.data/harrier-index.json'));
const PROGRESS = path.resolve(arg('progress', '.data/harrier-index.progress.jsonl'));
const DB_PATH = path.resolve(arg('db', '.data/relaydesk.sqlite'));

const textOf = (c) => `${c.title || ''}\n${String(c.content || '').slice(0, 4000)}\n${(c.tags || []).join(' ')}`;
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const norm = (v) => { let s = 0; for (const x of v) s += x * x; const l = Math.sqrt(s) || 1; return v.map((x) => x / l); };

function loadCards() {
  const db = new DatabaseSync(DB_PATH);
  const where = ALL
    ? "status='confirmed' AND scope='global'"
    : "status='confirmed' AND scope='global' AND (locale='zh' OR locale='en' OR locale IS NULL)";
  const rows = db.prepare(`SELECT id,title,content,tags_json,locale,audience FROM knowledge WHERE ${where} ORDER BY rowid`).all();
  db.close();
  return rows.map((r) => ({ id: r.id, title: r.title, content: r.content, tags: JSON.parse(r.tags_json || '[]'), locale: r.locale, audience: r.audience }));
}

async function embed(texts) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/embeddings`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: MODEL, input: texts }),
        signal: AbortSignal.timeout(300000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return data.data.map((d) => norm(d.embedding));
    } catch (error) { lastError = error; await new Promise((r) => setTimeout(r, 2000)); }
  }
  throw lastError;
}

async function main() {
  await fsp.mkdir(path.dirname(OUT), { recursive: true });
  let index = { model: MODEL, dim: 0, built_at: null, cards: [] };
  if (fs.existsSync(OUT) && !FORCE) {
    try { index = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* rebuild */ }
  }
  const done = new Set(index.cards.map((c) => c.hash));
  if (fs.existsSync(PROGRESS)) {
    for (const line of fs.readFileSync(PROGRESS, 'utf8').split('\n').filter(Boolean)) {
      try { done.add(JSON.parse(line).hash); } catch {}
    }
  }
  let cards = loadCards().map((c) => ({ ...c, text: textOf(c), hash: hash(textOf(c)) }));
  if (LIMIT > 0) cards = cards.slice(0, LIMIT);
  const pending = cards.filter((c) => !done.has(c.hash));
  console.log(`[harrier] cards=${cards.length} pending=${pending.length} batch=${BATCH} model=${MODEL}`);

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    try {
      const vectors = await embed(batch.map((c) => c.text));
      for (let j = 0; j < batch.length; j += 1) {
        index.cards.push({ id: batch[j].id, hash: batch[j].hash, locale: batch[j].locale, vector: vectors[j] });
        await fsp.appendFile(PROGRESS, JSON.stringify({ hash: batch[j].hash, id: batch[j].id, at: new Date().toISOString() }) + '\n');
      }
      index.dim = vectors[0]?.length || index.dim;
      index.model = MODEL;
      index.built_at = new Date().toISOString();
      await fsp.writeFile(OUT, JSON.stringify(index));
      console.log(`[harrier] ${Math.min(i + BATCH, pending.length)}/${pending.length} saved (dim=${index.dim})`);
    } catch (error) {
      console.error(`[harrier] batch ${i} failed: ${error.message}`);
    }
  }
  console.log(JSON.stringify({ cards: index.cards.length, dim: index.dim, out: OUT }, null, 2));
}

main().catch((e) => { console.error('[fatal]', e.message); process.exit(1); });
