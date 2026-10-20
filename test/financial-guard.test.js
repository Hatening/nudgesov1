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

test('FinancialGuard intercepts refund/compensation, returns safe templates and creates urgent financial escalations', async (t) => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-financial-'));
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
    body: JSON.stringify({ email: `qa-financial-${Date.now()}@example.test`, password: 'TestPass123!' })
  });
  assert.equal(register.status, 201);
  const registration = await register.json();
  const auth = { authorization: `Bearer ${registration.access_token}`, 'content-type': 'application/json' };

  const siteResponse = await fetch(`${base}/api/v1/sites`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: 'Financial Guard Site', industry_template: 'retail' })
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

  const chinese = await send('我要退款');
  assert.equal(chinese.status, 'transferred_to_human');
  assert.equal(chinese.need_human, true);
  assert.equal(chinese.reply.lang, 'zh');
  assert.match(chinese.reply.text, /人工专员/);
  assert.doesNotMatch(chinese.reply.text, /已退款|退款成功|保证退款|承诺退款|will refund|guarantee(?:d)? refund/i);
  assert.equal(chinese.category, 'financial');
  assert.equal(chinese.priority, 'urgent');

  const english = await send('I want a cash compensation');
  assert.equal(english.status, 'transferred_to_human');
  assert.equal(english.need_human, true);
  assert.equal(english.reply.lang, 'en');
  assert.match(english.reply.text, /human specialist/i);

  const damaged = await send('我的货破损了，赔我钱');
  assert.equal(damaged.status, 'transferred_to_human');
  assert.equal(damaged.need_human, true);
  assert.equal(damaged.category, 'financial');
  assert.equal(damaged.priority, 'urgent');

  const escalationsResponse = await fetch(`${base}/api/v1/escalations`, { headers: auth });
  assert.equal(escalationsResponse.status, 200);
  const escalations = await escalationsResponse.json();
  const financialCases = escalations.items.filter((item) => item.category === 'financial');
  assert.ok(financialCases.length >= 3);
  const third = financialCases.find((item) => item.message.includes('赔我钱'));
  assert.ok(third, 'damaged-goods financial escalation must exist');
  assert.equal(third.risk_level, 'high');
  assert.equal(third.category, 'financial');
  assert.equal(third.priority, 'urgent');
  assert.equal(third.status, 'pending');
});
