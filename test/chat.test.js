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

test('AC-02 public chat: Chinese message -> Chinese text reply, no auth', async (t) => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-chat-'));
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
    body: JSON.stringify({ email: `qa-chat-${Date.now()}@example.test`, password: 'TestPass123!' })
  });
  assert.equal(register.status, 201);
  const registration = await register.json();
  const auth = { authorization: `Bearer ${registration.token}`, 'content-type': 'application/json' };

  const siteResponse = await fetch(`${base}/api/v1/sites`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: 'QA Chat Site', industry_template: 'restaurant' })
  });
  assert.equal(siteResponse.status, 201);
  const { site } = await siteResponse.json();
  assert.ok(site.embed_key);

  const publicSite = await fetch(`${base}/api/v1/public/${site.embed_key}`);
  assert.equal(publicSite.status, 200);
  const publicSiteData = await publicSite.json();
  assert.ok(publicSiteData.privacy_notice);
  assert.equal(publicSiteData.site.name, 'QA Chat Site');

  const chatResponse = await fetch(`${base}/api/v1/public/${site.embed_key}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: '今天营业到几点？' })
  });
  assert.equal(chatResponse.status, 200);
  const chat = await chatResponse.json();
  assert.equal(chat.status, 'replied');
  assert.equal(chat.reply.lang, 'zh');
  assert.match(chat.reply.text, /[\u4e00-\u9fff]/);

  const messageResponse = await fetch(`${base}/api/v1/public/${site.embed_key}/messages/${chat.message_id}`);
  assert.equal(messageResponse.status, 200);
  const message = await messageResponse.json();
  assert.equal(message.reply.lang, 'zh');

  const audioResponse = await fetch(`${base}/api/v1/public/${site.embed_key}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input_type: 'audio',
      audio_filename: 'voice.wav',
      audio_base64: Buffer.alloc(3200).toString('base64')
    })
  });
  assert.equal(audioResponse.status, 200);
  const audio = await audioResponse.json();
  assert.equal(audio.input_type, 'audio');
  assert.equal(audio.reply.lang, 'zh');
  assert.match(audio.reply.text, /[\u4e00-\u9fff]/);
});
