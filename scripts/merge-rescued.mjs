#!/usr/bin/env node
/**
 * Merge cloud-rescued cards into the SQLite knowledge table.
 *
 * Input:  raw_data/rescued_cards.jsonl (or --file <path>)
 * Output: knowledge rows with review_status='cloud-rescued'
 *
 * The merge is an idempotent upsert by id. It never overwrites unrelated
 * knowledge rows. Migration 009 relaxes the old review_status CHECK so the
 * cloud-rescued workflow label is accepted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrateSchema, transaction, closeDatabase } from '../src/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const filePath = path.resolve(option('--file', path.join(ROOT, 'raw_data', 'rescued_cards.jsonl')));
const dbPath = path.resolve(option('--db', process.env.DB_PATH || path.join(ROOT, '.data', 'relaydesk.sqlite')));
const ALLOWED_SOURCE_TYPES = new Set(['wixqa', 'ecommerce_ai_skills']);

function readJsonl(file) {
  if (!fs.existsSync(file)) throw new Error(`input not found: ${file}`);
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path.basename(file)}:${index + 1}: ${error.message}`);
      }
    });
}

function main() {
  const cards = readJsonl(filePath);
  if (cards.length === 0) throw new Error(`empty input: ${filePath}`);

  const now = new Date().toISOString();
  const db = openDatabase(dbPath);
  try {
    migrateSchema(db);
    db.prepare(`
      INSERT OR IGNORE INTO tenants (id, name, plan, status, created_at)
      VALUES ('global', 'Global Knowledge', 'internal', 'active', ?)
    `).run(now);

    const existing = new Set(db.prepare('SELECT id FROM knowledge').all().map((row) => row.id));
    const upsert = db.prepare(`
      INSERT INTO knowledge
        (id, tenant_id, site_id, scope, filename, title, type, language, tags_json, content,
         status, created_at, updated_at, audience, category, is_insight, sensitivity, freshness,
         source_type, source_id, source_url, review_status, evidence_json)
      VALUES (?, 'global', NULL, 'global', NULL, ?, 'qa', ?, ?, ?, 'confirmed', ?, ?, 'seller', ?, 0, 'low', 'static', ?, ?, ?, 'cloud-rescued', ?)
      ON CONFLICT(id) DO UPDATE SET
        tenant_id = 'global',
        scope = 'global',
        title = excluded.title,
        type = 'qa',
        language = excluded.language,
        tags_json = excluded.tags_json,
        content = excluded.content,
        status = 'confirmed',
        updated_at = excluded.updated_at,
        audience = 'seller',
        category = excluded.category,
        is_insight = 0,
        sensitivity = 'low',
        freshness = 'static',
        source_type = excluded.source_type,
        source_id = excluded.source_id,
        source_url = excluded.source_url,
        review_status = 'cloud-rescued',
        evidence_json = excluded.evidence_json
    `);

    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    transaction(db, () => {
      for (const card of cards) {
        const id = String(card.id || '').trim();
        const question = String(card.question || '').trim();
        const answer = String(card.answer || '').trim();
        if (!id || !question || !answer) {
          skipped += 1;
          continue;
        }

        const sourceType = ALLOWED_SOURCE_TYPES.has(card.source_type) ? card.source_type : 'unknown';
        const tags = JSON.stringify([sourceType, card.reject_reason, 'cloud-rescued'].filter(Boolean));
        const evidence = JSON.stringify([{
          source_type: sourceType,
          source: card.source || null,
          source_file: card.source_file || null,
          source_url: card.source_url || null,
          reject_reason: card.reject_reason || null,
          validation: card.validation ? { passed: Boolean(card.validation.passed), missing: card.validation.missing || [] } : null,
          model: card.cloud?.model || null,
          usage: card.cloud?.usage || null
        }]);

        upsert.run(
          id,
          question.slice(0, 500),
          String(card.language || 'en').slice(0, 12),
          tags,
          answer,
          now,
          now,
          String(card.category || '其他').slice(0, 40),
          sourceType,
          card.source || null,
          card.source_url || null,
          evidence
        );
        if (existing.has(id)) updated += 1;
        else {
          inserted += 1;
          existing.add(id);
        }
      }
    }, { attempts: 12, baseDelayMs: 25 });

    const counts = {
      knowledge: Number(db.prepare('SELECT COUNT(*) AS count FROM knowledge').get().count),
      cloudRescued: Number(db.prepare("SELECT COUNT(*) AS count FROM knowledge WHERE review_status = 'cloud-rescued'").get().count)
    };
    const bySourceType = db.prepare(`
      SELECT source_type, COUNT(*) AS count
      FROM knowledge WHERE review_status = 'cloud-rescued'
      GROUP BY source_type ORDER BY count DESC
    `).all().map((row) => ({ ...row, count: Number(row.count) }));
    const foreignKeyProblems = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyProblems.length > 0) throw new Error(`foreign key check failed: ${foreignKeyProblems.length}`);
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error(`integrity_check failed: ${integrity}`);

    console.log('RESCUE_MERGE_OK');
    console.log(JSON.stringify({
      ok: true,
      file: filePath,
      db: dbPath,
      input: cards.length,
      inserted,
      updated,
      skipped,
      counts,
      bySourceType,
      integrity
    }, null, 2));
  } finally {
    closeDatabase(db);
  }
}

try {
  main();
} catch (error) {
  console.error(`RESCUE_MERGE_FAILED: ${error.message}`);
  process.exitCode = 1;
}
