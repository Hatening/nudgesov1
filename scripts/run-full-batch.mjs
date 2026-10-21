#!/usr/bin/env node
/**
 * 分夜全量跑批：按 300 张/批切分，8 并发，断点续跑。
 *
 * 用法：
 *   node scripts/run-full-batch.mjs --split-only
 *   node scripts/run-full-batch.mjs --batch 1 --workers 8
 *
 * 策略与 Phase 1 一致：Tier 1 阈值 4.5，Tier 2 阈值 4.8；本地单次；20% 分层 Judge；
 * 盲盒规则；云端 4.5~4.79 边界定向润色；失败进 manual_review.jsonl。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { validateTranslation } from './lib/translate-validate.mjs';
import { loadGlossary, glossaryPromptBlock } from './lib/glossary.mjs';
import { checkBlindBox } from './lib/quality-guards.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);
const LIMIT = Number(arg('limit', '300'));
const WORKERS = Math.max(1, Math.min(16, Number(arg('workers', '8'))));
const BATCH_INDEX = Number(arg('batch', '1'));
const SPLIT_ONLY = has('split-only');
const BATCH_DIR = path.resolve(arg('batch-dir', 'reports/translate/batches'));
const DB_PATH = path.resolve(arg('db', '.data/full-batch.sqlite'));
const SOURCE_DB = path.resolve(arg('source-db', '.data/relaydesk.sqlite'));
const LOCAL_BASE = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const LOCAL_MODEL = process.env.LOCAL_MODEL_NAME || 'qwen3.8-35b-a3b@q5_k_m';
const CLOUD_BASE = (process.env.CLOUD_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const CLOUD_MODEL = process.env.CLOUD_MODEL_NAME || 'deepseek-flash';
const SEED = 20261022;
const PRICE = { inputPerMTokens: 0.28 * 7.2, outputPerMTokens: 0.42 * 7.2 };

const LANGS = [
  { code: 'en-US', base: 'en', name: '英语', tier: 1, threshold: 4.5, script: 'Latn' },
  { code: 'es-ES', base: 'es', name: '西班牙语', tier: 1, threshold: 4.5, script: 'Latn' },
  { code: 'de-DE', base: 'de', name: '德语', tier: 1, threshold: 4.5, script: 'Latn' },
  { code: 'fr-FR', base: 'fr', name: '法语', tier: 1, threshold: 4.5, script: 'Latn' },
  { code: 'pl-PL', base: 'pl', name: '波兰语', tier: 2, threshold: 4.8, script: 'Latn' },
];
const LANG_HINTS = {
  de: '【德语重点】Reverse Logistics => Rückwärtslogistik；Disposition（处置）用 Bearbeitung/Verwertung；failure modes => Fehlerarten；注意冠词与格。',
  fr: '【法语重点】普通名词句中不要大写（Retours => retours）；shipping => Expédition/Envoi；élimination 不要用于“处置”，用 gestion/disposition；s’intégrer à。',
  pl: '【波兰语重点】na etapie（不是 w etapie）；failure modes => typy błędów；refund => zwrot pieniędzy。',
  es: '【西语重点】fulfillment center => centro logístico；palletización => paletización；usted/ustedes 一致。',
  en: '',
};

const glossary = loadGlossary();

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

async function chat({ base, model, headers = {}, prompt, jsonMode = false, timeout = 240000, temperature = 0.2 }) {
  const body = {
    model, temperature, max_tokens: 6000,
    messages: [
      { role: 'system', content: '你是严谨的本地化客服质量专家。严格遵循提示词。' },
      { role: 'user', content: prompt },
    ],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content || '', usage: data.usage || null };
}

function localPrompt(card, lang) {
  return `【顶部锚点】你是${lang.name}本地金牌客服。数字、符号、JSON Key（id/title/content/tags/category）绝不能改；条件、例外、步骤不得删减。
${LANG_HINTS[lang.base] || ''}
【术语表】
${glossaryPromptBlock(glossary, lang.base)}
【原文 JSON】
${JSON.stringify(card, null, 2)}
【底部重锚】只输出 JSON；自查 Key 一致、content 非空、数字完整、专有名词（ShipBob/Amazon/FBA）原样保留。`;
}

function cloudPrompt(card, lang, issues = []) {
  return `你不是翻译机器，你是${lang.name}本地资深客服。请直接生成一份目标 ${lang.threshold} 分以上的高质量母语知识卡。
保留全部事实、条件、例外、数字与符号；专有名词（ShipBob/Amazon/FBA）保持原样；返回 JSON，Key 与原文完全一致；只输出 JSON。
${LANG_HINTS[lang.base] || ''}
${glossaryPromptBlock(glossary, lang.base)}
${issues.length ? `上一轮问题：\n${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}
原文：
${JSON.stringify(card, null, 2)}`;
}

function polishPrompt(card, lang, translated, issues = []) {
  return `这是${lang.name}机器翻译，云端评分 4.5~4.79，只差一点。只修下面扣分项，不要重写、不要增删事实、不要改数字与专有名词。
扣分项：
${issues.map((s, i) => `${i + 1}. ${s}`).join('\n') || '语法与商业敬语细节'}
返回与原 JSON 完全相同的 Key（id/title/content/tags/category），只输出 JSON。
原文：${JSON.stringify(card)}
当前译文：${JSON.stringify(translated)}`;
}

function scorePrompt(card, translated, lang) {
  return `你是${lang.name}母语客服质量评审，按 1-5 分严苛打分（允许 0.1 分档）。
5=母语者水准；4.8=可直接商用；4.5=商业可接受；4.0=可交付但有瑕疵；3.x=不可商用。
检查：语法/介词、敬语、术语、语义偏移、增译漏译、数字符号、英文混杂。
只输出 JSON：{"score":4.5,"detected_language":"${lang.base}","grammar_ok":true,"issues":["..."]}
原文：${JSON.stringify(card)}
译文：${JSON.stringify(translated)}`;
}

function physical(card, translated, lang) {
  if (!translated) return { ok: false, failures: [{ code: 'JSON_INVALID', detail: 'missing translation' }] };
  const validation = validateTranslation(card, translated, lang.base, { script: lang.script, glossary });
  const blind = checkBlindBox(card, translated);
  const failures = [...(validation.ok ? [] : validation.failures), ...(blind.ok ? [] : blind.failures)];
  return { ok: failures.length === 0, failures };
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

async function splitBatches() {
  await fsp.mkdir(BATCH_DIR, { recursive: true });
  const cards = await selectCards();
  const files = [];
  for (let i = 0; i < cards.length; i += LIMIT) {
    const no = Math.floor(i / LIMIT) + 1;
    const file = path.join(BATCH_DIR, `batch-${String(no).padStart(4, '0')}.jsonl`);
    await fsp.writeFile(file, cards.slice(i, i + LIMIT).map((c) => JSON.stringify(c)).join('\n') + '\n');
    files.push({ no, file, count: Math.min(LIMIT, cards.length - i) });
  }
  await fsp.writeFile(path.join(BATCH_DIR, 'manifest.json'), JSON.stringify({ total_cards: cards.length, limit: LIMIT, batches: files }, null, 2));
  console.log(`split ${cards.length} cards into ${files.length} batches (limit ${LIMIT}) at ${BATCH_DIR}`);
  return files;
}

async function main() {
  await fsp.mkdir(BATCH_DIR, { recursive: true });
  if (SPLIT_ONLY) { await splitBatches(); return; }
  const batchFile = path.join(BATCH_DIR, `batch-${String(BATCH_INDEX).padStart(4, '0')}.jsonl`);
  if (!fs.existsSync(batchFile)) await splitBatches();
  const cards = fs.readFileSync(batchFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const progressFile = path.join(BATCH_DIR, `batch-${String(BATCH_INDEX).padStart(4, '0')}.progress.jsonl`);
  const manualFile = path.join(BATCH_DIR, `batch-${String(BATCH_INDEX).padStart(4, '0')}.manual_review.jsonl`);
  const completed = new Set();
  if (fs.existsSync(progressFile)) {
    for (const line of fs.readFileSync(progressFile, 'utf8').split('\n').filter(Boolean)) {
      try { completed.add(JSON.parse(line).key); } catch {}
    }
  }
  const workedCards = new Set([...completed].map((k) => k.split('::')[0]));
  const remainingCards = cards.filter((c) => !workedCards.has(c.id));

  const rand = mulberry32(SEED);
  const sampleKeys = new Set();
  for (const lang of LANGS) {
    const order = [...cards.keys()].sort(() => rand() - 0.5);
    for (const idx of order.slice(0, Math.max(1, Math.round(cards.length * 0.2)))) sampleKeys.add(`${lang.code}::${cards[idx].id}`);
  }
  await fsp.writeFile(path.join(BATCH_DIR, `batch-${String(BATCH_INDEX).padStart(4, '0')}.sampling.json`), JSON.stringify([...sampleKeys], null, 2));

  const cloudHeaders = loadCloudAuth();
  const jobs = [];
  for (const card of remainingCards) for (const lang of LANGS) {
    const key = `${card.id}::${lang.code}`;
    if (!completed.has(key)) jobs.push({ card, lang, key, sampled: sampleKeys.has(key) });
  }
  console.log(`[batch ${BATCH_INDEX}] cards=${cards.length} remaining_cards=${remainingCards.length} jobs=${jobs.length} workers=${WORKERS} completed_before=${completed.size}`);

  let cursor = 0;
  const stats = { jobs: jobs.length, admitted: 0, local_basic: 0, local_sampled: 0, cloud: 0, manual: 0, local_attempts: 0, cloud_calls: 0, judge_calls: 0, tokens_in: 0, tokens_out: 0, local_ms: 0 };
  let writeChain = Promise.resolve();
  const append = (file, row) => {
    writeChain = writeChain.then(() => fsp.appendFile(file, JSON.stringify(row) + '\n')).catch(() => {});
    return writeChain;
  };

  const score = async (card, translated, lang) => {
    stats.judge_calls += 1; stats.cloud_calls += 1;
    try {
      const r = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: scorePrompt(card, translated, lang), jsonMode: true, timeout: 120000, temperature: 0 });
      stats.tokens_in += Number(r.usage?.prompt_tokens || 0); stats.tokens_out += Number(r.usage?.completion_tokens || 0);
      const p = extractJson(r.content) || {};
      return { score: Number(p.score) || 0, grammar_ok: Boolean(p.grammar_ok), detected_language: p.detected_language || null, issues: Array.isArray(p.issues) ? p.issues : [] };
    } catch (error) {
      return { score: 0, grammar_ok: false, issues: [error.message] };
    }
  };

  const runJob = async (job) => {
    const { card, lang, sampled } = job;
    let local = null;
    stats.local_attempts += 1;
    try {
      const r = await chat({ base: LOCAL_BASE, model: LOCAL_MODEL, headers: {}, prompt: localPrompt(card, lang), jsonMode: false, temperature: 0.2 });
      local = { translated: extractJson(r.content), usage: r.usage, ms: 0 };
      stats.tokens_out += 0;
    } catch (error) {
      local = { translated: null, error: error.message };
    }
    const check = physical(card, local.translated, lang);
    let translated = local.translated;
    let route = null;
    let finalScore = null;

    if (check.ok && !sampled) {
      route = 'local_basic';
      stats.local_basic += 1;
      stats.admitted += 1;
    } else {
      let issues = check.ok ? [] : check.failures.map((f) => `${f.code}: ${f.detail}`);
      if (check.ok && sampled) {
        const s = await score(card, translated, lang);
        finalScore = s.score;
        if (s.score >= lang.threshold && s.grammar_ok && s.detected_language === lang.base) {
          route = 'local_sampled';
          stats.local_sampled += 1;
          stats.admitted += 1;
        } else {
          issues = s.issues;
        }
      }
      if (!route) {
        for (let attempt = 0; attempt < 2 && !route; attempt += 1) {
          stats.cloud_calls += 1;
          try {
            const r = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: cloudPrompt(card, lang, issues), jsonMode: true, timeout: 180000, temperature: 0.2 });
            stats.tokens_in += Number(r.usage?.prompt_tokens || 0); stats.tokens_out += Number(r.usage?.completion_tokens || 0);
            const parsed = extractJson(r.content);
            const c = physical(card, parsed, lang);
            if (!c.ok) { issues = c.failures.map((f) => `${f.code}: ${f.detail}`); continue; }
            const mustScore = sampled || !check.ok;
            if (!mustScore) {
              translated = parsed; route = 'cloud_basic'; stats.cloud += 1; stats.admitted += 1; break;
            }
            let s = await score(card, parsed, lang);
            finalScore = s.score;
            if (s.score >= 4.5 && s.score < lang.threshold) {
              try {
                const pr = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: polishPrompt(card, lang, parsed, s.issues), jsonMode: true, timeout: 180000, temperature: 0.2 });
                stats.tokens_in += Number(pr.usage?.prompt_tokens || 0); stats.tokens_out += Number(pr.usage?.completion_tokens || 0);
                const polished = extractJson(pr.content);
                if (polished && physical(card, polished, lang).ok) {
                  const ps = await score(card, polished, lang);
                  if (ps.score > s.score) { parsed = polished; s = ps; finalScore = ps.score; }
                }
              } catch {}
            }
            if (s.score >= lang.threshold && s.grammar_ok && s.detected_language === lang.base) {
              translated = parsed; route = 'cloud_sampled'; stats.cloud += 1; stats.admitted += 1;
            } else {
              issues = s.issues;
            }
          } catch (error) {
            issues = [error.message];
          }
        }
      }
    }
    if (!route) { route = 'manual_review'; stats.manual += 1; }
    const record = { key: job.key, card_id: card.id, lang: lang.code, route, score: finalScore, sampled, at: new Date().toISOString() };
    await append(progressFile, record);
    if (route === 'manual_review') await append(manualFile, { ...record, title: card.title });
    // 入库
    if (route !== 'manual_review' && translated) {
      const db = openDatabase(DB_PATH);
      migrateSchema(db);
      const dao = createDao(db);
      const id = `kb_${lang.code}_${card.id}`;
      if (!dao.findGlobalKnowledge(id)) {
        dao.createGlobalKnowledge({
          id, title: String(translated.title || '').slice(0, 180), content: String(translated.content || ''),
          tags: Array.isArray(translated.tags) ? translated.tags : [],
          language: lang.base, locale: lang.code, status: 'draft', audience: 'seller', category: '其他',
          source_id: 'manual_editor', structured_payload: { route, score: finalScore, sampled },
        });
      }
      closeDatabase(db);
    }
    console.log(`[${job.key}] ${route}${finalScore ? ` score=${finalScore}` : ''}`);
  };

  const worker = async () => {
    while (true) {
      const index = cursor; cursor += 1;
      if (index >= jobs.length) return;
      try { await runJob(jobs[index]); } catch (error) { console.error(`[job error] ${error.message}`); }
    }
  };
  const started = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, () => worker()));
  await writeChain;

  const report = {
    batch: BATCH_INDEX, workers: WORKERS, cards: cards.length, jobs: jobs.length,
    duration_ms: Date.now() - started, stats,
    manual_review_rate: Number(((stats.manual / Math.max(1, jobs.length)) * 100).toFixed(1)),
    cost_cny: Number((((stats.tokens_in / 1e6) * PRICE.inputPerMTokens) + ((stats.tokens_out / 1e6) * PRICE.outputPerMTokens)).toFixed(4)),
    progress_file: progressFile,
  };
  await fsp.writeFile(path.join(BATCH_DIR, `batch-${String(BATCH_INDEX).padStart(4, '0')}.report.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error('[fatal]', error.message); process.exit(1); });
