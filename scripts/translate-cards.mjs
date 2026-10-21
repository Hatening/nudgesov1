#!/usr/bin/env node
/**
 * 知识卡翻译脚本：本地 Qwen 先行 + 物理校验 + 云端 DeepSeek 兜底
 *
 * 强制规则（任何一条失败 => 写入 cloud_retry_pool.jsonl）：
 *   1. JSON 结构：可 JSON.parse，且 Key 路径与原版完全一致
 *   2. 语种断言：目标 sw/pl 等，若结果 80% 以上是英文词或检测不到目标语特征 => LOCAL_FAILED
 *   3. 实体比对：原文数字与特殊符号必须原样出现在译文
 *
 * 本地批次结束后自动读取 retry pool，调用云端重新翻译；云端结果再跑同一套校验，
 * 全部通过才打上 locale 标签，以 status='draft' 入库。
 *
 * 用法：
 *   node scripts/translate-cards.mjs --input reports/translate/sample-cards.jsonl \
 *     --lang pl --limit 1 --local-mode mock-english --cloud real \
 *     --db .data/translate-e2e.sqlite
 *
 * --local-mode: real | mock-english | mock-fail
 * --cloud:      real | mock-ok | off
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { validateTranslation } from './lib/translate-validate.mjs';
import { loadGlossary, glossaryPromptBlock } from './lib/glossary.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const INPUT = path.resolve(arg('input', 'reports/translate/sample-cards.jsonl'));
const LANG = String(arg('lang', 'pl')).toLowerCase();
const LIMIT = Number(arg('limit', '1')) || 1;
const LOCAL_MODE = arg('local-mode', 'real');
const CLOUD_MODE = arg('cloud', 'real');
const OUT = path.resolve(arg('out', `reports/translate/translated.${LANG}.jsonl`));
const POOL = path.resolve(arg('pool', 'reports/translate/cloud_retry_pool.jsonl'));
const REPORT = path.resolve(arg('report', `reports/translate/report.${LANG}.json`));
const DB_PATH = arg('db', '');

const LANG_NAME = { pl: 'Polish（波兰语）', sw: 'Swahili（斯瓦希里语）', en: 'English', de: 'German', fr: 'French', es: 'Spanish', ja: 'Japanese' };
const MAPPING_PATH = path.resolve(arg('mapping', 'config/language_mapping.json'));
const mapping = fs.existsSync(MAPPING_PATH) ? JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8')) : null;
const langEntry = mapping?.languages?.find((l) => l.code.toLowerCase() === LANG || l.language.toLowerCase() === LANG.split('-')[0].toLowerCase()) || null;
const LANG_BASE = langEntry?.language || LANG.split('-')[0];
const LANG_TIER = langEntry?.tier || 1;
const LANG_DISPLAY = langEntry?.name_zh || LANG_NAME[LANG] || LANG;
const LANG_SCRIPT = langEntry?.script || 'Latn';
const LOCALE_NEEDS_CLOUD = path.resolve('reports/translate/locale_needs_cloud.jsonl');
const GLOSSARY = loadGlossary();
const LOCAL_BASE = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const LOCAL_MODEL = process.env.LOCAL_MODEL_NAME || 'qwen3.8-35b-a3b@q5_k_m';
const CLOUD_BASE = (process.env.CLOUD_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const CLOUD_MODEL = process.env.CLOUD_MODEL_NAME || 'deepseek-flash';

function loadCloudAuth() {
  if (process.env.DEEPSEEK_API_KEY) return { headers: { authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` }, source: 'env:DEEPSEEK_API_KEY' };
  const dshHome = process.env.DSH_HOME
    ? process.env.DSH_HOME
    : path.join(process.env.USERPROFILE || '', '.dsh');
  const credPath = path.join(dshHome, '.credentials.yaml');
  if (!fs.existsSync(credPath)) return { headers: {}, source: 'missing' };
  const lines = fs.readFileSync(credPath, 'utf8').split(/\r?\n/);
  let inAccount = false;
  let token = '';
  for (const line of lines) {
    if (/^\s{2}deepseek-account-platform\/default:\s*$/.test(line)) { inAccount = true; continue; }
    if (inAccount && /^\s{2}\S/.test(line)) break;
    if (inAccount) {
      const match = line.match(/^\s+token:\s*(\S+)\s*$/);
      if (match) { token = match[1]; break; }
    }
  }
  if (!token) return { headers: {}, source: 'missing' };
  return { headers: { 'x-dsh-auth-token': token }, source: 'dsh-credentials' };
}

function extractJson(text) {
  if (!text) return null;
  const clean = String(text).replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
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

function buildPrompt(card) {
  const glossaryBlock = glossaryPromptBlock(GLOSSARY, LANG_BASE);
  return `把下面 JSON 中的 title、content、tags 翻译成 ${LANG_DISPLAY}。
硬性要求：
1. 返回合法 JSON，Key 必须与输入完全一致（id / title / content / tags）。
2. 数字、货币符号、百分比原样保留（例如 25%、500、$、€）。
3. 品牌与指标缩写保留英文（ACOS、ROAS、CTR、SKU、Amazon）。
4. 只输出 JSON，不要解释、不要 Markdown 围栏。
${glossaryBlock ? `\n${glossaryBlock}\n` : ''}
输入：
${JSON.stringify(card, null, 2)}`;
}

async function callChat({ base, model, headers, prompt, jsonMode = true, timeout = 120000 }) {
  const body = {
    model,
    temperature: 0.1,
    messages: [
      { role: 'system', content: '你是严谨的电商知识库翻译器。只输出 JSON。' },
      { role: 'user', content: prompt },
    ],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

const MOCK_ENGLISH = {
  title: 'ACOS advertising optimization',
  content: 'ACOS is ad spend divided by ad sales. Keep ACOS under 25% at all times. Review campaigns weekly and scale only the profitable ones.',
  tags: ['advertising', 'optimization'],
};

async function localTranslate(card) {
  if (LOCAL_MODE === 'mock-fail') throw new Error('mock local failure: connection refused');
  if (LOCAL_MODE === 'mock-english') {
    return { ...card, title: MOCK_ENGLISH.title, content: MOCK_ENGLISH.content, tags: MOCK_ENGLISH.tags };
  }
  const raw = await callChat({ base: LOCAL_BASE, model: LOCAL_MODEL, headers: {}, prompt: buildPrompt(card), timeout: 180000 });
  const parsed = extractJson(raw);
  if (!parsed) throw new Error(`local returned non-JSON: ${String(raw).slice(0, 200)}`);
  return parsed;
}

async function cloudTranslate(card) {
  if (CLOUD_MODE === 'off') throw new Error('cloud disabled');
  if (CLOUD_MODE === 'mock-ok') return { ...card, title: `[${LANG}] ${card.title}`, content: `[${LANG}] ${card.content}`, tags: (card.tags || []).map((t) => `[${LANG}] ${t}`) };
  const auth = loadCloudAuth();
  if (!auth.headers.authorization && !auth.headers['x-dsh-auth-token']) throw new Error('cloud auth missing (DEEPSEEK_API_KEY or DSH credentials)');
  const raw = await callChat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: auth.headers, prompt: buildPrompt(card), timeout: 120000 });
  const parsed = extractJson(raw);
  if (!parsed) throw new Error(`cloud returned non-JSON: ${String(raw).slice(0, 200)}`);
  return parsed;
}

async function readJsonl(file) {
  const text = await fsp.readFile(file, 'utf8');
  return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
}

async function appendJsonl(file, rows) {
  if (!rows.length) return;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.appendFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

async function main() {
  const cards = (await readJsonl(INPUT)).slice(0, LIMIT);
  if (!cards.length) throw new Error(`no cards in ${INPUT}`);

  const stats = { total: cards.length, local_ok: 0, local_failed: 0, cloud_ok: 0, cloud_failed: 0, db_inserted: 0, db_skipped: 0 };
  const results = [];

  // 1) 本地批次
  for (const card of cards) {
    let translated = null;
    let validation = null;
    let localError = null;
    try {
      translated = await localTranslate(card);
      validation = validateTranslation(card, translated, LANG_BASE, { script: LANG_SCRIPT });
    } catch (error) {
      localError = error.message;
    }
    if (localError || !validation?.ok) {
      stats.local_failed += 1;
      const failures = localError ? [{ code: 'LOCAL_ERROR', detail: localError }] : validation.failures;
      // Tier 3（小众/非洲/中东）：本地失败标记 locale_needs_cloud，等待云端复核
      if (LANG_TIER === 3) {
        await appendJsonl(LOCALE_NEEDS_CLOUD, [{ id: card.id, lang: LANG, tier: LANG_TIER, card, local_output: translated, failures, at: new Date().toISOString() }]);
        results.push({ id: card.id, route: 'locale_needs_cloud', local_failures: failures });
        console.log(`[local] ${card.id} FAILED -> locale_needs_cloud (${failures.map((f) => f.code).join(',')})`);
      } else {
        await appendJsonl(POOL, [{ id: card.id, lang: LANG, card, local_output: translated, failures, at: new Date().toISOString() }]);
        results.push({ id: card.id, route: 'cloud_pending', local_failures: failures });
        console.log(`[local] ${card.id} FAILED -> cloud_retry_pool (${failures.map((f) => f.code).join(',')})`);
      }
    } else {
      stats.local_ok += 1;
      const localeCard = { ...translated, locale: LANG, status: 'draft' };
      await appendJsonl(OUT, [localeCard]);
      results.push({ id: card.id, route: 'local', validation: 'passed' });
      console.log(`[local] ${card.id} OK -> ${OUT}`);
    }
  }

  // 2) 读取 retry pool，云端兜底
  if (fs.existsSync(POOL) && CLOUD_MODE !== 'off') {
    const poolRows = await readJsonl(POOL);
    // 同一卡片同一语种只处理一次（保留最后一条）
    const latest = new Map();
    for (const row of poolRows) {
      if (row.lang === LANG) latest.set(row.id, row);
    }
    const pending = [...latest.values()];
    const keepAfter = poolRows.filter((row) => row.lang !== LANG);
    for (const row of pending) {
      const { card } = row;
      let pass = null;
      let lastFailures = null;
      for (let attempt = 0; attempt < 2 && !pass; attempt += 1) {
        try {
          const translated = await cloudTranslate(card);
          const validation = validateTranslation(card, translated, LANG_BASE, { script: LANG_SCRIPT });
          if (validation.ok) pass = translated;
          else lastFailures = validation.failures;
        } catch (error) {
          lastFailures = [{ code: 'CLOUD_ERROR', detail: error.message }];
        }
      }
      if (pass) {
        stats.cloud_ok += 1;
        const localeCard = { ...pass, locale: LANG, status: 'draft', _route: 'cloud' };
        await appendJsonl(OUT, [localeCard]);
        results.push({ id: card.id, route: 'cloud', validation: 'passed' });

        if (DB_PATH) {
          const db = openDatabase(path.resolve(ROOT, DB_PATH));
          migrateSchema(db);
          const dao = createDao(db);
          const knowledgeId = `kb_${LANG}_${card.id}`;
          if (dao.findGlobalKnowledge(knowledgeId)) {
            stats.db_skipped += 1;
          } else {
            dao.createGlobalKnowledge({
              id: knowledgeId,
              title: String(pass.title || card.title).slice(0, 180),
              content: String(pass.content || ''),
              tags: Array.isArray(pass.tags) ? pass.tags : [],
              language: LANG,
              locale: LANG,
              status: 'draft',
              audience: 'seller',
              category: '广告与营销',
              source_id: 'manual_editor',
              structured_payload: { source_card: card, translation: pass, target_lang: LANG, route: 'cloud_fallback' },
            });
            stats.db_inserted += 1;
          }
          closeDatabase(db);
        }
      } else {
        stats.cloud_failed += 1;
        results.push({ id: card.id, route: 'cloud_failed', failures: lastFailures });
        keepAfter.push({ id: card.id, lang: LANG, card, failures: lastFailures, cloud_failed: true, at: new Date().toISOString() });
        console.log(`[cloud] ${card.id} FAILED (${(lastFailures || []).map((f) => f.code).join(',')})`);
      }
    }
    // 重写 retry pool：成功的行移除，云端仍失败的行保留，其他语种不动
    await fsp.writeFile(POOL, keepAfter.map((row) => JSON.stringify(row)).join('\n') + (keepAfter.length ? '\n' : ''));
  }

  const report = {
    at: new Date().toISOString(), lang: LANG, local_mode: LOCAL_MODE, cloud_mode: CLOUD_MODE,
    input: INPUT, output: OUT, pool: POOL, db: DB_PATH || null, stats, results,
  };
  await fsp.mkdir(path.dirname(REPORT), { recursive: true });
  await fsp.writeFile(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(stats, null, 2));
  console.log(`report: ${REPORT}`);
  if (stats.cloud_failed > 0) process.exitCode = 2;
}

main().catch((error) => { console.error('[fatal]', error.message); process.exit(1); });
