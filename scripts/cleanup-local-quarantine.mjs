#!/usr/bin/env node
/**
 * Remove the remaining legal/unknown-license public web rows from the local
 * knowledge DB while preserving ShipBob, ecommerce, and WixQA audit rows.
 *
 * Deletes:
 *   - Bitext rows
 *   - WebFAQ / traveling rows
 *   - seller_extra Google rows
 *
 * Preserves:
 *   - ShipBob (seller_extra2)
 *   - all ecommerce cards
 *   - base WixQA seed cards
 *   - cloud WixQA needs_manual_audit rows
 *   - demo/site candidate rows
 *
 * Dry-run by default. Pass --apply to mutate the database.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, closeDatabase, transaction } from '../src/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dbPath = path.resolve(option('--db', process.env.DB_PATH || path.join(ROOT, '.data', 'relaydesk.sqlite')));
const apply = args.includes('--apply');

const cleanupSql = `
  DELETE FROM knowledge
  WHERE scope = 'global'
    AND (
      lower(COALESCE(source_id, '')) LIKE '%bitext%'
      OR lower(COALESCE(source_id, '')) LIKE '%webfaq%'
      OR lower(COALESCE(source_id, '')) LIKE '%traveling%'
      OR (source_type = 'public_web' AND source_id LIKE 'raw_data/seller_extra/%')
    )
`;

const db = openDatabase(dbPath);
try {
  const before = {
    total: Number(db.prepare('SELECT COUNT(*) AS c FROM knowledge').get().c),
    planned: Number(db.prepare(`
      SELECT COUNT(*) AS c FROM knowledge
      WHERE scope = 'global'
        AND (
          lower(COALESCE(source_id, '')) LIKE '%bitext%'
          OR lower(COALESCE(source_id, '')) LIKE '%webfaq%'
          OR lower(COALESCE(source_id, '')) LIKE '%traveling%'
          OR (source_type = 'public_web' AND source_id LIKE 'raw_data/seller_extra/%')
        )
    `).get().c),
    shipbob: Number(db.prepare("SELECT COUNT(*) AS c FROM knowledge WHERE source_type = 'public_web' AND lower(COALESCE(source_id, '')) LIKE '%shipbob%'").get().c),
    wixqaAudit: Number(db.prepare("SELECT COUNT(*) AS c FROM knowledge WHERE review_status = 'needs_manual_audit' AND source_type = 'wixqa'").get().c)
  };

  let deleted = 0;
  if (apply) {
    deleted = transaction(db, () => Number(db.prepare(cleanupSql).run().changes || 0));
  }

  const after = {
    total: Number(db.prepare('SELECT COUNT(*) AS c FROM knowledge').get().c),
    licenseHold: Number(db.prepare("SELECT COUNT(*) AS c FROM knowledge WHERE review_status = 'license_hold'").get().c),
    manualAudit: Number(db.prepare("SELECT COUNT(*) AS c FROM knowledge WHERE review_status = 'needs_manual_audit'").get().c),
    core: Number(db.prepare("SELECT COUNT(*) AS c FROM knowledge WHERE review_status IN ('approved', 'cloud-rescued')").get().c),
    shipbob: Number(db.prepare("SELECT COUNT(*) AS c FROM knowledge WHERE source_type = 'public_web' AND lower(COALESCE(source_id, '')) LIKE '%shipbob%'").get().c),
    wixqaAudit: Number(db.prepare("SELECT COUNT(*) AS c FROM knowledge WHERE review_status = 'needs_manual_audit' AND source_type = 'wixqa'").get().c)
  };

  console.log(JSON.stringify({ ok: true, applied: apply, deleted, before, after }, null, 2));
} finally {
  closeDatabase(db);
}
