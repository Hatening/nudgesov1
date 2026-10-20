import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openDatabase, closeDatabase } from '../src/db.js';
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

async function startServer(dataDir, extraEnv = {}) {
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
      ...extraEnv
    },
    stdio: 'ignore'
  });
  await waitFor(`http://127.0.0.1:${port}/api/health`, child);
  return { child, base: `http://127.0.0.1:${port}` };
}

async function postJson(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

async function registerOwner(base, label) {
  const response = await postJson(`${base}/api/v1/auth/register`, {
    email: `${label}-${Date.now()}@example.test`,
    password: 'TestPass123!',
    store_name: `${label} Store`
  });
  assert.equal(response.status, 201);
  return { body: await response.json(), response };
}

async function createSite(base, token, name) {
  const response = await postJson(`${base}/api/v1/sites`, { name, industry_template: 'retail' }, {
    authorization: `Bearer ${token}`
  });
  assert.equal(response.status, 201);
  return (await response.json()).site;
}

test('P3-02 auth/RBAC: tenant isolation, roles, refresh/revoke, cookie CSRF, production fail-closed', async (t) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-auth-'));
  const { child, base } = await startServer(dataDir);
  t.after(async () => {
    await stopChildAndRemove(child, dataDir);
  });

  const ownerA = await registerOwner(base, 'owner-a');
  const ownerB = await registerOwner(base, 'owner-b');
  const tokenA = ownerA.body.token;
  const tokenB = ownerB.body.token;
  assert.ok(ownerA.body.csrf_token);
  const setCookieA = ownerA.response.headers.get('set-cookie') || '';
  assert.match(setCookieA, /rd_session=/);
  assert.match(setCookieA, /HttpOnly/i);

  const siteA = await createSite(base, tokenA, 'Owner A Site');
  const siteB = await createSite(base, tokenB, 'Owner B Site');

  // Tenant isolation: A cannot touch B's site or queue.
  const crossUpload = await postJson(`${base}/api/v1/sites/${siteB.id}/kb/upload`, {
    filename: 'x.txt', title: 'x', content: 'should not cross tenant'
  }, { authorization: `Bearer ${tokenA}` });
  assert.equal(crossUpload.status, 404);

  const risk = await postJson(`${base}/api/v1/public/${siteB.embed_key}/messages`, { message: '我要退款' });
  assert.equal(risk.status, 200);
  const riskBody = await risk.json();
  assert.ok(riskBody.escalation_id);

  const queueA = await (await fetch(`${base}/api/v1/escalations`, { headers: { authorization: `Bearer ${tokenA}` } })).json();
  const queueB = await (await fetch(`${base}/api/v1/escalations`, { headers: { authorization: `Bearer ${tokenB}` } })).json();
  assert.equal(queueA.items.length, 0);
  assert.equal(queueB.items.length, 1);
  const crossStatus = await postJson(`${base}/api/v1/escalations/${riskBody.escalation_id}/status`, { status: 'resolved' }, {
    authorization: `Bearer ${tokenA}`
  });
  assert.equal(crossStatus.status, 404);

  // RBAC: viewer can read, cannot create sites; admin can.
  const db = openDatabase(path.join(dataDir, 'relaydesk.sqlite'));
  db.prepare("UPDATE users SET role = 'viewer' WHERE id = ?").run(ownerA.body.user.id);
  closeDatabase(db);
  const viewerCreate = await postJson(`${base}/api/v1/sites`, { name: 'Forbidden', industry_template: 'retail' }, {
    authorization: `Bearer ${tokenA}`
  });
  assert.equal(viewerCreate.status, 403);
  const viewerRead = await fetch(`${base}/api/v1/sites`, { headers: { authorization: `Bearer ${tokenA}` } });
  assert.equal(viewerRead.status, 200);
  const db2 = openDatabase(path.join(dataDir, 'relaydesk.sqlite'));
  db2.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(ownerA.body.user.id);
  closeDatabase(db2);
  const adminCreate = await postJson(`${base}/api/v1/sites`, { name: 'Admin Site', industry_template: 'retail' }, {
    authorization: `Bearer ${tokenA}`
  });
  assert.equal(adminCreate.status, 201);

  // Cookie auth + CSRF protection.
  const login = await postJson(`${base}/api/v1/auth/login`, { email: ownerA.body.user.email, password: 'TestPass123!' });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const cookieMe = await fetch(`${base}/api/v1/auth/me`, { headers: { cookie } });
  assert.equal(cookieMe.status, 200);
  const cookieWriteNoCsrf = await postJson(`${base}/api/v1/sites`, { name: 'No CSRF', industry_template: 'retail' }, { cookie });
  assert.equal(cookieWriteNoCsrf.status, 403);
  const cookieWriteCsrf = await postJson(`${base}/api/v1/sites`, { name: 'With CSRF', industry_template: 'retail' }, {
    cookie,
    'x-csrf-token': loginBody.csrf_token
  });
  assert.equal(cookieWriteCsrf.status, 201);

  // Refresh token rotation: access expires in 15m, refresh in 30d; old access is revoked.
  const refresh = await postJson(`${base}/api/v1/auth/refresh`, { refresh_token: ownerB.body.refresh_token });
  assert.equal(refresh.status, 200);
  const refreshBody = await refresh.json();
  assert.notEqual(refreshBody.access_token, tokenB);
  assert.notEqual(refreshBody.refresh_token, ownerB.body.refresh_token);
  assert.equal(refreshBody.expires_in, 900);
  assert.equal(refreshBody.refresh_expires_in, 2592000);
  assert.equal((await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${tokenB}` } })).status, 401);
  assert.equal((await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${refreshBody.access_token}` } })).status, 200);

  // Logout-all revokes the refreshed access token.
  const logoutAll = await postJson(`${base}/api/v1/auth/logout-all`, {}, { authorization: `Bearer ${refreshBody.access_token}` });
  assert.equal(logoutAll.status, 200);
  assert.equal((await fetch(`${base}/api/v1/auth/me`, { headers: { authorization: `Bearer ${refreshBody.access_token}` } })).status, 401);
  const reuse = await postJson(`${base}/api/v1/auth/refresh`, { refresh_token: ownerB.body.refresh_token });
  assert.equal(reuse.status, 401);
  assert.match((await reuse.json()).error, /reuse|invalid/i);

  // Production without APP_API_KEY: health stays public; legacy API fails closed.
  const prodDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-prod-'));
  const prod = await startServer(prodDir, { NODE_ENV: 'production', APP_API_KEY: '' });
  try {
    assert.equal((await fetch(`${prod.base}/api/health`)).status, 200);
    assert.equal((await fetch(`${prod.base}/api/bootstrap`)).status, 401);
    const prodAuth = await postJson(`${prod.base}/api/v1/auth/register`, {
      email: `prod-dashboard-${Date.now()}@example.test`,
      password: 'TestPass123!'
    });
    assert.equal(prodAuth.status, 201);
    const prodSession = await prodAuth.json();
    const bearerBootstrap = await fetch(`${prod.base}/api/bootstrap`, {
      headers: { authorization: `Bearer ${prodSession.token}` }
    });
    assert.equal(bearerBootstrap.status, 200);
  } finally {
    await stopChildAndRemove(prod.child, prodDir);
  }
});
