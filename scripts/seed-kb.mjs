#!/usr/bin/env node
/**
 * Idempotent KB seed loader.
 *
 * The cards in db/seed/knowledge.jsonl already passed the build-time
 * evidence gate (numbers / URLs / entity strings must occur in the source).
 * This script only writes those approved cards and the GPC taxonomy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrateSchema, closeDatabase, transaction } from '../src/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, '.data'));
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(DATA_DIR, 'relaydesk.sqlite'));
const SEED_DIR = path.join(ROOT, 'db', 'seed');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
}

const db = openDatabase(DB_PATH);
migrateSchema(db);

const cards = readJsonl(path.join(SEED_DIR, 'knowledge.jsonl'));
const gpc = readJsonl(path.join(SEED_DIR, 'gpc_taxonomy.jsonl'));
const now = new Date().toISOString();

const insertKnowledge = db.prepare(`
  INSERT INTO knowledge
    (id, tenant_id, site_id, scope, filename, title, type, language, tags_json, content,
     status, created_at, updated_at, audience, category, is_insight,
     sensitivity, freshness, source_type, source_id, source_url, review_status, evidence_json)
  VALUES (?, ?, NULL, 'global', NULL, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title,
    language = excluded.language,
    tags_json = excluded.tags_json,
    content = excluded.content,
    audience = excluded.audience,
    category = excluded.category,
    sensitivity = excluded.sensitivity,
    freshness = excluded.freshness,
    source_type = excluded.source_type,
    source_id = excluded.source_id,
    source_url = excluded.source_url,
    review_status = excluded.review_status,
    evidence_json = excluded.evidence_json,
    updated_at = excluded.updated_at
`);

const insertGpc = db.prepare(`
  INSERT INTO gpc_taxonomy
    (code, level, level_num, parent_code, title, definition, definition_excludes,
     attributes_json, attribute_count, is_active, language)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(code) DO UPDATE SET
    level = excluded.level,
    level_num = excluded.level_num,
    parent_code = excluded.parent_code,
    title = excluded.title,
    definition = excluded.definition,
    definition_excludes = excluded.definition_excludes,
    attributes_json = excluded.attributes_json,
    attribute_count = excluded.attribute_count,
    is_active = excluded.is_active,
    language = excluded.language
`);

transaction(db, () => {
  for (const card of cards) {
    insertKnowledge.run(
      card.id,
      card.tenant_id || 'global',
      card.title || 'Untitled',
      card.type || 'qa',
      card.language || 'en',
      JSON.stringify(card.tags || []),
      card.content || '',
      card.created_at || now,
      card.updated_at || now,
      card.audience || 'seller',
      card.category || '其他',
      card.sensitivity || 'low',
      card.freshness || 'static',
      card.source_type || 'unknown',
      card.source_id || null,
      card.source_url || null,
      card.review_status || 'approved',
      card.evidence_json || '[]'
    );
  }
  for (const row of gpc) {
    insertGpc.run(
      row.code, row.level, row.level_num, row.parent_code,
      row.title, row.definition, row.definition_excludes,
      row.attributes_json || '[]', row.attribute_count || 0,
      row.is_active ?? 1, row.language || 'en'
    );
  }
});

const knowledgeCount = db.prepare("SELECT COUNT(*) AS n FROM knowledge").get().n;
const gpcCount = db.prepare("SELECT COUNT(*) AS n FROM gpc_taxonomy").get().n;
const globalCount = db.prepare("SELECT COUNT(*) AS n FROM knowledge WHERE tenant_id = 'global'").get().n;
closeDatabase(db);
console.log(JSON.stringify({ ok: true, db: DB_PATH, knowledge: knowledgeCount, global_knowledge: globalCount, gpc_taxonomy: gpcCount, seeded_cards: cards.length, seeded_gpc: gpc.length }, null, 2));
