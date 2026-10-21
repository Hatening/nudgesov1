#!/usr/bin/env node
/**
 * 22K U 型注意力阵列 + 双轨 Self-Reflection 终极 Pilot（2 张被 3/5 拒的卡）
 *
 * 本地 Qwen 两阶段：
 *   1) 草稿阶段：自然语言写出翻译决策（数字/敬语/术语处理），不要求 JSON
 *   2) 定稿阶段：把草稿放回 U 型 Prompt，输出严格 JSON
 *
 * U 型结构：顶部锚点 -> 上部术语/示例 -> 中部原文 -> 底部重锚警告
 * 最终由云端 DeepSeek 做严苛母语评分（允许 0.5 分档），>4.5 才视为达标。
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, migrateSchema, closeDatabase } from '../src/db.js';
import { createDao } from '../src/dao.js';
import { validateTranslation } from './lib/translate-validate.mjs';
import { loadGlossary } from './lib/glossary.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};
const CARDS_PATH = path.resolve(arg('cards', 'reports/translate/quality-cards.jsonl'));
const OUT_DIR = path.resolve(arg('out-dir', 'reports/translate/pilot-reflect'));
const LOCAL_BASE = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const LOCAL_MODEL = process.env.LOCAL_MODEL_NAME || 'qwen3.8-35b-a3b@q5_k_m';
const CLOUD_BASE = (process.env.CLOUD_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/$/, '');
const CLOUD_MODEL = process.env.CLOUD_MODEL_NAME || 'deepseek-flash';
const TARGET_IDS = ['kb_843896f27382ff6e', 'kb_aa704f7eed2a3518'];
const DB_PATH = path.resolve(arg('db', '.data/translate-reflect.sqlite'));
const PASS_SCORE = 4.5;

const glossary = loadGlossary();
const allCards = fs.readFileSync(CARDS_PATH, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
const cards = allCards.filter((c) => TARGET_IDS.includes(c.id));

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
  const body = {
    model,
    temperature,
    max_tokens: 6000,
    messages: [
      { role: 'system', content: '你是严谨的波兰语本地化客服专家。严格遵循提示词中的红线与结构。' },
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

function glossaryBlock() {
  return glossary.terms.map((term) => {
    const src = term.source_terms.slice(0, 2).join(' / ');
    const pl = term.translations.pl || [];
    return pl.length ? `- ${src} => ${pl.join(' / ')}` : null;
  }).filter(Boolean).join('\n');
}

function fewShots() {
  return `【之前被扣分的地方，必须这样改】
- ❌ "w etapie przyjmowania zwrotów" → ✅ "na etapie przyjmowania zwrotów"
- ❌ "centrum wykonawcze"（fulfillment center 直译）→ ✅ "centrum realizacji zamówień" / "centrum logistyczne"
- ❌ "refundacja / refundacje"（含 tags、分类）→ ✅ "zwrot pieniędzy"
- ❌ 句中 "Klientów" 大写 → ✅ "klientów"
- ❌ "Państwo ... ich produkty" → ✅ "Państwo ... Państwa produkty"
- ❌ "proszę o zapewnienie"（把客观要求改成请求）→ ✅ "należy zapewnić jasną procedurę eskalacji"
- ❌ "z zgodnością"（硬性语法错误）→ ✅ "ze zgodnością"
- ❌ "wymaganiami zgodności" → ✅ "wymogami zgodności"
- ❌ "zmniejszenie błędów" → ✅ "ograniczenie liczby błędów"
- ❌ "nasz zespół"（原文是第三人称"其团队"）→ ✅ "zespół ShipBob"
- ❌ "Co to są kluczowe operacje..." → ✅ "Jakie są kluczowe operacje..."
- ❌ "błędów stanu magazynowego" → ✅ "niezgodności stanów magazynowych"`;
}

function draftPrompt(card) {
  return `【草稿阶段｜先不要输出 JSON】
你是波兰本地金牌客服。在正式翻译前，先用 3-5 句话写下你的翻译草稿与决策（中文或波兰语均可）：
1. 原文里的数字、金额、符号有哪些？你打算如何原样保留？
2. 你会用哪些波兰语敬语（Pan/Pani、Państwo、proszę）保持客服礼貌？
3. fulfillment center、refund、return、shipping 分别准备怎么译？
4. 原文有哪些条件、例外、步骤、失败模式必须保留？

只输出这段自然语言草稿，不要输出 JSON。

待翻译原文：
${JSON.stringify({ title: card.title, content: card.content, tags: card.tags }, null, 2)}`;
}

function uShapePrompt(card, draft) {
  return `【顶部锚点｜角色与最高红线】
你是波兰本地金牌客服（native Polish customer support lead），不是翻译机器。译文必须让波兰客户觉得是本地团队写的。
红线（违反任何一条即失败）：
1. 数字、金额、百分比、符号必须原样保留（例如 3、120、2、$、25%）。
2. JSON Key 绝不能翻译：id、title、content、tags、category。
3. 原文的条件、例外、步骤、失败模式不得删减或合并。
4. content 不得为空，不得直接返回原文。

【上部参考区｜强制术语表】
${glossaryBlock()}

【上部参考区｜Few-Shot 正确示例】
${fewShots()}

【中部待处理区｜待翻译 JSON】
${JSON.stringify(card, null, 2)}

【上部参考区｜你的草稿（必须吸收）】
${draft}

【底部重锚区｜最终警告】
- 绝不准把 fulfillment center 直译成 "centrum wykonawcze"；必须用 "centrum realizacji zamówień" 或 "centrum logistyczne"。
- 绝不准把 refund 译成 "refundacja/refundacje"；必须用 "zwrot pieniędzy"（包括 tags 与分类）。
- 绝不准写 "z zgodnością"；波兰语必须是 "ze zgodnością"，也不要用 "wymaganiami zgodności"。
- 原文"其团队"是第三人称，不要改写成 "nasz zespół"；用 "zespół ShipBob"。
- 绝不准漏掉原文数字（3、120、2 等）与符号；不得用文字代替数字。
- 绝不准改变 JSON Key 或结构。
- 输出前自查：能否 JSON.parse？Key 是否与原文完全一致？content 是否非空？数字是否都在？术语是否来自术语表？
- 只输出 JSON，不要解释，不要 Markdown 围栏。`;
}

function scorePrompt(card, translated) {
  return `你是波兰语母语客服质量评审，按 1-5 分严苛打分（允许 0.5 分档）：
5 = 母语者水准；4.5 = 可直接商用；4 = 可交付但有小瑕疵；3 = 不地道或有误译；2 以下 = 不可用。
重点检查：
- fulfillment center 是否被译成 "centrum wykonawcze"（错误）还是 "centrum realizacji zamówień"/"centrum logistyczne"
- refund 是否用 "zwrot pieniędzy"（而不是 refundacja）
- 是否使用 "na etapie"（而不是 w etapie）
- 数字与符号是否完整保留
- 敬语与商业语气是否一致
只输出 JSON：{"score":4.5,"detected_language":"pl","grammar_ok":true,"issues":["..."]}

原文：
${JSON.stringify(card, null, 2)}

译文：
${JSON.stringify(translated, null, 2)}`;
}

async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const cloudHeaders = loadCloudAuth();
  const records = [];

  for (const card of cards) {
    const record = { card_id: card.id, title: card.title };
    try {
      record.draft = await chat({ base: LOCAL_BASE, model: LOCAL_MODEL, headers: {}, prompt: draftPrompt(card), jsonMode: false, temperature: 0.2 });
      console.log(`[draft] ${card.id} ${record.draft.length} chars`);
    } catch (error) {
      record.draft_error = error.message;
      record.draft = '';
    }

    let translated = null;
    let failures = null;
    for (let attempt = 0; attempt < 2 && !translated; attempt += 1) {
      try {
        const raw = await chat({ base: LOCAL_BASE, model: LOCAL_MODEL, headers: {}, prompt: uShapePrompt(card, record.draft || ''), jsonMode: false, temperature: 0.1 });
        const parsed = extractJson(raw);
        if (!parsed) { failures = [{ code: 'JSON_INVALID', detail: raw.slice(0, 200) }]; continue; }
        const validation = validateTranslation(card, parsed, 'pl', { script: 'Latn', glossary });
        if (validation.ok) translated = parsed;
        else failures = validation.failures;
      } catch (error) {
        failures = [{ code: 'LOCAL_ERROR', detail: error.message }];
      }
    }
    record.translated = translated;
    record.failures = failures;
    record.route = translated ? 'local_reflect' : 'local_failed';
    console.log(`[final] ${card.id} -> ${record.route}${failures ? ' :: ' + failures.map((f) => f.code).join(',') : ''}`);

    if (translated) {
      try {
        const raw = await chat({ base: CLOUD_BASE, model: CLOUD_MODEL, headers: cloudHeaders, prompt: scorePrompt(card, translated), jsonMode: true, timeout: 120000, temperature: 0 });
        const score = extractJson(raw);
        record.score = score ? {
          score: Number(score.score) || 0,
          detected_language: score.detected_language || null,
          grammar_ok: Boolean(score.grammar_ok),
          issues: Array.isArray(score.issues) ? score.issues : [],
        } : { score: 0, issues: ['invalid score JSON'] };
      } catch (error) {
        record.score = { score: 0, issues: [error.message] };
      }
      record.admitted = record.score.score > PASS_SCORE && record.score.grammar_ok && record.score.detected_language === 'pl';
      console.log(`[score] ${card.id} ${record.score.score}/5 admitted=${record.admitted}`);
    } else {
      record.score = null;
      record.admitted = false;
    }
    records.push(record);
  }

  // 两卡都达标才入库（draft）
  let inserted = 0;
  const admitted = records.filter((r) => r.admitted);
  if (admitted.length) {
    const db = openDatabase(DB_PATH);
    migrateSchema(db);
    const dao = createDao(db);
    for (const record of admitted) {
      const id = `kb_pl_${record.card_id}`;
      if (dao.findGlobalKnowledge(id)) continue;
      dao.createGlobalKnowledge({
        id,
        title: String(record.translated.title || '').slice(0, 180),
        content: String(record.translated.content || ''),
        tags: Array.isArray(record.translated.tags) ? record.translated.tags : [],
        language: 'pl', locale: 'pl-PL', status: 'draft', audience: 'seller', category: '其他',
        source_id: 'manual_editor',
        structured_payload: { route: record.route, native_score: record.score, reflection: record.draft ? 'u-shape-self-reflection' : null },
      });
      inserted += 1;
    }
    closeDatabase(db);
  }

  const summary = {
    total: records.length,
    local_ok: records.filter((r) => r.route === 'local_reflect').length,
    admitted: admitted.length,
    avg_score: admitted.length ? Number((admitted.reduce((s, r) => s + r.score.score, 0) / admitted.length).toFixed(2)) : 0,
    scores: records.map((r) => ({ id: r.card_id, score: r.score?.score ?? null, admitted: r.admitted })),
    threshold: PASS_SCORE,
    passed: admitted.length === records.length,
    db_inserted: inserted,
  };
  await fsp.writeFile(path.join(OUT_DIR, 'records.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  await fsp.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  const lines = [];
  lines.push('# U 型阵列 + Self-Reflection 终极 Pilot（2 张 3/5 卡）');
  lines.push('');
  lines.push(`- 时间：${new Date().toISOString()}`);
  lines.push(`- 本地：\`${LOCAL_MODEL}\`（22K 上下文，U 型 + 两阶段草稿）`);
  lines.push(`- 云端评分：\`${CLOUD_MODEL}\`（1-5，允许 0.5 分档，阈值 >4.5）`);
  lines.push('');
  lines.push('## 评分');
  lines.push('');
  lines.push('| 卡片 | 本地校验 | 草稿长度 | 母语评分 | 检测语言 | 入库 |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of records) {
    lines.push(`| ${r.title.slice(0, 26)}… | ${r.failures ? r.failures.map((f) => f.code).join(', ') : 'PASS'} | ${r.draft?.length || 0} 字 | ${r.score?.score ?? '—'}/5 | ${r.score?.detected_language || '—'} | ${r.admitted ? '✅' : '❌'} |`);
  }
  lines.push('');
  lines.push('## 结论');
  lines.push('');
  lines.push(`- 入库：${admitted.length} / ${records.length}；平均分：${summary.avg_score}；是否突破 4.5：**${summary.passed ? '是' : '否'}**`);
  for (const r of records) lines.push(`- ${r.title}：${r.score?.score ?? '—'}/5，${(r.score?.issues || []).join('；') || '无问题'}`);
  lines.push('');
  await fsp.writeFile(path.join(OUT_DIR, 'score-report.md'), lines.join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`report: ${path.join(OUT_DIR, 'score-report.md')}`);
}

main().catch((error) => { console.error('[fatal]', error.message); process.exit(1); });
