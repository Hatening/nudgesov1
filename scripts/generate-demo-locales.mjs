import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cacheDir = path.join(root, 'artifacts', 'demo-locale-generation');
const outputPath = path.join(root, 'public', 'demo-locales.js');

const source = {
  title: 'Watch NudgeSo draft the reply',
  subtitle: 'Example conversation — customer ↔ NudgeSo',
  localeLabel: 'Demo language',
  scenarioLabel: 'Choose a conversation',
  scenarios: [
    {
      id: 'shipping',
      tab: 'Shipping delay',
      customer: "Hi, my order hasn't arrived — it's been five days.",
      customerMeta: '10:24 · Delivered',
      reply: "I'm sorry about the wait, Maya. I found order #4821 — it's on its way and due Wednesday. Want me to send the tracking link?",
      replyMeta: '10:25 · Draft ready in 1 min',
      approvedMeta: 'Approved · ready to send'
    },
    {
      id: 'return',
      tab: 'Return or exchange',
      customer: "This size doesn't fit. Can I exchange it?",
      customerMeta: '10:31 · Delivered',
      reply: 'Of course. The size can be exchanged within 30 days. Would you like me to start the exchange and send a prepaid return label?',
      replyMeta: '10:32 · Draft ready in 1 min',
      approvedMeta: 'Approved · ready to send'
    },
    {
      id: 'product',
      tab: 'Product question',
      customer: 'Does this work with a 220V outlet?',
      customerMeta: '10:38 · Delivered',
      reply: 'Yes — this model supports 110–240V, so it works with a 220V outlet. The plug type may need an adapter depending on your socket.',
      replyMeta: '10:39 · Draft ready in 1 min',
      approvedMeta: 'Approved · ready to send'
    },
    {
      id: 'complaint',
      tab: 'Complaint',
      customer: "I've been waiting three weeks. This is unacceptable.",
      customerMeta: '10:44 · Delivered',
      reply: "I'm really sorry — three weeks is too long. I've handed this to a human teammate now so they can review the order and give you a concrete next step.",
      replyMeta: '10:45 · Human handoff',
      approvedMeta: 'Handed to a person'
    }
  ],
  controls: {
    draft: 'See another draft',
    approve: 'Approve',
    regenerate: 'Regenerate',
    pause: 'Pause demo',
    play: 'Play demo',
    previous: 'Previous conversation',
    next: 'Next conversation',
    drafting: 'Drafting…',
    draftMeta: 'Draft · not sent yet',
    approvedMeta: 'Approved · ready to send'
  }
};

const targets = [
  ['ar', 'Arabic'], ['az', 'Azerbaijani'], ['bg', 'Bulgarian'], ['bn', 'Bengali'],
  ['cs', 'Czech'], ['da', 'Danish'], ['de', 'German'], ['el', 'Greek'],
  ['es', 'Spanish'], ['fa', 'Persian'], ['fr', 'French'], ['he', 'Hebrew'],
  ['hi', 'Hindi'], ['hr', 'Croatian'], ['hu', 'Hungarian'], ['id', 'Indonesian'],
  ['it', 'Italian'], ['ja', 'Japanese'], ['ko', 'Korean'], ['ms', 'Malay'],
  ['nl', 'Dutch'], ['no', 'Norwegian'], ['pl', 'Polish'], ['pt-BR', 'Brazilian Portuguese'],
  ['pt-PT', 'European Portuguese'], ['ro', 'Romanian'], ['ru', 'Russian'], ['sk', 'Slovak'],
  ['sv', 'Swedish'], ['sw', 'Swahili'], ['th', 'Thai'], ['tr', 'Turkish'],
  ['uk', 'Ukrainian'], ['ur', 'Urdu'], ['vi', 'Vietnamese'], ['zh-CN', 'Simplified Chinese'],
  ['zh-TW', 'Traditional Chinese']
];

function dshToken() {
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
  const file = path.join(home, '.credentials.yaml');
  if (!fs.existsSync(file)) return '';
  let inAccount = false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^\s{2}deepseek-account-platform\/default:\s*$/.test(line)) { inAccount = true; continue; }
    if (inAccount && /^\s{2}\S/.test(line)) break;
    if (inAccount) {
      const match = line.match(/^\s+token:\s*(\S+)\s*$/);
      if (match) return match[1];
    }
  }
  return '';
}

const token = process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY || dshToken();
const useBearer = Boolean(process.env.DEEPSEEK_API_KEY || process.env.LLM_API_KEY);
const model = process.env.DEEPSEEK_MODEL || (useBearer ? 'deepseek-chat' : 'deepseek-flash');
if (!token) throw new Error('No DeepSeek credential available.');

const system = [
  'You are a careful marketing localization editor for NudgeSo, a calm customer-support product.',
  'Translate every English user-facing string in the supplied JSON into the requested language.',
  'Keep object keys, scenario ids, arrays, order numbers, the name Maya, brand name NudgeSo, URLs and timestamps unchanged.',
  'Translate tab labels, customer messages, replies, meta labels and controls naturally and concisely.',
  'Do not add promises or legal commitments that are not in the source.',
  'Return ONLY a valid JSON object with exactly the same structure. No markdown fences.'
].join(' ');

function parseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function validate(candidate, locale) {
  if (!candidate || typeof candidate !== 'object') throw new Error(`${locale}: not object`);
  for (const key of ['title', 'subtitle', 'localeLabel', 'scenarioLabel']) {
    if (typeof candidate[key] !== 'string' || !candidate[key].trim()) throw new Error(`${locale}: missing ${key}`);
  }
  if (!Array.isArray(candidate.scenarios) || candidate.scenarios.length !== source.scenarios.length) {
    throw new Error(`${locale}: scenario count mismatch`);
  }
  for (let i = 0; i < source.scenarios.length; i += 1) {
    const expected = source.scenarios[i];
    const got = candidate.scenarios[i] || {};
    if (got.id !== expected.id) throw new Error(`${locale}: scenario id mismatch at ${i}`);
    for (const field of ['tab', 'customer', 'customerMeta', 'reply', 'replyMeta', 'approvedMeta']) {
      if (typeof got[field] !== 'string' || !got[field].trim()) throw new Error(`${locale}: missing scenario ${i}.${field}`);
    }
  }
  for (const key of Object.keys(source.controls)) {
    if (typeof candidate.controls?.[key] !== 'string' || !candidate.controls[key].trim()) {
      throw new Error(`${locale}: missing control ${key}`);
    }
  }
  return candidate;
}

async function callApi(locale, language) {
  const headers = { 'content-type': 'application/json' };
  if (useBearer) headers.authorization = `Bearer ${token}`;
  else headers['x-dsh-auth-token'] = token;
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 5000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `TARGET LANGUAGE: ${language}\n\nSOURCE JSON:\n${JSON.stringify(source)}` }
      ]
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  return validate(parseJson(data.choices?.[0]?.message?.content), locale);
}

async function translate(locale, language) {
  const file = path.join(cacheDir, `${locale}.json`);
  if (fs.existsSync(file)) {
    try { return validate(JSON.parse(fs.readFileSync(file, 'utf8')), locale); } catch {}
  }
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const value = await callApi(locale, language);
      fs.writeFileSync(file, JSON.stringify(value, null, 2));
      return value;
    } catch (error) {
      lastError = error;
      console.error(`[${locale}] attempt ${attempt}: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
  throw lastError;
}

fs.mkdirSync(cacheDir, { recursive: true });
const result = { en: source, 'en-AU': source };
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const index = cursor;
    cursor += 1;
    const [locale, language] = targets[index];
    result[locale] = await translate(locale, language);
    console.log(`translated ${locale}`);
  }
}
await Promise.all(Array.from({ length: 3 }, () => worker()));
fs.writeFileSync(outputPath, `/* Generated by scripts/generate-demo-locales.mjs. DeepSeek API translation. */\nwindow.NS_DEMO_LOCALES = ${JSON.stringify(result, null, 2)};\n`);
console.log(JSON.stringify({ outputPath, locales: Object.keys(result).length, model }, null, 2));
