#!/usr/bin/env node
/**
 * 云端盲抽检（机制二，LLM-as-a-Judge）：
 * 从回刷成功的 structured_payload 中随机抽 5%（默认，可调），
 * 让 DeepSeek V4.1 Flash 比对「原文 vs 提取 JSON」，输出 pass/reason，统计通过率。
 *
 * 用法：node scripts/audit-retrofit-quality.mjs [--rate 0.05] [--max 200] [--concurrency 3]
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
const RATE = Number(arg('rate', '0.05')) || 0.05;
const MAX = Number(arg('max', '200')) || 200;
const CONCURRENCY = Math.max(1, Number(arg('concurrency', '3')) || 3);
const SEED = Number(arg('seed', '20261021')) || 20261021;

const CLOUD = {
  base: process.env.RETROFIT_CLOUD_URL || 'https://api.deepseek.com/v1',
  model: process.env.RETROFIT_CLOUD_MODEL || 'deepseek-flash',
  token: '',
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

// 可复现的伪随机（mulberry32）
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function judgePrompt(title, content, payload) {
  return `你是严苛的数据质检员。请比对“原文”和“提取的 JSON”。

检查是否有：
① 原文没有的数字/URL；
② 遗漏了原文的关键例外条件；
③ 过度的语义推断。

如果没有问题输出 {"pass": true}；如果有问题，指出具体原因并输出 {"pass": false, "reason": "..."}。
只输出 JSON，不要解释、不要 Markdown 围栏。

原文标题：${title}
原文：
${String(content).slice(0, 5000)}

提取的 JSON：
${JSON.stringify(payload)}`;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
        { role: 'system', content: 'You are a strict data quality auditor. Output only JSON.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 1500,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return {
    content: data?.choices?.[0]?.message?.content || '',
    usage: data?.usage || {},
  };
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

  const db = new DatabaseSync(DB_PATH);
  const all = db.prepare(`
    SELECT id, title, content, structured_payload
    FROM knowledge
    WHERE structured_payload IS NOT NULL AND structured_payload NOT IN ('', '{}')
      AND structured_payload NOT LIKE '%skipped_reason%'
  `).all().filter((row) => {
    try {
      const payload = JSON.parse(row.structured_payload);
      return payload && !payload.skipped_reason;
    } catch { return false; }
  });

  const random = rng(SEED);
  const shuffled = [...all];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const sampleSize = Math.min(MAX, Math.max(1, Math.round(all.length * RATE)));
  const sample = shuffled.slice(0, sampleSize);

  console.log(`[population] ${all.length} filled payloads`);
  console.log(`[sample] rate=${RATE} size=${sample.length} seed=${SEED}`);
  console.log(`[judge] ${CLOUD.base} model=${CLOUD.model}`);

  const limit = createLimiter(CONCURRENCY);
  let pass = 0, fail = 0, error = 0, tokens = 0;
  const failures = [];
  const records = [];

  await Promise.all(sample.map((row) => limit(async () => {
    let payload;
    try { payload = JSON.parse(row.structured_payload); } catch { payload = null; }
    const prompt = judgePrompt(row.title, row.content, payload);
    let verdict = null;
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const out = await callCloud(prompt);
        tokens += (out.usage.prompt_tokens || 0) + (out.usage.completion_tokens || 0);
        const parsed = extractJson(out.content);
        // 兼容 pass 为 true/"true"/1 三种写法
        if (parsed && (parsed.pass === true || parsed.pass === 'true' || parsed.pass === 1)) {
          verdict = { pass: true, reason: parsed.reason || null };
        } else if (parsed && (parsed.pass === false || parsed.pass === 'false' || parsed.pass === 0)) {
          verdict = { pass: false, reason: parsed.reason || '(no reason)' };
        } else if (parsed && typeof parsed.reason === 'string' && /pass\s*[:=]\s*true/i.test(out.content)) {
          verdict = { pass: true, reason: parsed.reason };
        } else {
          throw new Error('invalid_verdict');
        }
        break;
      } catch (e) {
        lastError = String(e.message).slice(0, 160);
        verdict = null;
        if (attempt < 2) await sleep(800);
      }
    }

    if (!verdict) {
      error += 1;
      failures.push({ id: row.id, title: row.title, reason: `judge_error: ${lastError}` });
      records.push({ id: row.id, title: row.title, pass: null, reason: lastError });
      return;
    }
    records.push({ id: row.id, title: row.title, pass: verdict.pass, reason: verdict.reason || null });
    if (verdict.pass) pass += 1;
    else {
      fail += 1;
      failures.push({ id: row.id, title: row.title, reason: verdict.reason || '(no reason)' });
      console.error(`  [FAIL] ${row.title.slice(0, 50)} → ${String(verdict.reason || '').slice(0, 160)}`);
    }
  })));

  const total = sample.length;
  const judged = pass + fail;
  const report = {
    at: new Date().toISOString(),
    model: CLOUD.model,
    population: all.length,
    rate: RATE,
    sample_size: total,
    judged,
    pass,
    fail,
    judge_error: error,
    pass_rate_pct: judged ? Math.round((pass / judged) * 10000) / 100 : 0,
    tokens,
    failures,
    seed: SEED,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'quality-audit.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'quality-audit-samples.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const md = [
    '# 回刷质量审计（LLM-as-a-Judge）',
    '',
    `- 生成时间：${report.at}`,
    `- 判定模型：${report.model}`,
    `- 已回刷总量：${all.length}`,
    `- 抽检比例：${(RATE * 100).toFixed(1)}%（样本 ${total}）`,
    `- 通过 / 失败 / 判定异常：${pass} / ${fail} / ${error}`,
    `- **通过率：${report.pass_rate_pct}%**`,
    `- token 用量：${tokens}`,
    '',
    '## 未通过样例',
    '',
    ...(failures.length
      ? failures.map((f) => `- \`${f.id}\` ${f.title}：${f.reason}`)
      : ['- 无']),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'QUALITY-AUDIT.md'), md + '\n');

  console.log(`\n[result] pass=${pass} fail=${fail} error=${error} pass_rate=${report.pass_rate_pct}%`);
  if (failures.length) {
    console.log('[failures]');
    for (const f of failures) console.log(`  - ${f.title}: ${f.reason}`);
  }
  db.close();
}

main().catch((error) => { console.error(`[fatal] ${error.message}`); process.exit(1); });
