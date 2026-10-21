import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import {
  evaluateSourcePermissions,
  assertSourcePermission,
  SourcePermissionError,
  SOURCE_POLICY_VERSION,
  SOURCE_ACTIONS,
} from '../src/source-permissions.js';

const NOW = '2026-10-21T00:00:00.000Z';

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-gov-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  migrateSchema(db);
  return { db, dir };
}

function insertSource(db, overrides = {}) {
  const base = {
    id: 'src_test',
    canonical_url: 'https://example.com/policy',
    domain: 'example.com',
    publisher: 'Example',
    source_type: 'official_doc',
    access_method: 'official_api',
    rights_status: 'ALLOW',
    fetch_allowed: 1,
    store_fulltext_allowed: 1,
    model_inference_allowed: 1,
    embed_allowed: 1,
    created_at: NOW,
    ...overrides,
  };
  const cols = Object.keys(base);
  const sql = `INSERT INTO source_registry (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  db.prepare(sql).run(...cols.map((c) => base[c]));
  return base.id;
}

test('migration 011 creates the four governance tables with default-deny columns', () => {
  const { db, dir } = freshDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const name of ['source_registry', 'claims', 'review_queue', 'import_batches']) {
    assert.ok(tables.includes(name), `missing table ${name}`);
  }
  const cols = db.prepare('PRAGMA table_info(source_registry)').all().map((c) => c.name);
  for (const col of ['rights_status', 'fetch_allowed', 'embed_allowed', 'model_inference_allowed', 'commercial_use_allowed', 'review_due_at']) {
    assert.ok(cols.includes(col), `missing column ${col}`);
  }
  closeDatabase(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evaluateSourcePermissions denies by default and blocks REVIEW_REQUIRED / BLOCK / METADATA_ONLY', () => {
  const { db, dir } = freshDb();

  // 未登记来源
  assert.equal(evaluateSourcePermissions(db, 'src_unknown', 'fetch', { now: NOW }).allowed, false);

  // 最小化插入（全部默认值）→ 默认 REVIEW_REQUIRED + 所有位为 0
  insertSource(db, { id: 'src_defaults', rights_status: 'REVIEW_REQUIRED' });
  const defaults = evaluateSourcePermissions(db, 'src_defaults', 'fetch', { now: NOW });
  assert.equal(defaults.allowed, false);
  assert.equal(defaults.reason, 'rights_status_review_required');

  // 即使权限位打开，REVIEW_REQUIRED / BLOCK / METADATA_ONLY 依然拒绝
  for (const status of ['REVIEW_REQUIRED', 'BLOCK', 'METADATA_ONLY']) {
    const id = insertSource(db, { id: `src_${status}`, rights_status: status, fetch_allowed: 1, embed_allowed: 1 });
    const decision = evaluateSourcePermissions(db, id, 'fetch', { now: NOW });
    assert.equal(decision.allowed, false, `${status} must deny fetch`);
    assert.match(decision.reason, /rights_status_/);
  }

  closeDatabase(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('evaluateSourcePermissions allows only explicitly granted actions and enforces expiry/limits', () => {
  const { db, dir } = freshDb();

  // ALLOW + 明确权限位
  insertSource(db, { id: 'src_allow', rights_status: 'ALLOW' });
  const fetch = evaluateSourcePermissions(db, 'src_allow', 'fetch', { now: NOW });
  assert.equal(fetch.allowed, true);
  assert.equal(fetch.policy_version, SOURCE_POLICY_VERSION);
  assert.equal(fetch.attribution_required, true);

  // 未打开的权限位（train 默认 0）拒绝
  const train = evaluateSourcePermissions(db, 'src_allow', 'train', { now: NOW });
  assert.equal(train.allowed, false);
  assert.match(train.reason, /permission_bit_off/);

  // ALLOW_WITH_LIMITS：只允许已开的位
  insertSource(db, { id: 'src_limited', rights_status: 'ALLOW_WITH_LIMITS', fetch_allowed: 1, embed_allowed: 0, model_inference_allowed: 1 });
  assert.equal(evaluateSourcePermissions(db, 'src_limited', 'fetch', { now: NOW }).allowed, true);
  assert.equal(evaluateSourcePermissions(db, 'src_limited', 'model_inference', { now: NOW }).allowed, true);
  assert.equal(evaluateSourcePermissions(db, 'src_limited', 'embed', { now: NOW }).allowed, false);

  // 复核过期 → 拒绝
  insertSource(db, { id: 'src_expired', review_due_at: '2026-01-01T00:00:00.000Z' });
  const expired = evaluateSourcePermissions(db, 'src_expired', 'fetch', { now: NOW });
  assert.equal(expired.allowed, false);
  assert.equal(expired.reason, 'review_expired');

  // 非商业限制 → 禁止商业使用；无衍生品 → 禁止 transform
  insertSource(db, { id: 'src_nc', noncommercial_restriction: 1, commercial_use_allowed: 1 });
  assert.equal(evaluateSourcePermissions(db, 'src_nc', 'commercial_use', { now: NOW }).allowed, false);
  insertSource(db, { id: 'src_nd', no_derivatives_restriction: 1, transform_allowed: 1 });
  assert.equal(evaluateSourcePermissions(db, 'src_nd', 'transform', { now: NOW }).allowed, false);

  // 未知动作拒绝
  assert.equal(evaluateSourcePermissions(db, 'src_allow', 'publish_everything', { now: NOW }).allowed, false);

  // assert 版本抛 403
  assert.throws(
    () => assertSourcePermission(db, 'src_unknown', 'fetch', { now: NOW }),
    (error) => error instanceof SourcePermissionError && error.status === 403,
  );
  const ok = assertSourcePermission(db, 'src_allow', 'embed', { now: NOW });
  assert.equal(ok.allowed, true);

  closeDatabase(db);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('claims reference source_registry via foreign key', () => {
  const { db, dir } = freshDb();
  insertSource(db, { id: 'src_fk' });
  db.prepare(`INSERT INTO claims (id, claim_text, source_id, evidence_quote, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('cl_1', 'Delivery takes 5-8 business days.', 'src_fk', 'takes 5-8 business days', NOW);
  const row = db.prepare('SELECT claim_text, source_id FROM claims WHERE id = ?').get('cl_1');
  assert.equal(row.source_id, 'src_fk');
  assert.throws(() => {
    db.prepare(`INSERT INTO claims (id, claim_text, source_id, created_at) VALUES (?, ?, ?, ?)`)
      .run('cl_bad', 'orphan claim', 'src_missing', NOW);
  }, /FOREIGN KEY/);
  closeDatabase(db);
  fs.rmSync(dir, { recursive: true, force: true });
});
