#!/usr/bin/env node
/**
 * 生成防幻觉 RAG 评测集：500 张核心卡 × 4 个刁钻问题（≈2,000 题）。
 *
 * - 分层抽样：覆盖平台规则/广告/物流/退货/支付等类目，以及全部 buyer 卡
 * - 本地 Qwen 生成 JSON：question / expected_intent / source_card_id
 * - 断点续跑：reports/eval/gen-progress.jsonl
 *
 * 用法：node scripts/gen-eval-questions.mjs --cards 500 --per-card 4 --workers 3
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};
const CARD_LIMIT = Number(arg('cards', '500'));
const PER_CARD = Number(arg('per-card', '4'));
const BATCH_CARDS = Math.max(1, Math.min(10, Number(arg('batch-cards', '1'))));
const WORKERS = Math.max(1, Math.min(6, Number(arg('workers', '3'))));
const OUT = path.resolve(arg('out', 'db/seed/eval_questions.jsonl'));
const PROGRESS = path.resolve(arg('progress', 'reports/eval/gen-progress.jsonl'));
const SOURCE_DB = path.resolve(arg('db', '.data/relaydesk.sqlite'));
const LOCAL_BASE = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const LOCAL_MODEL = process.env.LOCAL_MODEL_NAME || 'qwen3.8-35b-a3b@q5_k_m';
const SEED = 20261022;

const QUOTAS = {
  '平台规则': 250, '广告与营销': 60, '物流与配送': 55, '其他': 45,
  '退货与退款': 35, '商品与尺码': 25, '支付与结算': 15, '投诉与纠纷': 10, '账号与安全': 5,
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

function extractJson(text) {
  if (!text) return null;
  const clean = String(text).replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  if (start === -1) return null;
  let depth = 0; let inString = false; let escaped = false;
  for (let i = start; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(clean.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function selectCards(db) {
  const all = db.prepare(`SELECT id, title, content, tags_json, category, audience FROM knowledge
    WHERE status='confirmed' AND scope='global' ORDER BY rowid`).all();
  const buckets = new Map();
  for (const card of all) {
    if (!buckets.has(card.category)) buckets.set(card.category, []);
    buckets.get(card.category).push(card);
  }
  const picked = [];
  const used = new Set();
  for (const [category, quota] of Object.entries(QUOTAS)) {
    const bucket = (buckets.get(category) || []).sort(() => rand() - 0.5);
    for (const card of bucket.slice(0, quota)) {
      if (picked.length >= CARD_LIMIT) break;
      picked.push(card); used.add(card.id);
    }
  }
  // buyer 卡优先补齐
  for (const card of all.filter((c) => c.audience === 'buyer' && !used.has(c.id))) {
    if (picked.length >= CARD_LIMIT) break;
    picked.push(card); used.add(card.id);
  }
  // 剩余用随机卡补满
  const rest = all.filter((c) => !used.has(c.id)).sort(() => rand() - 0.5);
  for (const card of rest) {
    if (picked.length >= CARD_LIMIT) break;
    picked.push(card); used.add(card.id);
  }
  return picked.slice(0, CARD_LIMIT).map((r) => ({
    id: r.id, title: r.title, content: r.content, tags: JSON.parse(r.tags_json || '[]'), category: r.category, audience: r.audience,
  }));
}

function promptFor(card) {
  return `你是严苛的 RAG 测试集生成器。请阅读下面的知识卡，生成 ${PER_CARD} 个真实用户可能问的问题，专门用来测试检索系统会不会“答非所问/幻觉”。
要求：
1. 第 1 题：具体业务问题，必须依赖这张卡才能答。
2. 第 2 题：包含拼写错误、口语化、缩写或中英混杂。
3. 第 3 题：意图容易混淆（表面问 A，实际需要这张卡里的 B）。
4. 第 4 题：边界/例外条件（例如“如果……是否仍然……”）。
每题 expected_intent 用 3-8 个字的短标签。
只输出 JSON：{"questions":[{"question":"...","expected_intent":"..."}]}

知识卡：
${JSON.stringify({ title: card.title, content: card.content, tags: card.tags, category: card.category }, null, 2)}`;
}

function promptForBatch(cards) {
  const list = cards.map((c) => ({ source_card_id: c.id, title: c.title, content: c.content, tags: c.tags, category: c.category }));
  return `你是严苛的 RAG 测试集生成器。下面有 ${cards.length} 张知识卡。请为每张卡生成 ${PER_CARD} 个真实用户可能问的问题，专门测试检索系统会不会答非所问/幻觉。
每题要求：
1. 具体业务问题，必须依赖该卡才能答；
2. 包含拼写错误/口语化/缩写/中英混杂；
3. 意图容易混淆；
4. 边界或例外条件。
expected_intent 用 3-8 个字的短标签。
只输出 JSON：
{"items":[{"source_card_id":"<原样返回>","questions":[{"question":"...","expected_intent":"..."}]}]}

知识卡数组：
${JSON.stringify(list, null, 2)}`;
}

async function callLocal(prompt) {
  const body = {
    model: LOCAL_MODEL,
    temperature: 0.9,
    max_tokens: 6000,
    messages: [
      { role: 'system', content: '你是严谨的测试集生成器。只输出 JSON。' },
      { role: 'user', content: prompt },
    ],
  };
  const res = await fetch(`${LOCAL_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(360000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function main() {
  await fsp.mkdir(path.dirname(OUT), { recursive: true });
  await fsp.mkdir(path.dirname(PROGRESS), { recursive: true });
  const db = new DatabaseSync(SOURCE_DB);
  const cards = selectCards(db);
  db.close();
  const done = new Set();
  if (fs.existsSync(PROGRESS)) {
    for (const line of fs.readFileSync(PROGRESS, 'utf8').split('\n').filter(Boolean)) {
      try { done.add(JSON.parse(line).card_id); } catch {}
    }
  }
  const existingIds = new Set();
  if (fs.existsSync(OUT)) {
    for (const line of fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean)) {
      try { existingIds.add(JSON.parse(line).source_card_id); } catch {}
    }
  }
  const pending = cards.filter((c) => !done.has(c.id) && !existingIds.has(c.id));
  console.log(`[eval] cards=${cards.length} pending=${pending.length} workers=${WORKERS} per_card=${PER_CARD}`);

  let cursor = 0;
  let generated = 0;
  let failed = 0;
  let writeChain = Promise.resolve();
  const append = (file, rows) => {
    if (!rows.length) return writeChain;
    writeChain = writeChain.then(() => fsp.appendFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')).catch(() => {});
    return writeChain;
  };

  const chunks = [];
  for (let i = 0; i < pending.length; i += BATCH_CARDS) chunks.push(pending.slice(i, i + BATCH_CARDS));
  console.log(`[eval] chunks=${chunks.length} batch_cards=${BATCH_CARDS}`);

  const worker = async () => {
    while (true) {
      const index = cursor; cursor += 1;
      if (index >= chunks.length) return;
      const chunk = chunks[index];
      try {
        const raw = await callLocal(BATCH_CARDS === 1 ? promptFor(chunk[0]) : promptForBatch(chunk));
        const parsed = extractJson(raw);
        const items = BATCH_CARDS === 1
          ? [{ source_card_id: chunk[0].id, questions: parsed?.questions || [] }]
          : (parsed?.items || []);
        let batchRows = [];
        let completedCards = 0;
        for (const card of chunk) {
          const item = items.find((it) => String(it.source_card_id) === card.id) || (BATCH_CARDS === 1 ? items[0] : null);
          if (!item) continue;
          const questions = (item.questions || [])
            .map((q) => ({ question: String(q.question || '').trim(), expected_intent: String(q.expected_intent || '').trim() }))
            .filter((q) => q.question.length >= 4 && q.expected_intent.length >= 1)
            .slice(0, PER_CARD);
          if (!questions.length) continue;
          batchRows.push(...questions.map((q) => ({
            question: q.question,
            expected_intent: q.expected_intent,
            source_card_id: card.id,
            audience: card.audience,
            category: card.category,
            language: 'zh',
            generated_by: LOCAL_MODEL,
            generated_at: new Date().toISOString(),
          })));
          await append(PROGRESS, [{ card_id: card.id, count: questions.length, at: new Date().toISOString() }]);
          completedCards += 1;
        }
        if (!batchRows.length) throw new Error('no valid questions');
        await append(OUT, batchRows);
        generated += batchRows.length;
        console.log(`[eval] chunk ${index + 1}/${chunks.length} cards=${completedCards} +${batchRows.length} (total ${generated})`);
      } catch (error) {
        failed += 1;
        console.error(`[eval] chunk ${index + 1} FAILED: ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, () => worker()));
  await writeChain;
  console.log(JSON.stringify({ cards: cards.length, pending: pending.length, generated, failed }));
}

main().catch((error) => { console.error('[fatal]', error.message); process.exit(1); });
