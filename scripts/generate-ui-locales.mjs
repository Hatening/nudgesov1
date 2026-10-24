import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const i18nPath = path.join(root, 'public', 'i18n.js');
const cacheDir = path.join(root, 'artifacts', 'locale-generation');
const outputPath = path.join(root, 'public', 'ui-locales.js');

function extractCopy() {
  const text = fs.readFileSync(i18nPath, 'utf8');
  const marker = 'const copy = ';
  const start = text.indexOf(marker);
  if (start < 0) throw new Error('copy dictionary not found');
  const objectStart = text.indexOf('{', start + marker.length);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = objectStart; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const objectText = text.slice(objectStart, i + 1);
        return vm.runInNewContext(`(${objectText})`, { window: { NS_UI_LOCALES: {} } });
      }
    }
  }
  throw new Error('unterminated copy dictionary');
}

function dshToken() {
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
  const file = path.join(home, '.credentials.yaml');
  if (!fs.existsSync(file)) return '';
  const raw = fs.readFileSync(file, 'utf8');
  let inAccount = false;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s{2}deepseek-account-platform\/default:\s*$/.test(line)) { inAccount = true; continue; }
    if (inAccount && /^\s{2}\S/.test(line)) break;
    if (inAccount) {
      const match = line.match(/^\s+token:\s*(\S+)\s*$/);
      if (match) return match[1];
    }
  }
  return '';
}

const targets = [
  ['ar', 'Arabic'],
  ['az', 'Azerbaijani'],
  ['bg', 'Bulgarian'],
  ['bn', 'Bengali'],
  ['cs', 'Czech'],
  ['da', 'Danish'],
  ['de', 'German'],
  ['el', 'Greek'],
  ['es', 'Spanish'],
  ['fa', 'Persian'],
  ['fr', 'French'],
  ['he', 'Hebrew'],
  ['hi', 'Hindi'],
  ['hr', 'Croatian'],
  ['hu', 'Hungarian'],
  ['id', 'Indonesian'],
  ['it', 'Italian'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['ms', 'Malay'],
  ['nl', 'Dutch'],
  ['no', 'Norwegian'],
  ['pl', 'Polish'],
  ['pt-BR', 'Brazilian Portuguese'],
  ['pt-PT', 'European Portuguese'],
  ['ro', 'Romanian'],
  ['ru', 'Russian'],
  ['sk', 'Slovak'],
  ['sv', 'Swedish'],
  ['sw', 'Swahili'],
  ['th', 'Thai'],
  ['tr', 'Turkish'],
  ['uk', 'Ukrainian'],
  ['ur', 'Urdu'],
  ['vi', 'Vietnamese'],
  ['zh-CN', 'Simplified Chinese'],
  ['zh-TW', 'Traditional Chinese']
];

const source = extractCopy();
const en = source.en;
const token = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || dshToken();
const useBearer = Boolean(process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY);
const model = process.env.DEEPSEEK_MODEL || (useBearer ? 'deepseek-chat' : 'deepseek-flash');
if (!token) throw new Error('No DeepSeek credential available (DEEPSEEK_API_KEY or DSH account token).');

const system = [
  'You are a professional UI localization editor for NudgeSo, a calm customer-support product for small merchants.',
  'Translate every English string in the supplied JSON object into the requested language.',
  'Keep object keys unchanged, keep arrays in the same order and length, keep brand names such as NudgeSo unchanged.',
  'Keep URLs, API paths, placeholders and punctuation meaningful. Use concise, natural UI language, not literal word-for-word text.',
  'For Arabic, Hebrew, Persian and Urdu use the native script. For Japanese and Korean use natural native UI wording.',
  'Return ONLY a valid JSON object with exactly the same keys. Do not add markdown fences or explanations.'
].join(' ');

function parseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function validate(candidate, name) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error(`${name}: not an object`);
  const expected = Object.keys(en).sort();
  const actual = Object.keys(candidate).sort();
  if (expected.join('|') !== actual.join('|')) {
    const missing = expected.filter((key) => !(key in candidate));
    throw new Error(`${name}: key mismatch; missing=${missing.join(',')}`);
  }
  for (const key of expected) {
    if (Array.isArray(en[key])) {
      if (!Array.isArray(candidate[key]) || candidate[key].length !== en[key].length) {
        throw new Error(`${name}: array mismatch at ${key}`);
      }
    } else if (typeof candidate[key] !== 'string' || !candidate[key].trim()) {
      throw new Error(`${name}: empty string at ${key}`);
    }
  }
  return candidate;
}

async function callApi(tag, language) {
  const body = {
    model,
    temperature: 0,
    max_tokens: 12000,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: `TARGET LANGUAGE: ${language}\n\nSOURCE JSON:\n${JSON.stringify(en)}` }
    ]
  };
  const headers = { 'content-type': 'application/json' };
  if (useBearer) headers.authorization = `Bearer ${token}`;
  else headers['x-dsh-auth-token'] = token;
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  return validate(parseJson(content), tag);
}

async function translate(tag, language) {
  const file = path.join(cacheDir, `${tag}.json`);
  if (fs.existsSync(file)) {
    try {
      return validate(JSON.parse(fs.readFileSync(file, 'utf8')), tag);
    } catch {
      // regenerate stale or invalid cache
    }
  }
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const translated = await callApi(tag, language);
      fs.writeFileSync(file, JSON.stringify(translated, null, 2));
      return translated;
    } catch (error) {
      lastError = error;
      console.error(`[${tag}] attempt ${attempt} failed: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

fs.mkdirSync(cacheDir, { recursive: true });
const only = process.env.LOCALES_ONLY ? new Set(process.env.LOCALES_ONLY.split(',')) : null;
const pending = targets.filter(([tag]) => tag !== 'ar' && (!only || only.has(tag)));
const translated = { ar: source.ar };
let cursor = 0;
async function worker() {
  while (cursor < pending.length) {
    const index = cursor;
    cursor += 1;
    const [tag, language] = pending[index];
    translated[tag] = await translate(tag, language);
    console.log(`translated ${tag}`);
  }
}

await Promise.all(Array.from({ length: 3 }, () => worker()));
translated.en = en;
translated['en-AU'] = en;
const output = `/* Generated by scripts/generate-ui-locales.mjs. Source: DeepSeek API. */\nwindow.NS_UI_LOCALES = ${JSON.stringify(translated, null, 2)};\n`;
fs.writeFileSync(outputPath, output);
console.log(JSON.stringify({ outputPath, locales: Object.keys(translated).length, model }, null, 2));
