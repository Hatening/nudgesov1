import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function card(overrides) {
  return {
    id: 'rescue_test_1',
    source_type: 'wixqa',
    source: 'wixqa_expertwritten',
    source_file: 'db/seed/knowledge.rejected.jsonl',
    source_title: 'Test article',
    source_url: 'https://support.wix.com/en/article/test',
    reject_reason: 'url',
    review_status: 'cloud-rescued',
    question: 'How do I test the rescue merge?',
    answer: 'Use the local merge script with a temporary database.',
    category: '平台规则',
    language: 'en',
    validation: { passed: true, missing: [] },
    cloud: {
      model: 'deepseek-flash',
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      estimated_cost_usd: 0
    },
    ...overrides
  };
}

test('merge-rescued writes cloud-rescued cards into knowledge idempotently', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relaydesk-rescue-merge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'relaydesk.sqlite');
  const fixturePath = path.join(dir, 'rescued_cards.jsonl');
  const now = new Date().toISOString();

  fs.writeFileSync(fixturePath, [
    card(),
    card({
      id: 'rescue_test_2',
      source_type: 'ecommerce_ai_skills',
      source: 'raw_data/ecommerce-ai-skills/skills/ecom-listing/references/playbook.md',
      source_title: 'Listing playbook',
      source_url: '',
      reject_reason: 'number',
      question: '如何计算上架数量？',
      answer: '按原文给定的库存与周转天数计算，不额外添加数字。',
      category: '广告与营销',
      language: 'zh'
    })
  ].map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf8');

  let db = openDatabase(dbPath);
  migrateSchema(db);
  db.prepare(`
    INSERT INTO knowledge (id, scope, title, content, status, created_at, review_status)
    VALUES ('legacy_row', 'global', 'Legacy row', 'legacy content', 'confirmed', ?, 'approved')
  `).run(now);
  closeDatabase(db);

  const runMerge = () => execFileSync(process.execPath, [
    'scripts/merge-rescued.mjs',
    '--file', fixturePath,
    '--db', dbPath
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  const output = runMerge();
  assert.match(output, /RESCUE_MERGE_OK/);

  db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT * FROM knowledge WHERE review_status = 'cloud-rescued' ORDER BY id").all();
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.id), ['rescue_test_1', 'rescue_test_2']);
    for (const row of rows) {
      assert.equal(row.review_status, 'cloud-rescued');
      assert.equal(row.audience, 'seller');
      assert.equal(row.scope, 'global');
      assert.equal(row.tenant_id, 'global');
      assert.equal(row.status, 'confirmed');
      assert.ok(row.title);
      assert.ok(row.content);
      assert.ok(row.tags_json.includes('cloud-rescued'));
      assert.ok(row.evidence_json.includes('deepseek-flash'));
    }
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM knowledge WHERE id = 'legacy_row' AND review_status = 'approved'").get().count), 1);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM knowledge').get().count), 3);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    db.close();
  }

  runMerge();
  db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS count FROM knowledge').get().count), 3);
    assert.equal(Number(db.prepare("SELECT COUNT(*) AS count FROM knowledge WHERE review_status = 'cloud-rescued'").get().count), 2);
  } finally {
    db.close();
  }
});
