import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrateSchema, seedDatabase, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { redactPII } from '../src/privacy.js';
import { stopChildAndRemove } from '../test-support/cleanup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

async function waitFor(url, child) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error('server exited before ready');
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server did not become ready');
}

async function post(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

test('P3-05 privacy: consent audit, export, delete, retention and PII redaction', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-privacy-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, OLLAMA_URL: '', APP_API_KEY: '' },
    stdio: 'ignore'
  });
  t.after(async () => {
    await stopChildAndRemove(child, dataDir);
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, child);

  const register = await post(`${base}/api/v1/auth/register`, {
    email: `privacy-${Date.now()}@example.test`,
    password: 'TestPass123!',
    store_name: 'Privacy Store'
  });
  assert.equal(register.status, 201);
  const registration = await register.json();
  const token = registration.token;
  const siteResponse = await post(`${base}/api/v1/sites`, { name: 'Privacy Site', industry_template: 'retail' }, {
    authorization: `Bearer ${token}`
  });
  assert.equal(siteResponse.status, 201);
  const site = (await siteResponse.json()).site;

  const consent = await post(`${base}/api/v1/public/${site.embed_key}/consent`, { version: '2026-10-19' });
  assert.equal(consent.status, 200);
  assert.equal((await consent.json()).version, '2026-10-19');

  const message = await post(`${base}/api/v1/public/${site.embed_key}/messages`, { message: 'Where is my parcel?' });
  assert.equal(message.status, 200);

  const retention = await fetch(`${base}/api/v1/privacy/retention`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(retention.status, 200);
  const retentionBody = await retention.json();
  assert.equal(retentionBody.privacyRetentionDays, 365);
  const changedRetention = await fetch(`${base}/api/v1/privacy/retention`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ privacyRetentionDays: 30 })
  });
  assert.equal(changedRetention.status, 200);
  assert.equal((await changedRetention.json()).privacyRetentionDays, 30);

  const exported = await fetch(`${base}/api/v1/privacy/export`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(exported.status, 200);
  const exportBody = await exported.json();
  assert.equal(exportBody.tenant.name, 'Privacy Store');
  assert.equal(exportBody.sites.length, 1);
  assert.equal(exportBody.messages.length, 1);
  assert.ok(exportBody.privacy_consents.length >= 1);
  assert.equal(exportBody.users[0].password_hash, undefined);
  assert.equal(exportBody.users[0].password_salt, undefined);

  const deleted = await fetch(`${base}/api/v1/privacy/messages`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(deleted.status, 200);
  const deletedBody = await deleted.json();
  assert.equal(deletedBody.deleted.messages, 1);

  const after = await (await fetch(`${base}/api/v1/privacy/export`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(after.messages.length, 0);
  assert.equal(after.escalations.length, 0);

  assert.equal(redactPII('mail a@example.test phone +86 138 0013 8000 card 4111 1111 1111 1111'), 'mail [redacted-email] phone [redacted-phone] card [redacted-card]');
});

test('P3-05 retention purge removes stale messages without touching recent ones', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-prune-'));
  const db = openDatabase(path.join(dir, 'relaydesk.sqlite'));
  t.after(async () => {
    closeDatabase(db);
    await fs.rm(dir, { recursive: true, force: true });
  });
  migrateSchema(db);
  seedDatabase(db);
  const dao = createDao(db);
  const tenant = dao.createTenant({ id: 'tenant_prune', name: 'Prune Store', created_at: '2020-01-01T00:00:00.000Z' });
  const site = dao.createSite({
    id: 'site_prune', tenant_id: tenant.id, name: 'Prune Site', industry_template: 'retail',
    embed_key: 'prune-embed', created_at: '2020-01-01T00:00:00.000Z'
  });
  const oldMessageId = 'msg_old';
  dao.createPublicMessage({
    id: oldMessageId, tenant_id: tenant.id, site_id: site.id, embed_key: site.embed_key,
    message: 'old', input_type: 'text', reply: { lang: 'en', text: 'old' }, evidence: [],
    created_at: '2020-01-01T00:00:00.000Z'
  });
  dao.createPublicMessage({
    id: 'msg_recent', tenant_id: tenant.id, site_id: site.id, embed_key: site.embed_key,
    message: 'recent', input_type: 'text', reply: { lang: 'en', text: 'recent' }, evidence: [],
    created_at: new Date().toISOString()
  });
  const purged = dao.purgeExpiredData({ days: 30 });
  assert.equal(purged.messages, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM messages WHERE id = 'msg_recent'").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM messages WHERE id = 'msg_old'").get().c, 0);
});
