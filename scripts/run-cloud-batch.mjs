#!/usr/bin/env node
/**
 * 纯云端全量生成（DeepSeek）：本地 Qwen 完全跳过，跳过 Judge，只看代码校验。
 *
 * 用法：
 *   node scripts/run-cloud-batch.mjs --workers 15
 *   node scripts/run-cloud-batch.mjs --workers 15 --reset
 *
 * 流程：云端直接生成高质量 JSON -> 代码校验（Key/content/数字符号） -> 失败重试 1 次 -> manual_review。
 * 通过则 status=confirmed + review_status=approved 入库。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { checkKeys, checkContent, checkEntities } from './lib/translate-validate.mjs';
import { loadGlossary, glossaryPromptBlock } from './lib/glossary.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);
const WORKERS = Math.max(1, Math.min(30, Number(arg('workers', '15'))));
const LIMIT = Number(arg('limit', '0'));
const RESET = has('reset');
const OUT_DIR = path.resolve(arg('out-dir', 'reports/translate/cloud'));
const SOURCE_DB = path.resolve(arg('source-db', '.data/relaydesk.sqlite'));
const DB_PATH = path.resolve(arg('db', '.data/cloud-full.sqlite'));
const CLOUD_BASE = (process.env.CLOUD_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const CLOUD_MODEL = process.env.CLOUD_MODEL_NAME || 'deepseek-flash';
const PRICE = { inputPerMTokens: 0.28 * 7.2, outputPerMTokens: 0.42 * 7.2 };

const LANGS = [
  { code: 'en-US', base: 'en', name: '英语', threshold: 4.5 },
  { code: 'es-ES', base: 'es', name: '西班牙语', threshold: 4.5 },
  { code: 'de-DE', base: 'de', name: '德语', threshold: 4.5 },
  { code: 'fr-FR', base: 'fr', name: '法语', threshold: 4.5 },
  { code: 'pl-PL', base: 'pl', name: '波兰语', threshold: 4.8 },
];
const LANG_HINTS = {
  de: '德语：Reverse Logistics => Rückwärtslogistik；Disposition 用 Bearbeitung/Verwertung；failure modes => Fehlerarten；注意冠词与格。',
  fr: '法语：普通名词句中不要大写；shipping => Expédition/Envoi；élimination 不用于“处置”，用 gestion/disposition；s’intégrer à。',
  pl: '波兰语：na etapie；failure modes => typy błędów；refund => zwrot pieniędzy。',
  es: '西语：fulfillment center => centro logístico；palletización；usted/ustedes 一致。',
  en: '',
};
const glossary = loadGlossary();

function loadCloudAuth() {
  if (process.env.DEEPSEEK_API_KEY) return { authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` };
  const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
  const lines = fs.readFileSync(path.join(dshHome, '.credentials.yaml'), 'utf8').split(/\r?\n/);
  let inAccount = false;
  for (const line of lines) {
    if (/^\s{2}deepseek-account-platform\/default:\s*$/.test(line)) { inAccount = true; continue; }
    if (inAccount && /^\s{2}\S/.test(line)) break;
    if (inAccount) {
      const match = line.match(/^\s+token:\s*(\S+)\s*$/);
      if (match) return { 'x-dsh-auth-token': match[1] };
    }
  }
  throw new Error('cloud token missing');
}

function extractJson(text) {
  if (!text) return null;
  const clean = String(text).replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  if (start === -1) return null;
  let depth = 0; let inString = false; let escaped = false;
  for (let i = start; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
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

async function chat(prompt, headers, timeout = 120000) {
  const body = {
    model: CLOUD_MODEL,
    temperature: 0.2,
    max_tokens: 6000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: '你是资深本地化电商客服与知识库编辑。只输出合法 JSON，不解释。' },
      { role: 'user', content: prompt },
    ],
  };
  const started = Date.now();
  const res = await fetch(`${CLOUD_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const text = await res.text();
    const error = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    error.status = res.status;
    throw error;
  }
  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content || '', usage: data.usage || null, ms: Date.now() - started };
}

function promptFor(card, lang, issues = []) {
  return `请直接生成${lang.name}本地金牌客服水准的知识卡（最终版，不是翻译草稿）。
硬性要求：
1. 返回 JSON，Key 必须与原文完全一致：id、title、content、tags、category。
2. 保留全部事实、条件、例外、步骤、数字与符号（例如 3、120、$、25%、3-5 个工作日）。
3. 术语与表达符合当地商业习惯与敬语；读起来像母语者写的，不要机翻腔。
4. ${LANG_HINTS[lang.base] || ''}
5. 只输出 JSON，不要解释、不要 Markdown 围栏。

${glossaryPromptBlock(glossary, lang.base)}

${issues.length ? `上一轮代码校验失败，必须修正：\n${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n` : ''}
原文 JSON：
${JSON.stringify(card, null, 2)}`;
}

function codeValidate(card, translated) {
  if (!translated || typeof translated !== 'object') return { ok: false, issues: ['JSON_INVALID: 无法解析为对象'] };
  const keys = checkKeys(card, translated);
  const content = checkContent(card, translated);
  const translatedText = [translated.title, translated.content, ...(Array.isArray(translated.tags) ? translated.tags : [])].filter(Boolean).join('\n');
  const entities = checkEntities([card.title, card.content, ...(card.tags || [])].join('\n'), translatedText);
  const issues = [];
  if (!keys.ok) issues.push(`KEY_MISMATCH: missing=[${keys.missing.join(',')}] extra=[${keys.extra.join(',')}]`);
  if (!content.ok) issues.push(`${content.code}: ${content.detail}`);
  if (!entities.ok) issues.push(`ENTITY_MISSING: numbers=[${entities.missingNumbers.join(',')}] symbols=[${entities.missingSymbols.join(',')}]`);
  if (!String(translated.title || '').trim()) issues.push('TITLE_EMPTY');
  return { ok: issues.length === 0, issues };
}

async function selectCards() {
  const db = new DatabaseSync(SOURCE_DB);
  const rows = db.prepare(`SELECT id, title, content, tags_json, category FROM knowledge
    WHERE status='confirmed' AND scope='global' AND audience='seller'
      AND (locale='zh' OR locale='en' OR locale IS NULL)
    ORDER BY rowid`).all();
  db.close();
  return rows.map((r) => ({ id: r.id, title: r.title, content: r.content, tags: JSON.parse(r.tags_json || '[]'), category: r.category }));
}

async function main() {
  if (RESET) await fsp.rm(OUT_DIR, { recursive: true, force: true });
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const progressFile = path.join(OUT_DIR, 'progress.jsonl');
  const manualFile = path.join(OUT_DIR, 'manual_review.jsonl');
  const completed = new Set();
  if (fs.existsSync(progressFile)) {
    for (const line of fs.readFileSync(progressFile, 'utf8').split('\n').filter(Boolean)) {
      try { completed.add(JSON.parse(line).key); } catch {}
    }
  }
  const cards = await selectCards();
  const jobs = [];
  for (const card of cards) for (const lang of LANGS) {
    const key = `${card.id}::${lang.code}`;
    if (!completed.has(key)) jobs.push({ card, lang, key });
  }
  const limited = LIMIT > 0 ? jobs.slice(0, LIMIT) : jobs;
  console.log(`[cloud] cards=${cards.length} total_jobs=${cards.length * LANGS.length} remaining=${limited.length} workers=${WORKERS} completed_before=${completed.size}`);

  const headers = loadCloudAuth();
  let cursor = 0;
  const stats = { jobs: limited.length, admitted: 0, manual: 0, retries: 0, calls: 0, tokensIn: 0, tokensOut: 0, started: Date.now() };
  const db = openDatabase(DB_PATH);
  migrateSchema(db);
  const dao = createDao(db);
  let writeChain = Promise.resolve();
  const append = (file, row) => {
    writeChain = writeChain.then(() => fsp.appendFile(file, JSON.stringify(row) + '\n')).catch(() => {});
    return writeChain;
  };

  const runJob = async (job) => {
    const { card, lang } = job;
    let translated = null;
    let issues = [];
    for (let attempt = 0; attempt < 2 && !translated; attempt += 1) {
      stats.calls += 1;
      try {
        const r = await chat(promptFor(card, lang, issues), headers);
        stats.tokensIn += Number(r.usage?.prompt_tokens || 0);
        stats.tokensOut += Number(r.usage?.completion_tokens || 0);
        const parsed = extractJson(r.content);
        const check = codeValidate(card, parsed);
        if (check.ok) { translated = parsed; break; }
        issues = check.issues;
        if (attempt === 0) stats.retries += 1;
      } catch (error) {
        issues = [error.message];
        if (attempt === 0) stats.retries += 1;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!translated) {
      stats.manual += 1;
      const row = { key: job.key, card_id: card.id, lang: lang.code, route: 'manual_review', issues, at: new Date().toISOString() };
      await append(progressFile, row);
      await append(manualFile, { ...row, title: card.title });
      console.log(`[cloud] ${job.key} MANUAL ${issues[0] || ''}`);
      return;
    }
    stats.admitted += 1;
    const id = `kb_${lang.code}_${card.id}`;
    if (!dao.findGlobalKnowledge(id)) {
      dao.createGlobalKnowledge({
        id, title: String(translated.title || '').slice(0, 180), content: String(translated.content || ''),
        tags: Array.isArray(translated.tags) ? translated.tags : [],
        language: lang.base, locale: lang.code, status: 'confirmed', audience: 'seller', category: '其他',
        source_id: 'manual_editor', structured_payload: { route: 'cloud_only', translated_at: new Date().toISOString() },
      });
      db.prepare("UPDATE knowledge SET review_status='approved', license_status='clear' WHERE id=?").run(id);
    }
    await append(progressFile, { key: job.key, card_id: card.id, lang: lang.code, route: 'approved', at: new Date().toISOString() });
  };

  const worker = async () => {
    while (true) {
      const index = cursor; cursor += 1;
      if (index >= limited.length) return;
      try { await runJob(limited[index]); } catch (error) { console.error(`[job error] ${error.message}`); }
    }
  };
  await Promise.all(Array.from({ length: WORKERS }, () => worker()));
  await writeChain;
  closeDatabase(db);

  const cost = (stats.tokensIn / 1e6) * PRICE.inputPerMTokens + (stats.tokensOut / 1e6) * PRICE.outputPerMTokens;
  const report = {
    workers: WORKERS, cards: cards.length, jobs: limited.length,
    admitted: stats.admitted, manual: stats.manual,
    admission_rate: Number(((stats.admitted / Math.max(1, limited.length)) * 100).toFixed(1)),
    manual_rate: Number(((stats.manual / Math.max(1, limited.length)) * 100).toFixed(1)),
    retries: stats.retries, cloud_calls: stats.calls,
    tokens: { input: stats.tokensIn, output: stats.tokensOut },
    cost_cny: Number(cost.toFixed(4)),
    duration_ms: Date.now() - stats.started,
  };
  await fsp.writeFile(path.join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error('[fatal]', error.message); process.exit(1); });
