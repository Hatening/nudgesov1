#!/usr/bin/env node
/**
 * 单卡分时复用：Qwen 35B <-> Harrier 27B 一键切换。
 *
 * 用法：
 *   node scripts/switch-model.mjs --model=harrier
 *   node scripts/switch-model.mjs --model=qwen
 *   node scripts/switch-model.mjs --model=harrier --dry-run
 *
 * 环境变量：
 *   LMSTUDIO_LMS        lms.exe 路径（默认 ~/.lmstudio/bin/lms.exe）
 *   LOCAL_BASE_URL      LM Studio API（默认 http://192.168.3.227:3679/v1）
 *   QWEN_MODEL          默认 qwen3.8-35b-a3b@q5_k_m
 *   HARRIER_MODEL       默认 harrier-oss-v1-27b
 *   MODEL_SWITCH_CMD    可选：自定义命令模板，支持 {action} {model}
 *                       （用于远程主机，如 "ssh user@host lms {action} {model}"）
 *
 * 切换期间写 .data/engine-status.json，服务端返回 503 降级提示。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(`--${name}`); return i > -1 && args[i + 1] ? args[i + 1] : fallback; };
const equalsArg = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const modelKey = equalsArg('model', arg('model', ''));
const dryRun = args.includes('--dry-run');
if (!['qwen', 'harrier'].includes(modelKey)) {
  console.error('usage: node scripts/switch-model.mjs --model=qwen|harrier [--dry-run]');
  process.exit(2);
}

const API = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const LMS = process.env.LMSTUDIO_LMS || path.join(process.env.USERPROFILE || '', '.lmstudio', 'bin', 'lms.exe');
const MODELS = {
  qwen: process.env.QWEN_MODEL || 'qwen3.8-35b-a3b@q5_k_m',
  harrier: process.env.HARRIER_MODEL || 'harrier-oss-v1-27b',
};
const STATUS = path.resolve('.data/engine-status.json');
const target = MODELS[modelKey];
const other = MODELS[modelKey === 'qwen' ? 'harrier' : 'qwen'];

function writeStatus(state, message, extra = {}) {
  fs.mkdirSync(path.dirname(STATUS), { recursive: true });
  fs.writeFileSync(STATUS, JSON.stringify({ state, message, model: target, updated_at: new Date().toISOString(), ...extra }, null, 2));
}
function runCommand(command, timeout = 600000) {
  return spawnSync(command, { shell: true, encoding: 'utf8', timeout });
}
async function loadedModels() {
  try {
    const res = await fetch(`${API}/models`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || []).map((m) => m.id);
  } catch { return []; }
}
async function waitForModel(id, timeoutMs = 600000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const models = await loadedModels();
    if (models.some((m) => m === id || m.includes(id))) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}
function switchWithTemplate(action) {
  const template = process.env.MODEL_SWITCH_CMD;
  if (!template) return null;
  const command = template.replaceAll('{action}', action).replaceAll('{model}', target);
  const result = runCommand(command);
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr, command };
}

async function main() {
  console.log(`[switch] ${modelKey} -> ${target}`);
  console.log(`[switch] api=${API} lms=${LMS}`);
  const current = await loadedModels();
  console.log(`[switch] currently loaded: ${current.join(', ') || '(none)'}`);

  if (dryRun) {
    console.log('[dry-run] would unload all, then load', target);
    if (process.env.MODEL_SWITCH_CMD) console.log('[dry-run] template:', process.env.MODEL_SWITCH_CMD.replaceAll('{model}', target));
    return;
  }

  writeStatus('switching', '系统正在升级本地引擎，请稍候', { from: current });
  try {
    let unload = switchWithTemplate('unload');
    if (!unload) {
      if (!fs.existsSync(LMS)) throw new Error(`lms not found: ${LMS}; set LMSTUDIO_LMS or MODEL_SWITCH_CMD`);
      unload = runCommand(`"${LMS}" unload --all`);
    }
    console.log('[switch] unload:', unload.stdout?.trim() || unload.stderr?.trim() || 'ok');
    // 给显存释放留时间
    await new Promise((r) => setTimeout(r, 4000));

    let load = switchWithTemplate('load');
    if (!load) {
      const loadCmd = modelKey === 'harrier'
        ? `"${LMS}" load "${target}" --gpu max --context-length 8192 --yes`
        : `"${LMS}" load "${target}" --gpu max --context-length 32768 --yes`;
      load = runCommand(loadCmd);
    }
    console.log('[switch] load:', load.stdout?.trim() || load.stderr?.trim() || 'ok');

    const ready = await waitForModel(target);
    if (!ready) throw new Error(`model ${target} not visible at ${API}/models within timeout`);
    writeStatus('ready', '本地引擎已就绪', { model: target });
    console.log(`[switch] ready: ${target}`);
  } catch (error) {
    writeStatus('error', `本地引擎切换失败：${error.message}`, { model: target });
    console.error('[switch] failed:', error.message);
    process.exit(1);
  }
}

main();
