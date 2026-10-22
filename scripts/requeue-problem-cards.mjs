#!/usr/bin/env node
/**
 * 提取 Harrier 评测中召回失败的“问题卡片”，供切回 Qwen 后回炉重修。
 *
 * 用法：
 *   node scripts/requeue-problem-cards.mjs
 *   node scripts/requeue-problem-cards.mjs --mark
 *
 * --mark 只打标记（review_status=needs_manual_audit），不删除、不改正文。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i > -1 && args[i + 1] ? args[i + 1] : d; };
const MARK = args.includes('--mark');
const REPORT = arg('report', 'reports/eval/harrier-recall.json');
const OUT = arg('out', 'reports/requeue/problem-cards.jsonl');
const DB = arg('db', '.data/relaydesk.sqlite');

if (!fs.existsSync(REPORT)) throw new Error(`missing ${REPORT}; run eval-harrier-recall.mjs first`);
const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const byCard = new Map();
for (const miss of report.misses || []) {
  if (!byCard.has(miss.source_card_id)) byCard.set(miss.source_card_id, []);
  byCard.get(miss.source_card_id).push(miss);
}
const db = new DatabaseSync(DB);
const rows = [];
for (const [id, misses] of byCard) {
  const card = db.prepare('SELECT id,title,content,category,locale,audience,status,review_status FROM knowledge WHERE id=?').get(id);
  rows.push({
    source_card_id: id,
    title: card?.title || '',
    category: card?.category || misses[0]?.category || '其他',
    locale: card?.locale || null,
    audience: card?.audience || null,
    status: card?.status || null,
    review_status: card?.review_status || null,
    miss_count: misses.length,
    questions: misses.map((m) => m.question),
    reason: 'harrier_top5_miss',
  });
}
await fsp.mkdir(path.dirname(OUT), { recursive: true });
await fsp.writeFile(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
if (MARK) {
  const update = db.prepare("UPDATE knowledge SET review_status='needs_manual_audit', updated_at=? WHERE id=?");
  for (const row of rows) update.run(new Date().toISOString(), row.source_card_id);
}
db.close();
console.log(JSON.stringify({ cards: rows.length, misses: rows.reduce((s, r) => s + r.miss_count, 0), marked: MARK, out: OUT }, null, 2));
