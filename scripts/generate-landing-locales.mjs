import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const cacheDir = path.join(root, 'artifacts', 'landing-locale-generation-v2');
const outputPath = path.join(root, 'public', 'landing-locales.js');

const source = {
  metaTitle: 'NudgeSo — Calm Customer Support for small businesses',
  metaDescription: 'Async-first support that drafts warm answers, queues what matters, and leaves you space to breathe.',
  nav: ['Product', 'Pricing', 'How', 'FAQ'],
  signIn: 'Sign in',
  startFree: 'Start free',
  heroEyebrow: 'Async-first AI helpdesk',
  heroTitle: 'Calm Customer Support for small businesses',
  heroSub: 'Async-first support that drafts warm answers, queues what matters, and leaves you space to breathe — no more living in your inbox.',
  featuresTitle: "Everything your inbox needs, nothing it doesn't",
  featuresSub: 'Built for small businesses who want to reply well without the chaos.',
  features: [
    { title: 'One calm queue', body: 'Live today: website chat and a shared merchant inbox. Email and social connectors are rolling out separately, so we do not pretend they are already merged.' },
    { title: 'Drafts in your voice', body: "The AI learns your tone and suggests replies you'll actually want to send." },
    { title: 'Set up in minutes', body: 'Connect your inbox in a few clicks, import your FAQs, and the AI already knows your voice.' },
    { title: 'No late-night pings', body: 'Async by default, customers get honest reply times and your business gets its evenings back.' }
  ],
  howTitle: 'How it works',
  howSub: 'Three quiet steps between a noisy inbox and a calm one.',
  howSteps: [
    { title: 'Connect your inbox', body: 'Set up the website chat and shared inbox that are live today. Email and social connectors are a separate, assisted setup.' },
    { title: 'AI drafts friendly replies', body: 'The AI reads the thread, matches your tone from past replies, and drafts a warm answer for every message.' },
    { title: 'You approve, nudge, move on', body: 'Tweak a word or hit send. Threads snooze themselves until customers hear back. No pressure, ever.' }
  ],
  pricingTitle: 'Simple pricing',
  pricingSub: 'Start free. Paid plans are preview-only while billing is being finished.',
  monthly: 'Monthly',
  yearly: 'Yearly',
  saveNote: '~21% off',
  freePlan: {
    name: 'Free',
    billing: 'For a small business trying it out',
    features: ['Shared inbox', 'A generous monthly allowance of free AI drafts', 'Help guide'],
    cta: 'Start for free'
  },
  proPlan: {
    name: 'Pro',
    badge: 'Preview plan',
    billingMonthly: '$19 / month · billed monthly',
    billingYearly: '$15 / month · billed annually',
    features: ['Everything in Free', 'Website chat + shared inbox', 'Preview of planned priority support'],
    cta: 'Preview Pro'
  },
  businessPlan: {
    name: 'Business',
    badge: 'Preview price — no charge',
    billingMonthly: '$49 / month · billed monthly',
    billingYearly: '$39 / month · billed annually',
    features: ['Everything in Pro', 'Multiple staff seats (preview)', 'Guided setup help'],
    cta: 'Talk to us'
  },
  pricingNote: 'Preview pricing only: no payment is collected. Plan limits and paid features are illustrative and can be adjusted before billing launches.',
  faqTitle: 'Frequently asked questions',
  faqs: [
    { q: 'What does "async-first" actually mean?', a: 'It means customers leave a message and get an honest reply window (like "we\'ll be back in a few hours") instead of waiting on a live chat. You answer on your own schedule, and nobody gets anxious watching three dots bounce.' },
    { q: 'How long does setup take?', a: 'Most small businesses are up and running in under ten minutes. Connect your inbox, drop in a few FAQs, and the AI already starts writing replies that sound like you.' },
    { q: 'Does the AI send replies on its own?', a: 'No. The AI always drafts — a human on your team approves before anything reaches the customer. You stay in control of your voice; the AI just removes the typing.' },
    { q: "What's included in the free plan?", a: "The free plan gives you the shared inbox and a generous monthly allowance of free AI drafts, plus the help guide. Paid plans are preview-only until billing is live." },
    { q: 'Which channels can I connect?', a: 'Live today: the standalone website chat and the merchant shared inbox. Email and social messaging (including WhatsApp and Instagram) are not connected yet; they need an assisted setup and will roll out separately. We will only list a channel as available once it is genuinely connected.' }
  ],
  finalTitle: 'Bring calm to your inbox',
  finalSub: 'Set up in minutes · Free for small businesses · www.nudgeso.com',
  finalCta: 'Get NudgeSo free',
  footerTag: 'NudgeSo · Calm Customer Support · www.nudgeso.com',
  privacy: 'Privacy Policy',
  terms: 'Terms of Service'
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
  'You are a professional landing-page localization editor for NudgeSo, a calm customer-support product.',
  'Translate every English user-facing string in the supplied JSON into the requested language.',
  'Keep object keys, array order, lengths, price numbers, product name NudgeSo, URLs and email-like strings unchanged.',
  'Do not add pricing promises, legal claims or features not present in the source.',
  'Return ONLY a valid JSON object with exactly the same structure. No markdown fences.'
].join(' ');

function parseJson(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function assertShape(got, expected, locale) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(got) || got.length !== expected.length) throw new Error(`${locale}: array mismatch`);
    expected.forEach((value, index) => assertShape(got[index], value, `${locale}[${index}]`));
    return;
  }
  if (expected && typeof expected === 'object') {
    if (!got || typeof got !== 'object' || Array.isArray(got)) throw new Error(`${locale}: object mismatch`);
    for (const key of Object.keys(expected)) {
      if (!(key in got)) throw new Error(`${locale}: missing ${key}`);
      assertShape(got[key], expected[key], `${locale}.${key}`);
    }
    return;
  }
  if (typeof got !== 'string' || !got.trim()) throw new Error(`${locale}: empty string`);
  if (/\$\d+/.test(expected)) {
    const number = expected.match(/\$\d+/)?.[0];
    if (number && !got.includes(number)) throw new Error(`${locale}: price changed (${number})`);
  }
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
      max_tokens: 12000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `TARGET LANGUAGE: ${language}\n\nSOURCE JSON:\n${JSON.stringify(source)}` }
      ]
    })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  const parsed = parseJson(data.choices?.[0]?.message?.content);
  assertShape(parsed, source, locale);
  return parsed;
}

async function translate(locale, language) {
  const file = path.join(cacheDir, `${locale}.json`);
  if (fs.existsSync(file)) {
    try {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      assertShape(cached, source, locale);
      return cached;
    } catch {}
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
fs.writeFileSync(outputPath, `/* Generated by scripts/generate-landing-locales.mjs. DeepSeek API translation. */\nwindow.NS_LANDING_LOCALES = ${JSON.stringify(result, null, 2)};\n`);
console.log(JSON.stringify({ outputPath, locales: Object.keys(result).length, model }, null, 2));
