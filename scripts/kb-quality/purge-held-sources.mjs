#!/usr/bin/env node
/**
 * 本地清污（最终收尾）：删除 WebFAQ 与 Bitext 相关行。
 *  - 备份 .data/relaydesk.sqlite 后再删
 *  - 只删 source_id 命中 webfaq / bitext 的行；ShipBob(public_web) 与种子保留
 *
 * 用法：node scripts/kb-quality/purge-held-sources.mjs [--db .data/relaydesk.sqlite] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const DRY = argv.includes('--dry-run');
const DB_PATH = path.resolve(ROOT, arg('db', path.join('.data', 'relaydesk.sqlite')));

const WHERE = "(source_id LIKE '%webfaq%' OR source_id LIKE '%bitext%')";
const backupDir = path.resolve(ROOT, '.data', 'backups');
fs.mkdirSync(backupDir, { recursive: true });

if (!DRY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = path.join(backupDir, `relaydesk-before-purge-${stamp}.sqlite`);
  fs.copyFileSync(DB_PATH, backup);
  console.log(`[backup] ${path.relative(ROOT, backup)}`);
}

const db = new DatabaseSync(DB_PATH);
const before = db.prepare('SELECT COUNT(*) c FROM knowledge').get().c;
const targets = db.prepare(`SELECT source_type, review_status, COUNT(*) c FROM knowledge WHERE ${WHERE} GROUP BY source_type, review_status`).all();
console.log(`[before] total=${before}`);
for (const r of targets) console.log(`  target: ${r.source_type} / ${r.review_status} = ${r.c}`);

if (DRY) {
  console.log('[dry-run] no rows deleted');
  process.exit(0);
}

const info = db.prepare(`DELETE FROM knowledge WHERE ${WHERE}`).run();
const after = db.prepare('SELECT COUNT(*) c FROM knowledge').get().c;
const visible = db.prepare(`SELECT COUNT(*) c FROM knowledge WHERE status = 'confirmed' AND review_status NOT IN ('license_hold','needs_manual_audit','quarantined','rejected')`).get().c;
const summary = db.prepare('SELECT review_status, status, COUNT(*) c FROM knowledge GROUP BY review_status, status ORDER BY c DESC').all();

console.log(`[deleted] ${Number(info.changes || 0)} rows`);
console.log(`[after] total=${after} visible=${visible}`);
for (const r of summary) console.log(`  ${String(r.review_status).padEnd(22)} ${String(r.status).padEnd(10)} ${r.c}`);
const left = db.prepare(`SELECT COUNT(*) c FROM knowledge WHERE ${WHERE}`).get().c;
console.log(`[check] webfaq/bitext remaining = ${left}`);
db.close();
process.exit(left === 0 ? 0 : 1);
