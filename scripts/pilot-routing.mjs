#!/usr/bin/env node
/**
 * 4.8 分重试 + 语种级云端降维 路由验证（5 张 pl + 5 张 es）
 *
 * 规则：
 *  - 云端母语评分 >= 4.8 才允许入库
 *  - 本地评分 4.0~4.79：打回本地 Qwen，最多 3 次重试；每次把上一轮 issues 加粗注入底部重锚区
 *  - 本地 <4.0 或 3 次重试仍 <4.8：标记 cloud_required，走云端
 *  - 同批次某语种连续 3 张卡本地重试后不及格：熔断，加入 cloud_forced_languages，
 *    后续同语种卡片直接云端，不再消耗本地算力
 *  - 云端仍 <4.8：进 manual_review，不强行入库
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { validateTranslation } from './lib/translate-validate.mjs';
import { loadGlossary, glossaryPromptBlock } from './lib/glossary.mjs';
import { LanguageCircuitBreaker, estimateLocalWasteAvoided } from './lib/routing.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};
const CARDS_PATH = path.resolve(arg('cards', 'reports/translate/quality-cards.jsonl'));
const OUT_DIR = path.resolve(arg('out-dir', 'reports/translate/pilot-routing'));
const LOCAL_BASE = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const LOCAL_MODEL = process.env.LOCAL_MODEL_NAME || 'qwen3.8-35b-a3b@q5_k_m';
const CLOUD_BASE = (process.env.CLOUD_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const CLOUD_MODEL = process.env.CLOUD_MODEL_NAME || 'deepseek-flash';
const PASS_SCORE = 4.8;
const LOCAL_RETRY_MIN = 4.0;
const MAX_RETRIES = 3;
const BREAKER_THRESHOLD = 3;
const DB_PATH = path.resolve(arg('db', '.data/translate-routing.sqlite'));

const LANGS = [
  { code: 'pl-PL', base: 'pl', name: '波兰语', nameZh: '波兰语', script: 'Latn' },
  { code: 'es-ES', base: 'es', name: '西班牙语', nameZh: '西班牙语', script: 'Latn' },
];
const ONLY_LANGS = String(arg('langs', '')).split(',').map((s) => s.trim()).filter(Boolean);
const ACTIVE_LANGS = ONLY_LANGS.length ? LANGS.filter((l) => ONLY_LANGS.includes(l.code)) : LANGS;
const glossary = loadGlossary();
const cards = fs.readFileSync(CARDS_PATH, 'utf8').split('\n').filter(Boolean).map(JSON.parse);

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

function fewShots(lang) {
  if (lang.base === 'pl') {
    return `【已知波兰语错误示例】
- ❌ "w etapie przyjmowania zwrotów" → ✅ "na etapie przyjmowania zwrotów"
- ❌ "centrum wykonawcze" → ✅ "centrum realizacji zamówień" / "centrum logistyczne"
- ❌ "refundacja / refundacje" → ✅ "zwrot pieniędzy"
- ❌ "z zgodnością" → ✅ "ze zgodnością"
- ❌ 句中 "Klientów" 大写 → ✅ "klientów"`;
  }
  return `【已知西班牙语错误示例】
- ❌ "centro de ejecución"（fulfillment center 直译）→ ✅ "centro de cumplimiento logístico"
- ❌ "reembolso de devolución" 混用 → ✅ "devolución" / "reembolso" 按语境分开
- ❌ 对客户使用 "tú" 敬语不一致 → ✅ 统一使用 "usted/ustedes"
- ❌ "logística inversa" 拼写/大小写错误 → ✅ "logística inversa"
- ❌ 数字或货币符号被改写 → 必须原样保留（如 3、120、$、25%）`;
}

function localPrompt(card, lang, warnings = []) {
  const warningBlock = warnings.length
    ? `\n【本轮评审反馈｜必须逐条修正】\n${warnings.map((w, i) => `${i + 1}. **${w}**`).join('\n')}\n`
    : '';
  return `【顶部锚点｜角色与红线】
你是${lang.name}本地金牌客服，不是翻译机器。译文必须让本地客户觉得是本地团队写的。
红线（违反任何一条即失败）：
1. 数字、金额、百分比、符号必须原样保留。
2. JSON Key 绝不能翻译：id、title、content、tags、category。
3. 原文条件、例外、步骤、失败模式不得删减。
4. content 不得为空，不得返回原文。

【上部参考区｜强制术语表】
${glossaryPromptBlock(glossary, lang.base)}

【上部参考区｜Few-Shot】
${fewShots(lang)}

【中部待处理区｜原文 JSON】
${JSON.stringify(card, null, 2)}

【底部重锚区｜最终警告】
- 绝不准直译 fulfillment center；绝不准漏掉数字与符号。
- 输出前自查：能否 JSON.parse？Key 是否一致？content 是否非空？术语是否来自术语表？
- 只输出 JSON，不要解释。
${warningBlock}`;
}

function cloudPrompt(card, lang, issues = []) {
  const issueBlock = issues.length
    ? `\n【上一轮母语评审的具体问题｜逐条修正】\n${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
    : '';
  return `你不是翻译机器，你是${lang.name}本地资深客服。请直接生成一份目标评分 **4.8 分以上** 的高质量母语知识卡。
要求：
1. 按当地商业习惯与礼貌用语（敬语、称呼）重新组织，读起来像母语者写的。
2. 完整保留事实、条件、例外、步骤、数字与符号，不得增删事实。
3. 返回合法 JSON，Key 必须与原文完全一致（id、title、content、tags、category）。
4. 只输出 JSON，不要解释。

${glossaryPromptBlock(glossary, lang.base)}
${fewShots(lang)}
${issueBlock}
原文 JSON：
${JSON.stringify(card, null, 2)}`;
}

function scorePrompt(card, translated, lang) {
  return `你是${lang.name}母语客服质量评审，按 1-5 分严苛打分，**允许 0.1 分档**（例如 4.7、4.8、4.9）。
评分标准：
5.0 = 母语者水准；4.8 = 可直接商用；4.5 = 有小瑕疵；4.0 = 可交付但明显不地道；3.x = 不可商用。
重点检查：语法格/介词变体、敬语一致性、术语、语义是否偏移、是否增译/漏译、数字与符号是否完整、是否夹杂英文。
只输出 JSON：{"score":4.8,"detected_language":"${lang.base}","grammar_ok":true,"issues":["..."]}

原文：
${JSON.stringify(card, null, 2)}

译文：
${JSON.stringify(translated, null, 2)}`;
}

async function scoreTranslation(card, translated, lang, cloudHeaders) {
  try {
    const result = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: scorePrompt(card, translated, lang), jsonMode: true, timeout: 120000, temperature: 0 });
    const parsed = extractJson(result.content) || {};
    return {
      score: Number(parsed.score) || 0,
      detected_language: parsed.detected_language || null,
      grammar_ok: Boolean(parsed.grammar_ok),
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      usage: result.usage,
    };
  } catch (error) {
    return { score: 0, detected_language: null, grammar_ok: false, issues: [error.message], usage: null };
  }
}

async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const cloudHeaders = loadCloudAuth();
  const breaker = new LanguageCircuitBreaker(BREAKER_THRESHOLD);
  const records = [];
  let localAttempts = 0;
  let localTokens = 0;
  let localMs = 0;
  let cloudCalls = 0;
  let cloudTokensIn = 0;
  let cloudTokensOut = 0;
  const skippedLocalCards = [];

  const runLocalAttempt = async (card, lang, warnings) => {
    localAttempts += 1;
    try {
      const result = await chat({ base: LOCAL_BASE, model: LOCAL_MODEL, headers: {}, prompt: localPrompt(card, lang, warnings), jsonMode: false, temperature: 0.2, timeout: 240000 });
      localMs += result.ms;
      localTokens += Number(result.usage?.completion_tokens || 0);
      return { translated: extractJson(result.content), usage: result.usage, ms: result.ms };
    } catch (error) {
      return { translated: null, error: error.message, usage: null, ms: 0 };
    }
  };

  const runCloudFallback = async (card, lang, reason, seedIssues = []) => {
    let issues = [...seedIssues];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      cloudCalls += 1;
      try {
        const result = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: cloudPrompt(card, lang, issues), jsonMode: true, timeout: 180000, temperature: 0.2 });
        cloudTokensIn += Number(result.usage?.prompt_tokens || 0);
        cloudTokensOut += Number(result.usage?.completion_tokens || 0);
        const parsed = extractJson(result.content);
        if (!parsed) { issues = ['云端返回非 JSON']; continue; }
        const validation = validateTranslation(card, parsed, lang.base, { script: lang.script, glossary });
        if (!validation.ok) { issues = validation.failures.map((f) => `${f.code}: ${f.detail}`); continue; }
        const score = await scoreTranslation(card, parsed, lang, cloudHeaders);
        cloudCalls += 1;
        if (score.score >= PASS_SCORE && score.grammar_ok && score.detected_language === lang.base) {
          return { translated: parsed, score, route: reason, admitted: true };
        }
        issues = score.issues.length ? score.issues : [`评分 ${score.score} 未达 ${PASS_SCORE}`];
      } catch (error) {
        issues = [error.message];
      }
    }
    return { translated: null, score: null, route: reason, admitted: false };
  };

  for (const lang of ACTIVE_LANGS) {
    for (const card of cards) {
      const record = { lang: lang.code, card_id: card.id, title: card.title, attempts: [], route: null, admitted: false };

      // 语种已熔断：直接云端
      if (breaker.isForced(lang.code)) {
        skippedLocalCards.push({ lang: lang.code, card_id: card.id });
        const fallback = await runCloudFallback(card, lang, 'cloud_forced_language');
        record.route = 'cloud_forced_language';
        record.cloud = fallback;
        record.admitted = fallback.admitted;
        record.final_score = fallback.score?.score ?? null;
        console.log(`[${lang.code}] ${card.id} FORCED_CLOUD -> score=${record.final_score} admitted=${record.admitted}`);
        records.push(record);
        continue;
      }

      // 本地尝试 + 重试
      let warnings = [];
      let localPass = false;
      let lastScore = null;
      for (let attempt = 0; attempt <= MAX_RETRIES && !localPass; attempt += 1) {
        const local = await runLocalAttempt(card, lang, warnings);
        const validation = local.translated
          ? validateTranslation(card, local.translated, lang.base, { script: lang.script, glossary })
          : { ok: false, failures: [{ code: 'LOCAL_ERROR', detail: local.error || 'no JSON' }] };
        const score = local.translated && validation.ok ? await scoreTranslation(card, local.translated, lang, cloudHeaders) : null;
        if (score) cloudCalls += 1;
        const attemptRecord = {
          attempt: attempt + 1,
          ms: local.ms,
          tokens: local.usage?.completion_tokens || 0,
          validation_ok: validation.ok,
          failures: validation.ok ? [] : validation.failures,
          score: score?.score ?? 0,
          issues: score?.issues || [],
        };
        record.attempts.push(attemptRecord);
        lastScore = score?.score ?? 0;
        console.log(`[${lang.code}] ${card.id} attempt ${attempt + 1}: validation=${validation.ok ? 'PASS' : 'FAIL'} score=${attemptRecord.score} issues=${attemptRecord.issues.length}`);

        if (validation.ok && score && score.score >= PASS_SCORE && score.grammar_ok) {
          localPass = true;
          record.route = 'local_direct';
          record.admitted = true;
          record.final_score = score.score;
          record.translated = local.translated;
          breaker.noteLocalPass(lang.code);
          console.log(`[${lang.code}] ${card.id} LOCAL_PASS score=${score.score}`);
          break;
        }

        // 收集下一轮重锚警告
        const dynamic = [
          ...(validation.ok ? [] : validation.failures.map((f) => `${f.code}: ${f.detail}`)),
          ...(score?.issues || []),
        ].filter(Boolean).slice(0, 8);
        warnings = [...warnings, ...dynamic].slice(-10);

        // <4.0：不再浪费本地算力，直接 cloud_required
        if (score && score.score > 0 && score.score < LOCAL_RETRY_MIN) {
          console.log(`[${lang.code}] ${card.id} score ${score.score} < ${LOCAL_RETRY_MIN} -> cloud_required`);
          break;
        }
      }

      if (!localPass) {
        record.route = 'cloud_required';
        const fail = breaker.noteLocalFailure(lang.code);
        if (fail.triggered) {
          console.log(`[BREAKER] ${lang.code} forced after ${fail.count} consecutive local failures`);
          record.breaker_triggered = true;
        }
        const fallback = await runCloudFallback(card, lang, 'cloud_required', warnings.slice(-6));
        record.cloud = fallback;
        record.admitted = fallback.admitted;
        record.final_score = fallback.score?.score ?? null;
        if (!fallback.admitted) {
          record.route = 'manual_review';
          console.log(`[${lang.code}] ${card.id} CLOUD_FAIL -> manual_review`);
        } else {
          console.log(`[${lang.code}] ${card.id} CLOUD_PASS score=${record.final_score}`);
        }
      }
      records.push(record);
    }
  }

  // 入库（仅 admitted，draft）
  let inserted = 0;
  const admitted = records.filter((r) => r.admitted);
  if (admitted.length) {
    const db = openDatabase(DB_PATH);
    migrateSchema(db);
    const dao = createDao(db);
    for (const record of admitted) {
      const id = `kb_${record.lang}_${record.card_id}`;
      if (dao.findGlobalKnowledge(id)) continue;
      dao.createGlobalKnowledge({
        id,
        title: String(record.translated?.title || record.cloud?.translated?.title || '').slice(0, 180),
        content: String(record.translated?.content || record.cloud?.translated?.content || ''),
        tags: Array.isArray(record.translated?.tags) ? record.translated.tags : (record.cloud?.translated?.tags || []),
        language: record.lang.split('-')[0], locale: record.lang, status: 'draft', audience: 'seller', category: '其他',
        source_id: 'manual_editor',
        structured_payload: { route: record.route, score: record.final_score, attempts: record.attempts.length },
      });
      inserted += 1;
    }
    closeDatabase(db);
  }

  const skipped = skippedLocalCards.length;
  const waste = estimateLocalWasteAvoided({
    skippedLocalCards: skipped,
    maxAttempts: MAX_RETRIES + 1,
    avgAttemptMs: localAttempts ? localMs / localAttempts : 35000,
    avgTokensPerAttempt: localAttempts ? localTokens / localAttempts : 1600,
  });
  const naiveAttempts = records.length * (MAX_RETRIES + 1);
  const reduction = naiveAttempts ? Number((((naiveAttempts - localAttempts) / naiveAttempts) * 100).toFixed(1)) : 0;

  const summary = {
    total: records.length,
    local_direct: records.filter((r) => r.route === 'local_direct').length,
    cloud_required: records.filter((r) => r.route === 'cloud_required').length,
    cloud_forced_language: records.filter((r) => r.route === 'cloud_forced_language').length,
    manual_review: records.filter((r) => r.route === 'manual_review').length,
    admitted: admitted.length,
    local_attempts: localAttempts,
    naive_local_attempts: naiveAttempts,
    local_attempt_reduction_pct: reduction,
    breaker: breaker.snapshot(),
    skipped_local_cards: skipped,
    waste_avoided: waste,
    local_tokens: localTokens,
    cloud_calls: cloudCalls,
    cloud_tokens: { input: cloudTokensIn, output: cloudTokensOut },
  };
  await fsp.writeFile(path.join(OUT_DIR, 'records.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await fsp.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  const lines = [];
  lines.push('# 4.8 分重试 + 语种熔断 路由验证（5 pl + 5 es）');
  lines.push('');
  lines.push(`- 阈值：≥ ${PASS_SCORE} 直接入库；4.0–4.79 本地重试（最多 ${MAX_RETRIES} 次）；<4.0 或重试耗尽 → cloud_required`);
  lines.push(`- 熔断：同语种连续 ${BREAKER_THRESHOLD} 张卡本地失败 → cloud_forced_languages`);
  lines.push('');
  lines.push('## 逐卡路由');
  lines.push('');
  lines.push('| 语种 | 卡片 | 本地尝试 | 最终路由 | 分数 | 入库 |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of records) {
    lines.push(`| ${r.lang} | ${r.title.slice(0, 22)}… | ${r.attempts.length} | ${r.route} | ${r.final_score ?? '—'} | ${r.admitted ? '✅' : '❌'} |`);
  }
  lines.push('');
  lines.push('## 熔断与成本');
  lines.push('');
  lines.push(`- 触发熔断语种：${summary.breaker.forced.join(', ') || '无'}`);
  lines.push(`- 本地尝试：${summary.local_attempts} 次（naive 全重试为 ${summary.naive_local_attempts} 次，降低 ${summary.local_attempt_reduction_pct}%）`);
  lines.push(`- 熔断跳过本地卡：${summary.skipped_local_cards} 张；避免本地尝试 ${waste.avoided_local_attempts} 次、${waste.avoided_tokens} tokens、¥${waste.avoided_cny}`);
  lines.push(`- 入库：${summary.admitted} / ${summary.total}（local ${summary.local_direct} + cloud ${summary.cloud_required + summary.cloud_forced_language}）；manual_review：${summary.manual_review}`);
  lines.push('');
  lines.push('## 结论');
  lines.push('');
  lines.push(summary.admitted === summary.total ? '- 全部达标，可开启全量。' : '- 仍有未达标卡片，全量需暂缓。');
  lines.push('');
  await fsp.writeFile(path.join(OUT_DIR, 'report.md'), lines.join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`report: ${path.join(OUT_DIR, 'report.md')}`);
}

main().catch((error) => { console.error('[fatal]', error.message); process.exit(1); });
