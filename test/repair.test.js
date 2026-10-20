import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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

test('P0.5 auto-repair webhook: secret, queue file and PII redaction', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-repair-'));
  const queueDir = path.join(dataDir, 'repair-queue');
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      REPAIR_QUEUE_DIR: queueDir,
      REPAIR_WEBHOOK_SECRET: 'repair-test-secret',
      REPAIR_WORKER_ENABLED: '0',
      APP_API_KEY: '',
      OLLAMA_URL: ''
    },
    stdio: 'ignore'
  });
  t.after(async () => {
    await stopChildAndRemove(child, dataDir);
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, child);

  const body = {
    event: 'error',
    severity: 'high',
    service: 'relaydesk',
    fingerprint: 'checkout-500',
    message: 'checkout failed for customer a@example.test',
    source: 'prometheus'
  };
  const noSecret = await fetch(`${base}/api/ops/repair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  assert.equal(noSecret.status, 401);

  const wrongSecret = await fetch(`${base}/api/ops/repair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-repair-secret': 'wrong' },
    body: JSON.stringify(body)
  });
  assert.equal(wrongSecret.status, 401);

  const queued = await fetch(`${base}/api/ops/repair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-repair-secret': 'repair-test-secret' },
    body: JSON.stringify(body)
  });
  assert.equal(queued.status, 202);
  const result = await queued.json();
  assert.match(result.incident_id, /^repair_/);
  assert.equal(result.worker, 'disabled');

  const files = (await fs.readdir(queueDir)).filter((name) => name.endsWith('.json'));
  assert.equal(files.length, 1);
  const incident = JSON.parse(await fs.readFile(path.join(queueDir, files[0]), 'utf8'));
  assert.equal(incident.event, 'error');
  assert.equal(incident.service, 'relaydesk');
  assert.match(incident.message, /\[redacted-email\]/);
  assert.equal(incident.fingerprint, 'checkout-500');
});
