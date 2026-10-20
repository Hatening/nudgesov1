import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createLlmGateway } from '../src/llm.js';
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

function startMockProvider(mode = 'openai-ok') {
  const state = { calls: [], mode };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}
    state.calls.push({ url: req.url, headers: req.headers, body: parsed });
    if (mode === 'openai-fail') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end('{"error":"mock failure"}');
      return;
    }
    if (req.url.endsWith('/chat/completions') && parsed.stream === true) {
      const content = JSON.stringify({ answer: '营业时间是每天 09:00-21:00。', confidence: 0.93, needs_human: false });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (let offset = 0; offset < content.length; offset += 12) {
        const delta = content.slice(offset, offset + 12);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    if (req.url.endsWith('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ answer: '营业时间是每天 09:00-21:00。', confidence: 0.93, needs_human: false }) } }],
        usage: { prompt_tokens: 40, completion_tokens: 20 }
      }));
      return;
    }
    if (req.url.endsWith('/api/chat')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        message: { content: JSON.stringify({ answer: '营业时间是每天 09:00-21:00。', confidence: 0.9, needs_human: false }) },
        prompt_eval_count: 30,
        eval_count: 15
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, state }));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  });
}

test('P3-04 LLM gateway: OpenAI-compatible, Ollama, grounding and circuit fallback', async (t) => {
  const mock = await startMockProvider('openai-ok');
  t.after(async () => closeServer(mock.server));
  const hits = [{ id: 'kb_hours', title: '营业时间', content: '营业时间：每天 09:00-21:00。' }];

  const openai = createLlmGateway({
    env: {
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: `http://127.0.0.1:${mock.port}/v1`,
      LLM_MODEL: 'mock-model',
      LLM_API_KEY: 'test-key',
      LLM_TIMEOUT_MS: '2000'
    }
  });
  const result = await openai.answer('几点关门？', hits, 'zh', {});
  assert.equal(result.answer, '营业时间是每天 09:00-21:00。');
  assert.equal(result.provider, 'openai');
  assert.equal(result.model, 'mock-model');
  assert.equal(result.grounded, true);
  assert.equal(mock.state.calls.length, 1);
  assert.equal(mock.state.calls[0].headers.authorization, 'Bearer test-key');
  assert.match(JSON.stringify(mock.state.calls[0].body), /09:00-21:00/);
  assert.match(JSON.stringify(mock.state.calls[0].body), /Use ONLY/);
  assert.deepEqual(await openai.answer('no evidence', [], 'en', {}), { error: 'no_evidence', provider: 'openai' });

  const streamTokens = [];
  const streamed = await openai.stream('几点关门？', hits, 'zh', {}, (token) => streamTokens.push(token));
  assert.equal(streamed.answer, '营业时间是每天 09:00-21:00。');
  assert.ok(streamTokens.length > 1);
  assert.match(streamTokens.join(''), /09:00-21:00/);

  const ollama = createLlmGateway({
    env: { LLM_PROVIDER: 'ollama', OLLAMA_URL: `http://127.0.0.1:${mock.port}`, OLLAMA_MODEL: 'mock-qwen', LLM_TIMEOUT_MS: '2000' }
  });
  const ollamaResult = await ollama.answer('几点关门？', hits, 'zh', {});
  assert.equal(ollamaResult.provider, 'ollama');
  assert.equal(ollamaResult.model, 'mock-qwen');

  const failing = await startMockProvider('openai-fail');
  t.after(async () => closeServer(failing.server));
  const broken = createLlmGateway({
    env: {
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: `http://127.0.0.1:${failing.port}/v1`,
      LLM_MODEL: 'broken-model',
      LLM_API_KEY: 'test-key',
      LLM_TIMEOUT_MS: '1000',
      LLM_CIRCUIT_FAILURES: '3',
      LLM_CIRCUIT_COOLDOWN_MS: '60000'
    }
  });
  for (let i = 0; i < 3; i++) {
    const failure = await broken.answer('几点关门？', hits, 'zh', {});
    assert.ok(failure.error);
  }
  const circuit = await broken.answer('几点关门？', hits, 'zh', {});
  assert.equal(circuit.error, 'circuit_open');
  assert.equal(broken.status().circuit_open, true);
});

test('P3-04 LLM gateway: server /api/chat uses configured provider and returns model name', async (t) => {
  const mock = await startMockProvider('openai-ok');
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relaydesk-llm-integration-'));
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
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: `http://127.0.0.1:${mock.port}/v1`,
      LLM_MODEL: 'mock-integration-model',
      LLM_API_KEY: 'test-key',
      LLM_TIMEOUT_MS: '2000'
    },
    stdio: 'ignore'
  });
  t.after(async () => {
    await stopChildAndRemove(child, dataDir);
    await closeServer(mock.server);
  });
  await waitFor(`http://127.0.0.1:${port}/api/health`, child);
  const response = await fetch(`http://127.0.0.1:${port}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Where is my tracking number?', language: 'en' })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.result.model, 'mock-integration-model');
  assert.match(body.result.answer, /营业时间/);
  assert.ok(body.result.evidence.length > 0);

  const streamResponse = await fetch(`http://127.0.0.1:${port}/api/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Where is my tracking number?', language: 'en' })
  });
  assert.equal(streamResponse.status, 200);
  assert.match(streamResponse.headers.get('content-type') || '', /text\/event-stream/);
  const streamText = await streamResponse.text();
  assert.match(streamText, /"token"/);
  assert.match(streamText, /"done":true/);
  assert.match(streamText, /mock-integration-model/);
});
