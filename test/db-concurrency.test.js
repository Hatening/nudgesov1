import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase, closeDatabase } from '../src/db.js';
import { stopChild, removeDir } from '../test-support/cleanup.js';

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

async function spawnServer(port, dataDir) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, OLLAMA_URL: '', APP_API_KEY: '' },
    stdio: 'ignore'
  });
  await waitFor(`http://127.0.0.1:${port}/api/health`, child);
  return child;
}

async function createSite(base, name) {
  const emailName = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const register = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${emailName}-${Date.now()}@example.test`, password: 'TestPass123!' })
  });
  assert.equal(register.status, 201);
  const registration = await register.json();
  const siteResponse = await fetch(`${base}/api/v1/sites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${registration.token}` },
    body: JSON.stringify({ name, industry_template: 'retail' })
  });
  assert.equal(siteResponse.status, 201);
  return (await siteResponse.json()).site;
}

async function postMessage(base, key, message) {
  const response = await fetch(`${base}/api/v1/public/${key}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message })
  });
  assert.equal(response.status, 200);
  return response.json();
}

test('SQLite concurrency: 200 simultaneous HTTP writes preserve every row', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-concurrency-'));
  const port = await freePort();
  const child = await spawnServer(port, dataDir);
  t.after(async () => {
    await stopChild(child);
    await removeDir(dataDir);
  });

  const base = `http://127.0.0.1:${port}`;
  const site = await createSite(base, 'Concurrency Store');
  const normal = Array.from({ length: 100 }, (_, index) => postMessage(base, site.embed_key, `concurrent normal ${index}`));
  const highRisk = Array.from({ length: 100 }, (_, index) => postMessage(base, site.embed_key, `我要退款 ${index}`));
  const results = await Promise.all([...normal, ...highRisk]);
  assert.equal(results.length, 200);
  assert.equal(new Set(results.map((item) => item.message_id)).size, 200);

  const db = openDatabase(path.join(dataDir, 'relaydesk.sqlite'));
  const messageCount = Number(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE source = 'public'").get().count);
  const escalationCount = Number(db.prepare('SELECT COUNT(*) AS count FROM escalations').get().count);
  closeDatabase(db);
  assert.equal(messageCount, 200);
  assert.equal(escalationCount, 100);
});

test('SQLite concurrency: two server processes sharing WAL do not lose writes', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-multiprocess-'));
  const portA = await freePort();
  const portB = await freePort();
  const childA = await spawnServer(portA, dataDir);
  const baseA = `http://127.0.0.1:${portA}`;
  const site = await createSite(baseA, 'Multi Process Store');
  const childB = await spawnServer(portB, dataDir);
  const baseB = `http://127.0.0.1:${portB}`;
  t.after(async () => {
    await stopChild(childA);
    await stopChild(childB);
    await removeDir(dataDir);
  });

  const writesA = Array.from({ length: 100 }, (_, index) => postMessage(baseA, site.embed_key, `process A ${index}`));
  const writesB = Array.from({ length: 100 }, (_, index) => postMessage(baseB, site.embed_key, `process B ${index}`));
  const results = await Promise.all([...writesA, ...writesB]);
  assert.equal(results.length, 200);
  assert.equal(new Set(results.map((item) => item.message_id)).size, 200);

  const db = openDatabase(path.join(dataDir, 'relaydesk.sqlite'));
  const messageCount = Number(db.prepare("SELECT COUNT(*) AS count FROM messages WHERE source = 'public'").get().count);
  closeDatabase(db);
  assert.equal(messageCount, 200);
});
