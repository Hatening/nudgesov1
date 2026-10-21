import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
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

// 模拟云端 LLM：蒸馏返回两张卡，经营诊断返回 summary，视觉请求返回 OCR 文本
async function startMockLlm() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let text = '';
      try {
        const payload = JSON.parse(body || '{}');
        const content = JSON.stringify(payload.messages || []);
        if (content.includes('image_url')) {
          text = '退货政策：商品需在收货后 30 天内申请退货，且保持未使用状态。\n物流时效：标准配送 5-8 个工作日。';
        } else if (content.includes('经营档案') || content.includes('经营顾问')) {
          text = JSON.stringify({ summary: '你的客单价与目标市场清晰，建议先补齐退货与物流知识卡。', actions: ['上传退货政策', '补齐物流时效', '每周跑一次质量检查'] });
        } else {
          text = JSON.stringify({
            cards: [
              { title: '退货政策', content: '商品需在收货后 30 天内申请退货，且保持未使用状态。', tags: ['退货', '政策'] },
              { title: '物流时效', content: '标准配送在发货后 5-8 个工作日送达，节假日顺延。', tags: ['物流'] },
            ],
          });
        }
      } catch {
        text = '{}';
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
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

test('seller portal: profile form, AI diagnosis, cloud distillation, OCR confirm flow, tenant isolation', async (t) => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-seller-'));
  const mock = await startMockLlm();
  t.after(() => mock.server.close());
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir,
      OLLAMA_URL: '',
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: `http://127.0.0.1:${mock.port}/v1`,
      LLM_API_KEY: 'test-key',
      LLM_MODEL: 'mock-vision',
      LLM_RESPONSE_FORMAT: 'json_object',
      LLM_TIMEOUT_MS: '8000',
      APP_API_KEY: ''
    },
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

  // 2) AI 诊断走云端 mock
  const analyze = await fetch(`${base}/api/v1/tenant-profile/analyze`, {
    method: 'POST', headers: owner.auth, body: '{}'
  });
  assert.equal(analyze.status, 200);
  const analysis = await analyze.json();
  assert.match(analysis.summary, /客单价/);
  assert.ok(Array.isArray(analysis.actions) && analysis.actions.length === 3);

  // 3) 上传 txt 资料 → 云端蒸馏为 2 张卡，强制 draft + tenant_id
  const upload = await fetch(`${base}/api/v1/seller/knowledge/upload`, {
    method: 'POST', headers: owner.auth,
    body: JSON.stringify({
      filename: 'store-faq.txt',
      content: '退货政策：商品需在收货后 30 天内申请退货，且保持未使用状态。\n物流时效：标准配送 5-8 个工作日。'
    })
  });
  assert.equal(upload.status, 201);
  const uploadBody = await upload.json();
  assert.equal(uploadBody.items.length, 2);
  assert.equal(uploadBody.provider, 'openai');
  assert.equal(uploadBody.credits.charged, 7, 'text extraction 2 + cloud distill 5');
  assert.equal(uploadBody.credits.remaining_credits, 93);
  assert.deepEqual(uploadBody.credits.breakdown.map((b) => b.action_type), ['text_extract', 'cloud_distill']);
  const created = uploadBody.items[0];
  assert.equal(created.status, 'draft');
  assert.equal(created.tenant_id, owner.tenantId);
  assert.equal(created.audience, 'seller');

  // 4) 草稿列表可见
  const list = await (await fetch(`${base}/api/v1/seller/knowledge`, { headers: owner.auth })).json();
  assert.ok(list.items.some((item) => item.id === created.id));

  // 5) 草稿不进入检索
  const db = new DatabaseSync(path.join(dataDir, 'relaydesk.sqlite'));
  const row = db.prepare('SELECT status, tenant_id, audience FROM knowledge WHERE id = ?').get(created.id);
  assert.equal(row.status, 'draft');
  assert.equal(row.tenant_id, owner.tenantId);
  assert.equal(db.prepare(`SELECT COUNT(*) c FROM knowledge WHERE id = ? AND status = 'confirmed'`).get(created.id).c, 0);
  const usage = db.prepare('SELECT action_type, credits_consumed FROM tenant_usage WHERE tenant_id = ? ORDER BY rowid').all(owner.tenantId);
  assert.deepEqual(usage.map((u) => [u.action_type, u.credits_consumed]), [['text_extract', 2], ['cloud_distill', 5]]);
  const afterUpload = db.prepare('SELECT monthly_credits, used_credits FROM tenant_profiles WHERE tenant_id = ?').get(owner.tenantId);
  assert.equal(afterUpload.monthly_credits, 100);
  assert.equal(afterUpload.used_credits, 7);
  db.close();

  // 6) OCR 接口：图片 → 云端识别文本（供前端二次确认）
  const ocr = await fetch(`${base}/api/v1/seller/knowledge/ocr`, {
    method: 'POST', headers: owner.auth,
    body: JSON.stringify({ images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='] })
  });
  assert.equal(ocr.status, 200);
  const ocrBody = await ocr.json();
  assert.match(ocrBody.text, /退货政策/);
  assert.equal(ocrBody.pages, 1);
  assert.equal(ocrBody.credits.charged, 10);
  assert.equal(ocrBody.credits.remaining_credits, 83);

  // 7) 确认 OCR 文本后走同一蒸馏入库接口（再扣 2 + 5）
  const confirmedUpload = await fetch(`${base}/api/v1/seller/knowledge/upload`, {
    method: 'POST', headers: owner.auth,
    body: JSON.stringify({ filename: 'scan.png', content: ocrBody.text })
  });
  assert.equal(confirmedUpload.status, 201);
  assert.equal((await confirmedUpload.json()).items.length, 2);

  // 8) 配额门禁：把月额度调到 20，OCR 2 页（20 Credits）与文本上传都应 402
  const quotaDb = new DatabaseSync(path.join(dataDir, 'relaydesk.sqlite'));
  quotaDb.prepare('UPDATE tenant_profiles SET monthly_credits = 20 WHERE tenant_id = ?').run(owner.tenantId);
  const knowledgeBefore = quotaDb.prepare('SELECT COUNT(*) c FROM knowledge WHERE tenant_id = ?').get(owner.tenantId).c;
  const usageBefore = quotaDb.prepare('SELECT COUNT(*) c FROM tenant_usage WHERE tenant_id = ?').get(owner.tenantId).c;
  quotaDb.close();

  const blockedOcr = await fetch(`${base}/api/v1/seller/knowledge/ocr`, {
    method: 'POST', headers: owner.auth,
    body: JSON.stringify({ images: [
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    ] })
  });
  assert.equal(blockedOcr.status, 402);
  const blockedOcrBody = await blockedOcr.json();
  assert.equal(blockedOcrBody.code, 'CREDITS_EXCEEDED');
  assert.match(blockedOcrBody.error, /额度不足/);
  assert.equal(blockedOcrBody.remaining_credits, 0);

  const blockedUpload = await fetch(`${base}/api/v1/seller/knowledge/upload`, {
    method: 'POST', headers: owner.auth,
    body: JSON.stringify({ filename: 'blocked.txt', content: '这是一段会被额度拦截的测试文本，不应产生任何扣费或知识卡。' })
  });
  assert.equal(blockedUpload.status, 402);
  assert.equal((await blockedUpload.json()).code, 'CREDITS_EXCEEDED');

  const quotaDb2 = new DatabaseSync(path.join(dataDir, 'relaydesk.sqlite'));
  assert.equal(quotaDb2.prepare('SELECT COUNT(*) c FROM knowledge WHERE tenant_id = ?').get(owner.tenantId).c, knowledgeBefore, 'blocked uploads must not create cards');
  assert.equal(quotaDb2.prepare('SELECT COUNT(*) c FROM tenant_usage WHERE tenant_id = ?').get(owner.tenantId).c, usageBefore, 'blocked requests must not charge credits');
  quotaDb2.close();

  // 9) 确认入库
  const confirm = await fetch(`${base}/api/v1/seller/knowledge/${encodeURIComponent(created.id)}/confirm`, {
    method: 'POST', headers: owner.auth, body: '{}'
  });
  assert.equal(confirm.status, 200);
  assert.equal((await confirm.json()).item.status, 'confirmed');

  // 10) 租户隔离
  const other = await register(base, `qa-seller-other-${Date.now()}@example.test`);
  const otherList = await (await fetch(`${base}/api/v1/seller/knowledge`, { headers: other.auth })).json();
  assert.equal(otherList.items.some((item) => item.id === created.id), false);
  const otherConfirm = await fetch(`${base}/api/v1/seller/knowledge/${encodeURIComponent(created.id)}/confirm`, {
    method: 'POST', headers: other.auth, body: '{}'
  });
  assert.equal(otherConfirm.status, 404);

  // 10) 未登录拒绝
  assert.equal((await fetch(`${base}/api/v1/seller/knowledge`)).status, 401);
  assert.equal((await fetch(`${base}/api/v1/seller/knowledge/ocr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);

  // 11) bootstrap 带 profile 与 sellerKnowledge
  const bootstrap = await (await fetch(`${base}/api/bootstrap`, { headers: owner.auth })).json();
  assert.equal(bootstrap.profile.business_name, 'Northstar Goods');
  assert.ok(bootstrap.sellerKnowledge.some((item) => item.id === created.id));
});

test('pdf text extraction: FlateDecode text stream still works', () => {
  const content = 'BT /F1 12 Tf (Hello PDF text from RelayDesk) Tj ET';
  const compressed = zlib.deflateSync(Buffer.from(content, 'latin1'));
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + compressed.length + ' /Filter /FlateDecode >>\nstream\n', 'latin1'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')
  ]);
  assert.match(extractPdfText(pdf), /Hello PDF text from RelayDesk/);
});
