#!/usr/bin/env node
/**
 * 商业化分级路由模拟（10 卡：5 pl / 5 es）
 *
 * 新策略：
 *  - Tier 1（es-ES）：阈值 4.5；本地 Qwen 只跑 1 次；达标入库，否则云端
 *  - Tier 2（pl-PL）：阈值 4.8；本地只跑 1 次；达标入库，否则云端
 *  - 云端 Judge 只抽查 20% 卡片（固定随机种子），或本地结构破损时强制打分
 *  - 其余卡片用「基础语法 + 术语关键词」校验直接入库
 *  - 云端兜底仍失败 → manual_review
 *
 * 同时用上一轮 4.8 重试策略的真实数据做成本基线，计算成本下降百分比。
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
const CARDS_PATH = path.resolve(arg('cards', 'reports/translate/quality-cards.jsonl'));
const OUT_DIR = path.resolve(arg('out-dir', 'reports/translate/pilot-tiered'));
const LOCAL_BASE = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const LOCAL_MODEL = process.env.LOCAL_MODEL_NAME || 'qwen3.8-35b-a3b@q5_k_m';
const CLOUD_BASE = (process.env.CLOUD_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const CLOUD_MODEL = process.env.CLOUD_MODEL_NAME || 'deepseek-flash';
const DB_PATH = path.resolve(arg('db', '.data/translate-tiered.sqlite'));
const SAMPLE_RATE = 0.2;
const SEED = 20261021;
const PRICE = { inputPerMTokens: 0.28 * 7.2, outputPerMTokens: 0.42 * 7.2, kwhPrice: 0.6, powerKw: 0.5 };

const LANGS = [
  { code: 'pl-PL', base: 'pl', name: '波兰语', tier: 2, threshold: 4.8, script: 'Latn' },
  { code: 'es-ES', base: 'es', name: '西班牙语', tier: 1, threshold: 4.5, script: 'Latn' },
];
const glossary = loadGlossary();
const cards = fs.readFileSync(CARDS_PATH, 'utf8').split('\n').filter(Boolean).map(JSON.parse);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const sampleKeys = new Set(
  [...Array(10).keys()].sort(() => rand() - 0.5).slice(0, Math.round(10 * SAMPLE_RATE)).map((i) => `${LANGS[Math.floor(i / 5)].code}:${cards[i % 5].id}`),
);

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

async function chat({ base, model, headers = {}, prompt, jsonMode = false, timeout = 240000, temperature = 0.1 }) {
  const started = Date.now();
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content || '', usage: data.usage || null, ms: Date.now() - started };
}

function localPrompt(card, lang) {
  return `【顶部锚点】你是${lang.name}本地金牌客服。数字、符号、JSON Key（id/title/content/tags/category）绝不能改；条件、例外、步骤不得删减。
【术语表】
${glossaryPromptBlock(glossary, lang.base)}
【原文 JSON】
${JSON.stringify(card, null, 2)}
【底部重锚】只输出 JSON；自查 Key 一致、content 非空、数字完整、术语来自术语表。`;
}

function cloudPrompt(card, lang, issues = []) {
  return `你不是翻译机器，你是${lang.name}本地资深客服。请直接生成一份目标 ${lang.threshold} 分以上的高质量母语知识卡。
保留全部事实、条件、例外、数字与符号；返回 JSON，Key 与原文完全一致（id/title/content/tags/category）；只输出 JSON。
${glossaryPromptBlock(glossary, lang.base)}
${issues.length ? `上一轮问题：\n${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}
原文：
${JSON.stringify(card, null, 2)}`;
}

function scorePrompt(card, translated, lang) {
  return `你是${lang.name}母语客服质量评审，按 1-5 分严苛打分（允许 0.1 分档）。
5=母语者水准；4.8=可直接商用；4.5=商业可接受；4.0=可交付但有瑕疵；3.x=不可商用。
检查：语法/介词、敬语、术语、语义偏移、增译漏译、数字符号、英文混杂。
只输出 JSON：{"score":4.5,"detected_language":"${lang.base}","grammar_ok":true,"issues":["..."]}
原文：${JSON.stringify(card)}
译文：${JSON.stringify(translated)}`;
}

async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const cloudHeaders = loadCloudAuth();
  const records = [];
  let localMs = 0; let localTokens = 0; let localAttempts = 0;
  let cloudCalls = 0; let cloudIn = 0; let cloudOut = 0; let judgeCalls = 0;

  for (const lang of LANGS) {
    for (const card of cards) {
      const key = `${lang.code}:${card.id}`;
      const sampled = sampleKeys.has(key);
      const record = { lang: lang.code, tier: lang.tier, threshold: lang.threshold, card_id: card.id, title: card.title, sampled, judge_calls: 0, route: null, admitted: false };

      // 本地只跑 1 次
      localAttempts += 1;
      let local = null;
      try {
        const result = await chat({ base: LOCAL_BASE, model: LOCAL_MODEL, headers: {}, prompt: localPrompt(card, lang), jsonMode: false, temperature: 0.2 });
        localMs += result.ms;
        localTokens += Number(result.usage?.completion_tokens || 0);
        local = { translated: extractJson(result.content), usage: result.usage, ms: result.ms };
      } catch (error) {
        local = { translated: null, error: error.message, ms: 0 };
      }
      const validation = local.translated
        ? validateTranslation(card, local.translated, lang.base, { script: lang.script, glossary })
        : { ok: false, failures: [{ code: 'LOCAL_ERROR', detail: local.error || 'non-JSON' }] };
      record.local = { validation_ok: validation.ok, failures: validation.ok ? [] : validation.failures, ms: local.ms, tokens: local.usage?.completion_tokens || 0, translated: local.translated };

      // 结构破损 → 强制云端
      if (!validation.ok) {
        record.route = 'cloud_structural';
        record.force_score = true;
      } else if (sampled) {
        // 抽样卡：云端打分
        judgeCalls += 1; cloudCalls += 1;
        const score = await (async () => {
          try {
            const r = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: scorePrompt(card, local.translated, lang), jsonMode: true, timeout: 120000, temperature: 0 });
            cloudIn += Number(r.usage?.prompt_tokens || 0); cloudOut += Number(r.usage?.completion_tokens || 0);
            const p = extractJson(r.content) || {};
            return { score: Number(p.score) || 0, grammar_ok: Boolean(p.grammar_ok), detected_language: p.detected_language || null, issues: Array.isArray(p.issues) ? p.issues : [] };
          } catch (error) {
            return { score: 0, grammar_ok: false, issues: [error.message] };
          }
        })();
        record.judge = score;
        if (score.score >= lang.threshold && score.grammar_ok) {
          record.route = 'local_sampled_pass';
          record.admitted = true;
          record.final_score = score.score;
          record.translated = local.translated;
        } else {
          record.route = 'cloud_below_threshold';
          record.seed_issues = score.issues;
        }
      } else {
        // 80% 非抽样：基础校验通过直接入库
        record.route = 'local_basic_pass';
        record.admitted = true;
        record.final_score = null;
        record.translated = local.translated;
      }

      // 云端兜底
      if (!record.admitted) {
        let issues = record.seed_issues || (validation.ok ? [] : validation.failures.map((f) => `${f.code}: ${f.detail}`));
        for (let attempt = 0; attempt < 2 && !record.admitted; attempt += 1) {
          cloudCalls += 1;
          try {
            const r = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: cloudPrompt(card, lang, issues), jsonMode: true, timeout: 180000, temperature: 0.2 });
            cloudIn += Number(r.usage?.prompt_tokens || 0); cloudOut += Number(r.usage?.completion_tokens || 0);
            const parsed = extractJson(r.content);
            if (!parsed) { issues = ['云端非 JSON']; continue; }
            const cv = validateTranslation(card, parsed, lang.base, { script: lang.script, glossary });
            if (!cv.ok) { issues = cv.failures.map((f) => `${f.code}: ${f.detail}`); continue; }
            const mustScore = sampled || record.force_score;
            if (!mustScore) {
              record.route = record.route === 'cloud_structural' ? 'cloud_basic_pass' : 'cloud_basic_pass';
              record.admitted = true;
              record.translated = parsed;
              record.final_score = null;
              break;
            }
            judgeCalls += 1; cloudCalls += 1;
            const sr = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: scorePrompt(card, parsed, lang), jsonMode: true, timeout: 120000, temperature: 0 });
            cloudIn += Number(sr.usage?.prompt_tokens || 0); cloudOut += Number(sr.usage?.completion_tokens || 0);
            const sp = extractJson(sr.content) || {};
            const score = { score: Number(sp.score) || 0, grammar_ok: Boolean(sp.grammar_ok), detected_language: sp.detected_language || null, issues: Array.isArray(sp.issues) ? sp.issues : [] };
            record.cloud_score = score;
            if (score.score >= lang.threshold && score.grammar_ok) {
              record.route = 'cloud_sampled_pass';
              record.admitted = true;
              record.translated = parsed;
              record.final_score = score.score;
            } else {
              issues = score.issues.length ? score.issues : [`评分 ${score.score} 未达 ${lang.threshold}`];
            }
          } catch (error) {
            issues = [error.message];
          }
        }
        if (!record.admitted) record.route = 'manual_review';
      }

      console.log(`[${lang.code}] ${card.id} sampled=${sampled} -> ${record.route} score=${record.final_score ?? '—'} judge=${judgeCalls}`);
      records.push(record);
    }
  }

  // 入库
  let inserted = 0;
  for (const record of records.filter((r) => r.admitted)) {
    const db = openDatabase(DB_PATH);
    migrateSchema(db);
    const dao = createDao(db);
    const id = `kb_${record.lang}_${record.card_id}`;
    if (!dao.findGlobalKnowledge(id)) {
      dao.createGlobalKnowledge({
        id, title: String(record.translated?.title || '').slice(0, 180), content: String(record.translated?.content || ''),
        tags: Array.isArray(record.translated?.tags) ? record.translated.tags : [],
        language: record.lang.split('-')[0], locale: record.lang, status: 'draft', audience: 'seller', category: '其他',
        source_id: 'manual_editor', structured_payload: { route: record.route, score: record.final_score, sampled: record.sampled },
      });
      inserted += 1;
    }
    closeDatabase(db);
  }

  const localEnergy = (PRICE.powerKw * (localMs / 3600000)) * PRICE.kwhPrice;
  const cloudCost = (cloudIn / 1e6) * PRICE.inputPerMTokens + (cloudOut / 1e6) * PRICE.outputPerMTokens;
  const newCost = localEnergy + cloudCost;

  // 旧策略基线（4.8 + 3 次重试）
  let oldCloudIn = 8410; let oldCloudOut = 30517; let oldLocalMs = 0;
  try {
    const oldSummary = JSON.parse(fs.readFileSync('reports/translate/pilot-routing/summary.json', 'utf8'));
    oldCloudIn = oldSummary.cloud_tokens?.input || oldCloudIn;
    oldCloudOut = oldSummary.cloud_tokens?.output || oldCloudOut;
    const oldRecords = fs.readFileSync('reports/translate/pilot-routing/records.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    oldLocalMs = oldRecords.reduce((sum, r) => sum + (r.attempts || []).reduce((s, a) => s + (a.ms || 0), 0), 0);
  } catch { /* baseline fallback */ }
  const oldEnergy = (PRICE.powerKw * (oldLocalMs / 3600000)) * PRICE.kwhPrice;
  const oldCost = oldEnergy + (oldCloudIn / 1e6) * PRICE.inputPerMTokens + (oldCloudOut / 1e6) * PRICE.outputPerMTokens;
  const reduction = oldCost ? Number((((oldCost - newCost) / oldCost) * 100).toFixed(1)) : 0;

  const summary = {
    total: records.length,
    admitted: records.filter((r) => r.admitted).length,
    local_basic_pass: records.filter((r) => r.route === 'local_basic_pass').length,
    local_sampled_pass: records.filter((r) => r.route === 'local_sampled_pass').length,
    cloud_basic_pass: records.filter((r) => r.route === 'cloud_basic_pass').length,
    cloud_sampled_pass: records.filter((r) => r.route === 'cloud_sampled_pass').length,
    manual_review: records.filter((r) => r.route === 'manual_review').length,
    sampled_cards: [...sampleKeys],
    sample_rate: SAMPLE_RATE,
    judge_calls: judgeCalls,
    cloud_calls: cloudCalls,
    local_attempts: localAttempts,
    local_ms: localMs,
    local_tokens: localTokens,
    cloud_tokens: { input: cloudIn, output: cloudOut },
    manual_review_rate: Number(((records.filter((r) => r.route === 'manual_review').length / records.length) * 100).toFixed(1)),
    costs: {
      old_cny: Number(oldCost.toFixed(6)),
      new_cny: Number(newCost.toFixed(6)),
      reduction_pct: reduction,
      old_cloud_tokens: { input: oldCloudIn, output: oldCloudOut },
      new_cloud_tokens: { input: cloudIn, output: cloudOut },
      local_energy_cny: Number(localEnergy.toFixed(6)),
      cloud_cny: Number(cloudCost.toFixed(6)),
    },
  };
  await fsp.writeFile(path.join(OUT_DIR, 'records.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await fsp.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  const lines = [];
  lines.push('# 分级阈值 + 抽样 Judge 商业化模拟（10 卡）');
  lines.push('');
  lines.push(`- pl-PL：Tier 2，阈值 ${LANGS[0].threshold}；es-ES：Tier 1，阈值 ${LANGS[1].threshold}`);
  lines.push(`- 本地 Qwen 每卡只跑 1 次；云端 Judge 抽样 ${SAMPLE_RATE * 100}%（${[...sampleKeys].join('、')}）`);
  lines.push('');
  lines.push('| 语种 | 卡片 | 抽样 | 路由 | 分数 | 入库 |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of records) lines.push(`| ${r.lang} | ${r.title.slice(0, 20)}… | ${r.sampled ? '是' : '否'} | ${r.route} | ${r.final_score ?? '—'} | ${r.admitted ? '✅' : '❌'} |`);
  lines.push('');
  lines.push('## 指标');
  lines.push('');
  lines.push(`- 入库：${summary.admitted}/${summary.total}`);
  lines.push(`- 本地基础校验直接入库：${summary.local_basic_pass}；本地抽样通过：${summary.local_sampled_pass}`);
  lines.push(`- 云端基础校验入库：${summary.cloud_basic_pass}；云端抽样通过：${summary.cloud_sampled_pass}`);
  lines.push(`- manual_review：${summary.manual_review}（${summary.manual_review_rate}%）`);
  lines.push(`- Judge 调用：${summary.judge_calls} 次（旧策略 53 次云端调用）`);
  lines.push('');
  lines.push('## 成本');
  lines.push('');
  lines.push(`- 旧策略：¥${summary.costs.old_cny}（本地电费 + ${oldCloudIn}/${oldCloudOut} cloud tokens）`);
  lines.push(`- 新策略：¥${summary.costs.new_cny}（本地电费 ¥${summary.costs.local_energy_cny} + 云端 ¥${summary.costs.cloud_cny}）`);
  lines.push(`- **成本下降：${summary.costs.reduction_pct}%**`);
  lines.push('');
  await fsp.writeFile(path.join(OUT_DIR, 'report.md'), lines.join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`report: ${path.join(OUT_DIR, 'report.md')}`);
}

main().catch((error) => { console.error('[fatal]', error.message); process.exit(1); });
