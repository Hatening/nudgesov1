#!/usr/bin/env node
/**
 * 云端补齐 QA 评测集：为剩余未覆盖卡片生成 5 题/卡，目标 ≥2,000 题。
 * 输出：db/seed/qa_eval_set.jsonl（归档，含旧 1,481 + 新增）
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
const TARGET_CARDS = Number(arg('cards', '120'));
const PER_CARD = Number(arg('per-card', '5'));
const WORKERS = Number(arg('workers', '10'));
const OLD = path.resolve('db/seed/eval_questions.jsonl');
const OUT = path.resolve('db/seed/qa_eval_set.jsonl');
const DB_PATH = path.resolve('.data/relaydesk.sqlite');
const CLOUD_BASE = 'https://api.deepseek.com/v1';
const CLOUD_MODEL = process.env.CLOUD_MODEL_NAME || 'deepseek-flash';

const dshHome = process.env.DSH_HOME || `${process.env.USERPROFILE}\\.dsh`;
const lines = fs.readFileSync(`${dshHome}\\.credentials.yaml`, 'utf8').split(/\r?\n/);
let inAccount = false; let token = '';
for (const line of lines) {
  if (/^\s{2}deepseek-account-platform\/default:\s*$/.test(line)) { inAccount = true; continue; }
  if (inAccount && /^\s{2}\S/.test(line)) break;
  if (inAccount) { const m = line.match(/^\s+token:\s*(\S+)\s*$/); if (m) { token = m[1]; break; } }
}
const headers = { 'content-type': 'application/json', 'x-dsh-auth-token': token };

const oldRows = fs.existsSync(OLD)
  ? fs.readFileSync(OLD, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
const covered = new Set(oldRows.map((r) => r.source_card_id));
const db = new DatabaseSync(DB_PATH);
const candidates = db.prepare("SELECT id,title,content,tags_json,category,audience FROM knowledge WHERE status='confirmed' AND scope='global' ORDER BY rowid").all()
  .filter((r) => !covered.has(r.id));
db.close();
const picked = candidates.sort(() => Math.random() - 0.5).slice(0, TARGET_CARDS);

function promptFor(card) {
  return `你是严苛的 RAG 测试集生成器。为下面知识卡生成 ${PER_CARD} 个真实用户可能问的问题，测试检索系统会不会答非所问/幻觉：
1 具体业务问题；2 口语/拼写错误/中英混杂；3 意图混淆；4 边界/例外；5 多跳组合。
expected_intent 用 3-8 个汉字。
只输出 JSON：{"questions":[{"question":"...","expected_intent":"..."}]}
知识卡：${JSON.stringify({ title: card.title, content: card.content, tags: JSON.parse(card.tags_json || '[]'), category: card.category }, null, 2)}`;
}

async function generate(card) {
  const res = await fetch(`${CLOUD_BASE}/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({
      model: CLOUD_MODEL, temperature: 0.9, max_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: '你是测试集生成器。只输出 JSON。' }, { role: 'user', content: promptFor(card) }],
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const text = String(data.choices?.[0]?.message?.content || '').replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return (parsed.questions || []).map((q) => ({
    question: String(q.question || '').trim(),
    expected_intent: String(q.expected_intent || '').trim(),
    source_card_id: card.id,
    audience: card.audience,
    category: card.category,
    language: 'zh',
    generated_by: CLOUD_MODEL,
    generated_at: new Date().toISOString(),
  })).filter((q) => q.question.length >= 4);
}

let cursor = 0;
const newRows = [];
const worker = async () => {
  while (true) {
    const i = cursor; cursor += 1;
    if (i >= picked.length) return;
    try {
      const rows = await generate(picked[i]);
      newRows.push(...rows);
      console.log(`[cloud-eval] ${picked[i].id} +${rows.length} (total new ${newRows.length})`);
    } catch (error) {
      console.error(`[cloud-eval] ${picked[i].id} failed: ${error.message}`);
    }
  }
};
await Promise.all(Array.from({ length: WORKERS }, () => worker()));
const all = [...oldRows, ...newRows];
await fsp.writeFile(OUT, all.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify({ old: oldRows.length, new: newRows.length, total: all.length, cards: new Set(all.map((r) => r.source_card_id)).size }, null, 2));
