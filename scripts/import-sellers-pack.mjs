#!/usr/bin/env node
/**
 * Sellers 初始包分级导入（Phase 1 / 第 4 步，方案 A）
 *
 *  14 张有来源      -> status='draft'    + claims + review_queue（priority 3）
 *  19 张无来源      -> status='baseline' （不进 claims，不检索）
 *   7 张高风险无来源 -> status='blocked'  + review_queue（priority 1，license_hold）
 *
 * 安全保证：
 *  - 只写 draft / baseline / blocked，绝不写 confirmed；
 *  - 每张卡写入后校验：status != 'confirmed'，且不满足 RAG 白名单；
 *  - 全部包在 import_batches 批次记录里。
 *
 * 用法：
 *   node scripts/import-sellers-pack.mjs --dry-run
 *   node scripts/import-sellers-pack.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const PACK = path.resolve(arg('pack', 'D:/Documents/AI_Projects/NudgeSo/language_prompt/Sellers/knowledge/knowledge_cards.jsonl'));
const DB_PATH = path.resolve(ROOT, arg('db', path.join('.data', 'relaydesk.sqlite')));
const DRY = hasFlag('dry-run');
const POLICY_VERSION = '2026-10-21.1';
const BATCH_ID = 'ib_sellers_ops_20261021';
const NOW = new Date().toISOString();

const TOPIC_CATEGORY = {
  unit_economics: '支付与结算',
  paid_ads: '广告与营销',
  listing: '商品与尺码',
  product_listing: '商品与尺码',
  inventory: '物流与配送',
  fulfillment: '物流与配送',
  returns: '退货与退款',
  compliance: '平台规则',
  customer_service: '投诉与纠纷',
  customer_retention: '投诉与纠纷',
};

const hasSource = (c) => (Array.isArray(c.source_ids) && c.source_ids.length > 0)
  || (Array.isArray(c.source_urls) && c.source_urls.length > 0);
const isHighRisk = (c) => ['high', 'critical'].includes(String(c.risk_level || '').toLowerCase());

function classify(cards) {
  const draft = cards.filter((c) => hasSource(c));
  const blocked = cards.filter((c) => !hasSource(c) && isHighRisk(c));
  const baseline = cards.filter((c) => !hasSource(c) && !isHighRisk(c));
  return { draft, baseline, blocked };
}

function composeContent(card) {
  const steps = Array.isArray(card.recommended_steps) ? card.recommended_steps : [];
  const metrics = Array.isArray(card.metrics_to_track) ? card.metrics_to_track : [];
  return [
    `问题：${card.problem_statement || ''}`,
    `原则：${card.operating_principle || ''}`,
    steps.length ? `步骤：\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '',
    metrics.length ? `关注指标：${metrics.join('、')}` : '',
    card.failure_modes_and_limits ? `限制与失败信号：${card.failure_modes_and_limits}` : '',
  ].filter(Boolean).join('\n\n');
}

function confidenceOf(card) {
  const map = { low: 0.3, low_to_medium: 0.45, medium: 0.6, medium_to_high: 0.75, high: 0.85 };
  return map[String(card.confidence || '').toLowerCase()] ?? 0.4;
}

function main() {
  if (!fs.existsSync(PACK)) { console.error(`[fatal] pack not found: ${PACK}`); process.exit(2); }
  const cards = fs.readFileSync(PACK, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const { draft, baseline, blocked } = classify(cards);

  console.log(`[pack] ${cards.length} cards`);
  console.log(`[plan] draft=${draft.length} baseline=${baseline.length} blocked=${blocked.length}`);
  if (draft.length + baseline.length + blocked.length !== cards.length) {
    console.error('[fatal] classification does not partition the pack'); process.exit(1);
  }
  if (draft.length !== 14 || baseline.length !== 19 || blocked.length !== 7) {
    console.error(`[fatal] expected 14/19/7, got ${draft.length}/${baseline.length}/${blocked.length}`);
    process.exit(1);
  }
  if (DRY) {
    console.log('[dry-run] no writes');
    for (const c of draft) console.log(`  draft    ${c.card_id} ${c.title}`);
    for (const c of blocked) console.log(`  blocked  ${c.card_id} ${c.title}`);
    return;
  }

  const db = openDatabase(DB_PATH);
  migrateSchema(db);

  // 1) 为有来源卡片登记 source_registry（保守：REVIEW_REQUIRED，不可抓取/向量化）
  const sourceMap = new Map();
  for (const card of draft) {
    const ids = Array.isArray(card.source_ids) ? card.source_ids : [];
    const urls = Array.isArray(card.source_urls) ? card.source_urls : [];
    ids.forEach((sid, i) => {
      if (!sourceMap.has(sid)) sourceMap.set(sid, urls[i] || urls[0] || `pack://sellers/${sid}`);
    });
  }
  const upsertSource = db.prepare(`INSERT INTO source_registry
    (id, canonical_url, domain, publisher, source_type, access_method, license_name,
     rights_status, store_fulltext_allowed, embed_allowed, model_inference_allowed,
     attribution_required, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'external_reference', 'manual', 'pack-declared reference (pending verification)',
            'REVIEW_REQUIRED', 0, 0, 0, 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET canonical_url = excluded.canonical_url, updated_at = excluded.updated_at`);
  for (const [sid, url] of sourceMap) {
    let domain = 'pack.sellers';
    try { domain = new URL(url).hostname || domain; } catch { /* pack:// */ }
    upsertSource.run(sid, url, domain, domain, `Sellers pack reference ${sid}; pending review`, NOW, NOW);
  }
  console.log(`[sources] registered ${sourceMap.size} reference sources (REVIEW_REQUIRED, fetch=0, embed=0)`);

  const insertBatch = db.prepare(`INSERT INTO import_batches
    (id, name, source_id, knowledge_count, status, policy_snapshot_version, started_at, completed_at, summary_json, created_at)
    VALUES (?, ?, NULL, ?, 'completed', ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET knowledge_count = excluded.knowledge_count, completed_at = excluded.completed_at, summary_json = excluded.summary_json`);
  const insertKnowledge = db.prepare(`INSERT INTO knowledge
    (id, tenant_id, site_id, scope, filename, title, type, language, tags_json, content, status, audience, category,
     is_insight, created_at, updated_at, product_surface, locale, license_status, structured_payload,
     source_type, source_id, review_status, evidence_json)
    VALUES (?, 'global', NULL, 'global', NULL, ?, 'article', 'zh', ?, ?, ?, 'seller', ?, 0, ?, ?, 'seller_console',
            'zh-CN', ?, ?, 'unknown', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title, content = excluded.content, status = excluded.status,
      category = excluded.category, tags_json = excluded.tags_json, license_status = excluded.license_status,
      review_status = excluded.review_status, structured_payload = excluded.structured_payload,
      evidence_json = excluded.evidence_json, updated_at = excluded.updated_at`);
  const insertClaim = db.prepare(`INSERT INTO claims
    (id, claim_text, claim_type, source_id, knowledge_id, evidence_quote, confidence, review_status, created_at, updated_at)
    VALUES (?, ?, 'operating_principle', ?, ?, ?, ?, 'needs_review', ?, ?)
    ON CONFLICT(id) DO UPDATE SET claim_text = excluded.claim_text, review_status = excluded.review_status, updated_at = excluded.updated_at`);
  const insertReview = db.prepare(`INSERT INTO review_queue
    (id, item_type, item_id, reason, priority, status, policy_version, created_at)
    VALUES (?, 'knowledge', ?, ?, ?, 'open', ?, ?)
    ON CONFLICT(id) DO NOTHING`);

  let imported = { draft: 0, baseline: 0, blocked: 0 };
  let claims = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const card of draft) {
      const id = `kb_sellers_${card.card_id}`;
      const tags = [card.topic, card.platform_scope].filter(Boolean);
      insertKnowledge.run(id, card.title, JSON.stringify(tags), composeContent(card),
        'draft', TOPIC_CATEGORY[card.topic] || '其他', NOW, NOW, 'conditional', JSON.stringify(card),
        (card.source_ids || [])[0] || '', 'candidate',
        JSON.stringify({ pack: 'sellers_ops_v1', card_id: card.card_id, source_urls: card.source_urls || [] }));
      imported.draft += 1;

      const sourceId = (card.source_ids || [])[0];
      if (sourceId) {
        insertClaim.run(`cl_sellers_${card.card_id}`, card.operating_principle || card.title, sourceId, id,
          card.operating_principle || card.problem_statement || '', confidenceOf(card), NOW, NOW);
        claims += 1;
      }
      insertReview.run(`rq_sellers_${card.card_id}`, id, 'sellers_pack_sourced_pending_review', 3, POLICY_VERSION, NOW);
    }

    for (const card of baseline) {
      const id = `kb_sellers_${card.card_id}`;
      insertKnowledge.run(id, card.title, JSON.stringify([card.topic].filter(Boolean)), composeContent(card),
        'baseline', TOPIC_CATEGORY[card.topic] || '其他', NOW, NOW, 'unknown', JSON.stringify(card),
        '', 'candidate',
        JSON.stringify({ pack: 'sellers_ops_v1', card_id: card.card_id, source_urls: [] }));
      imported.baseline += 1;
    }

    for (const card of blocked) {
      const id = `kb_sellers_${card.card_id}`;
      insertKnowledge.run(id, card.title, JSON.stringify([card.topic].filter(Boolean)), composeContent(card),
        'blocked', TOPIC_CATEGORY[card.topic] || '其他', NOW, NOW, 'hold', JSON.stringify(card),
        '', 'license_hold',
        JSON.stringify({ pack: 'sellers_ops_v1', card_id: card.card_id, source_urls: [], block_reason: 'high_risk_no_source' }));
      imported.blocked += 1;
      insertReview.run(`rq_sellers_${card.card_id}`, id, 'sellers_pack_high_risk_no_source', 1, POLICY_VERSION, NOW);
    }

    insertBatch.run(BATCH_ID, 'Sellers Ops Seed Pack v1', cards.length, POLICY_VERSION, NOW, NOW,
      JSON.stringify({ total: cards.length, ...imported, claims, policy_version: POLICY_VERSION }), NOW);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    closeDatabase(db);
    throw error;
  }

  // 2) 校验：绝不 confirmed，且不在 RAG 白名单
  const rows = db.prepare("SELECT status, COUNT(*) c FROM knowledge WHERE id LIKE 'kb_sellers_%' GROUP BY status").all();
  const confirmed = db.prepare("SELECT COUNT(*) c FROM knowledge WHERE id LIKE 'kb_sellers_%' AND status = 'confirmed'").get().c;
  const ragVisible = db.prepare(`SELECT COUNT(*) c FROM knowledge
    WHERE id LIKE 'kb_sellers_%' AND status = 'confirmed' AND license_status <> 'hold'
      AND review_status NOT IN ('license_hold','needs_manual_audit','quarantined','rejected')`).get().c;
  const claimsCount = db.prepare("SELECT COUNT(*) c FROM claims WHERE id LIKE 'cl_sellers_%'").get().c;

  console.log(`[imported] draft=${imported.draft} baseline=${imported.baseline} blocked=${imported.blocked} claims=${claims}`);
  console.log(`[db status] ${rows.map((r) => `${r.status}=${r.c}`).join(' ')}`);
  console.log(`[safety] confirmed=${confirmed} (must be 0), rag_visible=${ragVisible} (must be 0), claims=${claimsCount}`);

  closeDatabase(db);
  if (confirmed !== 0 || ragVisible !== 0) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(`[fatal] ${error.message}`);
  process.exit(1);
}
