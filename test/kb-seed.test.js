import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, closeDatabase, migrateSchema } from '../src/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = path.join(root, 'db', 'seed');

function readJsonl(name) {
  return fs.readFileSync(path.join(seedDir, name), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${name}:${index + 1}: ${error.message}`);
      }
    });
}

function normalizeTitle(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

const knowledgeSeed = readJsonl('knowledge.jsonl');
const rescuedSeed = readJsonl('knowledge-rescued.jsonl');
const gpcSeed = readJsonl('gpc_taxonomy.jsonl');
const ALLOWED_SOURCES = new Set(['wixqa', 'ecommerce_ai_skills']);
const BANNED_SOURCE = /bitext|webfaq|traveling/i;

test('knowledge seed contains only approved sources with evidence-gate proof', () => {
  assert.ok(knowledgeSeed.length >= 1000, `expected >1000 knowledge cards, got ${knowledgeSeed.length}`);

  for (const [index, card] of knowledgeSeed.entries()) {
    assert.ok(ALLOWED_SOURCES.has(card.source_type), `card ${index} has unapproved source_type ${card.source_type}`);
    assert.ok(
      !BANNED_SOURCE.test(`${card.source_type} ${card.source_id || ''} ${card.source_url || ''}`),
      `card ${index} points at a quarantined source`
    );
    assert.equal(card.review_status, 'approved', `card ${index} is not approved`);
    assert.ok(card.evidence_json, `card ${index} has no evidence_json`);

    const evidence = JSON.parse(card.evidence_json);
    assert.ok(Array.isArray(evidence) && evidence.length > 0, `card ${index} evidence is empty`);

    const validation = JSON.parse(card.validation_json);
    assert.ok(validation.checked, `card ${index} has no checked evidence list`);
    assert.ok(Array.isArray(validation.missing), `card ${index} validation.missing is not an array`);
    assert.deepEqual(validation.missing, [], `card ${index} failed the evidence gate: ${validation.missing}`);
  }

  const seen = new Set();
  let duplicates = 0;
  for (const card of knowledgeSeed) {
    const key = normalizeTitle(card.title);
    if (seen.has(key)) duplicates += 1;
    seen.add(key);
  }
  assert.equal(duplicates, 0, 'knowledge seed contains duplicate normalized titles');
  assert.equal(BANNED_SOURCE.test(JSON.stringify(knowledgeSeed)), false, 'knowledge seed mentions a quarantined source');

  const sourceTypes = new Set(knowledgeSeed.map((card) => card.source_type));
  assert.deepEqual([...sourceTypes].sort(), ['ecommerce_ai_skills', 'wixqa']);

  // The cloud-rescued incremental seed must stay on the same approved sources.
  assert.equal(rescuedSeed.length, 5163);
  for (const [index, card] of rescuedSeed.entries()) {
    assert.ok(ALLOWED_SOURCES.has(card.source_type), `rescued card ${index} has unapproved source_type`);
    assert.equal(card.review_status, 'cloud-rescued', `rescued card ${index} has the wrong review_status`);
    assert.ok(card.evidence_json, `rescued card ${index} has no evidence_json`);
    const evidence = JSON.parse(card.evidence_json);
    assert.ok(Array.isArray(evidence) && evidence.length > 0, `rescued card ${index} evidence is empty`);
    const validation = JSON.parse(card.validation_json);
    assert.ok(validation.checked || validation.passed === true, `rescued card ${index} has no validation proof`);
    assert.deepEqual(validation.missing, [], `rescued card ${index} failed validation`);
  }
  assert.equal(BANNED_SOURCE.test(JSON.stringify(rescuedSeed)), false, 'rescued seed mentions a quarantined source');
  const ids = new Set();
  for (const card of [...knowledgeSeed, ...rescuedSeed]) {
    assert.equal(ids.has(card.id), false, `duplicate seed id ${card.id}`);
    ids.add(card.id);
  }
});

test('GPC seed is the complete four-level taxonomy', () => {
  assert.equal(gpcSeed.length, 6463);
  const counts = gpcSeed.reduce((acc, row) => {
    acc[row.level] = (acc[row.level] || 0) + 1;
    return acc;
  }, {});
  assert.deepEqual(counts, { Segment: 45, Family: 162, Class: 938, Brick: 5318 });

  const codes = new Set(gpcSeed.map((row) => row.code));
  assert.equal(codes.size, gpcSeed.length, 'GPC seed has duplicate codes');
  for (const row of gpcSeed) {
    if (row.parent_code !== null) {
      assert.ok(codes.has(row.parent_code), `GPC ${row.code} points at missing parent ${row.parent_code}`);
    }
  }
});

test('seed-kb seeds a clean database, cleans quarantined rows and is idempotent', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relaydesk-kb-seed-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'relaydesk.sqlite');
  const now = new Date().toISOString();

  let db = openDatabase(dbPath);
  migrateSchema(db);
  db.prepare(`
    INSERT INTO knowledge
      (id, tenant_id, scope, title, type, language, tags_json, content, status,
       created_at, updated_at, audience, category, is_insight, source_type, source_id, review_status, evidence_json)
    VALUES
      ('kb_old_bitext', 'global', 'global', 'Old Bitext card', 'qa', 'en', '[]', 'quarantined content', 'confirmed',
       ?, ?, 'seller', '其他', 0, 'public_web', 'raw_data/bitext.jsonl', 'approved', '[]'),
      ('kb_demo_keep', 'global', 'global', 'Demo card to keep', 'article', 'en', '[]', 'demo content', 'confirmed',
       ?, ?, 'buyer', '其他', 0, 'unknown', NULL, 'candidate', '[]')
  `).run(now, now, now, now);
  closeDatabase(db);

  const runSeed = () => execFileSync(process.execPath, ['scripts/seed-kb.mjs'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dir, DB_PATH: dbPath },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  runSeed();
  db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const count = (sql) => Number(db.prepare(sql).get().count);
    assert.equal(count("SELECT COUNT(*) AS count FROM knowledge WHERE id = 'kb_old_bitext'"), 0);
    assert.equal(count("SELECT COUNT(*) AS count FROM knowledge WHERE id = 'kb_demo_keep'"), 1);
    assert.equal(count("SELECT COUNT(*) AS count FROM knowledge WHERE source_type IN ('wixqa', 'ecommerce_ai_skills')"), knowledgeSeed.length + rescuedSeed.length);
    assert.equal(count("SELECT COUNT(*) AS count FROM knowledge WHERE review_status = 'cloud-rescued'"), rescuedSeed.length);
    assert.equal(count("SELECT COUNT(*) AS count FROM knowledge WHERE source_type = 'public_web'"), 0);
    assert.equal(count(`
      SELECT COUNT(*) AS count FROM knowledge
      WHERE lower(COALESCE(source_id, '')) LIKE '%bitext%'
         OR lower(COALESCE(source_id, '')) LIKE '%webfaq%'
    `), 0);
    assert.equal(count("SELECT COUNT(*) AS count FROM gpc_taxonomy"), gpcSeed.length);
    assert.equal(count("SELECT COUNT(*) AS count FROM tenants WHERE id = 'global'"), 1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

    const insight = db.prepare(
      "SELECT is_insight FROM knowledge WHERE source_type = 'ecommerce_ai_skills' AND category = '广告与营销' LIMIT 1"
    ).get();
    assert.equal(Number(insight.is_insight), 1, 'seller operational cards must be marked as insights');
    const other = db.prepare(
      "SELECT is_insight FROM knowledge WHERE source_type = 'ecommerce_ai_skills' AND category = '其他' LIMIT 1"
    ).get();
    assert.equal(Number(other.is_insight), 0, 'non-operational cards must not be marked as insights');

    const chain = db.prepare(`
      WITH RECURSIVE ancestors(code, parent_code, level, level_num, title) AS (
        SELECT code, parent_code, level, level_num, title FROM gpc_taxonomy WHERE code = 10001354
        UNION ALL
        SELECT parent.code, parent.parent_code, parent.level, parent.level_num, parent.title
        FROM gpc_taxonomy AS parent
        JOIN ancestors AS child ON child.parent_code = parent.code
      )
      SELECT code FROM ancestors ORDER BY level_num
    `).all().map((row) => row.code);
    assert.deepEqual(chain, [67000000, 67010000, 67010100, 10001354]);
  } finally {
    db.close();
  }

  runSeed();
  db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const count = (sql) => Number(db.prepare(sql).get().count);
    assert.equal(count('SELECT COUNT(*) AS count FROM knowledge'), knowledgeSeed.length + rescuedSeed.length + 1);
    assert.equal(count('SELECT COUNT(*) AS count FROM gpc_taxonomy'), gpcSeed.length);
    assert.equal(count("SELECT COUNT(*) AS count FROM knowledge WHERE id = 'kb_demo_keep'"), 1);
  } finally {
    db.close();
  }
});
