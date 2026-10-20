#!/usr/bin/env node
/**
 * Idempotent reference-data seeder for deployment.
 *
 * The cards in db/seed/knowledge.jsonl and db/seed/knowledge-rescued.jsonl
 * already passed the build-time evidence gate. This script adds a second,
 * runtime gate:
 *   - only WixQA and ecommerce-ai-skills cards are allowed;
 *   - Bitext / WebFAQ / traveling sources are rejected outright;
 *   - every card must carry non-empty evidence and a clean validation result;
 *   - reference rows are replaced (not merely appended), so a contaminated
 *     database is cleaned on the next start;
 *   - the GPC taxonomy is replaced from db/seed/gpc_taxonomy.jsonl.
 *
 * It is safe to run on every container start (Dockerfile CMD) and on a fresh
 * Render disk: migrations run first, then the seed is upserted atomically.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrateSchema, closeDatabase, transaction } from '../src/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, '.data'));
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(DATA_DIR, 'relaydesk.sqlite'));
const SEED_DIR = path.join(ROOT, 'db', 'seed');

const ALLOWED_SOURCE_TYPES = new Set(['wixqa', 'ecommerce_ai_skills']);
const BANNED_SOURCE = /bitext|webfaq|traveling/i;
// Keep in sync with db/migrations/005_is_insight.sql.
const INSIGHT_CATEGORIES = new Set([
  '行业洞察', '商业策略', '广告与营销', '物流与配送', '退货与退款',
  '支付与结算', '商品与尺码', '平台规则', '投诉与纠纷'
]);

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
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

function assertApprovedSeed(cards) {
  const allowedStatuses = new Set(['approved', 'cloud-rescued']);
  const seenIds = new Set();
  for (const [index, card] of cards.entries()) {
    const where = `knowledge seed card ${index} (${card.id || 'no-id'})`;

    if (!card.id) throw new Error(`${where}: missing id`);
    if (seenIds.has(card.id)) throw new Error(`${where}: duplicate id`);
    seenIds.add(card.id);
    if (!ALLOWED_SOURCE_TYPES.has(card.source_type)) {
      throw new Error(`${where}: unapproved source_type "${card.source_type}"`);
    }
    if (!card.source_id) throw new Error(`${where}: missing source_id`);
    if (BANNED_SOURCE.test(`${card.source_type} ${card.source_id} ${card.source_url || ''}`)) {
      throw new Error(`${where}: quarantined source (Bitext/WebFAQ) cannot be seeded`);
    }
    if (!allowedStatuses.has(card.review_status)) {
      throw new Error(`${where}: review_status "${card.review_status}" is not allowed`);
    }
    if (!card.title || !card.content) {
      throw new Error(`${where}: title/content is empty`);
    }

    let evidence;
    try {
      evidence = JSON.parse(card.evidence_json || '[]');
    } catch {
      throw new Error(`${where}: evidence_json is not valid JSON`);
    }
    if (!Array.isArray(evidence) || evidence.length === 0) {
      throw new Error(`${where}: evidence_json is empty`);
    }

    let validation;
    try {
      validation = JSON.parse(card.validation_json || 'null');
    } catch {
      throw new Error(`${where}: validation_json is not valid JSON`);
    }
    if (!validation || !Array.isArray(validation.missing)) {
      throw new Error(`${where}: validation_json is incomplete`);
    }
    if (!validation.checked && validation.passed !== true) {
      throw new Error(`${where}: validation_json has no proof`);
    }
    if (validation.missing.length > 0) {
      throw new Error(`${where}: evidence gate failed: ${validation.missing.slice(0, 5).join('; ')}`);
    }
  }
}

function isInsight(card) {
  return card.audience === 'seller' && INSIGHT_CATEGORIES.has(card.category) ? 1 : 0;
}

function main() {
  const baseCards = readJsonl(path.join(SEED_DIR, 'knowledge.jsonl'));
  const rescuedCards = readJsonl(path.join(SEED_DIR, 'knowledge-rescued.jsonl'));
  const cards = [...baseCards, ...rescuedCards];
  const gpc = readJsonl(path.join(SEED_DIR, 'gpc_taxonomy.jsonl'));
  if (baseCards.length === 0) throw new Error('db/seed/knowledge.jsonl is missing or empty');
  if (rescuedCards.length === 0) throw new Error('db/seed/knowledge-rescued.jsonl is missing or empty');
  if (gpc.length === 0) throw new Error('db/seed/gpc_taxonomy.jsonl is missing or empty');
  assertApprovedSeed(cards);

  const db = openDatabase(DB_PATH);
  try {
    migrateSchema(db);

    const cleanupKnowledge = db.prepare(`
      DELETE FROM knowledge
      WHERE scope = 'global'
        AND (
          source_type IN ('wixqa', 'ecommerce_ai_skills', 'public_web')
          OR lower(COALESCE(source_id, '')) LIKE '%bitext%'
          OR lower(COALESCE(source_id, '')) LIKE '%webfaq%'
          OR lower(COALESCE(source_id, '')) LIKE '%traveling%'
        )
    `);

    const insertKnowledge = db.prepare(`
      INSERT OR IGNORE INTO knowledge
        (id, tenant_id, site_id, scope, filename, title, type, language, tags_json, content,
         status, created_at, updated_at, audience, category, is_insight,
         sensitivity, freshness, source_type, source_id, source_url, review_status, evidence_json)
      VALUES (?, ?, NULL, 'global', NULL, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    const now = new Date().toISOString();
    const result = transaction(db, () => {
      const removed = Number(cleanupKnowledge.run().changes || 0);

      // Children first: gpc_taxonomy.parent_code uses ON DELETE RESTRICT.
      for (const level of ['Brick', 'Class', 'Family', 'Segment']) {
        db.exec(`DELETE FROM gpc_taxonomy WHERE level = '${level}'`);
      }

      for (const card of cards) {
        insertKnowledge.run(
          card.id,
          card.tenant_id || 'global',
          card.title,
          card.type || 'qa',
          card.language || 'en',
          JSON.stringify(card.tags || []),
          card.content,
          card.created_at || now,
          card.updated_at || now,
          card.audience || 'seller',
          card.category || '其他',
          card.is_insight ?? isInsight(card),
          card.sensitivity || 'low',
          card.freshness || 'static',
          card.source_type,
          card.source_id,
          card.source_url || null,
          card.review_status,
          card.evidence_json
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

      const banned = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM knowledge
        WHERE lower(COALESCE(source_id, '')) LIKE '%bitext%'
           OR lower(COALESCE(source_id, '')) LIKE '%webfaq%'
           OR lower(COALESCE(source_id, '')) LIKE '%traveling%'
      `).get().count);
      if (banned > 0) throw new Error(`quarantined rows still present after seed: ${banned}`);

      const referenceCount = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM knowledge
        WHERE scope = 'global' AND source_type IN ('wixqa', 'ecommerce_ai_skills')
      `).get().count);
      if (referenceCount !== cards.length) {
        throw new Error(`reference row count mismatch: ${referenceCount} != ${cards.length}`);
      }

      const cloudRescuedCount = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM knowledge WHERE review_status = 'cloud-rescued'
      `).get().count);
      if (cloudRescuedCount !== rescuedCards.length) {
        throw new Error(`cloud-rescued row count mismatch: ${cloudRescuedCount} != ${rescuedCards.length}`);
      }

      return { removed };
    });

    const counts = {
      knowledge: Number(db.prepare('SELECT COUNT(*) AS count FROM knowledge').get().count),
      reference: Number(db.prepare("SELECT COUNT(*) AS count FROM knowledge WHERE source_type IN ('wixqa', 'ecommerce_ai_skills')").get().count),
      cloudRescued: Number(db.prepare("SELECT COUNT(*) AS count FROM knowledge WHERE review_status = 'cloud-rescued'").get().count),
      global: Number(db.prepare("SELECT COUNT(*) AS count FROM knowledge WHERE tenant_id = 'global'").get().count),
      gpcTaxonomy: Number(db.prepare('SELECT COUNT(*) AS count FROM gpc_taxonomy').get().count)
    };
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error(`SQLite integrity_check failed: ${integrity}`);

    console.log(JSON.stringify({
      ok: true,
      db: DB_PATH,
      seed_cards: cards.length,
      base_seed_cards: baseCards.length,
      rescued_seed_cards: rescuedCards.length,
      seeded_gpc: gpc.length,
      removed_stale_reference_rows: result.removed,
      counts
    }, null, 2));
  } finally {
    closeDatabase(db);
  }
}

try {
  main();
} catch (error) {
  console.error(`KB_SEED_FAILED: ${error.message}`);
  process.exitCode = 1;
}
