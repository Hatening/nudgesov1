#!/usr/bin/env node
/**
 * 单并发彻底重跑 QA 评测集（云端 DeepSeek）
 * - 500 张卡 × 4 题 = 2,000 题
 * - workers 固定 1，batch 5 卡/次，避免并发断连
 * - 每 100 题打印一次进度
 * - 输出 db/seed/qa_eval_set.jsonl，跑完自动校验格式
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
const RESET = args.includes('--reset');
const CARD_LIMIT = 500;
const PER_CARD = 4;
const BATCH_CARDS = 5;
const OUT = path.resolve('db/seed/qa_eval_set.jsonl');
const PROGRESS = path.resolve('reports/eval/gen-single-progress.jsonl');
const DB_PATH = path.resolve('.data/relaydesk.sqlite');
const CLOUD_BASE = 'https://api.deepseek.com/v1';
const CLOUD_MODEL = process.env.CLOUD_MODEL_NAME || 'deepseek-flash';
const SEED = 20261022;

const dshHome = process.env.DSH_HOME || `${process.env.USERPROFILE}\\.dsh`;
const lines = fs.readFileSync(`${dshHome}\\.credentials.yaml`, 'utf8').split(/\r?\n/);
let inAccount = false; let token = '';
for (const line of lines) {
  if (/^\s{2}deepseek-account-platform\/default:\s*$/.test(line)) { inAccount = true; continue; }
  if (inAccount && /^\s{2}\S/.test(line)) break;
  if (inAccount) { const m = line.match(/^\s+token:\s*(\S+)\s*$/); if (m) { token = m[1]; break; } }
}
const headers = { 'content-type': 'application/json', 'x-dsh-auth-token': token };
const QUOTAS = { '平台规则': 250, '广告与营销': 60, '物流与配送': 55, '其他': 45, '退货与退款': 35, '商品与尺码': 25, '支付与结算': 15, '投诉与纠纷': 10, '账号与安全': 5 };

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(SEED);

function selectCards() {
  const db = new DatabaseSync(DB_PATH);
  const all = db.prepare("SELECT id,title,content,tags_json,category,audience FROM knowledge WHERE status='confirmed' AND scope='global' ORDER BY rowid").all();
  db.close();
  const buckets = new Map();
  for (const c of all) { if (!buckets.has(c.category)) buckets.set(c.category, []); buckets.get(c.category).push(c); }
  const picked = []; const used = new Set();
  for (const [cat, quota] of Object.entries(QUOTAS)) {
    for (const c of (buckets.get(cat) || []).sort(() => rand() - 0.5).slice(0, quota)) {
      if (picked.length >= CARD_LIMIT) break;
      picked.push(c); used.add(c.id);
    }
  }
  for (const c of all.filter((x) => x.audience === 'buyer' && !used.has(x.id))) { if (picked.length < CARD_LIMIT) { picked.push(c); used.add(c.id); } }
  for (const c of all.filter((x) => !used.has(x.id)).sort(() => rand() - 0.5)) { if (picked.length >= CARD_LIMIT) break; picked.push(c); used.add(c.id); }
  return picked.slice(0, CARD_LIMIT).map((r) => ({ id: r.id, title: r.title, content: r.content, tags: JSON.parse(r.tags_json || '[]'), category: r.category, audience: r.audience }));
}

function prompt(cards) {
  return `你是严苛的 RAG 测试集生成器。为下面 ${cards.length} 张知识卡，每张生成 ${PER_CARD} 个真实用户可能问的问题，测试检索系统会不会答非所问/幻觉。
每题：1 具体业务问题；2 口语/拼写错误/中英混杂；3 意图混淆；4 边界或例外条件。
expected_intent 用 3-8 个汉字。
只输出 JSON：
{"items":[{"source_card_id":"<原样返回>","questions":[{"question":"...","expected_intent":"..."}]}]}

知识卡：
${JSON.stringify(cards.map((c) => ({ source_card_id: c.id, title: c.title, content: c.content, tags: c.tags, category: c.category })), null, 2)}`;
}

function parseJson(text) {
  const clean = String(text || '').replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  if (start === -1) return null;
  try { return JSON.parse(clean.slice(start, clean.lastIndexOf('}') + 1)); } catch { return null; }
}

async function callCloud(cards) {
  const res = await fetch(`${CLOUD_BASE}/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({ model: CLOUD_MODEL, temperature: 0.9, max_tokens: 4000, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt(cards) }] }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return parseJson(data.choices?.[0]?.message?.content);
}

async function main() {
  await fsp.mkdir(path.dirname(PROGRESS), { recursive: true });
  if (RESET) {
    await fsp.rm(OUT, { force: true });
    await fsp.rm(PROGRESS, { force: true });
    console.log('[reset] removed old QA set and progress');
  }
  const done = new Set();
  if (fs.existsSync(PROGRESS)) {
    for (const line of fs.readFileSync(PROGRESS, 'utf8').split('\n').filter(Boolean)) {
      try { done.add(JSON.parse(line).card_id); } catch {}
    }
  }
  const cards = selectCards();
  const pending = cards.filter((c) => !done.has(c.id));
  console.log(`[qa] selected=${cards.length} pending=${pending.length} workers=1 batch=${BATCH_CARDS}`);

  const chunks = [];
  for (let i = 0; i < pending.length; i += BATCH_CARDS) chunks.push(pending.slice(i, i + BATCH_CARDS));

  let generated = 0;
  let malformed = 0;
  let lastLog = 0;
  for (let ci = 0; ci < chunks.length; ci += 1) {
    const chunk = chunks[ci];
    let remaining = chunk;
    for (let attempt = 0; attempt < 3 && remaining.length; attempt += 1) {
      try {
        const parsed = await callCloud(remaining);
        const items = parsed?.items || [];
        const rows = [];
        const stillMissing = [];
        for (const card of remaining) {
          const item = items.find((it) => String(it.source_card_id) === card.id);
          const questions = (item?.questions || [])
            .map((q) => ({ question: String(q.question || '').trim(), expected_intent: String(q.expected_intent || '').trim(), source_card_id: card.id, audience: card.audience, category: card.category, language: 'zh', generated_by: CLOUD_MODEL, generated_at: new Date().toISOString() }))
            .filter((q) => q.question.length >= 4 && q.expected_intent.length >= 1)
            .slice(0, PER_CARD);
          if (questions.length < PER_CARD) stillMissing.push(card);
          rows.push(...questions);
        }
        if (rows.length) {
          await fsp.appendFile(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
          for (const card of remaining) {
            if (!stillMissing.find((c) => c.id === card.id)) {
              await fsp.appendFile(PROGRESS, JSON.stringify({ card_id: card.id, at: new Date().toISOString() }) + '\n');
            }
          }
          generated += rows.length;
        }
        remaining = stillMissing;
        if (generated - lastLog >= 100) {
          console.log(`[qa] ${generated}/2000 questions (${ci + 1}/${chunks.length} chunks)`);
          lastLog = generated;
        }
      } catch (error) {
        console.error(`[qa] chunk ${ci + 1} attempt ${attempt + 1} failed: ${error.message}`);
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    if (remaining.length) console.log(`[qa] chunk ${ci + 1} still missing ${remaining.length} cards`);
  }

  // 校验
  const rows = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line); } catch { malformed += 1; return null; }
  }).filter(Boolean) : [];
  const uniqueCards = new Set(rows.map((r) => r.source_card_id));
  const perCard = {};
  for (const r of rows) perCard[r.source_card_id] = (perCard[r.source_card_id] || 0) + 1;
  const summary = {
    cards_selected: cards.length,
    questions: rows.length,
    malformed,
    unique_cards: uniqueCards.size,
    cards_with_4: Object.values(perCard).filter((n) => n >= PER_CARD).length,
    cards_with_less: Object.values(perCard).filter((n) => n < PER_CARD).length,
  };
  fs.writeFileSync('reports/eval/qa-single-summary.json', JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => { console.error('[fatal]', error.message); process.exit(1); });
