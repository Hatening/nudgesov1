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

test('AC-01 onboarding API: register -> site -> upload -> confirm -> embed', async (t) => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-onboarding-'));
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

  const email = `qa-${Date.now()}@example.test`;
  const password = 'TestPass123!';

  const register = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  assert.equal(register.status, 201);
  const registration = await register.json();
  assert.ok(registration.token);
  assert.equal(registration.user.email, email);
  const auth = { authorization: `Bearer ${registration.token}` };

  const siteResponse = await fetch(`${base}/api/v1/sites`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'QA Site', industry_template: 'restaurant' })
  });
  assert.equal(siteResponse.status, 201);
  const { site } = await siteResponse.json();
  assert.equal(site.industry_template, 'restaurant');
  assert.ok(site.embed_key);

  const uploadResponse = await fetch(`${base}/api/v1/sites/${site.id}/kb/upload`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: 'knowledge.txt',
      title: 'QA knowledge',
      content: 'Store hours: 09:00-21:00. Returns accepted within 30 days.'
    })
  });
  assert.equal(uploadResponse.status, 201);
  const { document: draft } = await uploadResponse.json();
  assert.equal(draft.status, 'draft');

  const confirmResponse = await fetch(`${base}/api/v1/sites/${site.id}/kb/confirm`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ document_id: draft.id })
  });
  assert.equal(confirmResponse.status, 200);
  const { document: confirmed } = await confirmResponse.json();
  assert.equal(confirmed.status, 'confirmed');

  const embedResponse = await fetch(`${base}/api/v1/sites/${site.id}/embed-code`, { headers: auth });
  assert.equal(embedResponse.status, 200);
  const embed = await embedResponse.json();
  assert.match(embed.snippet, /<script[^>]+widget\.js\?key=/);
  assert.match(embed.standalone_url, /^http:\/\/127\.0\.0\.1:/);

  const loginResponse = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  assert.equal(loginResponse.status, 200);
  assert.ok((await loginResponse.json()).token);

  const unauthorized = await fetch(`${base}/api/v1/sites`, { method: 'GET' });
  assert.equal(unauthorized.status, 401);
});
