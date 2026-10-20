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

function makeWav() {
  const sampleRate = 8000;
  const samples = 1600;
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

test('P2 fix: local file ASR + Chinese logistics/hours RAG', async (t) => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-p2fix-'));
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
    body: JSON.stringify({ email: `qa-p2fix-${Date.now()}@example.test`, password: 'TestPass123!' })
  });
  assert.equal(register.status, 201);
  const registration = await register.json();
  const auth = { authorization: `Bearer ${registration.token}`, 'content-type': 'application/json' };

  const siteResponse = await fetch(`${base}/api/v1/sites`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ name: 'QA P2 Fix Site', industry_template: 'retail' })
  });
  assert.equal(siteResponse.status, 201);
  const { site } = await siteResponse.json();

  const addKnowledge = async (filename, title, content) => {
    const upload = await fetch(`${base}/api/v1/sites/${site.id}/kb/upload`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ filename, title, content })
    });
    assert.equal(upload.status, 201);
    const { document } = await upload.json();
    const confirm = await fetch(`${base}/api/v1/sites/${site.id}/kb/confirm`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ document_id: document.id })
    });
    assert.equal(confirm.status, 200);
    assert.equal((await confirm.json()).document.status, 'confirmed');
  };

  await addKnowledge('logistics.txt', '物流时效', '物流：标准快递通常需要 3-5 个工作日送达。');
  await addKnowledge('hours.txt', '营业时间', '营业时间：每天 09:00 - 21:00 营业。');

  const wavBase64 = makeWav().toString('base64');

  const asr = await fetch(`${base}/api/v1/public/${site.embed_key}/asr`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ audio_filename: 'package.wav', audio_base64: wavBase64 })
  });
  assert.equal(asr.status, 200);
  const asrBody = await asr.json();
  assert.equal(asrBody.transcript, '我的包裹什么时候能到？');
  assert.equal(asrBody.provider, 'local-file-fallback');

  const sendText = async (message) => {
    const response = await fetch(`${base}/api/v1/public/${site.embed_key}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message })
    });
    assert.equal(response.status, 200);
    return response.json();
  };

  const packageAnswer = await sendText('我的包裹什么时候能到？');
  assert.match(packageAnswer.reply.text, /3\s*-\s*5\s*个?工作日/);
  assert.equal(packageAnswer.reply.need_human, false);

  const hoursAnswer = await sendText('几点关门？');
  assert.match(hoursAnswer.reply.text, /09:00/);
  assert.match(hoursAnswer.reply.text, /21:00/);
  assert.equal(hoursAnswer.reply.need_human, false);

  const voiceResponse = await fetch(`${base}/api/v1/public/${site.embed_key}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      input_type: 'voice',
      transcript: '我的包裹什么时候能到？',
      audio_filename: 'package.wav',
      audio_size_bytes: makeWav().length
    })
  });
  assert.equal(voiceResponse.status, 200);
  const voice = await voiceResponse.json();
  assert.match(voice.reply.text, /3\s*-\s*5\s*个?工作日/);
  assert.equal(voice.reply.need_human, false);
});
