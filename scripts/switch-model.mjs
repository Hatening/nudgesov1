#!/usr/bin/env node
/**
 * 单卡分时复用：Qwen 35B <-> Harrier 27B 一键切换（LM Studio REST API 优先）。
 *
 * 用法：
 *   node scripts/switch-model.mjs --model=harrier
 *   node scripts/switch-model.mjs --model=qwen
 *   node scripts/switch-model.mjs --model=harrier --dry-run
 *
 * 环境变量：
 *   LOCAL_BASE_URL  默认 http://192.168.3.227:3679/v1
 *   LM_API_TOKEN    LM Studio API token（如启用了鉴权）
 *   QWEN_MODEL      默认 qwen3.8-35b-a3b@q5_k_m
 *   HARRIER_MODEL   默认 text-embedding-harrier-27b
 *   MODEL_SWITCH_CMD  REST 失败时的兜底命令模板，支持 {action} {model}
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i > -1 && args[i + 1] ? args[i + 1] : fallback; };
const equalsArg = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const modelKey = equalsArg('model', arg('model', ''));
const dryRun = args.includes('--dry-run');
if (!['qwen', 'harrier'].includes(modelKey)) {
  console.error('usage: node scripts/switch-model.mjs --model=qwen|harrier [--dry-run]');
  process.exit(2);
}

const API = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const ORIGIN = API.replace(/\/v1$/, '');
const TOKEN = process.env.LM_API_TOKEN || '';
const MODELS = {
  qwen: process.env.QWEN_MODEL || 'qwen3.8-35b-a3b@q5_k_m',
  harrier: process.env.HARRIER_MODEL || 'text-embedding-harrier-27b',
};
const target = MODELS[modelKey];
const STATUS = path.resolve('.data/engine-status.json');

function writeStatus(state, message, extra = {}) {
  fs.mkdirSync(path.dirname(STATUS), { recursive: true });
  fs.writeFileSync(STATUS, JSON.stringify({ state, message, model: target, updated_at: new Date().toISOString(), ...extra }, null, 2));
}
function headers() {
  const h = { 'content-type': 'application/json' };
  if (TOKEN) h.authorization = `Bearer ${TOKEN}`;
  return h;
}
async function lm(pathname, options = {}) {
  const res = await fetch(`${ORIGIN}${pathname}`, { ...options, headers: { ...headers(), ...(options.headers || {}) }, signal: AbortSignal.timeout(120000) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${pathname} HTTP ${res.status}: ${String(text).slice(0, 300)}`);
  return body;
}
async function listModels() {
  const data = await lm('/api/v0/models');
  return data.data || [];
}
async function waitLoaded(id, timeoutMs = 600000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const models = await listModels();
    const hit = models.find((m) => m.id === id);
    if (hit?.state === 'loaded') return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}
function fallback(action, extra = {}) {
  const template = process.env.MODEL_SWITCH_CMD;
  if (!template) return false;
  const command = template.replaceAll('{action}', action).replaceAll('{model}', target);
  const result = spawnSync(command, { shell: true, encoding: 'utf8', timeout: 600000 });
  if (result.status !== 0) throw new Error(`fallback ${action} failed: ${result.stderr}`);
  return true;
}

async function main() {
  console.log(`[switch] ${modelKey} -> ${target}`);
  console.log(`[switch] api=${ORIGIN}`);
  const models = await listModels();
  const loaded = models.filter((m) => m.state === 'loaded');
  console.log(`[switch] loaded: ${loaded.map((m) => m.id).join(', ') || '(none)'}`);

  if (dryRun) {
    console.log(`[dry-run] unload: ${loaded.map((m) => m.id).join(', ') || '(none)'}`);
    console.log(`[dry-run] load: ${target}`);
    return;
  }

  writeStatus('switching', '系统正在升级本地引擎，请稍候', { from: loaded.map((m) => m.id) });
  try {
    for (const model of loaded) {
      console.log(`[switch] unload ${model.id}`);
      await lm('/api/v1/models/unload', { method: 'POST', body: JSON.stringify({ instance_id: model.id }) });
    }
    await new Promise((r) => setTimeout(r, 3000));

    const contextLength = modelKey === 'harrier' ? 8192 : 32768;
    const loadBody = { model: target, context_length: contextLength };
    if (modelKey === 'qwen') loadBody.flash_attention = true;
    console.log(`[switch] load ${target} (context ${contextLength})`);
    try {
      await lm('/api/v1/models/load', { method: 'POST', body: JSON.stringify(loadBody) });
    } catch (error) {
      console.error(`[switch] REST load failed: ${error.message}`);
      if (!fallback('load')) throw error;
    }

    if (!await waitLoaded(target)) throw new Error(`model ${target} not loaded within timeout`);
    writeStatus('ready', '本地引擎已就绪', { model: target });
    console.log(`[switch] ready: ${target}`);
  } catch (error) {
    writeStatus('error', `本地引擎切换失败：${error.message}`, { model: target });
    console.error('[switch] failed:', error.message);
    process.exit(1);
  }
}

main();
