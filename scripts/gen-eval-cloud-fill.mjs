#!/usr/bin/env node
/** 用云端 DeepSeek 补齐本地 Qwen 缺失的 QA，目标 2,000 道。 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const OUT = 'db/seed/qa_eval_set.jsonl';
const DB = '.data/relaydesk.sqlite';
const CLOUD_BASE = 'https://api.deepseek.com/v1';
const CLOUD_MODEL = 'deepseek-flash';
const WORKERS = 5;
const SEED = 20261022;
const QUOTAS = { '平台规则': 250, '广告与营销': 60, '物流与配送': 55, '其他': 45, '退货与退款': 35, '商品与尺码': 25, '支付与结算': 15, '投诉与纠纷': 10, '账号与安全': 5 };

const dshHome = process.env.DSH_HOME || `${process.env.USERPROFILE}\\.dsh`;
const lines = fs.readFileSync(`${dshHome}\\.credentials.yaml`, 'utf8').split(/\r?\n/);
let inAccount = false, token = '';
for (const line of lines) {
  if (/^\s{2}deepseek-account-platform\/default:\s*$/.test(line)) { inAccount = true; continue; }
  if (inAccount && /^\s{2}\S/.test(line)) break;
  if (inAccount) { const m = line.match(/^\s+token:\s*(\S+)\s*$/); if (m) { token = m[1]; break; } }
}
const headers = { 'content-type': 'application/json', 'x-dsh-auth-token': token };

function mulberry32(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(SEED);

function selectCards() {
  const db = new DatabaseSync(DB);
  const all = db.prepare("SELECT id,title,content,tags_json,category,audience FROM knowledge WHERE status='confirmed' AND scope='global' ORDER BY rowid").all();
  db.close();
  const buckets = new Map();
  for (const c of all) { if (!buckets.has(c.category)) buckets.set(c.category, []); buckets.get(c.category).push(c); }
  const picked = [], used = new Set();
  for (const [cat, quota] of Object.entries(QUOTAS)) {
    for (const c of (buckets.get(cat) || []).sort(() => rand() - 0.5).slice(0, quota)) {
      if (picked.length < 500) { picked.push(c); used.add(c.id); }
    }
  }
  for (const c of all.filter((x) => x.audience === 'buyer' && !used.has(x.id))) if (picked.length < 500) { picked.push(c); used.add(c.id); }
  for (const c of all.filter((x) => !used.has(x.id)).sort(() => rand() - 0.5)) { if (picked.length >= 500) break; picked.push(c); used.add(c.id); }
  return picked.slice(0, 500).map((r) => ({ id: r.id, title: r.title, content: r.content, tags: JSON.parse(r.tags_json || '[]'), category: r.category, audience: r.audience }));
}

const rows = fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const counts = {};
for (const r of rows) counts[r.source_card_id] = (counts[r.source_card_id] || 0) + 1;
const cards = selectCards();
const todo = cards.map((c) => ({ card: c, need: Math.max(0, 4 - (counts[c.id] || 0)) })).filter((x) => x.need > 0);
console.log(`existing=${rows.length} selected=${cards.length} cards_to_fill=${todo.length} questions_needed=${todo.reduce((s, x) => s + x.need, 0)}`);

function prompt(card, need) {
  return `为知识卡生成 ${need} 个真实用户可能问的刁钻问题，用于 RAG 检索测试。
要求：具体业务问题、口语/错别字/中英混杂、意图混淆、边界条件各覆盖；expected_intent 用 3-8 个汉字。
只输出 JSON：{"questions":[{"question":"...","expected_intent":"..."}]}
知识卡：${JSON.stringify({ title: card.title, content: card.content, tags: card.tags, category: card.category }, null, 2)}`;
}

async function generate(card, need) {
  const res = await fetch(`${CLOUD_BASE}/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({ model: CLOUD_MODEL, temperature: 0.9, max_tokens: 1500, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt(card, need) }] }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = String(data.choices?.[0]?.message?.content || '').replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return (parsed.questions || []).slice(0, need).map((q) => ({
    question: String(q.question || '').trim(), expected_intent: String(q.expected_intent || '').trim(),
    source_card_id: card.id, audience: card.audience, category: card.category, language: 'zh',
    generated_by: CLOUD_MODEL, generated_at: new Date().toISOString(),
  })).filter((q) => q.question.length >= 4);
}

let cursor = 0;
const newRows = [];
async function worker() {
  while (true) {
    const i = cursor; cursor += 1;
    if (i >= todo.length) return;
    const { card, need } = todo[i];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { const got = await generate(card, need); newRows.push(...got); console.log(`[fill] ${card.id} +${got.length}`); break; }
      catch (error) { console.error(`[fill] ${card.id} failed: ${error.message}`); }
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()));
await fsp.appendFile(OUT, newRows.map((r) => JSON.stringify(r)).join('\n') + (newRows.length ? '\n' : ''));
const finalRows = fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean);
console.log(JSON.stringify({ added: newRows.length, total: finalRows.length, unique_cards: new Set(finalRows.map((l) => JSON.parse(l).source_card_id)).size }, null, 2));
