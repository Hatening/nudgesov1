import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { rankKnowledge } from '../src/core.js';

// 用真实 DAO + 临时库验证：license_hold / needs_manual_audit 永远不会被召回
test('KB isolation: license_hold and needs_manual_audit rows are never retrieved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-isolation-'));
  const dbPath = path.join(dir, 'test.sqlite');
  const db = openDatabase(dbPath);
  migrateSchema(db);

  const now = new Date().toISOString();
  const insert = db.prepare(`INSERT INTO knowledge
    (id, tenant_id, site_id, scope, filename, title, type, language, tags_json, content, status,
     audience, category, is_insight, created_at, updated_at, source_type, source_id, review_status, evidence_json)
    VALUES (?, 'global', NULL, 'global', NULL, ?, 'article', 'en', '[]', ?, ?, ?, '其他', 0, ?, ?, ?, ?, ?, '[]')`);

  const rows = [
    ['kb_ok_buyer', 'Buyer shipping policy', 'Delivery takes 3-5 business days.', 'confirmed', 'buyer', 'approved'],
    ['kb_ok_seller', 'Seller ACOS playbook', 'ACOS is ad spend divided by ad sales.', 'confirmed', 'seller', 'approved'],
    ['kb_hold_bitext', 'Bitext refund phrasing', 'Refund wording from held corpus.', 'draft', 'buyer', 'license_hold'],
    ['kb_hold_wix', 'Wix bulk article about events', 'Wix help center bulk content.', 'draft', 'seller', 'needs_manual_audit'],
    ['kb_hold_seller', 'Held seller playbook', 'ACOS policy pending legal review.', 'draft', 'seller', 'needs_manual_audit'],
  ];
  for (const [id, title, content, status, audience, review] of rows) {
    insert.run(id, title, content, status, audience, now, now, 'public_web', `raw_data/${id}.jsonl`, review);
  }

  const dao = createDao(db);

  const buyerCorpus = dao.listGlobalKnowledge('buyer', { includeQuarantined: false });
  const sellerCorpus = dao.listGlobalKnowledge('seller', { includeQuarantined: false });
  const allCorpus = dao.listGlobalKnowledge('all', { includeQuarantined: false });

  const ids = (list) => list.map((r) => r.id);
  assert.ok(ids(buyerCorpus).includes('kb_ok_buyer'));
  assert.equal(ids(buyerCorpus).includes('kb_hold_bitext'), false, 'buyer retrieval leaked license_hold');
  assert.ok(ids(sellerCorpus).includes('kb_ok_seller'));
  assert.equal(ids(sellerCorpus).includes('kb_hold_wix'), false, 'seller retrieval leaked needs_manual_audit');
  assert.equal(ids(allCorpus).includes('kb_hold_seller'), false, 'all retrieval leaked held row');

  // rankKnowledge 只能命中可见语料
  const hits = rankKnowledge('ACOS ad spend policy', allCorpus);
  assert.equal(hits.some((h) => h.id === 'kb_hold_seller'), false, 'rankKnowledge returned held row');

  // 管理后台显式 includeQuarantined 时才看得到
  const adminCorpus = dao.listGlobalKnowledge('all', { includeQuarantined: true });
  assert.ok(adminCorpus.some((r) => r.id === 'kb_hold_bitext'), 'admin view should see held rows');

  // 站点语料同样过滤
  const siteInsert = db.prepare("INSERT INTO sites (id, tenant_id, name, industry_template, embed_key, status, created_at) VALUES ('site_x','global','Site X','retail','embedx','active',?)");
  siteInsert.run(now);
  db.prepare("INSERT INTO knowledge (id, tenant_id, site_id, scope, title, type, language, tags_json, content, status, audience, category, is_insight, created_at, review_status) VALUES ('kb_site_hold','global','site_x','site','Held site doc','article','en','[]','held site content','confirmed','buyer','其他',0,?, 'license_hold')").run(now);
  const siteCorpus = dao.listConfirmedKnowledgeForSite('site_x', 'buyer', { includeQuarantined: false });
  assert.equal(siteCorpus.some((r) => r.id === 'kb_site_hold'), false, 'site corpus leaked license_hold');

  closeDatabase(db);
  fs.rmSync(dir, { recursive: true, force: true });
});
