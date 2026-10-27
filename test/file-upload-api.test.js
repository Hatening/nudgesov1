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

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    centrals.push({ name: nameBytes, dataLength: data.length, offset });
    offset += local.length + nameBytes.length + data.length;
  }
  const centralParts = [];
  for (const entry of centrals) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(entry.dataLength, 20);
    central.writeUInt32LE(entry.dataLength, 24);
    central.writeUInt16LE(entry.name.length, 28);
    central.writeUInt32LE(entry.offset, 42);
    centralParts.push(central, entry.name);
  }
  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, end]);
}

function docx(text) {
  return makeZip({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`
  });
}

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

test('onboarding knowledge API accepts a multipart DOCX and returns a draft', async (t) => {
  const port = await freePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-upload-api-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, OLLAMA_URL: '', APP_API_KEY: '' },
    stdio: 'ignore'
  });
  t.after(async () => { await stopChildAndRemove(child, dataDir); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/health`, child);

  const register = await fetch(`${base}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `upload-${Date.now()}@example.test`, password: 'TestPass123!' })
  });
  assert.equal(register.status, 201);
  const registration = await register.json();
  const auth = { authorization: `Bearer ${registration.token}` };

  const siteResponse = await fetch(`${base}/api/v1/sites`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Upload Site', industry_template: 'retail' })
  });
  assert.equal(siteResponse.status, 201);
  const { site } = await siteResponse.json();

  const form = new FormData();
  form.append('file', new Blob([docx('Shipping takes 3-5 days. Returns accepted within 30 days.')], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }), 'policy.docx');
  form.append('title', 'Policy');
  const upload = await fetch(`${base}/api/v1/sites/${site.id}/kb/upload`, {
    method: 'POST',
    headers: auth,
    body: form
  });
  assert.equal(upload.status, 201);
  const payload = await upload.json();
  assert.equal(payload.file_type, 'docx');
  assert.match(payload.document.content, /Shipping takes 3-5 days/);

  const legacy = new FormData();
  legacy.append('file', new Blob([Buffer.from('old')], { type: 'application/msword' }), 'old.doc');
  const legacyResponse = await fetch(`${base}/api/v1/sites/${site.id}/kb/upload`, {
    method: 'POST',
    headers: auth,
    body: legacy
  });
  assert.equal(legacyResponse.status, 415);
  assert.equal((await legacyResponse.json()).code, 'UNSUPPORTED_LEGACY_FORMAT');
});
