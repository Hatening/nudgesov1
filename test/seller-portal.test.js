import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { stopChildAndRemove } from '../test-support/cleanup.js';
import { extractPdfText } from '../src/pdf-text.js';

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

async function register(base, email) {
  const res = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'TestPass123!' })
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  return { token: body.token, tenantId: body.user.tenant_id, auth: { authorization: `Bearer ${body.token}`, 'content-type': 'application/json' } };
}

test('seller portal: profile form, AI diagnosis fallback, tenant knowledge upload draft -> confirm', async (t) => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-seller-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, OLLAMA_URL: '', APP_API_KEY: '' },
    stdio: 'ignore'
  });
  t.after(async () => { await stopChildAndRemove(child, dataDir); });

  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, child);
  const owner = await register(base, `qa-seller-${Date.now()}@example.test`);

  // 1) 经营概况：初始为空 → 保存 → 回读
  const emptyProfile = await (await fetch(`${base}/api/v1/tenant-profile`, { headers: owner.auth })).json();
  assert.equal(emptyProfile.profile, null);

  const saved = await fetch(`${base}/api/v1/tenant-profile`, {
    method: 'PUT', headers: owner.auth,
    body: JSON.stringify({
      business_name: 'Northstar Goods',
      monthly_revenue: '客单价 $35 / 月营收 $50k',
      categories: '家居、宠物用品',
      markets: ['US', 'EU', 'JP'],
      platforms: ['Amazon', 'Shopify'],
      team_size: 5,
      goals: '3 个月内把 ACOS 压到 25% 以下'
    })
  });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.profile.business_name, 'Northstar Goods');
  assert.deepEqual(savedBody.profile.markets, ['US', 'EU', 'JP']);
  assert.equal(savedBody.profile.team_size, 5);

  const reread = await (await fetch(`${base}/api/v1/tenant-profile`, { headers: owner.auth })).json();
  assert.equal(reread.profile.categories, '家居、宠物用品');

  // 2) AI 诊断（无 LLM 时走确定性兜底）
  const analyze = await fetch(`${base}/api/v1/tenant-profile/analyze`, {
    method: 'POST', headers: owner.auth, body: '{}'
  });
  assert.equal(analyze.status, 200);
  const analysis = await analyze.json();
  assert.ok(analysis.summary.length > 10);
  assert.ok(Array.isArray(analysis.actions) && analysis.actions.length >= 1);

  // 3) 上传 txt 资料 → 强制 draft + 强制 tenant_id
  const upload = await fetch(`${base}/api/v1/seller/knowledge/upload`, {
    method: 'POST', headers: owner.auth,
    body: JSON.stringify({
      filename: 'store-faq.txt',
      content: '退货政策：商品需在收货后 30 天内申请退货，且保持未使用状态。\n物流时效：标准配送 5-8 个工作日。'
    })
  });
  assert.equal(upload.status, 201);
  const uploadBody = await upload.json();
  assert.ok(uploadBody.items.length >= 1);
  const created = uploadBody.items[0];
  assert.equal(created.status, 'draft');
  assert.equal(created.tenant_id, owner.tenantId);
  assert.equal(created.audience, 'seller');

  // 4) 草稿列表可见
  const list = await (await fetch(`${base}/api/v1/seller/knowledge`, { headers: owner.auth })).json();
  assert.ok(list.items.some((item) => item.id === created.id));

  // 5) 草稿不进入检索：直接读库验证 status + 检索口径
  const db = new DatabaseSync(path.join(dataDir, 'relaydesk.sqlite'));
  const row = db.prepare('SELECT status, tenant_id, audience FROM knowledge WHERE id = ?').get(created.id);
  assert.equal(row.status, 'draft');
  assert.equal(row.tenant_id, owner.tenantId);
  const retrievable = db.prepare(`SELECT COUNT(*) c FROM knowledge WHERE id = ? AND status = 'confirmed'`).get(created.id).c;
  assert.equal(retrievable, 0);
  db.close();

  // 6) 确认入库
  const confirm = await fetch(`${base}/api/v1/seller/knowledge/${encodeURIComponent(created.id)}/confirm`, {
    method: 'POST', headers: owner.auth, body: '{}'
  });
  assert.equal(confirm.status, 200);
  const confirmed = await confirm.json();
  assert.equal(confirmed.item.status, 'confirmed');

  // 7) 租户隔离：另一个商家看不到、也不能确认
  const other = await register(base, `qa-seller-other-${Date.now()}@example.test`);
  const otherList = await (await fetch(`${base}/api/v1/seller/knowledge`, { headers: other.auth })).json();
  assert.equal(otherList.items.some((item) => item.id === created.id), false);
  const otherConfirm = await fetch(`${base}/api/v1/seller/knowledge/${encodeURIComponent(created.id)}/confirm`, {
    method: 'POST', headers: other.auth, body: '{}'
  });
  assert.equal(otherConfirm.status, 404);

  // 8) 未登录不能访问
  const anon = await fetch(`${base}/api/v1/seller/knowledge`);
  assert.equal(anon.status, 401);

  // 9) bootstrap 带上 profile 与 sellerKnowledge
  const bootstrap = await (await fetch(`${base}/api/bootstrap`, { headers: owner.auth })).json();
  assert.equal(bootstrap.profile.business_name, 'Northstar Goods');
  assert.ok(bootstrap.sellerKnowledge.some((item) => item.id === created.id));
});

test('pdf text extraction: FlateDecode text stream', () => {
  const content = 'BT /F1 12 Tf (Hello PDF text from RelayDesk) Tj ET';
  const compressed = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + compressed.length + ' /Filter /FlateDecode >>\nstream\n', 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')
  ]);
  const text = extractPdfText(pdf);
  assert.match(text, /Hello PDF text from RelayDesk/);
});
