#!/usr/bin/env node
/**
 * 全球语言 Pilot 翻译测试（只跑 3 张卡，不全量）
 *
 * 读取 config/language_mapping.json，按语种 Tier 选择策略：
 *   Tier 1/2：本地 Qwen 翻译 + 物理校验，通过即可作为候选
 *   Tier 3  ：本地 Qwen 翻译 + 物理校验；失败标记 locale_needs_cloud，
 *             成功也带 cloud_review_required=true（必须云端复核后才可入库）
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { validateTranslation } from './lib/translate-validate.mjs';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 && args[i + 1] ? args[i + 1] : fallback;
};

const MAPPING_PATH = path.resolve(arg('mapping', 'config/language_mapping.json'));
const CARDS_PATH = path.resolve(arg('cards', 'reports/translate/pilot-cards.jsonl'));
const LANGS = String(arg('langs', 'es-ES,pl-PL,sw-KE,fa-IR')).split(',').map((s) => s.trim()).filter(Boolean);
const OUT_DIR = path.resolve(arg('out-dir', 'reports/translate/pilot'));
const LOCAL_BASE = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const LOCAL_MODEL = process.env.LOCAL_MODEL_NAME || 'qwen3.8-35b-a3b@q5_k_m';
const LOCAL_TIMEOUT = Number(process.env.LOCAL_TIMEOUT_MS || 240000);

const mapping = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));
const langByCode = new Map(mapping.languages.map((l) => [l.code, l]));
const cards = fs.readFileSync(CARDS_PATH, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));

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

function buildPrompt(card, lang) {
  return `把下面 JSON 中的 title、content、tags 翻译成 ${lang.name_zh}（${lang.name_en}）。
硬性要求：
1. 返回合法 JSON，Key 必须与输入完全一致（id、title、content、tags），不得翻译字段名。
2. 完整保留原文的适用情境、例外条件、限制、步骤与因果说明，不得删减、合并或省略。
3. 数字、货币符号、百分比原样保留（例如 120、15、2、3、25%、$）。
4. 品牌、平台与指标缩写保留英文（ShipBob、IPP、FBA、SKU、Wix、ACOS、RMA、MC/DOT）。
5. 只输出 JSON，不要解释，不要 Markdown 围栏。

输入：
${JSON.stringify(card, null, 2)}`;
}

async function translateLocal(card, lang) {
  const body = {
    model: LOCAL_MODEL,
    temperature: 0,
    max_tokens: 5000,
    messages: [
      { role: 'system', content: '你是严谨的电商知识库翻译器。只输出 JSON，不改变字段结构。' },
      { role: 'user', content: buildPrompt(card, lang) },
    ],
  };
  const res = await fetch(`${LOCAL_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(LOCAL_TIMEOUT),
  });
  if (!res.ok) throw new Error(`local HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';
  const parsed = extractJson(content);
  if (!parsed) throw new Error(`local non-JSON: ${String(content).slice(0, 200)}`);
  return { parsed, raw: content, usage: data.usage || null };
}

function conditionMarkers(text) {
  const source = String(text || '');
  return {
    chineseMarkers: (source.match(/(例如|如果|当|最多|至少|不超过|超过|避免|不得|除外|例外|前提|条件|否则|但是|同时)/g) || []).length,
    sentences: (source.match(/[。.!?！？]/g) || []).length,
    bullets: (source.match(/^[-*•]/gm) || []).length,
  };
}

async function main() {
  await fsp.mkdir(OUT_DIR, { recursive: true });
  const records = [];
  const needsCloud = [];
  const pool = [];

  for (const card of cards) {
    for (const code of LANGS) {
      const lang = langByCode.get(code);
      if (!lang) throw new Error(`language ${code} not found in mapping`);
      const base = lang.language;
      let parsed = null;
      let failure = null;
      let raw = '';
      try {
        const result = await translateLocal(card, lang);
        parsed = result.parsed;
        raw = result.raw;
        const validation = validateTranslation(card, parsed, base, { script: lang.script });
        if (!validation.ok) failure = validation.failures;
      } catch (error) {
        failure = [{ code: 'LOCAL_ERROR', detail: error.message }];
      }

      const ok = !failure;
      const route = ok
        ? (lang.tier === 3 ? 'local_needs_cloud_review' : 'local_ok')
        : (lang.tier === 3 ? 'locale_needs_cloud' : 'cloud_retry_pool');

      const record = {
        card_id: card.id,
        title: card.title,
        locale: code,
        language: base,
        tier: lang.tier,
        script: lang.script,
        route,
        ok,
        failures: failure,
        keys_equal: ok ? true : (parsed ? JSON.stringify(Object.keys(card).sort()) === JSON.stringify(Object.keys(parsed).sort()) : false),
        source_len: card.content.length,
        translated_len: parsed?.content ? String(parsed.content).length : 0,
        source_markers: conditionMarkers(card.content),
        translated: parsed,
        raw_snippet: raw ? String(raw).slice(0, 300) : null,
      };
      records.push(record);

      if (route === 'locale_needs_cloud') {
        needsCloud.push({ card_id: card.id, locale: code, tier: lang.tier, failures: failure, card, at: new Date().toISOString() });
      }
      if (route === 'cloud_retry_pool') {
        pool.push({ card_id: card.id, locale: code, tier: lang.tier, failures: failure, card, at: new Date().toISOString() });
      }
      console.log(`[${code}] ${card.id} -> ${route}${failure ? ' :: ' + failure.map((f) => f.code).join(',') : ''}`);
    }
  }

  await fsp.writeFile(path.join(OUT_DIR, 'pilot.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  if (needsCloud.length) await fsp.writeFile(path.join(OUT_DIR, 'locale_needs_cloud.jsonl'), needsCloud.map((r) => JSON.stringify(r)).join('\n') + '\n');
  if (pool.length) await fsp.writeFile(path.join(OUT_DIR, 'cloud_retry_pool.jsonl'), pool.map((r) => JSON.stringify(r)).join('\n') + '\n');

  // ---------------- Markdown 报告 ----------------
  const lines = [];
  lines.push('# 全球语言 Pilot 翻译报告');
  lines.push('');
  lines.push(`- 时间：${new Date().toISOString()}`);
  lines.push(`- 本地模型：\`${LOCAL_MODEL}\`（${LOCAL_BASE}）`);
  lines.push(`- 语言映射：\`config/language_mapping.json\`（${mapping.languages.length} 种语言）`);
  lines.push(`- 测试卡：${cards.length} 张`);
  lines.push(`- 测试语种：${LANGS.map((c) => `${c}(Tier${langByCode.get(c).tier})`).join('、')}`);
  lines.push('');
  lines.push('## 结果总览');
  lines.push('');
  lines.push('| 卡片 | 语种 | Tier | 结果 | 失败项 | 字段Key一致 | 译文长度 |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of records) {
    lines.push(`| ${r.card_id.slice(0, 18)}… | ${r.locale} | ${r.tier} | ${r.route} | ${(r.failures || []).map((f) => f.code).join(', ') || '—'} | ${r.keys_equal ? '✅' : '❌'} | ${r.translated_len} |`);
  }
  lines.push('');

  const showCodes = LANGS.filter((c) => langByCode.get(c).tier >= 2);
  for (const card of cards) {
    lines.push(`## 卡片：${card.title}`);
    lines.push('');
    lines.push('原文（节选）：');
    lines.push('```text');
    lines.push(card.content.slice(0, 500));
    lines.push('```');
    lines.push('');
    for (const code of showCodes) {
      const r = records.find((x) => x.card_id === card.id && x.locale === code);
      if (!r) continue;
      lines.push(`### ${code}（Tier ${r.tier}）— ${r.route}`);
      lines.push('');
      if (!r.translated) {
        lines.push(`失败：${(r.failures || []).map((f) => `${f.code}: ${f.detail}`).join('；')}`);
        lines.push('');
        continue;
      }
      lines.push('```json');
      lines.push(JSON.stringify(r.translated, null, 2));
      lines.push('```');
      lines.push('');
    }
  }
  if (needsCloud.length) {
    lines.push('## locale_needs_cloud 队列');
    lines.push('');
    lines.push('以下 Tier 3 结果未通过本地物理校验，已标记 `locale_needs_cloud`，等待云端 DeepSeek 复核：');
    lines.push('');
    for (const row of needsCloud) lines.push(`- ${row.card_id} · ${row.locale} · ${row.failures.map((f) => f.code).join(', ')}`);
    lines.push('');
  }
  await fsp.writeFile(path.join(OUT_DIR, 'PILOT-REPORT.md'), lines.join('\n') + '\n');

  const summary = {
    total: records.length,
    local_ok: records.filter((r) => r.route === 'local_ok').length,
    local_needs_cloud_review: records.filter((r) => r.route === 'local_needs_cloud_review').length,
    locale_needs_cloud: needsCloud.length,
    cloud_retry_pool: pool.length,
    by_locale: LANGS.map((code) => {
      const rows = records.filter((r) => r.locale === code);
      return { locale: code, tier: langByCode.get(code).tier, ok: rows.filter((r) => r.ok).length, failed: rows.filter((r) => !r.ok).length };
    }),
  };
  await fsp.writeFile(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`report: ${path.join(OUT_DIR, 'PILOT-REPORT.md')}`);
}

main().catch((error) => { console.error('[fatal]', error.message); process.exit(1); });
