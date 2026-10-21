import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlmGateway } from '../src/llm.js';

// 本地 Ollama 失败时，complete() 必须自动路由到云端（OpenAI 兼容）provider。
test('llm.complete falls back from unreachable local Ollama to cloud provider', async () => {
  const calls = [];
  const gateway = createLlmGateway({
    env: {
      LLM_PROVIDER: 'ollama',
      OLLAMA_URL: 'http://local-ollama.test',
      OLLAMA_MODEL: 'qwen-local',
      LLM_BASE_URL: 'http://cloud.test/v1',
      LLM_API_KEY: 'cloud-key',
      LLM_MODEL: 'deepseek-flash',
      LLM_RESPONSE_FORMAT: 'json_object',
      LLM_TIMEOUT_MS: '2000',
      LLM_CIRCUIT_FAILURES: '10',
    },
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('local-ollama.test')) {
        throw new Error('connect ECONNREFUSED 127.0.0.1:11434');
      }
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"cards":[{"title":"t","content":"c","tags":[]}]}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
        }),
      };
    },
  });

  const result = await gateway.complete('把资料拆成卡片', { ollamaEnabled: true });
  assert.ok(result && !result.error, 'cloud fallback should succeed');
  assert.equal(result.provider, 'openai');
  assert.equal(result.model, 'deepseek-flash');
  assert.match(result.content, /cards/);
  assert.equal(calls.some((u) => u.includes('local-ollama.test')), true, 'local provider should be tried first');
  assert.equal(calls.some((u) => u.includes('cloud.test')), true, 'cloud provider should be tried second');
});

test('llm.complete returns null when no provider is configured', async () => {
  const gateway = createLlmGateway({ env: { LLM_API_KEY: '', OLLAMA_URL: '' }, fetchImpl: async () => { throw new Error('should not call'); } });
  assert.equal(await gateway.complete('x'), null);
});

test('llm.completeVision reports vision_unavailable without a cloud key', async () => {
  const gateway = createLlmGateway({ env: { LLM_API_KEY: '', OLLAMA_URL: '' }, fetchImpl: async () => { throw new Error('should not call'); } });
  const result = await gateway.completeVision('OCR this', ['data:image/png;base64,AAA']);
  assert.equal(result.error, 'vision_unavailable');
});
