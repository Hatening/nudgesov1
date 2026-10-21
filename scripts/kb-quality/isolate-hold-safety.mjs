#!/usr/bin/env node
/**
 * 安全隔离（裁决一）：对 Bitext / WixQA 打标记，不删除。
 *
 *  - Bitext: review_status='license_hold', status='draft'
 *    （若库里已被删除，则从 raw_data/candidates.bitext.jsonl 恢复后再打标）
 *  - WixQA : 批量入库的行 -> review_status='needs_manual_audit', status='draft'
 *            db/seed 里已审核的种子行保持 approved + confirmed
 *  - 其余（seed / ecommerce-ai-skills / shipbob）保持不动
 *
 * 用法：node scripts/kb-quality/isolate-hold-safety.mjs [--db .data/relaydesk.sqlite]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const DB_PATH = path.resolve(ROOT, arg('db', path.join('.data', 'relaydesk.sqlite')));
const BITEXT_SOURCE = path.resolve(ROOT, 'raw_data/candidates.bitext.jsonl');
const SEED_FILE = path.resolve(ROOT, 'db/seed/knowledge.jsonl');
const BACKUP_DIR = path.resolve(ROOT, '.data', 'backups');

fs.mkdirSync(BACKUP_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(BACKUP_DIR, `relaydesk-before-isolation-${stamp}.sqlite`);
fs.copyFileSync(DB_PATH, backup);
console.log(`[backup] ${path.relative(ROOT, backup)}`);

const db = new DatabaseSync(DB_PATH);
const countBy = (where) => db.prepare(`SELECT COUNT(*) c FROM knowledge WHERE ${where}`).get().c;
const totalBefore = countBy('1=1');
const bitBefore = countBy("source_id LIKE '%bitext%'");
const wixBefore = countBy("source_type = 'wixqa'");
console.log(`[before] total=${totalBefore} bitext=${bitBefore} wixqa=${wixBefore}`);

db.prepare(`UPDATE knowledge
  SET review_status = 'license_hold', status = 'draft', updated_at = ?
  WHERE source_id LIKE '%bitext%'`).run(new Date().toISOString());

const seedIds = new Set();
if (fs.existsSync(SEED_FILE)) {
  for (const line of fs.readFileSync(SEED_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const row = JSON.parse(line); if (row.id) seedIds.add(row.id); } catch { /* skip */ }
  }
}
const wixRows = db.prepare("SELECT id FROM knowledge WHERE source_type = 'wixqa'").all();
const bulkWix = wixRows.filter((r) => !seedIds.has(r.id)).map((r) => r.id);
const seedWix = wixRows.filter((r) => seedIds.has(r.id)).map((r) => r.id);
const nowIso = new Date().toISOString();
const markWix = db.prepare("UPDATE knowledge SET review_status = 'needs_manual_audit', status = 'draft', updated_at = ? WHERE id = ?");
const keepWix = db.prepare("UPDATE knowledge SET review_status = 'approved', status = 'confirmed', updated_at = ? WHERE id = ?");
db.exec('BEGIN IMMEDIATE');
try {
  for (const id of bulkWix) markWix.run(nowIso, id);
  for (const id of seedWix) keepWix.run(nowIso, id);
  db.exec('COMMIT');
} catch (error) {
  try { db.exec('ROLLBACK'); } catch {}
  throw error;
}
console.log(`[wixqa] bulk -> needs_manual_audit+draft: ${bulkWix.length}; seed -> approved+confirmed: ${seedWix.length}`);

let restored = 0;
if (bitBefore === 0 && fs.existsSync(BITEXT_SOURCE)) {
  const rows = fs.readFileSync(BITEXT_SOURCE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const exists = db.prepare('SELECT 1 FROM knowledge WHERE title = ? COLLATE NOCASE');
  const insert = db.prepare(`INSERT INTO knowledge
    (id, tenant_id, site_id, scope, filename, title, type, language, tags_json, content, status,
     audience, category, is_insight, created_at, updated_at, source_type, source_id, review_status, evidence_json)
    VALUES (?, 'global', NULL, 'global', NULL, ?, 'article', 'en', ?, ?, 'draft',
            'buyer', '其他', 0, ?, ?, 'public_web', ?, 'license_hold', ?)`);
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const card of rows) {
      const title = String(card.question || '').trim().slice(0, 500);
      const content = String(card.answer || '').trim();
      if (!title || !content) continue;
      if (exists.get(title)) continue;
      const id = `kb_bitext_${crypto.createHash('sha1').update(title).digest('hex').slice(0, 12)}`;
      insert.run(id, title, JSON.stringify(card.tags || []), content.slice(0, 20000), now, now,
        card.source || 'raw_data/candidates.bitext.jsonl', JSON.stringify([{ source: card.source || '' }]));
      restored += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

const summary = db.prepare(`
  SELECT review_status, status, COUNT(*) c FROM knowledge GROUP BY review_status, status ORDER BY c DESC`).all();

console.log(`[restored] bitext rows restored = ${restored}`);
console.log(`[after] total=${countBy('1=1')}`);
console.log(summary.map((r) => `  ${String(r.review_status).padEnd(22)} ${String(r.status).padEnd(10)} ${r.c}`).join('\n'));

const notDraft = db.prepare(`
  SELECT COUNT(*) c FROM knowledge
  WHERE review_status IN ('license_hold', 'needs_manual_audit') AND status <> 'draft'`).get().c;
console.log(`[check] hold/audit rows not draft = ${notDraft}`);
db.close();
process.exit(notDraft === 0 ? 0 : 1);
