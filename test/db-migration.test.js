import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { hashToken } from '../src/core.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('JSON to SQLite migration preserves all collections, hashes sessions and is idempotent', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-migration-'));
  const source = path.join(dir, 'store.json');
  const dbPath = path.join(dir, 'relaydesk.sqlite');
  const at = '2026-10-19T00:00:00.000Z';
  const fixture = {
    tenants: [{ id: 'tenant_fixture', name: 'Fixture Store', plan: 'free', status: 'active', created_at: at }],
    users: [{
      id: 'user_fixture',
      tenant_id: 'tenant_fixture',
      email: 'fixture@example.test',
      password_salt: 'salt',
      password_hash: 'hash',
      role: 'owner',
      created_at: at
    }],
    sessions: [{ token: 'legacy-token', user_id: 'user_fixture', tenant_id: 'tenant_fixture', created_at: at }],
    sites: [{
      id: 'site_fixture',
      tenant_id: 'tenant_fixture',
      name: 'Fixture Site',
      industry_template: 'retail',
      industry_template_name: '零售 / Retail',
      embed_key: 'fixture-embed',
      status: 'active',
      created_at: at,
      knowledge: [{ id: 'kbdoc_site_fixture', filename: 'hours.txt', title: '营业时间', content: '营业时间：每天 09:00 - 21:00 营业。', status: 'confirmed', created_at: at, updated_at: at }]
    }],
    knowledge: [{ id: 'kb_global_fixture', title: 'Shipping', type: 'faq', language: 'en', tags: ['shipping'], content: 'Shipping takes 3-5 business days.', updatedAt: at }],
    conversations: [{
      id: 'conv_fixture',
      customer: 'Fixture Customer',
      channel: 'Website',
      language: 'en',
      intent: 'Shipping status',
      status: 'open',
      lastMessage: 'Where is my parcel?',
      updatedAt: at,
      messages: [{ role: 'customer', text: 'Where is my parcel?', at }, { role: 'agent', text: 'It is on the way.', at }]
    }],
    publicMessages: [{
      id: 'msg_public_fixture',
      site_id: 'site_fixture',
      embed_key: 'fixture-embed',
      message: '几点关门？',
      input_type: 'text',
      language: 'zh',
      intent: 'General question',
      risk: 'low',
      reply: { lang: 'zh', text: '09:00-21:00', need_human: false, grounded: true },
      evidence: [{ id: 'kbdoc_site_fixture', title: '营业时间', score: 1, language: 'zh' }],
      created_at: at
    }],
    escalations: [{
      id: 'esc_fixture',
      tenant_id: 'tenant_fixture',
      site_id: 'site_fixture',
      message_id: 'msg_public_fixture',
      message: '我要退款',
      language: 'zh',
      intent: 'Returns and refunds',
      risk: 'high',
      status: 'pending',
      created_at: at,
      updated_at: at
    }],
    settings: { storeName: 'Fixture Store', supportedLanguages: ['en', 'zh'], confidenceThreshold: 0.62 },
    glossary: [{ id: 'gl_fixture', source: 'refund', preferred: { en: 'refund' }, forbidden: [], notes: '' }],
    events: [{ id: 'evt_fixture', type: 'answer_generated', at, language: 'en', confidence: 0.8, grounded: true, needsHuman: false }],
    testRuns: [{ id: 'test_fixture', at, total: 5, passed: 5, results: [] }]
  };
  await fs.writeFile(source, JSON.stringify(fixture, null, 2), 'utf8');

  const run = () => execFileSync(process.execPath, [
    'scripts/migrate-json-to-sqlite.mjs',
    '--source', source,
    '--db', dbPath
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  const first = run();
  assert.match(first, /MIGRATION_OK/);

  let db = openDatabase(dbPath);
  let dao = createDao(db);
  assert.equal(dao.listTenants().length, 1);
  assert.equal(dao.listUsers().length, 1);
  assert.equal(dao.findSiteByEmbedKey('fixture-embed').knowledge_count, 1);
  assert.equal(dao.listGlobalKnowledge().length, 1);
  assert.equal(dao.listConversations().length, 1);
  assert.equal(dao.listConversations()[0].messages.length, 2);
  assert.equal(dao.findPublicMessage('site_fixture', 'msg_public_fixture').message, '几点关门？');
  assert.equal(dao.listEscalations('tenant_fixture').length, 1);
  assert.equal(dao.getSettings().storeName, 'Fixture Store');
  assert.equal(dao.listGlossary().length, 1);
  assert.equal(dao.listTestRuns().length, 1);
  const auth = dao.findSessionByToken('legacy-token');
  assert.equal(auth.user.email, 'fixture@example.test');
  assert.notEqual(db.prepare('SELECT token_hash FROM sessions').get().token_hash, 'legacy-token');
  assert.equal(db.prepare('SELECT token_hash FROM sessions').get().token_hash, hashToken('legacy-token'));
  const countsBefore = {
    messages: db.prepare('SELECT COUNT(*) AS c FROM messages').get().c,
    knowledge: db.prepare('SELECT COUNT(*) AS c FROM knowledge').get().c,
    escalations: db.prepare('SELECT COUNT(*) AS c FROM escalations').get().c
  };
  closeDatabase(db);

  const second = run();
  assert.match(second, /MIGRATION_OK/);
  db = openDatabase(dbPath);
  dao = createDao(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM messages').get().c, countsBefore.messages);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM knowledge').get().c, countsBefore.knowledge);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM escalations').get().c, countsBefore.escalations);
  closeDatabase(db);

  const files = await fs.readdir(dir);
  assert.ok(files.some((file) => file.startsWith('store.json.bak-')));
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
});
