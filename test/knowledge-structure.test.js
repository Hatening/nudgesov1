import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';

test('knowledge structure: new columns + license/validity/surface retrieval guards', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-struct-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  migrateSchema(db);

  // 010 迁移字段齐全
  const columns = db.prepare('PRAGMA table_info(knowledge)').all().map((c) => c.name);
  for (const name of ['product_surface', 'locale', 'license_status', 'valid_from', 'valid_until', 'structured_payload']) {
    assert.ok(columns.includes(name), `missing column ${name}`);
  }

  const now = new Date();
  const iso = (d) => d.toISOString();
  const insert = db.prepare(`INSERT INTO knowledge
    (id, tenant_id, site_id, scope, title, content, status, audience, category, is_insight,
     product_surface, locale, license_status, valid_from, valid_until, structured_payload,
     created_at, updated_at, review_status)
    VALUES (?, 'global', NULL, 'global', ?, ?, 'confirmed', 'buyer', '其他', 0, ?, 'en', ?, ?, ?, '{}', ?, ?, 'approved')`);

  const yesterday = iso(new Date(now.getTime() - 86400000));
  const tomorrow = iso(new Date(now.getTime() + 86400000));

  insert.run('kb_ok', 'Buyer chat ok', 'always valid content', 'buyer_chat', 'clear', null, null, iso(now), iso(now));
  insert.run('kb_general', 'General knowledge', 'works on every surface', 'general', 'clear', null, null, iso(now), iso(now));
  insert.run('kb_hold', 'Held knowledge', 'legally held content', 'buyer_chat', 'hold', null, null, iso(now), iso(now));
  insert.run('kb_expired', 'Expired policy', 'expired content', 'buyer_chat', 'clear', yesterday, yesterday, iso(now), iso(now));
  insert.run('kb_future', 'Future policy', 'not yet valid content', 'buyer_chat', 'clear', tomorrow, null, iso(now), iso(now));
  insert.run('kb_seller_surface', 'Seller only', 'seller console content', 'seller_console', 'clear', null, null, iso(now), iso(now));

  const dao = createDao(db);
  const buyerCorpus = dao.listGlobalKnowledge('all', { includeQuarantined: false, surface: 'buyer_chat' });
  const ids = buyerCorpus.map((r) => r.id).sort();

  assert.deepEqual(ids, ['kb_general', 'kb_ok'], `unexpected retrieval set: ${ids.join(',')}`);

  // structured_payload 映射为对象
  const ok = buyerCorpus.find((r) => r.id === 'kb_ok');
  assert.deepEqual(ok.structured_payload, {});
  assert.equal(ok.locale, 'en');
  assert.equal(ok.license_status, 'clear');

  // seller_console 只能看到 seller_console + general
  const sellerIds = dao.listGlobalKnowledge('all', { includeQuarantined: false, surface: 'seller_console' }).map((r) => r.id).sort();
  assert.deepEqual(sellerIds, ['kb_general', 'kb_seller_surface']);

  // 管理视角仍可见全部
  const adminIds = dao.listGlobalKnowledge('all', { includeQuarantined: true }).map((r) => r.id);
  assert.equal(adminIds.length, 6);

  closeDatabase(db);
  fs.rmSync(dir, { recursive: true, force: true });
});
