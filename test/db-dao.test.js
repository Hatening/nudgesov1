import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { openDatabase, migrateSchema, seedDatabase, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { id, now, hashToken } from '../src/core.js';

test('SQLite DAO: schema, WAL, CRUD, transactions and session hashing', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-dao-'));
  const dbPath = path.join(dir, 'relaydesk.sqlite');
  const db = openDatabase(dbPath);
  t.after(async () => {
    closeDatabase(db);
    await fs.rm(dir, { recursive: true, force: true });
  });

  assert.equal(migrateSchema(db), true);
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys), 1);
  seedDatabase(db);

  const dao = createDao(db);
  assert.equal(dao.listGlobalKnowledge().length, 3);
  assert.equal(dao.getSettings().storeName, 'Northstar Goods');

  const tenant = { id: id('tenant'), name: 'DAO Test Store', plan: 'free', status: 'active', created_at: now() };
  const { salt, hash } = { salt: 'salt', hash: 'hash' };
  const user = {
    id: id('user'),
    tenant_id: tenant.id,
    email: 'dao-test@example.test',
    password_salt: salt,
    password_hash: hash,
    role: 'owner',
    created_at: now()
  };
  const registration = dao.registerTenantOwner(tenant, user);
  assert.ok(registration.token);
  assert.equal(dao.findSessionByToken(registration.token).user.email, user.email);
  assert.notEqual(db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').get(user.id).token_hash, registration.token);
  assert.equal(dao.findSessionByToken('wrong-token'), null);

  const site = dao.createSite({
    id: id('site'),
    tenant_id: tenant.id,
    name: 'DAO Site',
    industry_template: 'retail',
    industry_template_name: '零售 / Retail',
    embed_key: 'dao-embed-key',
    created_at: now()
  });
  assert.equal(site.knowledge_count, 0);

  const doc = dao.createSiteKnowledge(site.id, tenant.id, {
    id: id('kbdoc'),
    filename: 'faq.txt',
    title: '物流时效',
    content: '物流：标准快递通常需要 3-5 个工作日送达。',
    status: 'draft'
  });
  assert.equal(doc.status, 'draft');
  assert.equal(dao.confirmSiteKnowledge(site.id, doc.id).status, 'confirmed');
  assert.equal(dao.findSiteById(site.id).knowledge_count, 1);
  assert.equal(dao.listConfirmedKnowledgeForSite(site.id).length, 1);

  const messageId = id('msg');
  const escalationId = id('esc');
  const reply = { lang: 'zh', text: '已收到', need_human: true, grounded: false };
  const created = dao.createPublicMessageWithEscalation({
    id: messageId,
    tenant_id: tenant.id,
    site_id: site.id,
    embed_key: site.embed_key,
    message: '我要退款',
    input_type: 'text',
    language: 'zh',
    intent: 'Returns and refunds',
    risk: 'high',
    reply,
    evidence: [],
    created_at: now()
  }, {
    id: escalationId,
    tenant_id: tenant.id,
    site_id: site.id,
    message_id: messageId,
    message: '我要退款',
    input_type: 'text',
    language: 'zh',
    intent: 'Returns and refunds',
    risk: 'high',
    status: 'pending',
    created_at: now(),
    updated_at: now()
  }, { type: 'test_escalation', data: { messageId } });

  assert.equal(created.message.id, messageId);
  assert.equal(created.escalation.id, escalationId);
  assert.equal(dao.listEscalations(tenant.id).length, 1);
  assert.equal(dao.listEscalations(tenant.id)[0].site_name, 'DAO Site');
  assert.equal(dao.updateEscalationStatus(tenant.id, escalationId, 'resolved').status, 'resolved');
  assert.equal(dao.findPublicMessage(site.id, messageId).reply.text, '已收到');

  const before = dao.countGlobalKnowledge();
  assert.throws(() => dao.transaction(() => {
    db.prepare(`INSERT INTO knowledge (id, scope, title, content, created_at) VALUES (?, 'global', 'rollback', 'x', ?)`)
      .run('kb_rollback', now());
    throw new Error('force rollback');
  }), /force rollback/);
  assert.equal(dao.countGlobalKnowledge(), before);

  const exported = dao.exportStore();
  assert.equal(exported.tenants.length, 2);
  assert.equal(exported.sites.length, 1);
  assert.equal(exported.sites[0].knowledge.length, 1);
  assert.equal(exported.publicMessages.length, 1);
  assert.equal(exported.escalations.length, 1);
  assert.equal(exported.sessions.length, 0);
  assert.ok(exported.settings.storeName);
});
