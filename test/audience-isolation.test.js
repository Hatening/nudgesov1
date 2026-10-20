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

test('audience isolation: public buyer window can never retrieve seller knowledge', async (t) => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-audience-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, OLLAMA_URL: '', APP_API_KEY: '' },
    stdio: 'ignore'
  });
  t.after(async () => { await stopChildAndRemove(child, dataDir); });

  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, child);

  // 1) 商家注册 + 建站
  const register = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `qa-audience-${Date.now()}@example.test`, password: 'TestPass123!' })
  });
  assert.equal(register.status, 201);
  const registration = await register.json();
  const auth = { authorization: `Bearer ${registration.token}`, 'content-type': 'application/json' };

  const siteResponse = await fetch(`${base}/api/v1/sites`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: 'QA Audience Site', industry_template: 'retail' })
  });
  assert.equal(siteResponse.status, 201);
  const { site } = await siteResponse.json();
  assert.ok(site.embed_key);

  // 2) 写入两张卡：一张 seller（广告优化），一张 buyer（物流政策）
  const sellerCard = await fetch(`${base}/api/knowledge`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      title: 'ACOS 广告优化手册',
      content: 'ACOS 是广告花费除以广告销售额。降低 ACOS 的方法是先否定高花费零订单的搜索词，再逐步下调出价，并区分新品期与成熟品期。',
      language: 'zh', type: 'faq', audience: 'seller'
    })
  });
  assert.equal(sellerCard.status, 201);
  const sellerItem = (await sellerCard.json()).item;
  assert.equal(sellerItem.audience, 'seller');

  const buyerCard = await fetch(`${base}/api/knowledge`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      title: 'Shipping policy',
      content: 'Standard delivery takes 5-8 business days after dispatch. Tracking is sent by email.',
      language: 'en', type: 'faq', audience: 'buyer'
    })
  });
  assert.equal(buyerCard.status, 201);
  assert.equal((await buyerCard.json()).item.audience, 'buyer');

  // 3) 买家身份（public embed_key）问卖家问题：必须检索不到，并转人工
  const publicAsk = await fetch(`${base}/api/v1/public/${site.embed_key}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'ACOS 广告优化怎么降低？' })
  });
  assert.equal(publicAsk.status, 200);
  const publicReply = await publicAsk.json();
  const publicEvidence = publicReply.evidence || [];
  assert.equal(
    publicEvidence.some((item) => item.id === sellerItem.id || /ACOS/i.test(item.title || '')),
    false,
    `buyer window leaked seller knowledge: ${JSON.stringify(publicEvidence)}`
  );
  assert.equal(publicReply.reply.need_human, true, 'buyer question without buyer knowledge must escalate');
  assert.equal(publicReply.reply.grounded, false);

  // 4) 商家后台提问：应能看到 seller 知识
  const sellerAsk = await fetch(`${base}/api/chat`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ message: 'ACOS 广告优化怎么降低？', language: 'zh' })
  });
  assert.equal(sellerAsk.status, 200);
  const sellerReply = await sellerAsk.json();
  const sellerEvidence = sellerReply.result.evidence || [];
  assert.ok(
    sellerEvidence.some((item) => item.id === sellerItem.id || /ACOS/i.test(item.title || '')),
    `seller dashboard did not see seller knowledge: ${JSON.stringify(sellerEvidence)}`
  );

  // 5) 未鉴权的 /api/chat 也只能拿到买家语料
  const anonAsk = await fetch(`${base}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'ACOS 广告优化怎么降低？', language: 'zh' })
  });
  assert.equal(anonAsk.status, 200);
  const anonReply = await anonAsk.json();
  assert.equal(
    (anonReply.result.evidence || []).some((item) => /ACOS/i.test(item.title || '')),
    false,
    'unauthenticated /api/chat must not expose seller knowledge'
  );
});
