#!/usr/bin/env node
/**
 * 扩量验证（25 张：5 卡 × en/es/de/fr/pl）
 *
 * 新策略：
 *  - Tier 1（en/es/de/fr）：阈值 4.5；Tier 2（pl）：阈值 4.8
 *  - 本地 Qwen 每卡只跑 1 次
 *  - 盲盒规则：长度比例 0.5~1.5；ShipBob 等专有名词必须原样保留
 *  - 云端 Judge 分层抽样 20%（每个语种随机 1 张）
 *  - 云端 4.5~4.79 的边界卡：触发 1 次定向润色，再评分
 *  - 非抽样卡：基础校验 + 盲盒规则通过即可入库；每 100 张抽 5 张复查
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { validateTranslation } from './lib/translate-validate.mjs';
import { loadGlossary, glossaryPromptBlock } from './lib/glossary.mjs';
import { checkBlindBox } from './lib/quality-guards.mjs';
import { BasicAcceptanceAuditor } from './lib/audit.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};
const CARDS_PATH = path.resolve(arg('cards', 'reports/translate/quality-cards.jsonl'));
const OUT_DIR = path.resolve(arg('out-dir', 'reports/translate/pilot-expanded'));
const LOCAL_BASE = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const LOCAL_MODEL = process.env.LOCAL_MODEL_NAME || 'qwen3.8-35b-a3b@q5_k_m';
const CLOUD_BASE = (process.env.CLOUD_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const CLOUD_MODEL = process.env.CLOUD_MODEL_NAME || 'deepseek-flash';
const DB_PATH = path.resolve(arg('db', '.data/translate-expanded.sqlite'));
const SEED = 20261022;
const SAMPLE_PER_LANG = 1;
const LANG_HINTS = {
  de: '【德语重点】Reverse Logistics => Rückwärtslogistik；Disposition（处置）不要直译，用 Bearbeitung/Verwertung；failure modes => Fehlerarten；注意冠词与格。',
  fr: '【法语重点】普通名词句中不要大写（Retours => retours）；shipping => Expédition/Envoi；élimination 不要用于“处置”，用 gestion/disposition；s’intégrer à。',
  pl: '【波兰语重点】na etapie（不是 w etapie）；failure modes => typy błędów；inventory inaccuracies => nieścisłości w stanach magazynowych；refund => zwrot pieniędzy。',
  es: '【西语重点】fulfillment center => centro logístico；palletización => paletización；注意 usted/ustedes 一致。',
  en: '',
};
const PRICE = { inputPerMTokens: 0.28 * 7.2, outputPerMTokens: 0.42 * 7.2, kwhPrice: 0.6, powerKw: 0.5 };

const LANGS = [
  { code: 'en-US', base: 'en', name: '英语', tier: 1, threshold: 4.5, script: 'Latn' },
  { code: 'es-ES', base: 'es', name: '西班牙语', tier: 1, threshold: 4.5, script: 'Latn' },
  { code: 'de-DE', base: 'de', name: '德语', tier: 1, threshold: 4.5, script: 'Latn' },
  { code: 'fr-FR', base: 'fr', name: '法语', tier: 1, threshold: 4.5, script: 'Latn' },
  { code: 'pl-PL', base: 'pl', name: '波兰语', tier: 2, threshold: 4.8, script: 'Latn' },
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
const sampleKeys = new Set();
for (const lang of LANGS) {
  const order = [...cards.keys()].sort(() => rand() - 0.5);
  for (const idx of order.slice(0, SAMPLE_PER_LANG)) sampleKeys.add(`${lang.code}:${cards[idx].id}`);
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
  const clean = String(text).replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
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
${LANG_HINTS[lang.base] || ''}
【术语表】
${glossaryPromptBlock(glossary, lang.base)}
【原文 JSON】
${JSON.stringify(card, null, 2)}
【底部重锚】只输出 JSON；自查 Key 一致、content 非空、数字（含 40% 等）完整、专有名词（ShipBob/Amazon/FBA）原样保留。`;
}

function cloudPrompt(card, lang, issues = []) {
  return `你不是翻译机器，你是${lang.name}本地资深客服。请直接生成一份目标 ${lang.threshold} 分以上的高质量母语知识卡。
保留全部事实、条件、例外、数字（含 40% 等）与符号；专有名词（ShipBob/Amazon/FBA）保持原样；返回 JSON，Key 与原文完全一致；只输出 JSON。
${LANG_HINTS[lang.base] || ''}
${glossaryPromptBlock(glossary, lang.base)}
${issues.length ? `上一轮问题：\n${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : ''}
原文：
${JSON.stringify(card, null, 2)}`;
}

function polishPrompt(card, lang, translated, issues = []) {
  return `这是${lang.name}机器翻译，云端评分 4.5~4.79，只差一点。请做定向润色：只修下面列出的扣分项，不要重写、不要增删事实、不要改数字与专有名词。
扣分项：
${issues.map((s, i) => `${i + 1}. ${s}`).join('\n') || '语法与商业敬语细节'}
必须返回与原 JSON 完全相同的 Key（id/title/content/tags/category），只输出 JSON。
原文：
${JSON.stringify(card, null, 2)}
当前译文：
${JSON.stringify(translated, null, 2)}`;
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
  return { ok: failures.length === 0, failures, validation, blind };
}

async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const cloudHeaders = loadCloudAuth();
  const auditor = new BasicAcceptanceAuditor({ batchSize: 100, sampleSize: 5, alertFailures: 2, passThreshold: 4.5 });
  const records = [];
  let localMs = 0; let localTokens = 0; let localAttempts = 0;
  let cloudCalls = 0; let cloudIn = 0; let cloudOut = 0; let judgeCalls = 0; let polishCalls = 0;

  const score = async (card, translated, lang) => {
    judgeCalls += 1; cloudCalls += 1;
    try {
      const r = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: scorePrompt(card, translated, lang), jsonMode: true, timeout: 120000, temperature: 0 });
      cloudIn += Number(r.usage?.prompt_tokens || 0); cloudOut += Number(r.usage?.completion_tokens || 0);
      const p = extractJson(r.content) || {};
      return { score: Number(p.score) || 0, grammar_ok: Boolean(p.grammar_ok), detected_language: p.detected_language || null, issues: Array.isArray(p.issues) ? p.issues : [] };
    } catch (error) {
      return { score: 0, grammar_ok: false, issues: [error.message] };
    }
  };

  const cloudFallback = async (card, lang, issues, mustScore) => {
    let translated = null;
    let lastIssues = [...issues];
    for (let attempt = 0; attempt < 2 && !translated; attempt += 1) {
      cloudCalls += 1;
      try {
        const r = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: cloudPrompt(card, lang, lastIssues), jsonMode: true, timeout: 180000, temperature: 0.2 });
        cloudIn += Number(r.usage?.prompt_tokens || 0); cloudOut += Number(r.usage?.completion_tokens || 0);
        const parsed = extractJson(r.content);
        const check = physical(card, parsed, lang);
        if (!check.ok) { lastIssues = check.failures.map((f) => `${f.code}: ${f.detail}`); continue; }
        translated = parsed;
        if (mustScore) {
          let s = await score(card, translated, lang);
          // 边界卡（仅 4.8 语种）：4.5~4.79 触发 1 次定向润色
          if (s.score >= 4.5 && s.score < lang.threshold) {
            polishCalls += 1; cloudCalls += 1;
            try {
              const pr = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: polishPrompt(card, lang, translated, s.issues), jsonMode: true, timeout: 180000, temperature: 0.2 });
              cloudIn += Number(pr.usage?.prompt_tokens || 0); cloudOut += Number(pr.usage?.completion_tokens || 0);
              const polished = extractJson(pr.content);
              const pcheck = physical(card, polished, lang);
              if (pcheck.ok) {
                const ps = await score(card, polished, lang);
                if (ps.score > s.score) { translated = polished; s = ps; }
              }
            } catch { /* keep original */ }
          }
          if (s.score >= lang.threshold && s.grammar_ok && s.detected_language === lang.base) {
            return { translated, score: s, admitted: true };
          }
          return { translated: null, score: s, admitted: false };
        }
        return { translated, score: null, admitted: true };
      } catch (error) {
        lastIssues = [error.message];
      }
    }
    return { translated: null, score: null, admitted: false };
  };

  for (const lang of LANGS) {
    for (const card of cards) {
      const key = `${lang.code}:${card.id}`;
      const sampled = sampleKeys.has(key);
      const record = { lang: lang.code, tier: lang.tier, threshold: lang.threshold, card_id: card.id, title: card.title, sampled, route: null, admitted: false };

      localAttempts += 1;
      let local = null;
      try {
        const r = await chat({ base: LOCAL_BASE, model: LOCAL_MODEL, headers: {}, prompt: localPrompt(card, lang), jsonMode: false, temperature: 0.2 });
        localMs += r.ms; localTokens += Number(r.usage?.completion_tokens || 0);
        local = { translated: extractJson(r.content), usage: r.usage, ms: r.ms };
      } catch (error) {
        local = { translated: null, error: error.message, ms: 0 };
      }
      const localCheck = physical(card, local.translated, lang);
      record.local = { ok: localCheck.ok, failures: localCheck.failures, ms: local.ms, tokens: local.usage?.completion_tokens || 0, translated: local.translated };

      if (localCheck.ok && !sampled) {
        record.route = 'local_basic_pass';
        record.admitted = true;
        record.translated = local.translated;
        auditor.recordAdmitted();
        console.log(`[${lang.code}] ${card.id} LOCAL_BASIC_PASS (blind box ok)`);
        records.push(record);
        continue;
      }

      if (localCheck.ok && sampled) {
        const s = await score(card, local.translated, lang);
        record.judge = s;
        if (s.score >= lang.threshold && s.grammar_ok && s.detected_language === lang.base) {
          record.route = 'local_sampled_pass';
          record.admitted = true;
          record.translated = local.translated;
          record.final_score = s.score;
          auditor.recordAdmitted();
          console.log(`[${lang.code}] ${card.id} LOCAL_SAMPLED_PASS score=${s.score}`);
          records.push(record);
          continue;
        }
        record.seed_issues = s.issues;
      }

      const mustScore = sampled || !localCheck.ok;
      const fallback = await cloudFallback(card, lang, localCheck.ok ? (record.seed_issues || []) : localCheck.failures.map((f) => `${f.code}: ${f.detail}`), mustScore);
      if (fallback.admitted) {
        record.route = record.sampled ? 'cloud_sampled_pass' : (localCheck.ok ? 'cloud_basic_pass' : 'cloud_structural_pass');
        record.admitted = true;
        record.translated = fallback.translated;
        record.final_score = fallback.score?.score ?? null;
        if (!mustScore) auditor.recordAdmitted();
        console.log(`[${lang.code}] ${card.id} ${record.route} score=${record.final_score ?? '—'}`);
      } else {
        record.route = 'manual_review';
        record.cloud_score = fallback.score;
        console.log(`[${lang.code}] ${card.id} MANUAL_REVIEW`);
      }
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
  // 旧策略基线：上一轮 10 卡 4.8+3 次重试 ¥0.2317 → 按卡数放大
  const oldCostPerCard = 0.231713 / 10;
  const oldCost = oldCostPerCard * records.length;
  const reduction = oldCost ? Number((((oldCost - newCost) / oldCost) * 100).toFixed(1)) : 0;

  const summary = {
    total: records.length,
    admitted: records.filter((r) => r.admitted).length,
    local_basic_pass: records.filter((r) => r.route === 'local_basic_pass').length,
    local_sampled_pass: records.filter((r) => r.route === 'local_sampled_pass').length,
    cloud_basic_pass: records.filter((r) => r.route === 'cloud_basic_pass').length,
    cloud_structural_pass: records.filter((r) => r.route === 'cloud_structural_pass').length,
    cloud_sampled_pass: records.filter((r) => r.route === 'cloud_sampled_pass').length,
    manual_review: records.filter((r) => r.route === 'manual_review').length,
    manual_review_rate: Number(((records.filter((r) => r.route === 'manual_review').length / records.length) * 100).toFixed(1)),
    sampled_keys: [...sampleKeys],
    judge_calls: judgeCalls,
    polish_calls: polishCalls,
    cloud_calls: cloudCalls,
    local_attempts: localAttempts,
    local_ms: localMs,
    local_tokens: localTokens,
    cloud_tokens: { input: cloudIn, output: cloudOut },
    audit: auditor.snapshot(),
    costs: {
      old_cny: Number(oldCost.toFixed(6)),
      new_cny: Number(newCost.toFixed(6)),
      reduction_pct: reduction,
      per_1000_cny: Number(((newCost / records.length) * 1000).toFixed(2)),
      local_energy_cny: Number(localEnergy.toFixed(6)),
      cloud_cny: Number(cloudCost.toFixed(6)),
    },
    by_lang: LANGS.map((lang) => {
      const rows = records.filter((r) => r.lang === lang.code);
      return { lang: lang.code, threshold: lang.threshold, admitted: rows.filter((r) => r.admitted).length, manual: rows.filter((r) => r.route === 'manual_review').length, avg_score: (() => {
        const scores = rows.map((r) => r.final_score).filter((x) => typeof x === 'number');
        return scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null;
      })() };
    }),
  };
  await fsp.writeFile(path.join(OUT_DIR, 'records.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await fsp.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  const lines = [];
  lines.push('# 扩量验证（25 张：en/es/de/fr/pl × 5 卡）');
  lines.push('');
  lines.push(`- 阈值：en/es/de/fr = 4.5；pl = 4.8`);
  lines.push(`- 本地单次 + 20% 分层抽样（每语种 1 张）+ 盲盒规则 + 边界定向润色`);
  lines.push('');
  lines.push('## 逐语种');
  lines.push('');
  lines.push('| 语种 | 阈值 | 入库 | manual_review | 平均分 |');
  lines.push('|---|---|---|---|---|');
  for (const row of summary.by_lang) lines.push(`| ${row.lang} | ${row.threshold} | ${row.admitted}/5 | ${row.manual} | ${row.avg_score ?? '—'} |`);
  lines.push('');
  lines.push('## 总体');
  lines.push('');
  lines.push(`- 入库：${summary.admitted}/${summary.total}`);
  lines.push(`- manual_review：${summary.manual_review}（${summary.manual_review_rate}%）`);
  lines.push(`- 本地基础校验入库：${summary.local_basic_pass}；本地抽样通过：${summary.local_sampled_pass}`);
  lines.push(`- 云端基础/结构兜底：${summary.cloud_basic_pass + summary.cloud_structural_pass}；云端抽样通过：${summary.cloud_sampled_pass}`);
  lines.push(`- Judge 调用：${summary.judge_calls}；定向润色：${summary.polish_calls}；云端总调用：${summary.cloud_calls}`);
  lines.push(`- 盲盒审计：已入库 ${summary.audit.admitted} 张，下次抽样在 ${summary.audit.next_audit_at} 张`);
  lines.push('');
  lines.push('## 成本');
  lines.push('');
  lines.push(`- 旧策略按卡数放大：¥${summary.costs.old_cny}`);
  lines.push(`- 新策略：¥${summary.costs.new_cny}（本地电费 ¥${summary.costs.local_energy_cny} + 云端 ¥${summary.costs.cloud_cny}）`);
  lines.push(`- **成本下降：${summary.costs.reduction_pct}%**；折合每 1,000 张 ¥${summary.costs.per_1000_cny}`);
  lines.push('');
  lines.push('## 逐卡明细');
  lines.push('');
  lines.push('| 语种 | 卡片 | 抽样 | 路由 | 分数 | 入库 |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of records) lines.push(`| ${r.lang} | ${r.title.slice(0, 18)}… | ${r.sampled ? '是' : '否'} | ${r.route} | ${r.final_score ?? '—'} | ${r.admitted ? '✅' : '❌'} |`);
  lines.push('');
  await fsp.writeFile(path.join(OUT_DIR, 'report.md'), lines.join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`report: ${path.join(OUT_DIR, 'report.md')}`);
}

main().catch((error) => { console.error('[fatal]', error.message); process.exit(1); });
