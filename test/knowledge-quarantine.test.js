import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';

test('buyer and seller retrieval never returns license_hold or needs_manual_audit rows', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relaydesk-quarantine-'));

  const db = openDatabase(path.join(dir, 'relaydesk.sqlite'));
  t.after(() => {
    closeDatabase(db);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  migrateSchema(db);

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO knowledge
      (id, scope, title, content, status, audience, review_status,
       source_type, language, tags_json, type, created_at, updated_at)
    VALUES (?, 'global', ?, ?, ?, ?, ?, 'wixqa', 'zh', '[]', 'qa', ?, ?)
  `);
  const cards = [
    ['kb_buyer_ok', '买家正常卡', '买家正常内容', 'confirmed', 'buyer', 'approved'],
    ['kb_buyer_hold', '买家法务卡', '买家法务内容', 'confirmed', 'buyer', 'license_hold'],
    ['kb_buyer_audit', '买家待审卡', '买家待审内容', 'draft', 'buyer', 'needs_manual_audit'],
    ['kb_seller_ok', '卖家正常卡', '卖家正常内容', 'confirmed', 'seller', 'approved'],
    ['kb_seller_audit', '卖家待审卡', '卖家待审内容', 'confirmed', 'seller', 'needs_manual_audit'],
    ['kb_seller_hold', '卖家法务卡', '卖家法务内容', 'confirmed', 'seller', 'license_hold']
  ];
  for (const [id, title, content, status, audience, reviewStatus] of cards) {
    insert.run(id, title, content, status, audience, reviewStatus, now, now);
  }

  const dao = createDao(db);
  const ids = (audience) => dao.listGlobalKnowledge(audience, { includeQuarantined: false })
    .map((card) => card.id)
    .sort();

  assert.deepEqual(ids('buyer'), ['kb_buyer_ok']);
  assert.deepEqual(ids('seller'), ['kb_seller_ok']);
  assert.deepEqual(ids('all'), ['kb_buyer_ok', 'kb_seller_ok']);

  // Admin/audit listing still sees every row; only chat retrieval is filtered.
  assert.equal(dao.listGlobalKnowledge('all').length, cards.length);
});
