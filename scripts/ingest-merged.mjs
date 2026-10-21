#!/usr/bin/env node
/**
 * ingest-merged.mjs — 把 candidates.merged.jsonl 批量写入 SQLite knowledge 表。
 *
 * 字段映射：
 *   question  -> title
 *   answer    -> content
 *   tags      -> tags_json
 *   audience  -> audience ('buyer' | 'seller')
 *   category  -> category
 *   source    -> source_id + evidence_json
 *
 * 冲突策略：按 title（NOCASE）判重。
 *   默认跳过；--update 时更新 content/category/tags/audience/is_insight。
 *
 * 用法：
 *   node scripts/ingest-merged.mjs                     # 默认 raw_data/candidates.merged.jsonl
 *   node scripts/ingest-merged.mjs --db .data/relaydesk.sqlite --update
 *   node scripts/ingest-merged.mjs --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const DB_PATH = path.resolve(ROOT, arg('db', path.join('.data', 'relaydesk.sqlite')));
const INPUT = path.resolve(ROOT, arg('file', path.join('raw_data', 'candidates.merged.jsonl')));
const UPDATE = hasFlag('update');
const DRY_RUN = hasFlag('dry-run');
const LIMIT = Number(arg('limit', '0')) || 0;

const OPERATIONAL_CATEGORIES = new Set([
  '行业洞察', '商业策略', '广告与营销', '物流与配送', '退货与退款',
  '支付与结算', '商品与尺码', '平台规则', '投诉与纠纷',
]);

function cacheKey(title, audience) {
  return crypto.createHash('sha1').update(`${audience}|${String(title).trim().toLowerCase()}`).digest('hex').slice(0, 16);
}

function sourceTypeOf(source) {
  const s = String(source || '');
  if (s.includes('ecommerce-ai-skills')) return 'ecommerce_ai_skills';
  if (s.includes('seller_extra')) return 'public_web';
  if (s.includes('shopify')) return 'public_web';
  return 'public_web';
}

function loadCards(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim());
  const cards = [];
  let invalid = 0;
  for (const line of lines) {
    try { cards.push(JSON.parse(line)); } catch { invalid += 1; }
  }
  return { cards, invalid };
}

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error(`[fatal] input not found: ${INPUT}`);
    process.exit(1);
  }

  const { cards, invalid } = loadCards(INPUT);
  const selected = LIMIT > 0 ? cards.slice(0, LIMIT) : cards;
  console.log(`[input] ${path.relative(ROOT, INPUT)} — ${cards.length} cards${invalid ? `, ${invalid} invalid lines` : ''}`);
  console.log(`[db] ${path.relative(ROOT, DB_PATH)}`);
  console.log(`[mode] ${DRY_RUN ? 'dry-run' : UPDATE ? 'insert + update by title' : 'insert, skip existing titles'}`);

  if (DRY_RUN) {
    const byAudience = {};
    for (const card of selected) {
      const audience = card.audience === 'seller' ? 'seller' : 'buyer';
      byAudience[audience] = (byAudience[audience] || 0) + 1;
    }
    console.log(`[dry-run] would process ${selected.length} cards`, JSON.stringify(byAudience));
    return;
  }

  const db = openDatabase(DB_PATH);
  migrateSchema(db);

  // 组合判重：title + locale + tenant_id + source_url（KB-STRUCT-001）
  const findStmt = db.prepare(`
    SELECT id FROM knowledge
    WHERE title = ? COLLATE NOCASE
      AND COALESCE(locale, 'en') = ?
      AND COALESCE(tenant_id, 'global') = ?
      AND COALESCE(source_url, '') = ?
  `);
  const insertStmt = db.prepare(`
    INSERT INTO knowledge (
      id, tenant_id, site_id, scope, filename, title, type, language, tags_json, content,
      status, audience, category, is_insight, created_at, updated_at,
      source_type, source_id, source_url, review_status, evidence_json,
      product_surface, locale, license_status, valid_from, valid_until, structured_payload
    ) VALUES (?, 'global', NULL, 'global', NULL, ?, 'article', ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?,
              ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE knowledge
    SET content = ?, tags_json = ?, audience = ?, category = ?, is_insight = ?,
        source_type = ?, source_id = ?, source_url = ?, evidence_json = ?, updated_at = ?,
        product_surface = ?, locale = ?, license_status = ?
    WHERE id = ?
  `);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const now = new Date().toISOString();

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const card of selected) {
      const question = String(card.question || '').trim();
      const answer = String(card.answer || '').trim();
      if (!question || !answer) { failed += 1; continue; }

      const audience = card.audience === 'seller' ? 'seller' : 'buyer';
      const category = String(card.category || '其他').trim() || '其他';
      const tags = Array.isArray(card.tags) ? card.tags.map((t) => String(t).trim()).filter(Boolean) : [];
      const sourceType = sourceTypeOf(card.source);
      const sourceId = String(card.source || '');
      const sourceUrl = card.source_url ? String(card.source_url) : '';
      const locale = card.locale || (card.language ? String(card.language).slice(0, 8) : 'zh');
      const surface = card.product_surface || (audience === 'seller' ? 'seller_console' : 'buyer_chat');
      const licenseStatus = card.license_status || 'clear';
      const validFrom = card.valid_from || null;
      const validUntil = card.valid_until || null;
      const structured = JSON.stringify(card.structured_payload || {});
      const isInsight = audience === 'seller' && OPERATIONAL_CATEGORIES.has(category) ? 1 : 0;
      const evidence = JSON.stringify([{ source: sourceId, chunk: card.chunk ?? null, model: card.model ?? null }]);

      // 组合判重：title + locale + tenant_id + source_url
      const existing = findStmt.get(question, locale, 'global', sourceUrl);
      if (existing) {
        if (!UPDATE) { skipped += 1; continue; }
        updateStmt.run(answer.slice(0, 20000), JSON.stringify(tags), audience, category, isInsight, sourceType, sourceId, sourceUrl, evidence, now, surface, locale, licenseStatus, existing.id);
        updated += 1;
        continue;
      }

      const cacheId = `kb_${cacheKey(question, audience)}`;
      try {
        insertStmt.run(
          cacheId, question.slice(0, 500), card.language || 'zh', JSON.stringify(tags), answer.slice(0, 20000),
          audience, category, isInsight, now, now, sourceType, sourceId, sourceUrl, evidence,
          surface, locale, licenseStatus, validFrom, validUntil, structured,
        );
        inserted += 1;
      } catch (error) {
        failed += 1;
        if (failed <= 3) console.error(`  [fail] ${question.slice(0, 50)}: ${error.message}`);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    closeDatabase(db);
    throw error;
  }

  const total = db.prepare('SELECT COUNT(*) AS c FROM knowledge').get().c;
  const byAudience = db.prepare('SELECT audience, COUNT(*) AS c FROM knowledge GROUP BY audience').all();
  const byCategory = db.prepare('SELECT category, COUNT(*) AS c FROM knowledge GROUP BY category ORDER BY c DESC LIMIT 12').all();

  console.log(`\n[result] inserted=${inserted} updated=${updated} skipped=${skipped} failed=${failed}`);
  console.log(`[total] knowledge rows = ${total}`);
  console.log('[audience] ' + byAudience.map((r) => `${r.audience}=${r.c}`).join(' '));
  console.log('[category] ' + byCategory.map((r) => `${r.category}=${r.c}`).join(' · '));

  closeDatabase(db);
}

main();
