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

test('/api/insights: public page lists only seller insight cards, never buyer or other categories', async (t) => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-insights-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, OLLAMA_URL: '', APP_API_KEY: '' },
    stdio: 'ignore'
  });
  t.after(async () => { await stopChildAndRemove(child, dataDir); });

  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, child);

  // 公开可读（不需要 token）
  const anonymous = await fetch(`${base}/api/insights`);
  assert.equal(anonymous.status, 200);
  const empty = await anonymous.json();
  assert.ok(Array.isArray(empty.items));
  assert.deepEqual(empty.categories, ['行业洞察', '商业策略']);

  const register = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `qa-insights-${Date.now()}@example.test`, password: 'TestPass123!' })
  });
  assert.equal(register.status, 201);
  const { token } = await register.json();
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const create = (payload) => fetch(`${base}/api/knowledge`, { method: 'POST', headers: auth, body: JSON.stringify(payload) });

  const insight = await create({
    title: 'ACOS 中位数上升后的投放策略',
    content: '把预算拆成防守型与测试型两条线，测试线不超过总预算的 15%。',
    language: 'zh', audience: 'seller', category: '行业洞察'
  });
  assert.equal(insight.status, 201);

  const strategy = await create({
    title: '从铺货到精品的三个拐点',
    content: '单 SKU 月销稳定后锁定期货，退货率超阈值时先修 listing。',
    language: 'zh', audience: 'seller', category: '商业策略'
  });
  assert.equal(strategy.status, 201);

  // 不应出现：seller 但分类不属于洞察；buyer 但分类是行业洞察
  await create({ title: 'Seller ops note', content: 'Internal seller playbook about bids.', audience: 'seller', category: '广告与营销' });
  await create({ title: 'Buyer shipping note', content: 'Buyer facing shipping policy.', audience: 'buyer', category: '行业洞察' });

  const listed = await (await fetch(`${base}/api/insights?limit=24`)).json();
  const titles = listed.items.map((item) => item.title);
  assert.ok(titles.includes('ACOS 中位数上升后的投放策略'));
  assert.ok(titles.includes('从铺货到精品的三个拐点'));
  assert.equal(titles.includes('Seller ops note'), false, 'non-insight category leaked into /api/insights');
  assert.equal(titles.includes('Buyer shipping note'), false, 'buyer knowledge leaked into /api/insights');
  assert.ok(listed.items.every((item) => typeof item.summary === 'string' && item.summary.length > 0));
});
