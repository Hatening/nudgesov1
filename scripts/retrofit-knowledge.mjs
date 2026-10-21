#!/usr/bin/env node
/**
 * 知识回刷（KB-STRUCT-001 / 任务二）：为 structured_payload 为空的卡片
 * 调用本地 LM Studio 模型，抽取「适用情境 / 诊断条件 / 例外风险」。
 *
 * 特性：
 *   - 端点自动探测（默认 127.0.0.1:3679 → 192.168.3.227:3679 → 127.0.0.1:1234）
 *   - 模型名模糊匹配（qwen3.8-35b-a3b / qwen3.8-35b-a3b@q5_k_m）
 *   - 并发 4（可调），失败重试 1 次
 *   - 断点续传：reports/retrofit/progress.json + DB 中已填充的自动跳过
 *   - 结果逐条写 reports/retrofit/results.jsonl；失败写 failures.jsonl
 *
 * 用法：
 *   node scripts/retrofit-knowledge.mjs --dry-run
 *   node scripts/retrofit-knowledge.mjs --limit 10
 *   node scripts/retrofit-knowledge.mjs --limit 0 --concurrency 4     # 0 = 全量
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
const hasFlag = (name) => argv.includes(`--${name}`);

const DB_PATH = path.resolve(ROOT, arg('db', path.join('.data', 'relaydesk.sqlite')));
const LIMIT = Number(arg('limit', '0')) || 0; // 0 = 全量（--all 亦可）
const CONCURRENCY = Math.max(1, Number(arg('concurrency', '4')) || 4);
const MIN_CONTENT = Number(arg('min-content', '80')) || 0;
const DRY_RUN = hasFlag('dry-run');
const INCLUDE_BLOCKED = hasFlag('include-blocked');
const OUT_DIR = path.join(ROOT, 'reports', 'retrofit');
const PROGRESS_FILE = path.join(OUT_DIR, 'progress.json');
const RESULTS_FILE = path.join(OUT_DIR, 'results.jsonl');
const FAILURES_FILE = path.join(OUT_DIR, 'failures.jsonl');
const FAILED_POOL_FILE = path.join(OUT_DIR, 'failed_pool.jsonl');
const SKIPPED_FILE = path.join(OUT_DIR, 'skipped-short.jsonl');

const ENDPOINTS = (process.env.RETROFIT_LLM_URL
  ? [process.env.RETROFIT_LLM_URL]
  : ['http://127.0.0.1:3679/v1', 'http://192.168.3.227:3679/v1', 'http://127.0.0.1:1234/v1'])
  .map((u) => u.replace(/\/$/, ''));
const MODEL_HINT = process.env.RETROFIT_LLM_MODEL || 'qwen3.8-35b-a3b';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Schema / Prompt
const PAYLOAD_SCHEMA = {
  applicability: ['适用情境，字符串数组，1-5 条'],
  diagnostic_conditions: ['诊断条件/判断依据，字符串数组，0-6 条'],
  exception_risks: ['例外或风险，字符串数组，0-6 条'],
};

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

// ---------------------------------------------------------------- 端点 / 模型探测
async function resolveBackend() {
  const attempts = [];
  for (const base of ENDPOINTS) {
    try {
      const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) { attempts.push(`${base}: HTTP ${res.status}`); continue; }
      const data = await res.json();
      const ids = (data.data || []).map((m) => m.id);
      if (!ids.length) { attempts.push(`${base}: no models`); continue; }
      const exact = ids.find((id) => id === MODEL_HINT);
      const fuzzy = ids.find((id) => id.startsWith(MODEL_HINT));
      const anyQwen = ids.find((id) => /qwen/i.test(id));
      const model = exact || fuzzy || anyQwen;
      if (!model) { attempts.push(`${base}: no qwen model (${ids.slice(0, 3).join(',')})`); continue; }
      return { base, model, available: ids };
    } catch (error) {
      attempts.push(`${base}: ${error.message}`);
    }
  }
  const error = new Error(`no local LM Studio backend available.\n  ${attempts.join('\n  ')}\n请先在 LM Studio 里加载模型并开启 Local Server（端口 3679）。`);
  error.attempts = attempts;
  throw error;
}

async function callModel(backend, prompt) {
  const res = await fetch(`${backend.base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: backend.model,
      messages: [
        { role: 'system', content: 'You extract structured knowledge from support text. Output only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 1200,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return {
    content: data?.choices?.[0]?.message?.content || '',
    usage: data?.usage || {},
  };
}

// ---------------------------------------------------------------- 并发池
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

// ---------------------------------------------------------------- 主流程
function loadProgress() {
  if (!fs.existsSync(PROGRESS_FILE)) return { done: {}, failed: {} };
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); } catch { return { done: {}, failed: {} }; }
}

function selectCandidates(db) {
  const where = ["(structured_payload IS NULL OR structured_payload = '' OR structured_payload = '{}')"];
  if (!INCLUDE_BLOCKED) {
    where.push("status = 'confirmed'");
    where.push("license_status <> 'hold'");
    where.push("review_status NOT IN ('license_hold','needs_manual_audit','quarantined','rejected')");
  }
  return db.prepare(`SELECT id, title, content, locale, product_surface FROM knowledge WHERE ${where.join(' AND ')} ORDER BY rowid`).all();
}

async function main() {
  if (!fs.existsSync(DB_PATH)) { console.error(`[fatal] db not found: ${DB_PATH}`); process.exit(1); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  const all = selectCandidates(db);
  const progress = loadProgress();
  const pending = all.filter((row) => !progress.done[row.id] && !progress.failed[row.id]);
  const selected = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;

  console.log(`[db] ${path.relative(ROOT, DB_PATH)}`);
  console.log(`[candidates] empty_payload=${all.length} pending=${pending.length} selected=${selected.length}`);
  if (DRY_RUN) {
    for (const row of selected.slice(0, 20)) console.log(`  - ${row.id.slice(0, 18)} [${row.locale}] ${row.title.slice(0, 60)}`);
    console.log('[dry-run] no model calls');
    db.close();
    return;
  }

  let backend;
  try {
    backend = await resolveBackend();
  } catch (error) {
    console.error(`[fatal] ${error.message}`);
    db.close();
    process.exit(2);
  }
  console.log(`[backend] ${backend.base}  model=${backend.model}`);

  const limit = createLimiter(CONCURRENCY);
  let ok = 0, failed = 0, skippedShort = 0, tokens = 0;
  const startedAt = Date.now();

  await Promise.all(selected.map((row) => limit(async () => {
    // 机制：超短文本不调用模型，直接打标记，避免空洞 JSON 与算力浪费
    if (MIN_CONTENT > 0 && String(row.content || '').trim().length < MIN_CONTENT) {
      const marker = {
        applicability: [],
        diagnostic_conditions: [],
        exception_risks: [],
        skipped_reason: 'source_too_short',
        source_chars: String(row.content || '').trim().length,
      };
      db.prepare('UPDATE knowledge SET structured_payload = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(marker), new Date().toISOString(), row.id);
      progress.done[row.id] = { at: new Date().toISOString(), skipped: 'short_text' };
      fs.appendFileSync(SKIPPED_FILE, JSON.stringify({ id: row.id, title: row.title, chars: marker.source_chars }) + '\n');
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
      ok += 1;
      skippedShort += 1;
      return;
    }

    const prompt = buildPrompt(row.title, row.content);
    let payload = null;
    let usage = {};
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const out = await callModel(backend, prompt);
        usage = out.usage || {};
        tokens += (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
        payload = extractJson(out.content);
        const errors = validatePayload(payload);
        if (errors.length) throw new Error(`invalid_payload: ${errors.join(',')}`);
        break;
      } catch (error) {
        lastError = String(error.message).slice(0, 200);
        payload = null;
        if (attempt === 0) await sleep(800);
      }
    }

    if (payload) {
      db.prepare('UPDATE knowledge SET structured_payload = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(payload), new Date().toISOString(), row.id);
      progress.done[row.id] = { at: new Date().toISOString(), model: backend.model };
      fs.appendFileSync(RESULTS_FILE, JSON.stringify({ id: row.id, title: row.title, payload, usage }) + '\n');
      ok += 1;
      console.log(`  [ok] ${row.title.slice(0, 50)} → ${JSON.stringify(payload).slice(0, 120)}`);
    } else {
      failed += 1;
      progress.failed[row.id] = { at: new Date().toISOString(), error: lastError };
      fs.appendFileSync(FAILURES_FILE, JSON.stringify({ id: row.id, title: row.title, error: lastError }) + '\n');
      // 机制一：本地两次失败 → 进入云端兜底池（保留原文，供云端重跑）
      fs.appendFileSync(FAILED_POOL_FILE, JSON.stringify({
        id: row.id,
        title: row.title,
        content: row.content,
        locale: row.locale,
        product_surface: row.product_surface,
        error: lastError,
        at: new Date().toISOString(),
      }) + '\n');
      console.error(`  [fail] ${row.title.slice(0, 50)}: ${lastError}`);
    }
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  })));

  const summary = {
    at: new Date().toISOString(),
    backend: backend.base,
    model: backend.model,
    selected: selected.length,
    ok,
    skipped_short: skippedShort,
    failed,
    tokens,
    seconds: Math.round((Date.now() - startedAt) / 1000),
    concurrency: CONCURRENCY,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'last-run.json'), JSON.stringify(summary, null, 2));
  console.log(`\n[summary] ${JSON.stringify(summary)}`);
  db.close();
  process.exit(failed > 0 && ok === 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exit(1);
});
