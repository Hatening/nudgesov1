import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase, migrateSchema, seedDatabase, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
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

test('P3-06 observability: request IDs, metrics endpoint and SQLite backup', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-ops-'));
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

  const health = await fetch(`${base}/api/health`);
  assert.match(health.headers.get('x-request-id') || '', /\S+/);
  await fetch(`${base}/api/bootstrap`);
  const metricsResponse = await fetch(`${base}/api/ops/metrics`);
  assert.equal(metricsResponse.status, 200);
  const metrics = await metricsResponse.json();
  assert.ok(metrics.requests_total >= 2);
  assert.ok(metrics.latency_ms.p95 >= 0);
  assert.equal(metrics.sqlite.journal_mode, 'wal');
  assert.equal(metrics.database.tenants, 1);
  assert.equal(metrics.llm.configured, false);
  assert.ok(metrics.status_counts['200'] >= 1);

  const backupDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-backup-'));
  const dbPath = path.join(backupDir, 'source.sqlite');
  const outPath = path.join(backupDir, 'snapshot.sqlite');
  const db = openDatabase(dbPath);
  migrateSchema(db);
  seedDatabase(db);
  const dao = createDao(db);
  const tenant = dao.createTenant({ id: 'tenant_backup', name: 'Backup Store', created_at: new Date().toISOString() });
  dao.createSite({ id: 'site_backup', tenant_id: tenant.id, name: 'Backup Site', industry_template: 'retail', embed_key: 'backup-key', created_at: new Date().toISOString() });
  dao.createPublicMessage({
    id: 'msg_backup', tenant_id: tenant.id, site_id: 'site_backup', embed_key: 'backup-key',
    message: 'backup me', input_type: 'text', reply: { lang: 'en', text: 'ok' }, evidence: [],
    created_at: new Date().toISOString()
  });
  closeDatabase(db);

  const output = execFileSync(process.execPath, ['scripts/backup-sqlite.mjs', '--db', dbPath, '--out', outPath], {
    cwd: root,
    encoding: 'utf8'
  });
  assert.match(output, /"ok": true/);
  const stat = await fs.stat(outPath);
  assert.ok(stat.size > 0);
  const check = openDatabase(outPath);
  assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(check.prepare("SELECT COUNT(*) AS c FROM messages WHERE id = 'msg_backup'").get().c, 1);
  closeDatabase(check);
  await fs.rm(backupDir, { recursive: true, force: true });
});
