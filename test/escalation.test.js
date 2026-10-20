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
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error('server exited before ready');
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server did not become ready');
}

test('AC-03 high-risk refund/complaint creates escalations', async (t) => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-escalation-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      OLLAMA_URL: '',
      APP_API_KEY: ''
    },
    stdio: 'ignore'
  });

  t.after(async () => {
    await stopChildAndRemove(child, dataDir);
  });

  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, child);

  const register = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `qa-esc-${Date.now()}@example.test`, password: 'TestPass123!' })
  });
  assert.equal(register.status, 201);
  const registration = await register.json();
  const auth = { authorization: `Bearer ${registration.token}`, 'content-type': 'application/json' };

  const siteResponse = await fetch(`${base}/api/v1/sites`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: 'QA Escalation Site', industry_template: 'retail' })
  });
  assert.equal(siteResponse.status, 201);
  const { site } = await siteResponse.json();

  const send = async (message) => {
    const response = await fetch(`${base}/api/v1/public/${site.embed_key}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message })
    });
    assert.equal(response.status, 200);
    return response.json();
  };

  const refund = await send('我要退款，订单号 12345');
  assert.equal(refund.reply.need_human, true);
  assert.match(refund.reply.text, /已收到/);
  assert.match(refund.reply.text, /商家会尽快联系|商家会尽快处理/);
  assert.doesNotMatch(refund.reply.text, /可以退款|保证退款|今天处理|赔偿/);
  assert.ok(refund.escalation_id);

  const complaint = await send('我要投诉你们');
  assert.equal(complaint.reply.need_human, true);
  assert.ok(complaint.escalation_id);

  const queueResponse = await fetch(`${base}/api/v1/escalations`, { headers: auth });
  assert.equal(queueResponse.status, 200);
  const queue = await queueResponse.json();
  assert.equal(queue.items.length, 2);
  assert.ok(queue.items.every((item) => item.risk === 'high'));
  assert.ok(queue.items.every((item) => item.status === 'pending'));
  assert.ok(queue.items.some((item) => item.message.includes('退款')));
  assert.ok(queue.items.some((item) => item.message.includes('投诉')));

  const first = queue.items[0];
  const resolveResponse = await fetch(`${base}/api/v1/escalations/${first.id}/status`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ status: 'resolved' })
  });
  assert.equal(resolveResponse.status, 200);
  assert.equal((await resolveResponse.json()).escalation.status, 'resolved');
});
