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

test('RAG isolation: buyer and seller retrieval never cross audiences', async (t) => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-rag-isolation-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, OLLAMA_URL: '', APP_API_KEY: '' },
    stdio: 'ignore'
  });
  t.after(async () => { await stopChildAndRemove(child, dataDir); });

  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, child);

  const register = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `qa-rag-${Date.now()}@example.test`, password: 'TestPass123!' })
  });
  assert.equal(register.status, 201);
  const { token } = await register.json();
  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const siteResponse = await fetch(`${base}/api/v1/sites`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ name: 'QA RAG Site', industry_template: 'retail' })
  });
  assert.equal(siteResponse.status, 201);
  const { site } = await siteResponse.json();

  const createKnowledge = async (payload) => {
    const response = await fetch(`${base}/api/knowledge`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ source_id: 'manual_editor', status: 'confirmed', ...payload })
    });
    assert.equal(response.status, 201);
    return (await response.json()).item;
  };

  const sellerRefund = await createKnowledge({
    title: '退款纠纷处理 SOP',
    content: '卖家运营标准流程：退款纠纷处理先核对订单与物流，再按平台规则升级，客服需在 2 小时内响应并留存处理记录。',
    language: 'zh', type: 'faq', audience: 'seller', category: '退货与退款'
  });
  const sellerAcos = await createKnowledge({
    title: '广告 ACOS 优化手册',
    content: 'ACOS 是广告花费除以广告销售额。降低 ACOS 的方法是先否定高花费零订单的搜索词，再逐步下调出价。',
    language: 'zh', type: 'faq', audience: 'seller', category: '广告与营销'
  });
  const buyerRefund = await createKnowledge({
    title: '退款纠纷处理说明',
    content: '买家退款纠纷处理说明：提交退款申请后，商家会在 3 个工作日内审核；如有争议可申请平台介入。',
    language: 'zh', type: 'faq', audience: 'buyer', category: '退货与退款'
  });
  assert.equal(sellerRefund.audience, 'seller');
  assert.equal(sellerAcos.audience, 'seller');
  assert.equal(buyerRefund.audience, 'buyer');

  const publicMessages = `${base}/api/v1/public/${site.embed_key}/messages`;
  const publicAsk = async (message) => {
    const response = await fetch(publicMessages, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message })
    });
    assert.equal(response.status, 200);
    return response.json();
  };

  // Assertion 1: public buyer asks about refunds. This path is high-risk and may
  // hand off without evidence, but it must never surface seller cards.
  const buyerRefundReply = await publicAsk('退款');
  const buyerRefundEvidence = buyerRefundReply.evidence || [];
  assert.equal(
    buyerRefundEvidence.some((item) => item.id === sellerRefund.id || item.id === sellerAcos.id),
    false,
    `buyer refund question leaked seller knowledge: ${JSON.stringify(buyerRefundEvidence)}`
  );
  assert.equal(
    buyerRefundEvidence.some((item) => /退款纠纷处理 SOP|ACOS/i.test(item.title || '')),
    false,
    'buyer refund question surfaced a seller-only title'
  );

  // Assertion 2: only seller knowledge exists for ACOS. A buyer must get
  // no-match/human handoff, not an unrelated buyer card or a seller card.
  const buyerAcosReply = await publicAsk('怎么投广告 ACOS');
  const buyerAcosEvidence = buyerAcosReply.evidence || [];
  assert.equal(
    buyerAcosEvidence.some((item) => item.id === sellerAcos.id),
    false,
    `buyer ACOS question leaked seller knowledge: ${JSON.stringify(buyerAcosEvidence)}`
  );
  assert.equal(
    buyerAcosEvidence.length,
    0,
    `buyer ACOS question must not substitute unrelated buyer cards: ${JSON.stringify(buyerAcosEvidence)}`
  );
  assert.equal(buyerAcosReply.reply.need_human, true, 'buyer ACOS question must hand off to a human');

  // Assertion 3: an authenticated seller asking about refund disputes must hit
  // the seller operational card first, never the buyer-facing card.
  const sellerResponse = await fetch(`${base}/api/chat`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ message: '退款纠纷处理', language: 'zh' })
  });
  assert.equal(sellerResponse.status, 200);
  const sellerReply = await sellerResponse.json();
  const sellerEvidence = sellerReply.result?.evidence || [];
  assert.ok(sellerEvidence.length > 0, `seller question returned no evidence: ${JSON.stringify(sellerReply)}`);
  assert.equal(sellerEvidence[0].id, sellerRefund.id, `seller question did not rank the seller SOP first: ${JSON.stringify(sellerEvidence)}`);
  assert.equal(
    sellerEvidence.some((item) => item.id === buyerRefund.id),
    false,
    `seller question leaked buyer knowledge: ${JSON.stringify(sellerEvidence)}`
  );
});
