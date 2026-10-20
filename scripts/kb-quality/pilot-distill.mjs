#!/usr/bin/env node
/**
 * KB-QUALITY-001 / 阶段三：WixQA 100 篇小批量蒸馏
 *
 * 策略：本地 Qwen3.8（LM Studio）优先 → 失败重试 1 次 → 仍失败转 DeepSeek 云端
 * （复用 DSH 账户 token，模型 deepseek-flash）。
 *
 * 只读 WixQA 语料；产物全部写入 reports/kb-quality-001/。
 *
 * 用法：
 *   node scripts/kb-quality/pilot-distill.mjs --limit 100 --concurrency 3
 *   node scripts/kb-quality/pilot-distill.mjs --dry-run     # 只打印抽样清单
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};
const hasFlag = (name) => argv.includes(`--${name}`);

const WIX_DIR = 'D:/Documents/AI_Projects/NudgeSo/language_prompt/GPT/02_WixQA/dataset_snapshot';
const OUT_DIR = path.resolve(ROOT, 'reports/kb-quality-001');
fs.mkdirSync(OUT_DIR, { recursive: true });

const LIMIT = Number(arg('limit', '100'));
const CONCURRENCY = Number(arg('concurrency', '3'));
const DRY_RUN = hasFlag('dry-run');
const MAX_CONTENT = Number(arg('max-content', '6000'));
const PROMPT_VERSION = 'kbq001-pilot-v1';

// 云端预算闸门（本地两次失败后才触发）
const MAX_CLOUD_CALLS = Number(arg('max-cloud-calls', '20'));
const MAX_CLOUD_TOKENS = Number(arg('max-cloud-tokens', '200000'));

const LOCAL = {
  url: process.env.LOCAL_LLM_URL || 'http://192.168.3.227:3679/v1',
  model: process.env.LOCAL_LLM_MODEL || 'qwen3.8-35b-a3b@q5_k_m',
};
const CLOUD = {
  url: process.env.CLOUD_LLM_URL || 'https://api.deepseek.com/v1',
  model: process.env.CLOUD_LLM_MODEL || 'deepseek-flash',
  key: '',
};

// 读取 DSH 账户 token（不落盘、不打印）
function loadDshToken() {
  const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
  const file = path.join(dshHome, '.credentials.yaml');
  if (!fs.existsSync(file)) return '';
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  let inAccount = false;
  for (const line of lines) {
    if (/^\s{2}deepseek-account-platform\/default:\s*$/.test(line)) { inAccount = true; continue; }
    if (inAccount && /^\s{2}\S/.test(line)) break;
    if (inAccount) {
      const m = line.match(/^\s+token:\s*(\S+)\s*$/);
      if (m) return m[1];
    }
  }
  return '';
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------- 抽样
function hashOrder(text) {
  return crypto.createHash('sha1').update(text).digest('hex');
}

function readCorpus() {
  const file = path.join(WIX_DIR, 'wix_kb_corpus/wix_kb_corpus.jsonl');
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return rows;
}

function sample(rows, limit) {
  const byType = {};
  for (const row of rows) {
    const type = row.article_type || 'unknown';
    (byType[type] ||= []).push(row);
  }
  for (const type of Object.keys(byType)) {
    byType[type].sort((a, b) => hashOrder(a.id).localeCompare(hashOrder(b.id)));
  }
  const total = rows.length;
  const picked = [];
  for (const [type, list] of Object.entries(byType)) {
    const quota = Math.max(1, Math.round((list.length / total) * limit));
    picked.push(...list.slice(0, quota).map((row) => ({ ...row, sampled_type: type })));
  }
  picked.sort((a, b) => hashOrder(a.id).localeCompare(hashOrder(b.id)));
  return picked.slice(0, limit);
}

// ---------------------------------------------------------------- LLM 调用
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callOpenAI(base, model, key, prompt, extraHeaders = {}) {
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = `Bearer ${key}`;
  Object.assign(headers, extraHeaders);
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: 'You extract grounded knowledge cards from documentation. Output strictly valid JSON. Never invent facts.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 3000,
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return {
    content: data?.choices?.[0]?.message?.content || '',
    usage: data?.usage || {},
  };
}

function extractJson(text) {
  if (!text) return null;
  let clean = String(text).replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < clean.length; i += 1) {
    const ch = clean[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
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

function promptFor(article) {
  const content = String(article.contents || '').slice(0, MAX_CONTENT);
  return `你是企业帮助中心知识结构化专家。请把下面这篇 Wix 帮助中心文章拆成 1-4 张“可核查的知识卡”。

严格规则：
1. 只能使用文章中出现的事实；禁止补写文章里没有的政策、承诺、时间限制、金额或步骤。
2. 保留原文中的金额、百分比、日期、单位、前置条件与例外情况，数字必须与原文一致。
3. 每张卡必须包含 evidence: [{"quote": "..."}]，quote 必须是原文的逐字片段（8-200 字），不得改写。
4. 如果文章不足以支撑某个字段，数组留空 []，不要编造；确实信息不足时 knowledge_type 用 "faq"，review_status 用 "needs_review"。
5. 只输出 JSON 对象，不要解释、不要 Markdown 围栏。

输出格式：
{"cards":[{
 "knowledge_type":"how_to|troubleshooting|feature_explainer|known_issue|faq",
 "intent_id":"小写下划线标识，如 event_registration_form",
 "aliases":["用户可能的其他问法，最多4条"],
 "required_slots":["回答时需要用户提供的槽位，如 event_name"],
 "answer":"直接回答，1-3 句，必须可被 evidence 支撑",
 "steps":["可执行步骤，最多8条"],
 "preconditions":["前置条件"],
 "exceptions":["例外/限制"],
 "evidence":[{"quote":"原文逐字片段"}],
 "review_status":"approved|needs_review"
}]}

文章标题：${article.title}
文章类型：${article.article_type}
文章正文：
${content}`;
}

// ---------------------------------------------------------------- 卡片校验
function normalize(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function validateCard(card, article) {
  const errors = [];
  if (!card || typeof card !== 'object') errors.push('not_object');
  if (!card.answer || typeof card.answer !== 'string') errors.push('missing_answer');
  if (!Array.isArray(card.evidence) || card.evidence.length === 0) errors.push('missing_evidence');
  else {
    const haystack = normalize(article.contents);
    for (const ev of card.evidence) {
      const quote = normalize(ev?.quote);
      if (!quote || quote.length < 8) errors.push('short_quote');
      else if (!haystack.includes(quote)) errors.push('quote_not_in_source');
    }
  }
  if (!card.intent_id || !/^[a-z0-9_.]+$/.test(card.intent_id)) errors.push('bad_intent_id');
  if (!Array.isArray(card.steps)) errors.push('bad_steps');
  if (!Array.isArray(card.preconditions)) errors.push('bad_preconditions');
  if (!Array.isArray(card.exceptions)) errors.push('bad_exceptions');
  return errors;
}

function numbersPreserved(answer, article) {
  const nums = String(answer).match(/\d+(?:[.,]\d+)?/g) || [];
  if (!nums.length) return true;
  const hay = String(article.contents);
  return nums.every((n) => hay.includes(n));
}

function toCard(raw, article, index) {
  const contents = String(article.contents || '');
  const quote = String(raw.evidence?.[0]?.quote || '');
  const start = contents.indexOf(quote);
  const card = {
    card_id: `kb_wix_${article.id.slice(0, 10)}_${index + 1}`,
    version: 1,
    knowledge_type: raw.knowledge_type || 'faq',
    audience: 'platform_support',
    industry: 'website_builder_platform',
    locale: 'en',
    intent_id: String(raw.intent_id || `wix.${article.id.slice(0, 8)}`).slice(0, 60),
    aliases: Array.isArray(raw.aliases) ? raw.aliases.slice(0, 8).map(String) : [],
    required_slots: Array.isArray(raw.required_slots) ? raw.required_slots.slice(0, 8).map(String) : [],
    answer: String(raw.answer || '').slice(0, 4000),
    steps: Array.isArray(raw.steps) ? raw.steps.slice(0, 12).map(String) : [],
    preconditions: Array.isArray(raw.preconditions) ? raw.preconditions.slice(0, 8).map(String) : [],
    exceptions: Array.isArray(raw.exceptions) ? raw.exceptions.slice(0, 8).map(String) : [],
    evidence: Array.isArray(raw.evidence) ? raw.evidence.slice(0, 3).map((e) => ({ source_id: article.id, quote: String(e.quote || '') })) : [],
    source_id: article.id,
    source_url: article.url,
    source_span: { start: start >= 0 ? start : 0, end: start >= 0 ? start + quote.length : 0 },
    source_hash: sha256(contents),
    license_status: 'approved_with_attribution',
    review_status: 'approved',
    state: 'PASS_LOCAL',
    numbers_preserved: numbersPreserved(raw.answer || '', article),
  };
  if (!card.numbers_preserved) card.review_status = 'needs_review';
  return card;
}

// ---------------------------------------------------------------- 并发与主流程
function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

const BUDGET = {
  local_calls: 0,
  local_tokens_in: 0,
  local_tokens_out: 0,
  cloud_calls: 0,
  cloud_tokens_in: 0,
  cloud_tokens_out: 0,
  cloud_budget_exhausted: false,
};

async function processArticle(article, log, cache) {
  if (cache[article.id]) {
    log.push({ source_id: article.id, title: article.title, article_type: article.article_type, provider: cache[article.id].provider, status: cache[article.id].status, cards: cache[article.id].cards.length, cached: true, attempts: [] });
    return { cards: cache[article.id].cards, status: cache[article.id].status, provider: cache[article.id].provider };
  }

  const prompt = promptFor(article);
  const attempts = [];

  const tryOnce = async (provider) => {
    const started = Date.now();
    try {
      const out = provider === 'local'
        ? await callOpenAI(LOCAL.url, LOCAL.model, '', prompt)
        : await callOpenAI(CLOUD.url, CLOUD.model, CLOUD.key, prompt, { 'x-dsh-auth-token': CLOUD.key });
      if (provider === 'local') {
        BUDGET.local_calls += 1;
        BUDGET.local_tokens_in += out.usage.prompt_tokens || 0;
        BUDGET.local_tokens_out += out.usage.completion_tokens || 0;
      } else {
        BUDGET.cloud_calls += 1;
        BUDGET.cloud_tokens_in += out.usage.prompt_tokens || 0;
        BUDGET.cloud_tokens_out += out.usage.completion_tokens || 0;
      }
      const parsed = extractJson(out.content);
      if (!parsed || !Array.isArray(parsed.cards) || parsed.cards.length === 0) throw new Error('unparseable_or_empty');
      const cards = [];
      const rejects = [];
      parsed.cards.forEach((raw, index) => {
        const errors = validateCard(raw, article);
        const card = toCard(raw, article, index);
        if (errors.length) {
          card.review_status = 'needs_review';
          card.validation_errors = errors;
          rejects.push({ index, errors });
        }
        cards.push(card);
      });
      attempts.push({ provider, ok: true, cards: cards.length, rejects: rejects.length, ms: Date.now() - started, usage: out.usage });
      return { provider, cards, rejects };
    } catch (error) {
      attempts.push({ provider, ok: false, error: String(error.message).slice(0, 160), ms: Date.now() - started });
      return { provider, cards: [], rejects: [], error: String(error.message) };
    }
  };

  let result = await tryOnce('local');
  if (result.cards.length === 0) {
    await sleep(1200);
    result = await tryOnce('local');
  }

  let provider = 'local';
  if (result.cards.length === 0) {
    if (BUDGET.cloud_calls >= MAX_CLOUD_CALLS || BUDGET.cloud_tokens_in + BUDGET.cloud_tokens_out >= MAX_CLOUD_TOKENS) {
      BUDGET.cloud_budget_exhausted = true;
    } else if (CLOUD.key) {
      result = await tryOnce('cloud');
      provider = 'cloud';
    }
  }

  const approved = result.cards.filter((c) => c.review_status === 'approved').length;
  const status = result.cards.length === 0
    ? 'HUMAN_REVIEW'
    : provider === 'cloud'
      ? 'PASS_CLOUD'
      : approved === result.cards.length ? 'PASS_LOCAL' : 'HUMAN_REVIEW';

  const entry = { provider, status, cards: result.cards, attempts, at: new Date().toISOString() };
  for (const card of result.cards) card.state = status;
  cache[article.id] = entry;
  log.push({ source_id: article.id, title: article.title, article_type: article.article_type, provider, status, cards: result.cards.length, approved, attempts });
  return { cards: result.cards, status, provider };
}

async function main() {
  CLOUD.key = loadDshToken();
  const corpus = readCorpus();
  const picked = sample(corpus, LIMIT);

  console.log(`[sample] ${picked.length} / ${corpus.length} articles`);
  const byType = {};
  for (const a of picked) byType[a.article_type] = (byType[a.article_type] || 0) + 1;
  console.log('[sample] types:', JSON.stringify(byType));
  if (DRY_RUN) {
    for (const a of picked.slice(0, 10)) console.log(`  - [${a.article_type}] ${a.title}`);
    console.log(`[dry-run] ${picked.length} articles, no LLM calls`);
    return;
  }

  const cardsFile = path.join(OUT_DIR, 'pilot-cards.jsonl');
  const failFile = path.join(OUT_DIR, 'pilot-failures.jsonl');
  const logFile = path.join(OUT_DIR, 'pilot-log.jsonl');
  const cacheFile = path.join(OUT_DIR, 'pilot-cache.json');
  for (const f of [cardsFile, failFile, logFile]) fs.writeFileSync(f, '');

  const cache = {};
  const limit = createLimiter(CONCURRENCY);
  const logs = [];
  const states = {};
  let done = 0, totalCards = 0, failedArticles = 0, approvedCards = 0, needsReviewCards = 0;

  const saveCache = () => fs.writeFileSync(cacheFile, JSON.stringify(cache));

  await Promise.all(picked.map((article) => limit(async () => {
    const result = await processArticle(article, logs, cache);
    if (result.cards.length) {
      fs.appendFileSync(cardsFile, result.cards.map((c) => JSON.stringify(c)).join('\n') + '\n');
      totalCards += result.cards.length;
      approvedCards += result.cards.filter((c) => c.review_status === 'approved').length;
      needsReviewCards += result.cards.filter((c) => c.review_status !== 'approved').length;
    } else {
      failedArticles += 1;
      fs.appendFileSync(failFile, JSON.stringify({ source_id: article.id, title: article.title, type: article.article_type }) + '\n');
    }
    states[result.status] = (states[result.status] || 0) + 1;
    const last = logs[logs.length - 1];
    if (last) fs.appendFileSync(logFile, JSON.stringify(last) + '\n');
    done += 1;
    if (done % 10 === 0) {
      saveCache();
      console.log(`  [${done}/${picked.length}] cards=${totalCards} failed=${failedArticles} states=${JSON.stringify(states)}`);
    }
  })));

  saveCache();
  const meta = {
    generated_at: new Date().toISOString(),
    prompt_version: PROMPT_VERSION,
    articles_sampled: picked.length,
    articles_with_cards: picked.length - failedArticles,
    failed_articles: failedArticles,
    cards: totalCards,
    approved_cards: approvedCards,
    needs_review_cards: needsReviewCards,
    states,
    providers: logs.reduce((acc, l) => { acc[l.provider] = (acc[l.provider] || 0) + 1; return acc; }, {}),
    budget: BUDGET,
    budget_limits: { max_cloud_calls: MAX_CLOUD_CALLS, max_cloud_tokens: MAX_CLOUD_TOKENS },
    local_model: LOCAL.model,
    cloud_model: CLOUD.model,
    cloud_available: Boolean(CLOUD.key),
    cost_note: 'DeepSeek 单价未在仓库配置，需按账户实际计费核对；本报告只记录 token。',
  };
  fs.writeFileSync(path.join(OUT_DIR, 'pilot-run.json'), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));
}

main().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exit(1);
});
