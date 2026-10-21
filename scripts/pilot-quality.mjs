#!/usr/bin/env node
/**
 * 5 卡本地化质量 Pilot（波兰语）：
 *  1) 本地 Qwen + 术语表翻译，物理校验（Key/content/实体/语言检测/50字语法/术语）
 *  2) 成本守卫：数字实体丢失率 > 20% 立即停止，不进入云端
 *  3) 云端兜底：以“波兰资深客服”身份重写（本地化，不是机翻）
 *  4) 母语者打分：云端 1-5 分，<4 分不准入库
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
const OUT_DIR = path.resolve(arg('out-dir', 'reports/translate/pilot-quality'));
const LOCALE = 'pl-PL';
const LANG = 'pl';
const LOCALE_NAME = '波兰语（Poland）';
const LOCAL_BASE = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const LOCAL_MODEL = process.env.LOCAL_MODEL_NAME || 'qwen3.8-35b-a3b@q5_k_m';
const CLOUD_BASE = (process.env.CLOUD_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const CLOUD_MODEL = process.env.CLOUD_MODEL_NAME || 'deepseek-flash';
const DB_PATH = path.resolve(arg('db', '.data/translate-quality.sqlite'));
const REUSE_LOCAL = arg('reuse-local', '');
const ENTITY_FAILURE_LIMIT = 0.2;
const ADMIT_SCORE = 4;

const glossary = loadGlossary();
const cards = fs.readFileSync(CARDS_PATH, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

function loadCloudAuth() {
  if (process.env.DEEPSEEK_API_KEY) return { authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` };
  const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
  const credPath = path.join(dshHome, '.credentials.yaml');
  if (!fs.existsSync(credPath)) throw new Error('cloud auth missing');
  const lines = fs.readFileSync(credPath, 'utf8').split(/\r?\n/);
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

function localPrompt(card) {
  return `你是波兰本地资深客服，把下面知识卡翻译成地道的波兰语（不是逐字机翻）。
硬性要求：
1. 返回合法 JSON，Key 必须与输入完全一致（id、title、content、tags、category），不得翻译字段名。
2. 完整保留适用情境、例外条件、步骤、数字与符号，不得删减。
3. 使用波兰客服常用礼貌表达（proszę、Państwo 等）。
4. 只输出 JSON，不要解释。

${glossaryPromptBlock(glossary, LANG)}

输入：
${JSON.stringify(card, null, 2)}`;
}

function cloudPrompt(card) {
  return `你不是一个翻译机器，你是波兰（Poland）的资深客服。请根据波兰当地的商业习惯与礼貌用语（如 Pan/Pani、proszę、uprzejmie），重新组织这段话，使其符合当地人的阅读习惯，而不是机翻腔。
硬性要求：
1. 保留全部事实、条件、例外、步骤、数字与符号，不得增删事实。
2. 返回合法 JSON，Key 必须与原文完全一致（id、title、content、tags、category）。
3. 使用波兰客服常见敬语与专业措辞。
4. 只输出 JSON，不要解释。

${glossaryPromptBlock(glossary, LANG)}

原文 JSON：
${JSON.stringify(card, null, 2)}`;
}

function scorePrompt(card, translated) {
  return `你是波兰语母语客服质量评审。请对下面译文按 1-5 分打分：
1 = 机翻/难以阅读；2 = 明显不自然；3 = 能看懂但不地道；4 = 地道、专业，可交付；5 = 母语者水准。
同时检查：语法是否正确、敬语/礼貌是否恰当、电商术语是否专业、是否夹杂英文、是否符合波兰商业习惯。
只输出 JSON：{"score":1,"detected_language":"pl","grammar_ok":true,"issues":["..."]}

原文：
${JSON.stringify(card, null, 2)}

译文：
${JSON.stringify(translated, null, 2)}`;
}

async function chat({ base, model, headers, prompt, jsonMode = true, timeout = 240000 }) {
  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: '你是严谨的本地化翻译与质量评审助手。只输出 JSON。' },
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

async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const cloudHeaders = loadCloudAuth();
  const records = [];
  const reuseMap = new Map();
  if (REUSE_LOCAL) {
    const reusePath = path.resolve(REUSE_LOCAL);
    if (fs.existsSync(reusePath)) {
      for (const row of fs.readFileSync(reusePath, 'utf8').split('\n').filter(Boolean).map(JSON.parse)) {
        reuseMap.set(row.card_id, row);
      }
      console.log(`[reuse] loaded ${reuseMap.size} local results from ${reusePath}`);
    }
  }

  // ---------- 1) 本地阶段 ----------
  for (const card of cards) {
    let translated = null;
    let failures = null;
    let raw = '';
    const reused = reuseMap.get(card.id);
    if (reused && (reused.translated || reused.failures)) {
      translated = reused.translated || null;
      failures = reused.failures || null;
      console.log(`[local] ${card.id} REUSED ${failures ? 'FAIL' : 'PASS'}`);
    } else {
      try {
        raw = await chat({ base: LOCAL_BASE, model: LOCAL_MODEL, headers: {}, prompt: localPrompt(card), jsonMode: false, timeout: 240000 });
        translated = extractJson(raw);
        if (!translated) throw new Error(`non-JSON: ${raw.slice(0, 160)}`);
        const validation = validateTranslation(card, translated, LANG, { script: 'Latn', glossary });
        if (!validation.ok) failures = validation.failures;
      } catch (error) {
        failures = [{ code: 'LOCAL_ERROR', detail: error.message }];
      }
      console.log(`[local] ${card.id} ${failures ? 'FAIL ' + failures.map((f) => f.code).join(',') : 'PASS'}`);
    }
    records.push({
      card_id: card.id, title: card.title, stage: 'local', route: failures ? 'local_failed' : 'local_pass',
      failures, translated, raw_snippet: raw ? raw.slice(0, 200) : null,
    });
  }

  // ---------- 2) 成本守卫 ----------
  const entityFailures = records.filter((r) => (r.failures || []).some((f) => f.code === 'ENTITY_MISSING')).length;
  const entityRate = entityFailures / records.length;
  if (entityRate > ENTITY_FAILURE_LIMIT) {
    const summary = { stopped: true, reason: 'ENTITY_FAILURE_RATE_EXCEEDED', entity_rate: entityRate, entity_failures: entityFailures, total: records.length };
    await fsp.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
    await fsp.writeFile(path.join(OUT_DIR, 'score-report.md'), `# 5 卡本地化质量 Pilot\n\n> 已停止：数字实体丢失率 ${(entityRate * 100).toFixed(0)}% > 20%，按成本守卫不进入云端。\n`);
    console.log(JSON.stringify(summary));
    return;
  }

  // ---------- 3) 云端本地化兜底 ----------
  for (const record of records.filter((r) => r.route === 'local_failed')) {
    const card = cards.find((c) => c.id === record.card_id);
    const localFailures = record.failures;
    let translated = null;
    let failures = null;
    for (let attempt = 0; attempt < 2 && !translated; attempt += 1) {
      try {
        const raw = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: cloudPrompt(card), jsonMode: true, timeout: 180000 });
        const parsed = extractJson(raw);
        const validation = parsed ? validateTranslation(card, parsed, LANG, { script: 'Latn', glossary }) : { ok: false, failures: [{ code: 'JSON_INVALID', detail: 'cloud non-JSON' }] };
        if (validation.ok) translated = parsed;
        else failures = validation.failures;
      } catch (error) {
        failures = [{ code: 'CLOUD_ERROR', detail: error.message }];
      }
    }
    if (translated) {
      record.route = 'cloud_localized';
      record.translated = translated;
      record.failures = null;
      record.local_failures = localFailures;
    } else {
      record.route = 'cloud_failed';
      record.failures = failures;
      record.local_failures = localFailures;
      record.translated = null; // 云端失败即淘汰，绝不拿本地残次品参加打分
    }
    console.log(`[cloud] ${record.card_id} -> ${record.route}`);
  }

  // ---------- 4) 母语者打分（只评本地通过或云端本地化成功的候选） ----------
  for (const record of records.filter((r) => r.translated && ['local_pass', 'cloud_localized'].includes(r.route))) {
    const card = cards.find((c) => c.id === record.card_id);
    try {
      const raw = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: scorePrompt(card, record.translated), jsonMode: true, timeout: 120000 });
      const score = extractJson(raw);
      record.score = score ? {
        score: Number(score.score) || 0,
        detected_language: score.detected_language || null,
        grammar_ok: Boolean(score.grammar_ok),
        issues: Array.isArray(score.issues) ? score.issues.slice(0, 8) : [],
      } : { score: 0, detected_language: null, grammar_ok: false, issues: ['invalid score JSON'] };
    } catch (error) {
      record.score = { score: 0, detected_language: null, grammar_ok: false, issues: [error.message] };
    }
    const s = record.score;
    record.admitted = s.score >= ADMIT_SCORE && s.grammar_ok && s.detected_language === LANG;
    console.log(`[score] ${record.card_id} ${s.score}/5 admitted=${record.admitted}`);
  }

  // ---------- 5) 入库（仅 admitted，draft） ----------
  let inserted = 0;
  const admitted = records.filter((r) => r.admitted);
  if (admitted.length) {
    const db = openDatabase(DB_PATH);
    migrateSchema(db);
    const dao = createDao(db);
    for (const record of admitted) {
      const id = `kb_${LANG}_${record.card_id}`;
      if (dao.findGlobalKnowledge(id)) continue;
      dao.createGlobalKnowledge({
        id,
        title: String(record.translated.title || '').slice(0, 180),
        content: String(record.translated.content || ''),
        tags: Array.isArray(record.translated.tags) ? record.translated.tags : [],
        language: LANG,
        locale: LOCALE,
        status: 'draft',
        audience: 'seller',
        category: '其他',
        source_id: 'manual_editor',
        structured_payload: { source_card_id: record.card_id, route: record.route, native_score: record.score },
      });
      inserted += 1;
    }
    closeDatabase(db);
  }

  // ---------- 6) 报告 ----------
  await fsp.writeFile(path.join(OUT_DIR, 'records.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const summary = {
    total: records.length,
    local_pass: records.filter((r) => r.route === 'local_pass').length,
    cloud_localized: records.filter((r) => r.route === 'cloud_localized').length,
    cloud_failed: records.filter((r) => r.route === 'cloud_failed').length,
    entity_failures: entityFailures,
    entity_rate: entityRate,
    admitted: admitted.length,
    rejected: records.filter((r) => r.translated && !r.admitted).length,
    db_inserted: inserted,
    score_avg: admitted.length ? Number((admitted.reduce((s, r) => s + r.score.score, 0) / admitted.length).toFixed(2)) : 0,
  };
  await fsp.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  const lines = [];
  lines.push('# 5 卡本地化质量 Pilot（波兰语）');
  lines.push('');
  lines.push(`- 时间：${new Date().toISOString()}`);
  lines.push(`- 本地模型：\`${LOCAL_MODEL}\`；云端评审：\`${CLOUD_MODEL}\``);
  lines.push(`- 用语种：${LOCALE}（Tier 2）；术语表：\`db/glossary_global.json\``);
  lines.push(`- 成本守卫：数字实体丢失率 ${(entityRate * 100).toFixed(0)}%（阈值 20%）`);
  lines.push('');
  lines.push('## 评分总览');
  lines.push('');
  lines.push('| 卡片 | 路由 | 物理校验 | 母语者评分 | 检测语言 | 语法 | 入库 | 问题 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const r of records) {
    const gate = r.failures ? r.failures.map((f) => f.code).join(', ') : 'PASS';
    const score = r.score ? `${r.score.score}/5` : '—';
    const lang = r.score?.detected_language || '—';
    const grammar = r.score ? (r.score.grammar_ok ? 'OK' : 'FAIL') : '—';
    lines.push(`| ${r.title.slice(0, 22)}… | ${r.route} | ${gate} | ${score} | ${lang} | ${grammar} | ${r.admitted ? '✅' : '❌'} | ${(r.score?.issues || []).join('；') || '—'} |`);
  }
  lines.push('');
  lines.push('## 关键结论');
  lines.push('');
  lines.push(`- 本地通过：${summary.local_pass} / 5；云端本地化：${summary.cloud_localized}；云端失败：${summary.cloud_failed}`);
  lines.push(`- 最终入库（≥4 分）：${summary.admitted} / 5；平均分：${summary.score_avg}`);
  for (const r of records.filter((x) => x.score)) {
    lines.push(`- ${r.title}：${r.score.score}/5，${r.score.issues.join('；') || '无问题'}`);
  }
  lines.push('');
  await fsp.writeFile(path.join(OUT_DIR, 'score-report.md'), lines.join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`report: ${path.join(OUT_DIR, 'score-report.md')}`);
}

main().catch((error) => { console.error('[fatal]', error.message); process.exit(1); });
