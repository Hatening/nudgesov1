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

async function post(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

test('P3-03 security: rate limits, Retry-After and security headers', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-security-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      OLLAMA_URL: '',
      APP_API_KEY: '',
      RATE_LIMIT_WINDOW_MS: '60000',
      RATE_LIMIT_AUTH_MAX: '3',
      RATE_LIMIT_PUBLIC_MAX: '5',
      RATE_LIMIT_ASR_MAX: '3',
      RATE_LIMIT_V1_MAX: '1000',
      RATE_LIMIT_LEGACY_MAX: '4'
    },
    stdio: 'ignore'
  });
  t.after(async () => {
    await stopChildAndRemove(child, dataDir);
  });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, child);

  const page = await fetch(`${base}/chat.html`);
  assert.equal(page.status, 200);
  for (const header of ['content-security-policy', 'x-content-type-options', 'referrer-policy', 'x-frame-options', 'permissions-policy']) {
    assert.ok(page.headers.get(header), `missing ${header}`);
  }

  const register = await post(`${base}/api/v1/auth/register`, {
    email: `security-${Date.now()}@example.test`,
    password: 'TestPass123!'
  });
  assert.equal(register.status, 201);
  const registration = await register.json();
  const token = registration.token;

  const siteResponse = await post(`${base}/api/v1/sites`, { name: 'Rate Limit Site', industry_template: 'retail' }, {
    authorization: `Bearer ${token}`
  });
  assert.equal(siteResponse.status, 201);
  const site = (await siteResponse.json()).site;

  for (let i = 0; i < 5; i++) {
    const response = await post(`${base}/api/v1/public/${site.embed_key}/messages`, { message: `rate ${i}` });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-ratelimit-limit'), '5');
  }
  const limited = await post(`${base}/api/v1/public/${site.embed_key}/messages`, { message: 'too many' });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);

  // Auth limit counts register + login in the same window.
  const login1 = await post(`${base}/api/v1/auth/login`, { email: `security-${Date.now()}@example.test`, password: 'wrong' });
  assert.ok([401, 429].includes(login1.status));
  const login2 = await post(`${base}/api/v1/auth/login`, { email: `security-${Date.now()}@example.test`, password: 'wrong' });
  const login3 = await post(`${base}/api/v1/auth/login`, { email: `security-${Date.now()}@example.test`, password: 'wrong' });
  assert.equal(login3.status, 429);

  // Legacy API has its own bucket; health is exempt.
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
  const legacyStatuses = [];
  for (let i = 0; i < 5; i++) {
    legacyStatuses.push((await fetch(`${base}/api/bootstrap`)).status);
  }
  assert.equal(legacyStatuses[4], 429);
});
