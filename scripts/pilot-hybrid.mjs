#!/usr/bin/env node
/**
 * 混合双打架构 Pilot（5 张波兰语卡）
 *
 * A 路线：本地 Q5 翻译 -> LanguageTool 规则修正 -> 物理校验 -> 母语评分
 * B 路线：A 路线结果 -> 云端 DeepSeek 语法后编辑（不重译）-> 校验 -> 母语评分
 * C 路线：Q6 本地直出（只测速与显存估算，不实际跑 5 卡）
 *
 * 输出：5 卡 A/B 得分、LanguageTool 修正明细、Token/耗时、三种路线成本对比。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { validateTranslation } from './lib/translate-validate.mjs';
import { loadGlossary, glossaryPromptBlock } from './lib/glossary.mjs';
import { correctObjectFields } from './lib/languagetool.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};
const CARDS_PATH = path.resolve(arg('cards', 'reports/translate/quality-cards.jsonl'));
const OUT_DIR = path.resolve(arg('out-dir', 'reports/translate/pilot-hybrid'));
const LOCAL_BASE = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const LOCAL_MODEL = process.env.LOCAL_MODEL_NAME || 'qwen3.8-35b-a3b@q5_k_m';
const Q6_MODEL = process.env.Q6_MODEL_NAME || 'qwen3.8-35b-a3b@q6_k';
const CLOUD_BASE = (process.env.CLOUD_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const CLOUD_MODEL = process.env.CLOUD_MODEL_NAME || 'deepseek-flash';
const DB_PATH = path.resolve(arg('db', '.data/translate-hybrid.sqlite'));
const PASS_SCORE = 4.5;
// 成本假设（报告里会明示）：DeepSeek V3.2 官方价约 $0.28/百万输入、$0.42/百万输出，汇率 7.2
const PRICE = { inputPerMTokens: 0.28 * 7.2, outputPerMTokens: 0.42 * 7.2, kwhPrice: 0.6, q5PowerKw: 0.5, q6PowerKw: 0.55 };

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

async function chat({ base, model, headers, prompt, jsonMode = false, timeout = 240000, temperature = 0.1 }) {
  const started = Date.now();
  const body = {
    model, temperature, max_tokens: 6000,
    messages: [
      { role: 'system', content: '你是严谨的波兰语本地化客服专家。严格遵循提示词。' },
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

function localPrompt(card) {
  return `你是波兰本地资深客服，把下面知识卡翻译成地道的波兰语（不是逐字机翻）。
硬性要求：
1. 返回合法 JSON，Key 必须与输入完全一致（id、title、content、tags、category），不得翻译字段名。
2. 完整保留适用情境、例外条件、步骤、数字与符号，不得删减。
3. 使用波兰客服常用礼貌表达（proszę、Państwo 等）。
4. fulfillment center 用 "centrum realizacji zamówień"；refund 用 "zwrot pieniędzy"；用 "na etapie"。
5. 只输出 JSON，不要解释。

${glossaryPromptBlock(glossary, 'pl')}

输入：
${JSON.stringify(card, null, 2)}`;
}

function editPrompt(card, translated) {
  return `这是一段由机器翻译的波兰语客服回复。请检查其中的语法格、介词变体、商业敬语（Pan/Pani/Państwo）与词序，将其润色为母语者习惯的表达。
规则：
1. 不要重新翻译，不要改变事实、数字、符号、条件或例外。
2. 返回 JSON，Key 与原 JSON 完全一致（id、title、content、tags、category）。
3. 不要新增原文或机器译文中不存在的内容。
4. 只做语法与表达润色，保持同样的信息量。

原文（中文，仅用于事实核对，不要翻译它）：
${JSON.stringify({ title: card.title, content: card.content, tags: card.tags }, null, 2)}

机器译文（待润色）：
${JSON.stringify(translated, null, 2)}`;
}

function scorePrompt(card, translated) {
  return `你是波兰语母语客服质量评审，按 1-5 分严苛打分（允许 0.5 分档）：
5 = 母语者水准；4.5 = 可直接商用；4 = 可交付但有小瑕疵；3 = 不地道或有误译；2 以下 = 不可用。
重点检查：语法格/介词变体、敬语一致性、fulfillment center/refund 术语、数字与符号是否完整、是否夹杂英文。
只输出 JSON：{"score":4.5,"detected_language":"pl","grammar_ok":true,"issues":["..."]}

原文：
${JSON.stringify(card, null, 2)}

译文：
${JSON.stringify(translated, null, 2)}`;
}

function costOfUsage(usage) {
  const input = Number(usage?.prompt_tokens || 0);
  const output = Number(usage?.completion_tokens || 0);
  return {
    input_tokens: input,
    output_tokens: output,
    cny: (input / 1e6) * PRICE.inputPerMTokens + (output / 1e6) * PRICE.outputPerMTokens,
  };
}

async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const cloudHeaders = loadCloudAuth();
  const records = [];
  let localMs = 0;
  let localTokens = 0;
  let q6 = null;

  for (const card of cards) {
    // ---------- 本地 Q5 ----------
    let local = null;
    let localError = null;
    try {
      const result = await chat({ base: LOCAL_BASE, model: LOCAL_MODEL, headers: {}, prompt: localPrompt(card), jsonMode: false, temperature: 0.1 });
      localMs += result.ms;
      localTokens += Number(result.usage?.completion_tokens || 0);
      local = { translated: extractJson(result.content), usage: result.usage, ms: result.ms, raw: result.content };
      if (!local.translated) localError = 'local non-JSON';
    } catch (error) {
      localError = error.message;
    }
    console.log(`[local] ${card.id} ${local?.translated ? 'OK' : 'FAIL ' + localError} (${local?.ms || 0}ms, ${local?.usage?.completion_tokens || 0} tok)`);
    if (!local?.translated) {
      records.push({ card_id: card.id, title: card.title, error: localError });
      continue;
    }

    const localValidation = validateTranslation(card, local.translated, 'pl', { script: 'Latn', glossary });

    // ---------- A 路线：LanguageTool ----------
    let lt;
    try {
      lt = await correctObjectFields(local.translated, ['title', 'content', 'tags'], 'pl-PL');
    } catch (error) {
      lt = { object: local.translated, corrections: [], error: error.message };
    }
    const aTranslation = lt.object;
    const aValidation = validateTranslation(card, aTranslation, 'pl', { script: 'Latn', glossary });

    // ---------- B 路线：云端语法后编辑 ----------
    let bTranslation = null;
    let bValidation = null;
    let editUsage = null;
    let editMs = 0;
    try {
      const edited = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: editPrompt(card, aTranslation), jsonMode: true, timeout: 180000, temperature: 0.1 });
      editUsage = edited.usage;
      editMs = edited.ms;
      const parsed = extractJson(edited.content);
      if (parsed) {
        const validation = validateTranslation(card, parsed, 'pl', { script: 'Latn', glossary });
        if (validation.ok) {
          bTranslation = parsed;
          bValidation = validation;
        } else {
          bValidation = validation;
        }
      }
    } catch (error) {
      bValidation = { ok: false, failures: [{ code: 'CLOUD_EDIT_ERROR', detail: error.message }] };
    }

    // ---------- 评分 ----------
    const scoreOf = async (translated) => {
      try {
        const result = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: scorePrompt(card, translated), jsonMode: true, timeout: 120000, temperature: 0 });
        const parsed = extractJson(result.content);
        return { score: Number(parsed?.score) || 0, detected_language: parsed?.detected_language || null, grammar_ok: Boolean(parsed?.grammar_ok), issues: Array.isArray(parsed?.issues) ? parsed.issues : [], usage: result.usage };
      } catch (error) {
        return { score: 0, detected_language: null, grammar_ok: false, issues: [error.message], usage: null };
      }
    };
    const aScore = await scoreOf(aTranslation);
    const bScore = bTranslation ? await scoreOf(bTranslation) : null;

    records.push({
      card_id: card.id,
      title: card.title,
      local: { translated: local.translated, validation: localValidation, usage: local.usage, ms: local.ms },
      lt: { translated: aTranslation, corrections: lt.corrections, error: lt.error || null, validation: aValidation },
      a: { translated: aTranslation, score: aScore, admitted: aScore.score > PASS_SCORE && aScore.grammar_ok },
      b: { translated: bTranslation, validation: bValidation, score: bScore, edit_usage: editUsage, edit_ms: editMs,
        admitted: Boolean(bScore && bScore.score > PASS_SCORE && bScore.grammar_ok) },
    });
    console.log(`[A] ${card.id} LT修正=${lt.corrections.length} 得分=${aScore.score} admitted=${aScore.score > PASS_SCORE}`);
    console.log(`[B] ${card.id} 云端润色=${bTranslation ? 'OK' : 'FAIL'} 得分=${bScore?.score ?? '—'} admitted=${Boolean(bScore && bScore.score > PASS_SCORE)}`);
  }

  // ---------- Q6 测速（单次，失败则记录） ----------
  try {
    const q6Result = await chat({ base: LOCAL_BASE, model: Q6_MODEL, headers: {}, prompt: '用波兰语写一句客服问候语，并说明你是客服。', jsonMode: false, timeout: 300000, temperature: 0.2 });
    q6 = { ok: true, ms: q6Result.ms, usage: q6Result.usage, content: String(q6Result.content).slice(0, 120) };
  } catch (error) {
    q6 = { ok: false, error: error.message };
  }
  console.log('[Q6]', JSON.stringify(q6));

  // ---------- 汇总 ----------
  const aScores = records.map((r) => r.a?.score?.score).filter((x) => typeof x === 'number');
  const bScores = records.map((r) => r.b?.score?.score).filter((x) => typeof x === 'number');
  const avg = (arr) => (arr.length ? Number((arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(2)) : 0);
  const editCost = records.reduce((sum, r) => sum + costOfUsage(r.b?.edit_usage).cny, 0);
  const scoreCost = records.reduce((sum, r) => sum + costOfUsage(r.a?.score?.usage).cny + costOfUsage(r.b?.score?.usage).cny, 0);
  const q5Throughput = localMs ? (localTokens / (localMs / 1000)) : 0;
  const q6Throughput = q6?.ok && q6.usage?.completion_tokens ? (q6.usage.completion_tokens / (q6.ms / 1000)) : q5Throughput * 0.85;
  const energy = (kw, ms) => (kw * (ms / 3600000)) * PRICE.kwhPrice;

  const summary = {
    cards: records.length,
    a_avg: avg(aScores),
    b_avg: avg(bScores),
    a_admitted: records.filter((r) => r.a?.admitted).length,
    b_admitted: records.filter((r) => r.b?.admitted).length,
    lt_corrections: records.reduce((s, r) => s + (r.lt?.corrections?.length || 0), 0),
    local_q5: { total_ms: localMs, completion_tokens: localTokens, tokens_per_sec: Number(q5Throughput.toFixed(2)) },
    q6,
    q6_assumed_tokens_per_sec: Number(q6Throughput.toFixed(2)),
    costs: {
      cloud_edit_cny_total_5cards: Number(editCost.toFixed(6)),
      cloud_score_cny_total_5cards: Number(scoreCost.toFixed(6)),
      q5_energy_cny_total_5cards: Number(energy(PRICE.q5PowerKw, localMs).toFixed(6)),
    },
    price_assumptions: PRICE,
    threshold: PASS_SCORE,
    b_breakthrough: avg(bScores) > PASS_SCORE,
  };
  await fsp.writeFile(path.join(OUT_DIR, 'records.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await fsp.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  const lines = [];
  lines.push('# 混合双打架构 5 卡 Pilot（波兰语）');
  lines.push('');
  lines.push(`- 本地：\`${LOCAL_MODEL}\`；云端语法后编辑/评分：\`${CLOUD_MODEL}\``);
  lines.push(`- LanguageTool：本地规则引擎（0 API 费用）`);
  lines.push('');
  lines.push('## A/B 得分');
  lines.push('');
  lines.push('| 卡片 | LT 修正数 | A 路线得分 | B 路线得分 | A 入库 | B 入库 |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of records) {
    lines.push(`| ${r.title.slice(0, 24)}… | ${r.lt?.corrections?.length || 0} | ${r.a?.score?.score ?? '—'} | ${r.b?.score?.score ?? '—'} | ${r.a?.admitted ? '✅' : '❌'} | ${r.b?.admitted ? '✅' : '❌'} |`);
  }
  lines.push('');
  lines.push(`- A 平均：${summary.a_avg}（入库 ${summary.a_admitted}/${records.length}）`);
  lines.push(`- B 平均：${summary.b_avg}（入库 ${summary.b_admitted}/${records.length}）`);
  lines.push(`- 是否突破 4.5：**${summary.b_breakthrough ? '是' : '否'}**`);
  lines.push('');
  lines.push('## LanguageTool 修正明细');
  lines.push('');
  for (const r of records) {
    for (const c of r.lt?.corrections || []) {
      lines.push(`- ${r.card_id} · ${c.field} · \`${c.before}\` → \`${c.after}\`（${c.rule}）`);
    }
  }
  lines.push('');
  lines.push('## 成本（5 卡）');
  lines.push('');
  lines.push(`- Q5 本地：${localMs} ms，${localTokens} tokens，${summary.local_q5.tokens_per_sec} tok/s`);
  lines.push(`- Q6 测速：${q6?.ok ? `${q6.ms} ms，${q6.usage?.completion_tokens || 0} tokens` : '失败：' + q6?.error}`);
  lines.push(`- 云端语法后编辑：¥${summary.costs.cloud_edit_cny_total_5cards}`);
  lines.push(`- 云端评分（QA）：¥${summary.costs.cloud_score_cny_total_5cards}`);
  lines.push(`- Q5 电费：¥${summary.costs.q5_energy_cny_total_5cards}`);
  lines.push('');
  await fsp.writeFile(path.join(OUT_DIR, 'report.md'), lines.join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`report: ${path.join(OUT_DIR, 'report.md')}`);
}

main().catch((error) => { console.error('[fatal]', error.message); process.exit(1); });
