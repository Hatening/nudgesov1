#!/usr/bin/env node
/**
 * Cloud rescue pipeline for rejected knowledge cards.
 *
 * Default mode is PILOT: select 10 hydrated rejected cards covering every
 * reject_reason/source_type combination, call the configured OpenAI-compatible
 * model, then immediately run the local evidence gate (numbers / URLs /
 * entities must occur in the source).
 *
 * Full mode is opt-in (`--all`) and is intentionally not run by default.
 *
 * Usage:
 *   node scripts/rescue-rejected.mjs                 # pilot 10
 *   node scripts/rescue-rejected.mjs --all            # full 5,373 (after approval)
 *
 * The script never prints the API key. It records token usage per attempt in
 * raw_data/rescue_usage.jsonl and writes pilot/full results under raw_data/.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POOL_PATH = path.join(ROOT, 'raw_data', 'recycle_pool.jsonl');
const SOURCE_PACK_PATH = path.join(ROOT, 'raw_data', 'rejected_with_sources.jsonl');
const PILOT_RESULTS_PATH = path.join(ROOT, 'raw_data', 'rescue_pilot_results.jsonl');
const PILOT_REPORT_PATH = path.join(ROOT, 'raw_data', 'rescue_pilot_report.md');
const FULL_RESULTS_PATH = path.join(ROOT, 'raw_data', 'rescue_full_results.jsonl');
const RESCUED_CARDS_PATH = path.join(ROOT, 'raw_data', 'rescued_cards.jsonl');
const USAGE_PATH = path.join(ROOT, 'raw_data', 'rescue_usage.jsonl');

const ALLOWED_CATEGORIES = new Set([
  '退货与退款', '物流与配送', '支付与结算', '商品与尺码', '账号与安全',
  '广告与营销', '投诉与纠纷', '平台规则', '其他', '行业洞察', '商业策略'
]);

// Exactly one group per hydrated source_type/reject_reason combination.
const PILOT_GROUPS = [
  ['wixqa', 'number+url'],
  ['wixqa', 'url'],
  ['wixqa', 'number+url+entity'],
  ['wixqa', 'number'],
  ['wixqa', 'url+entity'],
  ['wixqa', 'entity'],
  ['wixqa', 'number+entity'],
  ['ecommerce_ai_skills', 'entity'],
  ['ecommerce_ai_skills', 'number'],
  ['ecommerce_ai_skills', 'number+entity']
];

const STOP = new Set([
  'The', 'This', 'That', 'These', 'Those', 'You', 'Your', 'Yes', 'No', 'If', 'When',
  'Where', 'What', 'How', 'Why', 'Can', 'Could', 'Should', 'Will', 'Would', 'It',
  'In', 'On', 'For', 'To', 'With', 'From', 'And', 'Or', 'A', 'An', 'All', 'Any',
  // Imperative/sentence starters are not entity names.
  'Use', 'Select', 'Click', 'Enter', 'Choose', 'Go', 'Add', 'Note', 'Create', 'Upload',
  'Check', 'Set', 'Open', 'Then', 'Under', 'After', 'Before', 'Ensure', 'Make', 'Review',
  'Follow', 'Log', 'Save', 'Paste', 'Copy', 'Filter', 'Compare', 'Allow', 'Submit',
  'Purchase', 'Redeem', 'Apply', 'Contact', 'First', 'Next', 'Finally', 'Optionally'
]);

const URL_RE = /https?:\/\/[^\s)\]"'<>]+/gi;
const NUMBER_RE = /(?<![\w])\d[\d,]*(?:\.\d+)?%?/g;
const ENTITY_RE = /\b(?:[A-Z][A-Za-z0-9&+.-]*(?:[ \t]+(?:of|the|and|for|to|in|on|with|&)[ \t]+|[ \t]+)+[A-Z][A-Za-z0-9&+.-]*)\b/g;
const QUOTED_RE = /`([^`]{3,80})`|"([^"]{3,80})"|“([^”]{3,80})”/g;

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path.basename(file)}:${index + 1}: ${error.message}`);
      }
    });
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function pLimit(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const job = queue.shift();
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        next();
      });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

function readDshToken() {
  const dshHome = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
  const file = path.join(dshHome, '.credentials.yaml');
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  let inAccount = false;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s{2}deepseek-account-platform\/default:\s*$/.test(line)) {
      inAccount = true;
      continue;
    }
    if (inAccount && /^\s{2}\S/.test(line)) break;
    if (inAccount) {
      const match = line.match(/^\s+token:\s*(\S+)\s*$/);
      if (match) return match[1];
    }
  }
  return null;
}

function loadConfig() {
  const env = process.env;
  let apiKey = env.LLM_API_KEY || env.OPENAI_API_KEY || '';
  let baseUrl = env.LLM_BASE_URL || env.OPENAI_BASE_URL || '';
  let model = env.LLM_MODEL || env.OPENAI_MODEL || '';
  let authHeader = env.LLM_AUTH_HEADER;
  let authScheme = env.LLM_AUTH_SCHEME;
  let credentialSource = 'env';

  if (!apiKey) {
    const token = readDshToken();
    if (!token) {
      throw new Error('No LLM_API_KEY/OPENAI_API_KEY and no DSH account token found.');
    }
    apiKey = token;
    credentialSource = 'dsh-account';
    baseUrl ||= 'https://api.deepseek.com/v1';
    model ||= 'deepseek-flash';
    authHeader ||= 'x-dsh-auth-token';
    if (authScheme === undefined) authScheme = '';
  } else {
    baseUrl ||= 'https://api.openai.com/v1';
    model ||= 'gpt-4o-mini';
    authHeader ||= 'authorization';
    if (authScheme === undefined) authScheme = 'Bearer';
  }

  const responseFormat = String(env.LLM_RESPONSE_FORMAT || 'json_object').toLowerCase();
  return {
    apiKey,
    credentialSource,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    authHeader: String(authHeader).toLowerCase(),
    authScheme: String(authScheme),
    responseFormat: responseFormat === 'json_object' ? 'json_object' : null,
    temperature: Number(env.LLM_TEMPERATURE || 0.1),
    timeoutMs: Number(env.LLM_TIMEOUT_MS || 60000),
    maxTokens: Number(env.RESCUE_MAX_TOKENS || 4096),
    maxSourceChars: Number(env.RESCUE_MAX_SOURCE_CHARS || 12000),
    maxRetries: Number(env.RESCUE_MAX_RETRIES || 2),
    concurrency: Math.max(1, Number(env.RESCUE_CONCURRENCY || 3)),
    inputPricePer1M: Number(env.LLM_INPUT_PRICE_PER_1M || 0),
    outputPricePer1M: Number(env.LLM_OUTPUT_PRICE_PER_1M || 0)
  };
}

function authHeaders(config) {
  return {
    'content-type': 'application/json',
    [config.authHeader]: config.authScheme ? `${config.authScheme} ${config.apiKey}` : config.apiKey
  };
}

function buildMessages(item, config) {
  const rejectReason = item.reject_reason || 'unknown';
  const fullSource = String(item.source_text || '');
  const truncated = fullSource.length > config.maxSourceChars;
  const sourceForPrompt = truncated ? fullSource.slice(0, config.maxSourceChars) : fullSource;
  const system = `你是一个极其严苛的电商合规审核员。下面是一张知识卡和它的原文。卡片因 ${rejectReason} 被拦截。请基于原文，修正这张卡。绝不能添加原文里没有的数字、URL、前置条件！如果完全偏离原文，输出 {"status": "discard"}；如果可以修正，输出标准 JSON（包含 question, answer, category 等）。

附加纪律：
- 只输出一个 JSON 对象，不要 Markdown 代码块或解释。
- status 只能是 "rescued" 或 "discard"。
- rescued 时必须包含 question、answer、category、language、notes。
- category 只能从以下列表选择：${[...ALLOWED_CATEGORIES].join('、')}。
- answer 中的每一个数字、URL、实体/引号短语都必须能在原文中找到；绝不能新增原文没有的价格、时效、承诺或前置条件。
- 如果原文不足以安全修正，status 必须是 "discard"。`;
  const user = JSON.stringify({
    reject_reason: rejectReason,
    reject_details: String(item.reason || '').slice(0, 2000),
    original_card: {
      question: item.question || '',
      answer: item.original_answer || '',
      category: item.category || '其他',
      language: item.language || 'en'
    },
    source: {
      title: item.source_title || '',
      url: item.source_url || '',
      text: sourceForPrompt,
      truncated
    }
  });
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

function extractJsonObject(content) {
  const text = String(content || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function validateAnswer(answer, source) {
  const text = String(answer || '');
  const src = normalize(source);
  const srcNoComma = src.replace(/,/g, '');
  const checked = { urls: [], numbers: [], entities: [] };
  const missing = [];

  const urls = new Set([...text.matchAll(URL_RE)].map((match) => match[0].replace(/[.,;:]+$/, '')));
  for (const url of urls) {
    checked.urls.push(url);
    if (!src.includes(normalize(url))) missing.push(`url:${url}`);
  }

  const numbers = new Set([...text.matchAll(NUMBER_RE)].map((match) => match[0].replace(/[.,;:]+$/, '')));
  for (const number of numbers) {
    checked.numbers.push(number);
    const normalized = normalize(number);
    if (!src.includes(normalized) && !srcNoComma.includes(normalized.replace(/,/g, ''))) {
      missing.push(`number:${number}`);
    }
  }

  const entities = new Set();
  for (const match of text.matchAll(ENTITY_RE)) {
    const entity = match[0];
    const first = entity.split(/\s+/)[0];
    if (entity === entity.toUpperCase()) continue;
    if (STOP.has(first)) continue;
    // Do not let a sentence-ending word ("Discount.", "ID.") glue onto the
    // next list item and become a fake entity.
    if (/[.,;:!?]$/.test(first)) continue;
    if (/\s-\s/.test(entity)) continue;
    if (entity.length >= 4) entities.add(entity);
  }
  for (const groups of text.matchAll(QUOTED_RE)) {
    for (const group of groups.slice(1)) {
      if (group && group.trim()) entities.add(group.trim());
    }
  }
  for (const entity of entities) {
    checked.entities.push(entity);
    if (!src.includes(normalize(entity))) missing.push(`entity:${entity}`);
  }

  return { passed: missing.length === 0, missing, checked };
}

async function requestOnce(config, messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const body = {
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens
    };
    if (config.responseFormat) body.response_format = { type: config.responseFormat };
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders(config),
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}: ${text.slice(0, 600)}`);
      error.status = response.status;
      error.retryAfter = response.headers.get('retry-after');
      throw error;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Cloud response is not JSON: ${text.slice(0, 300)}`);
    }
    const choice = data.choices?.[0] || {};
    return {
      content: choice.message?.content || '',
      reasoning: choice.message?.reasoning_content || '',
      finishReason: choice.finish_reason || null,
      usage: data.usage || {},
      model: data.model || config.model
    };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWithRetry(config, item, messages, logUsage) {
  let lastError;
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    const started = Date.now();
    try {
      const result = await requestOnce(config, messages);
      const usage = {
        prompt_tokens: Number(result.usage.prompt_tokens || result.usage.input_tokens || 0),
        completion_tokens: Number(result.usage.completion_tokens || result.usage.output_tokens || 0),
        total_tokens: Number(result.usage.total_tokens || 0)
      };
      const cost = (usage.prompt_tokens / 1_000_000) * config.inputPricePer1M
        + (usage.completion_tokens / 1_000_000) * config.outputPricePer1M;
      logUsage({
        at: new Date().toISOString(),
        rescue_id: item.rescue_id,
        attempt: attempt + 1,
        status: 'ok',
        model: result.model,
        finish_reason: result.finishReason,
        reasoning_chars: String(result.reasoning || '').length,
        latency_ms: Date.now() - started,
        usage,
        estimated_cost_usd: Number(cost.toFixed(8))
      });
      return { ...result, usage, estimated_cost_usd: cost, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      logUsage({
        at: new Date().toISOString(),
        rescue_id: item.rescue_id,
        attempt: attempt + 1,
        status: 'error',
        http_status: error.status || null,
        latency_ms: Date.now() - started,
        error: String(error.message || error).slice(0, 500)
      });
      const retryable = error.status === 429 || (error.status >= 500 && error.status < 600);
      if (!retryable || attempt === config.maxRetries) break;
      const retryAfter = Number(error.retryAfter);
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(10000, 1000 * (2 ** attempt) + Math.floor(Math.random() * 300));
      console.error(`[retry] ${item.rescue_id} attempt ${attempt + 1} failed (${error.status || 'network'}); waiting ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function normalizeCategory(value, fallback) {
  const category = String(value || '').trim();
  if (ALLOWED_CATEGORIES.has(category)) return category;
  return ALLOWED_CATEGORIES.has(fallback) ? fallback : '其他';
}

async function rescueItem(item, config, logUsage) {
  const messages = buildMessages(item, config);
  const cloud = await requestWithRetry(config, item, messages, logUsage);
  const parsed = extractJsonObject(cloud.content);
  const base = {
    rescue_id: item.rescue_id,
    source_type: item.source_type,
    source: item.source,
    idx: item.idx,
    reject_reason: item.reject_reason,
    reject_details: item.reason,
    source_file: item.source_file,
    source_title: item.source_title,
    source_url: item.source_url,
    before: {
      question: item.question,
      answer: item.original_answer,
      category: item.category,
      language: item.language
    },
    cloud: {
      model: cloud.model,
      attempts: cloud.attempts,
      finish_reason: cloud.finishReason,
      reasoning_chars: String(cloud.reasoning || '').length,
      usage: cloud.usage,
      estimated_cost_usd: Number(cloud.estimated_cost_usd.toFixed(8)),
      raw_content: String(cloud.content || '').slice(0, 4000)
    }
  };

  if (!parsed) {
    return { ...base, status: 'parse_error', error: 'cloud response did not contain a JSON object', validation: null, review_status: null };
  }
  if (parsed.status === 'discard') {
    return { ...base, status: 'discard', after: null, validation: null, notes: String(parsed.reason || parsed.notes || '').slice(0, 1000), review_status: null };
  }
  if (parsed.status !== 'rescued') {
    return { ...base, status: 'invalid_response', error: `unexpected status: ${parsed.status}`, validation: null, review_status: null };
  }

  const answer = String(parsed.answer || '').trim();
  const question = String(parsed.question || item.question || '').trim();
  const category = normalizeCategory(parsed.category, item.category);
  const language = String(parsed.language || item.language || 'en').slice(0, 12);
  if (!answer) {
    return { ...base, status: 'invalid_response', error: 'rescued response has empty answer', validation: null, review_status: null };
  }
  const validation = validateAnswer(answer, item.source_text);
  const after = {
    status: 'rescued',
    question,
    answer,
    category,
    language,
    notes: String(parsed.notes || '').slice(0, 1000)
  };
  if (!validation.passed) {
    return { ...base, status: 'validation_failed', after, validation, review_status: null };
  }
  return {
    ...base,
    status: 'rescued',
    after: { ...after, review_status: 'cloud-rescued' },
    validation,
    review_status: 'cloud-rescued'
  };
}

function selectPilot(pool, pack) {
  const byKey = new Map(pack.map((item) => [`${item.source_type}|${item.source}|${item.idx}`, item]));
  const selected = [];
  const used = new Set();
  for (const [sourceType, reason] of PILOT_GROUPS) {
    const poolRow = pool.find((row) => (
      row.source_type === sourceType
      && row.reject_reason === reason
      && !used.has(`${row.source_type}|${row.source}|${row.idx}`)
    ));
    if (!poolRow) continue;
    const key = `${poolRow.source_type}|${poolRow.source}|${poolRow.idx}`;
    const hydrated = byKey.get(key);
    if (!hydrated || !hydrated.hydrate_ok) continue;
    used.add(key);
    selected.push({
      ...hydrated,
      rescue_id: `rescue_${crypto.createHash('sha1').update(key).digest('hex').slice(0, 16)}`
    });
  }
  return selected;
}

function readJsonlLoose(file) {
  if (!fs.existsSync(file)) return [];
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // A process kill can leave the last line partial; resume from the rest.
    }
  }
  return rows;
}

function toRescuedCard(result) {
  return {
    id: result.rescue_id,
    source_type: result.source_type,
    source: result.source,
    source_file: result.source_file,
    source_title: result.source_title,
    source_url: result.source_url,
    reject_reason: result.reject_reason,
    review_status: 'cloud-rescued',
    question: result.after.question,
    answer: result.after.answer,
    category: result.after.category,
    language: result.after.language,
    validation: result.validation,
    cloud: result.cloud
  };
}

function truncate(value, length = 900) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function printPilot(results) {
  results.forEach((result, index) => {
    console.log(`\n===== [${index + 1}/${results.length}] ${result.source_type} | ${result.reject_reason} | ${result.rescue_id} =====`);
    console.log('BEFORE');
    console.log(`  question: ${truncate(result.before.question, 500)}`);
    console.log(`  answer:   ${truncate(result.before.answer, 900)}`);
    console.log(`  reject:   ${truncate(result.reject_details, 500)}`);
    console.log('AFTER');
    console.log(`  status:   ${result.status}`);
    if (result.after) {
      console.log(`  question: ${truncate(result.after.question, 500)}`);
      console.log(`  answer:   ${truncate(result.after.answer, 900)}`);
      console.log(`  category: ${result.after.category} | review_status: ${result.after.review_status || result.review_status || '-'}`);
    } else if (result.error) {
      console.log(`  error:    ${truncate(result.error, 500)}`);
    }
    if (result.validation) {
      console.log(`  evidence: ${result.validation.passed ? 'PASS' : 'FAIL'}${result.validation.missing.length ? ` | missing: ${result.validation.missing.slice(0, 6).join('; ')}` : ''}`);
    }
    console.log(`  tokens:   prompt=${result.cloud.usage.prompt_tokens} completion=${result.cloud.usage.completion_tokens} total=${result.cloud.usage.total_tokens} | cost=$${result.cloud.estimated_cost_usd}`);
  });
}

function writePilotReport(results, summary) {
  const lines = [
    '# Cloud Rescue Pilot (10 cards)',
    '',
    `Generated: ${summary.generated_at}`,
    `Model: ${summary.model}`,
    `Concurrency: ${summary.concurrency}`,
    '',
    `Rescued: **${summary.rescued}** | Discard: **${summary.discard}** | Validation failed: **${summary.validation_failed}** | Errors: **${summary.errors}**`,
    '',
    `Tokens: prompt **${summary.tokens.prompt_tokens}**, completion **${summary.tokens.completion_tokens}**, total **${summary.tokens.total_tokens}**`,
    `Estimated cost: **$${summary.estimated_cost_usd}** (${summary.pricing_note})`,
    ''
  ];
  if (summary.note) lines.push(`> ${summary.note}`, '');
  results.forEach((result, index) => {
    lines.push(`## ${index + 1}. ${result.source_type} / ${result.reject_reason} / \`${result.rescue_id}\``);
    lines.push('');
    lines.push('**Before**');
    lines.push('');
    lines.push(`- question: ${result.before.question}`);
    lines.push(`- answer: ${result.before.answer}`);
    lines.push(`- reject: ${result.reject_details}`);
    lines.push('');
    lines.push('**After**');
    lines.push('');
    lines.push(`- status: \`${result.status}\``);
    if (result.after) {
      lines.push(`- question: ${result.after.question}`);
      lines.push(`- answer: ${result.after.answer}`);
      lines.push(`- category: ${result.after.category}`);
    }
    if (result.validation) {
      lines.push(`- evidence: ${result.validation.passed ? 'PASS' : 'FAIL'}`);
      if (result.validation.missing.length) lines.push(`- missing: ${result.validation.missing.join('; ')}`);
    }
    lines.push(`- tokens: prompt ${result.cloud.usage.prompt_tokens}, completion ${result.cloud.usage.completion_tokens}, total ${result.cloud.usage.total_tokens}`);
    lines.push('');
  });
  fs.writeFileSync(PILOT_REPORT_PATH, lines.join('\n'), 'utf8');
}

function summarize(results, config) {
  const tokens = results.reduce((acc, result) => {
    acc.prompt_tokens += result.cloud.usage.prompt_tokens || 0;
    acc.completion_tokens += result.cloud.usage.completion_tokens || 0;
    acc.total_tokens += result.cloud.usage.total_tokens || 0;
    acc.cost += result.cloud.estimated_cost_usd || 0;
    return acc;
  }, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 });
  return {
    generated_at: new Date().toISOString(),
    model: config.model,
    base_url: config.baseUrl,
    credential_source: config.credentialSource,
    concurrency: config.concurrency,
    rescued: results.filter((result) => result.status === 'rescued').length,
    discard: results.filter((result) => result.status === 'discard').length,
    validation_failed: results.filter((result) => result.status === 'validation_failed').length,
    errors: results.filter((result) => ['parse_error', 'invalid_response', 'error'].includes(result.status)).length,
    tokens: {
      prompt_tokens: tokens.prompt_tokens,
      completion_tokens: tokens.completion_tokens,
      total_tokens: tokens.total_tokens
    },
    estimated_cost_usd: Number(tokens.cost.toFixed(6)),
    pricing_note: config.inputPricePer1M === 0 && config.outputPricePer1M === 0
      ? 'input/output prices are 0; set LLM_INPUT_PRICE_PER_1M and LLM_OUTPUT_PRICE_PER_1M for a monetary estimate'
      : `input $${config.inputPricePer1M}/1M, output $${config.outputPricePer1M}/1M`
  };
}

function revalidatePilot() {
  const results = readJsonl(PILOT_RESULTS_PATH);
  if (results.length === 0) throw new Error(`No pilot results at ${PILOT_RESULTS_PATH}`);
  const pack = readJsonl(SOURCE_PACK_PATH);
  const byKey = new Map(pack.map((item) => [`${item.source_type}|${item.source}|${item.idx}`, item]));

  for (const result of results) {
    if (!result.after || !result.after.answer) continue;
    const source = byKey.get(`${result.source_type}|${result.source}|${result.idx}`)?.source_text || '';
    const validation = validateAnswer(result.after.answer, source);
    result.validation = validation;
    if (validation.passed) {
      result.status = 'rescued';
      result.review_status = 'cloud-rescued';
      result.after.review_status = 'cloud-rescued';
    } else {
      result.status = 'validation_failed';
      result.review_status = null;
      delete result.after.review_status;
    }
  }

  const config = {
    model: results[0]?.cloud?.model || 'deepseek-flash',
    baseUrl: '',
    credentialSource: 'revalidate-local',
    concurrency: 0,
    inputPricePer1M: 0,
    outputPricePer1M: 0
  };
  const summary = summarize(results, config);
  summary.revalidated_at = new Date().toISOString();
  summary.note = 'Local evidence gate re-run on saved cloud outputs; no new cloud calls.';
  fs.writeFileSync(PILOT_RESULTS_PATH, results.map((result) => JSON.stringify(result)).join('\n') + '\n', 'utf8');
  writePilotReport(results, summary);
  printPilot(results);
  console.log('\nPILOT_REVALIDATED');
  console.log(JSON.stringify({ ok: true, mode: 'revalidate', ...summary }, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--revalidate-pilot')) {
    revalidatePilot();
    return;
  }
  const all = args.includes('--all');
  const limitArg = args.indexOf('--limit');
  const pilotSize = limitArg >= 0 ? Math.max(1, Number(args[limitArg + 1]) || 10) : 10;

  const config = loadConfig();
  const pool = readJsonl(POOL_PATH);
  const pack = readJsonl(SOURCE_PACK_PATH);
  if (pool.length === 0) throw new Error(`Empty or missing ${POOL_PATH}`);
  if (pack.length === 0) throw new Error(`Missing source pack ${SOURCE_PACK_PATH}; run: python scripts/hydrate-rejected-sources.py`);

  const hydratedPack = pack.filter((item) => item.hydrate_ok);
  const fullExisting = all ? readJsonlLoose(FULL_RESULTS_PATH) : [];
  const done = new Set(fullExisting.map((result) => result.rescue_id));
  const selected = all
    ? hydratedPack.map((item) => ({
        ...item,
        rescue_id: `rescue_${crypto.createHash('sha1').update(`${item.source_type}|${item.source}|${item.idx}`).digest('hex').slice(0, 16)}`
      }))
    : selectPilot(pool, pack);

  if (selected.length === 0) throw new Error('No hydrated cards selected for rescue');
  const maxNew = limitArg >= 0 ? Math.max(1, Number(args[limitArg + 1]) || 1) : Number.POSITIVE_INFINITY;
  const work = all
    ? selected.filter((item) => !done.has(item.rescue_id)).slice(0, maxNew)
    : selected.slice(0, pilotSize);
  if (all) {
    fs.writeFileSync(FULL_RESULTS_PATH, fullExisting.map((result) => JSON.stringify(result)).join('\n') + (fullExisting.length ? '\n' : ''), 'utf8');
    const existingRescued = fullExisting.filter((result) => result.status === 'rescued');
    fs.writeFileSync(
      RESCUED_CARDS_PATH,
      existingRescued.map((result) => JSON.stringify(toRescuedCard(result))).join('\n') + (existingRescued.length ? '\n' : ''),
      'utf8'
    );
  }
  console.log(JSON.stringify({
    mode: all ? 'full' : 'pilot',
    model: config.model,
    base_url: config.baseUrl,
    credential_source: config.credentialSource,
    concurrency: config.concurrency,
    total_selected: selected.length,
    resumed: fullExisting.length,
    remaining: work.length,
    source_pack: path.relative(ROOT, SOURCE_PACK_PATH).split(path.sep).join('/')
  }, null, 2));

  const usageRows = [];
  const runId = crypto.randomUUID();
  let completed = fullExisting.length;
  const logUsage = (row) => {
    const record = { run_id: runId, ...row };
    usageRows.push(record);
    fs.appendFileSync(USAGE_PATH, JSON.stringify(record) + '\n', 'utf8');
  };
  const persistFullResult = (result) => {
    if (!all) return;
    fs.appendFileSync(FULL_RESULTS_PATH, JSON.stringify(result) + '\n', 'utf8');
    if (result.status === 'rescued') {
      fs.appendFileSync(RESCUED_CARDS_PATH, JSON.stringify(toRescuedCard(result)) + '\n', 'utf8');
    }
    completed += 1;
    if (completed % 25 === 0 || completed === selected.length) {
      const percent = selected.length ? ((completed / selected.length) * 100).toFixed(1) : '0.0';
      console.error(`[progress] ${completed}/${selected.length} (${percent}%)`);
    }
  };

  const limit = pLimit(config.concurrency);
  const results = await Promise.all(work.map((item) => limit(async () => {
    try {
      const result = await rescueItem(item, config, logUsage);
      persistFullResult(result);
      console.error(`[done] ${item.rescue_id} -> ${result.status}`);
      return result;
    } catch (error) {
      console.error(`[failed] ${item.rescue_id}: ${error.message}`);
      const result = {
        rescue_id: item.rescue_id,
        source_type: item.source_type,
        source: item.source,
        idx: item.idx,
        reject_reason: item.reject_reason,
        reject_details: item.reason,
        before: {
          question: item.question,
          answer: item.original_answer,
          category: item.category,
          language: item.language
        },
        status: 'error',
        error: String(error.message || error).slice(0, 1000),
        cloud: { model: config.model, attempts: config.maxRetries + 1, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, estimated_cost_usd: 0 },
        validation: null,
        review_status: null
      };
      persistFullResult(result);
      return result;
    }
  })));

  const allResults = all ? [...fullExisting, ...results] : results;
  const summary = summarize(allResults, config);
  summary.run_id = runId;
  if (all) {
    summary.total_candidates = selected.length;
    summary.resumed_results = fullExisting.length;
    summary.processed_this_run = results.length;
    const rescued = allResults.filter((result) => result.status === 'rescued');
    fs.writeFileSync(FULL_RESULTS_PATH, allResults.map((result) => JSON.stringify(result)).join('\n') + '\n', 'utf8');
    fs.writeFileSync(RESCUED_CARDS_PATH, rescued.map((result) => JSON.stringify(toRescuedCard(result))).join('\n') + (rescued.length ? '\n' : ''), 'utf8');
    console.log(JSON.stringify({ ok: true, mode: 'full', out: path.relative(ROOT, RESCUED_CARDS_PATH), ...summary }, null, 2));
    return;
  }

  fs.writeFileSync(PILOT_RESULTS_PATH, results.map((result) => JSON.stringify(result)).join('\n') + '\n', 'utf8');
  writePilotReport(results, summary);
  printPilot(results);
  console.log('\nPILOT_DONE');
  console.log(JSON.stringify({
    ok: true,
    mode: 'pilot',
    pilot_results: path.relative(ROOT, PILOT_RESULTS_PATH),
    pilot_report: path.relative(ROOT, PILOT_REPORT_PATH),
    usage_log: path.relative(ROOT, USAGE_PATH),
    ...summary
  }, null, 2));
}

main().catch((error) => {
  console.error(`RESCUE_FAILED: ${error.message}`);
  process.exitCode = 1;
});
