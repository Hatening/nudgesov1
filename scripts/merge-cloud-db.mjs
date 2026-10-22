#!/usr/bin/env node
/**
 * 幂等合并：把 cloud-full.sqlite 的翻译卡合并进生产库 relaydesk.sqlite。
 * 规则：按 id 去重；已存在则跳过；只合并 5 个目标 locale。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PROD = '.data/relaydesk.sqlite';
const CLOUD = '.data/cloud-full.sqlite';
const LANGS = ['en-US', 'es-ES', 'de-DE', 'fr-FR', 'pl-PL'];

if (!fs.existsSync(CLOUD)) throw new Error(`missing ${CLOUD}`);
const backup = `.data/backups/relaydesk-before-merge-${Date.now()}.sqlite`;
fs.mkdirSync(path.dirname(backup), { recursive: true });
fs.copyFileSync(PROD, backup);
console.log('backup:', backup);

const prod = new DatabaseSync(PROD);
const cloud = new DatabaseSync(CLOUD, { readOnly: true });
const prodCols = prod.prepare('PRAGMA table_info(knowledge)').all().map((c) => c.name);
const cloudCols = cloud.prepare('PRAGMA table_info(knowledge)').all().map((c) => c.name);
const cols = prodCols.filter((c) => cloudCols.includes(c));
const placeholders = cols.map(() => '?').join(',');
const insert = prod.prepare(`INSERT OR IGNORE INTO knowledge (${cols.join(',')}) VALUES (${placeholders})`);
const exists = prod.prepare('SELECT 1 FROM knowledge WHERE id=?');

prod.exec('BEGIN IMMEDIATE');
let inserted = 0;
let skipped = 0;
try {
  for (const lang of LANGS) {
    const rows = cloud.prepare('SELECT * FROM knowledge WHERE locale=? AND status=?').all(lang, 'confirmed');
    for (const row of rows) {
      if (exists.get(row.id)) { skipped += 1; continue; }
      insert.run(...cols.map((c) => row[c]));
      inserted += 1;
    }
  }
  prod.exec('COMMIT');
} catch (error) {
  try { prod.exec('ROLLBACK'); } catch {}
  throw error;
}
const counts = prod.prepare("SELECT locale, COUNT(*) c FROM knowledge WHERE locale IN ('en-US','es-ES','de-DE','fr-FR','pl-PL') GROUP BY locale").all();
console.log(JSON.stringify({ inserted, skipped, total: prod.prepare('SELECT COUNT(*) c FROM knowledge').get().c, byLocale: counts }, null, 2));
cloud.close(); prod.close();
