#!/usr/bin/env node
/**
 * 云端兜底（机制一）：读取 reports/retrofit/failed_pool.jsonl，
 * 用 DeepSeek V4.1 Flash（deepseek-flash）按同一 Schema 重新抽取并写回 SQLite。
 *
 * 用法：node scripts/retrofit-cloud-fallback.mjs [--concurrency 3] [--limit 0]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const DB_PATH = path.resolve(ROOT, arg('db', path.join('.data', 'relaydesk.sqlite')));
const OUT_DIR = path.join(ROOT, 'reports', 'retrofit');
const POOL_FILE = path.join(OUT_DIR, 'failed_pool.jsonl');
const RESULTS_FILE = path.join(OUT_DIR, 'cloud-results.jsonl');
const ATTEMPTS_FILE = path.join(OUT_DIR, 'cloud-attempts.jsonl');
const CONCURRENCY = Math.max(1, Number(arg('concurrency', '3')) || 3);
const LIMIT = Number(arg('limit', '0')) || 0;

const CLOUD = {
  base: process.env.RETROFIT_CLOUD_URL || 'https://api.deepseek.com/v1',
  model: process.env.RETROFIT_CLOUD_MODEL || 'deepseek-flash',
  token: '',
};

const PAYLOAD_SCHEMA = {
  applicability: ['适用情境，字符串数组，1-5 条'],
  diagnostic_conditions: ['诊断条件/判断依据，字符串数组，0-6 条'],
  exception_risks: ['例外或风险，字符串数组，0-6 条'],
};

function loadDshToken() {
  const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
  const file = path.join(dshHome, '.credentials.yaml');
  if (!fs.existsSync(file)) return '';
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let inAccount = false;
  for (const line of lines) {
    if (/^\s{2}deepseek-account-platform\/default:\s*$/.test(line)) { inAccount = true; continue; }
    if (inAccount && /^\s{2}\S/.test(line)) break;
    if (inAccount) {
      const m = line.match(/^\s+token:\s*(\S+)\s*$/);
      if (m) return m[1];
    }
  }
  return '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildPrompt(title, content) {
  return `你是客服知识结构化专家。请从下面的客服文本中，提取出「适用情境」「诊断条件」「例外风险」。

严格规则：
1. 只能依据给定文本，不得补充文本中没有的政策、金额、时限或承诺。
2. 文本没有对应信息时用空数组 []，不要编造。
3. 只输出 JSON 对象，不要 Markdown 围栏，不要解释。

输出 JSON Schema：
${JSON.stringify(PAYLOAD_SCHEMA, null, 2)}

文本标题：${title}
文本正文：
${String(content).slice(0, 6000)}`;
}

function extractJson(text) {
  if (!text) return null;
  const clean = String(text).replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(clean.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function validatePayload(payload) {
  const errors = [];
  const arr = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (!payload || typeof payload !== 'object') return ['not_object'];
  for (const key of ['applicability', 'diagnostic_conditions', 'exception_risks']) {
    if (!arr(payload[key])) errors.push(`bad_${key}`);
  }
  if (Array.isArray(payload.applicability) && payload.applicability.length === 0) errors.push('empty_applicability');
  return errors;
}

async function callCloud(prompt) {
  const res = await fetch(`${CLOUD.base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-dsh-auth-token': CLOUD.token,
      authorization: `Bearer ${CLOUD.token}`,
    },
    body: JSON.stringify({
      model: CLOUD.model,
      messages: [
        { role: 'system', content: 'You extract structured knowledge from support text. Output only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 1500,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { content: data?.choices?.[0]?.message?.content || '', usage: data?.usage || {} };
}

function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

async function main() {
  CLOUD.token = loadDshToken();
  if (!CLOUD.token) { console.error('[fatal] no DSH DeepSeek token'); process.exit(1); }
  if (!fs.existsSync(POOL_FILE)) { console.log('[skip] failed_pool.jsonl not found'); return; }

  const db = new DatabaseSync(DB_PATH);
  const lines = fs.readFileSync(POOL_FILE, 'utf8').split('\n').filter(Boolean);
  const byId = new Map();
  for (const line of lines) {
    try { const row = JSON.parse(line); byId.set(row.id, row); } catch { /* skip */ }
  }
  let records = [...byId.values()];
  // 跳过 DB 里已经填充的
  records = records.filter((row) => {
    const current = db.prepare('SELECT structured_payload AS p FROM knowledge WHERE id = ?').get(row.id);
    return current && (current.p === '{}' || current.p === null || current.p === '');
  });
  if (LIMIT > 0) records = records.slice(0, LIMIT);

  console.log(`[cloud] ${CLOUD.base} model=${CLOUD.model}`);
  console.log(`[pool] failed records=${byId.size} pending=${records.length}`);

  const limit = createLimiter(CONCURRENCY);
  let ok = 0, failed = 0, tokens = 0;
  const remaining = [];

  await Promise.all(records.map((row) => limit(async () => {
    const prompt = buildPrompt(row.title, row.content);
    let payload = null;
    let usage = {};
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const out = await callCloud(prompt);
        usage = out.usage || {};
        tokens += (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
        payload = extractJson(out.content);
        const errors = validatePayload(payload);
        if (errors.length) throw new Error(`invalid_payload: ${errors.join(',')}`);
        break;
      } catch (error) {
        lastError = String(error.message).slice(0, 200);
        payload = null;
        if (attempt === 0) await sleep(1000);
      }
    }
    fs.appendFileSync(ATTEMPTS_FILE, JSON.stringify({ id: row.id, ok: Boolean(payload), error: lastError || null, usage }) + '\n');
    if (payload) {
      db.prepare('UPDATE knowledge SET structured_payload = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(payload), new Date().toISOString(), row.id);
      fs.appendFileSync(RESULTS_FILE, JSON.stringify({ id: row.id, title: row.title, payload, usage, provider: 'deepseek-flash' }) + '\n');
      ok += 1;
      console.log(`  [ok] ${row.title.slice(0, 50)}`);
    } else {
      failed += 1;
      remaining.push({ ...row, error: lastError });
      console.error(`  [fail] ${row.title.slice(0, 50)}: ${lastError}`);
    }
  })));

  // 保留未成功的条目，成功的从池子里移除
  fs.writeFileSync(POOL_FILE, remaining.map((r) => JSON.stringify(r)).join('\n') + (remaining.length ? '\n' : ''));
  const summary = {
    at: new Date().toISOString(),
    backend: CLOUD.base,
    model: CLOUD.model,
    attempted: records.length,
    ok,
    failed,
    tokens,
    remaining: remaining.length,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'cloud-fallback.json'), JSON.stringify(summary, null, 2));
  console.log(`[summary] ${JSON.stringify(summary)}`);
  db.close();
}

main().catch((error) => { console.error(`[fatal] ${error.message}`); process.exit(1); });
