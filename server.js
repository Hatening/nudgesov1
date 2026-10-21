import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  openDatabase,
  migrateSchema,
  seedDatabase,
  isDatabaseEmpty,
  closeDatabase
} from './src/db.js';
import { createDao } from './src/dao.js';
import { createRateLimiter } from './src/rate-limit.js';
import { extractPdfText, isPdfBuffer } from './src/pdf-text.js';
import { distillKnowledge } from './src/knowledge-distill.js';
import { createLlmGateway } from './src/llm.js';
import { redactPII, privacyNotice, CONSENT_VERSION } from './src/privacy.js';
import { createMetrics } from './src/observability.js';
import { createRepairQueue } from './src/repair.js';
import { financialGuard } from './src/financial-guard.js';
import {
  rankKnowledge,
  inferIntent,
  detectLanguage,
  fallbackAnswer,
  isHighRiskMessage,
  retrievePublicHits,
  retrieveVoiceHits,
  parseWav,
  localAsrTranscript,
  buildVoiceReply,
  id,
  now,
  safeEqual
} from './src/core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3030);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '.data'));
const DB_PATH = path.resolve(process.env.DB_PATH || path.join(DATA_DIR, 'relaydesk.sqlite'));
const JSON_PATH = path.join(DATA_DIR, 'store.json');
const OLLAMA_URL = (process.env.OLLAMA_URL || '').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 25000);
const APP_API_KEY = process.env.APP_API_KEY || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_COOKIE = 'rd_session';
const ROLE_RANK = { viewer: 0, agent: 1, admin: 2, owner: 3 };
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const RATE_LIMIT_AUTH_MAX = Number(process.env.RATE_LIMIT_AUTH_MAX || 30);
const RATE_LIMIT_PUBLIC_MAX = Number(process.env.RATE_LIMIT_PUBLIC_MAX || 600);
const RATE_LIMIT_ASR_MAX = Number(process.env.RATE_LIMIT_ASR_MAX || 60);
const RATE_LIMIT_V1_MAX = Number(process.env.RATE_LIMIT_V1_MAX || 1200);
const RATE_LIMIT_LEGACY_MAX = Number(process.env.RATE_LIMIT_LEGACY_MAX || 600);
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
const rateLimiter = createRateLimiter();
const metrics = createMetrics();
const repairQueue = createRepairQueue({
  dir: path.resolve(process.env.REPAIR_QUEUE_DIR || path.join(__dirname, 'artifacts', 'repair-queue'))
});
const PUBLIC_DIR = path.join(__dirname, 'public');

const INDUSTRY_TEMPLATES = [
  { id: 'restaurant', name: '餐饮 / Restaurant', description: 'Menu, hours, reservations and food-safety FAQs.' },
  { id: 'retail', name: '零售 / Retail', description: 'Shipping, returns, sizing and product-care policies.' },
  { id: 'clinic', name: '诊所 / Clinic', description: 'Appointments, preparation and non-diagnostic FAQs.' },
  { id: 'local_service', name: '本地服务 / Local service', description: 'Service area, booking windows and quote questions.' },
  { id: 'cross_border', name: '跨境 / Cross-border', description: 'Customs, delivery windows and multilingual support.' }
];
const TEMPLATE_BY_ID = new Map(INDUSTRY_TEMPLATES.map((item) => [item.id, item]));

await fs.mkdir(DATA_DIR, { recursive: true });
const db = openDatabase(DB_PATH);
migrateSchema(db);
if (isDatabaseEmpty(db)) {
  let jsonExists = false;
  try { await fs.access(JSON_PATH); jsonExists = true; } catch {}
  if (jsonExists) {
    throw new Error(`SQLite database is empty but ${JSON_PATH} exists. Run "npm run migrate:sqlite" before starting the server.`);
  }
  seedDatabase(db);
}
const dao = createDao(db);
const llm = createLlmGateway();
if (process.env.NODE_ENV === 'production' && !APP_API_KEY) {
  console.warn('WARN: NODE_ENV=production without APP_API_KEY; legacy /api/* is fail-closed.');
}
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.warn('WARN: NODE_ENV=production without SESSION_SECRET; cookie sessions will not survive restart.');
}

function json(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  res.end(body);
}
function applySecurityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '));
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  if (proto === 'https' || process.env.COOKIE_SECURE === '1') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  const origin = String(req.headers.origin || '');
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-API-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
}
function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}
function enforceRate(res, key, limit) {
  const result = rateLimiter.hit(key, limit, RATE_LIMIT_WINDOW_MS);
  if (!res.hasHeader('X-RateLimit-Limit')) res.setHeader('X-RateLimit-Limit', String(limit));
  if (!res.hasHeader('X-RateLimit-Remaining')) res.setHeader('X-RateLimit-Remaining', String(result.remaining));
  if (!result.allowed) {
    res.setHeader('Retry-After', String(result.retryAfterSec));
    json(res, 429, { error: 'Too many requests. Please retry later.', retry_after_sec: result.retryAfterSec });
    return false;
  }
  return true;
}
function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body), 'x-content-type-options': 'nosniff' });
  res.end(body);
}
async function readBody(req, limit = 2_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Expected valid JSON body'), { status: 400 }); }
}
function legacySession(req) {
  const bearer = String(req.headers.authorization || '');
  const bearerMatch = bearer.match(/^Bearer\s+(.+)$/i);
  const cookie = cookieValue(req, SESSION_COOKIE);
  const token = bearerMatch ? bearerMatch[1] : cookie;
  if (!token) return false;
  const auth = dao.findSessionByToken(token);
  return Boolean(auth && roleAtLeast(auth, 'admin'));
}
function authorized(req) {
  if (legacySession(req)) return true;
  if (process.env.NODE_ENV === 'production' && !APP_API_KEY) return false;
  if (!APP_API_KEY) return true;
  return safeEqual(req.headers['x-api-key'] || '', APP_API_KEY);
}
function cookieValue(req, name) {
  const header = String(req.headers.cookie || '');
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('=') || '');
  }
  return '';
}
function csrfFor(token) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(String(token || '')).digest('hex');
}
function sessionCookie(req, token) {
  const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || process.env.COOKIE_SECURE === '1';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=900${secure ? '; Secure' : ''}`;
}
function refreshCookie(req, token) {
  const secure = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || process.env.COOKIE_SECURE === '1';
  return `${SESSION_COOKIE}_refresh=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/api/v1/auth/refresh; Max-Age=2592000${secure ? '; Secure' : ''}`;
}
function setAuthCookies(req, res, accessToken, refreshToken) {
  res.setHeader('set-cookie', [sessionCookie(req, accessToken), refreshCookie(req, refreshToken)]);
}
function clearSessionCookie(req, res) {
  res.setHeader('set-cookie', [
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
    `${SESSION_COOKIE}_refresh=; HttpOnly; SameSite=Lax; Path=/api/v1/auth/refresh; Max-Age=0`
  ]);
}
function roleAtLeast(auth, role) {
  return (ROLE_RANK[auth?.user?.role] ?? -1) >= (ROLE_RANK[role] ?? 99);
}
function requireRole(auth, res, role) {
  if (!roleAtLeast(auth, role)) {
    json(res, 403, { error: 'Forbidden for this role.' });
    return false;
  }
  return true;
}

function voiceTopic(question) {
  if (/(几点|营业|开门|关门|下班|hours|open|close)/i.test(question)) {
    return { zh: '营业时间', en: 'your opening hours' };
  }
  if (/(包裹|快递|物流|送达|到货|package|delivery|shipping)/i.test(question)) {
    return { zh: '包裹送达时间', en: 'the delivery time' };
  }
  return { zh: '这个问题', en: 'this question' };
}

function buildLlmVoiceReply(question, result, lang) {
  const topic = voiceTopic(question);
  const isEnglish = String(lang || '').toLowerCase().startsWith('en');
  const soothing = isEnglish ? 'I understand — let me help you check that.' : '理解您着急，我来帮您确认一下。';
  const confirm = isEnglish
    ? `Just to confirm, you're asking about ${topic.en}, right?`
    : `您刚才是想问${topic.zh}，对吗？`;
  const answer = String(result.answer || '').trim();
  const text = [soothing, confirm, answer].filter(Boolean).join(' ');
  return {
    text,
    need_human: Boolean(result.needsHuman),
    grounded: Boolean(result.grounded),
    model: result.model || 'deepseek-flash',
    segments: [
      { type: 'soothing', text: soothing },
      { type: 'confirm', text: confirm },
      { type: 'answer', text: answer }
    ]
  };
}

function publicUser(user, tenant) {  return { id: user.id, email: user.email, tenant_id: user.tenant_id, tenant_name: tenant ? tenant.name : '', role: user.role || 'owner' };
}
function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  try {
    const actual = crypto.scryptSync(String(password), String(salt), 64).toString('hex');
    return safeEqual(actual, String(hash));
  } catch {
    return false;
  }
}
function createSiteForTenant(auth, name, template) {
  return {
    id: id('site'),
    tenant_id: auth.user.tenant_id,
    name: name.slice(0, 120),
    industry_template: template.id,
    industry_template_name: template.name,
    embed_key: crypto.randomBytes(12).toString('hex'),
    status: 'active',
    created_at: now()
  };
}
function publicSite(site) {
  return {
    id: site.id,
    tenant_id: site.tenant_id,
    name: site.name,
    industry_template: site.industry_template,
    industry_template_name: site.industry_template_name,
    embed_key: site.embed_key,
    status: site.status,
    created_at: site.created_at,
    knowledge_count: site.knowledge_count || 0
  };
}
function siteForAuth(auth, siteId) {
  return dao.findSiteByTenant(auth.user.tenant_id, siteId);
}
function siteForEmbedKey(key) {
  return dao.findSiteByEmbedKey(key);
}
function v1Auth(req) {
  const bearer = bearerToken(req);
  const token = bearer || cookieValue(req, SESSION_COOKIE);
  if (!token) return null;
  const auth = dao.findSessionByToken(token);
  if (!auth) return null;
  auth.viaCookie = !bearer;
  auth.csrfToken = csrfFor(token);
  return auth;
}
function requireV1(req, res) {
  const auth = v1Auth(req);
  if (!auth) {
    json(res, 401, { error: 'Authentication required. Use Authorization: Bearer <token>.' });
    return null;
  }
  if (auth.viaCookie && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (!safeEqual(req.headers['x-csrf-token'] || '', auth.csrfToken)) {
      json(res, 403, { error: 'CSRF token required for cookie-authenticated writes.' });
      return null;
    }
  }
  return auth;
}
function corpusForSite(site, audience = 'buyer', surface = 'buyer_chat') {
  const options = { includeQuarantined: false, surface };
  const confirmed = dao.listConfirmedKnowledgeForSite(site.id, audience, options);
  if (confirmed.length) return confirmed;
  // 站点没有自建语料时退回全局语料，但同样按受众、许可/有效期与产品面过滤。
  return dao.listGlobalKnowledge(audience, options);
}
function stats() {
  return dao.stats();
}

// ---------------------------------------------------------------- 商家自助配置辅助
function profileContext(profile) {
  if (!profile) return '';
  const lines = [];
  if (profile.business_name) lines.push(`店铺/品牌：${profile.business_name}`);
  if (profile.platforms?.length) lines.push(`经营平台：${profile.platforms.join('、')}`);
  if (profile.markets?.length) lines.push(`目标市场：${profile.markets.join('、')}`);
  if (profile.categories) lines.push(`核心品类：${profile.categories}`);
  if (profile.monthly_revenue) lines.push(`客单价/月营收：${profile.monthly_revenue}`);
  if (profile.team_size) lines.push(`团队规模：${profile.team_size} 人`);
  if (profile.goals) lines.push(`当前目标：${profile.goals}`);
  if (!lines.length) return '';
  return `【商家经营档案】\n${lines.join('\n')}\n\n【商家问题】\n`;
}

function parseModelCards(content) {
  if (!content) return [];
  const clean = String(content).replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  if (start === -1) return [];
  const end = clean.lastIndexOf('}');
  if (end <= start) return [];
  try {
    const parsed = JSON.parse(clean.slice(start, end + 1));
    if (!Array.isArray(parsed.cards)) return [];
    return parsed.cards
      .map((c) => ({
        title: String(c.title || c.question || '').trim().slice(0, 180),
        content: String(c.content || c.answer || '').trim().slice(0, 20000),
        tags: Array.isArray(c.tags) ? c.tags.slice(0, 12).map((t) => String(t).slice(0, 40)) : [],
      }))
      .filter((c) => c.title && c.content);
  } catch {
    return [];
  }
}

const PROFILE_ACTIONS = [
  '先补齐经营档案中的客单价、核心品类与目标市场，再让 AI 做投放建议。',
  '把历史客服问答上传到「专属知识库」，确认入库后 AI 会优先引用。',
  '每周检查一次「质量与测试」，确认回答仍有知识证据支撑。',
];

const OCR_PROMPT = '请逐字提取这些图片中的全部文字，保持原有段落顺序。只输出文字内容，不要解释、不要 Markdown 围栏。多页图片请按顺序合并输出。';
const CREDIT_COSTS = Object.freeze({ text_extract: 2, cloud_distill: 5, ocr_page: 10 });

function fallbackProfileAnalysis(profile) {
  const parts = [];
  if (profile.categories) parts.push(`核心品类「${profile.categories}」`);
  if (profile.markets?.length) parts.push(`目标市场 ${profile.markets.join('、')}`);
  if (profile.monthly_revenue) parts.push(`当前客单价/营收 ${profile.monthly_revenue}`);
  const summary = parts.length
    ? `已根据你的经营档案（${parts.join('，')}）建立上下文。建议先把该品类的历史问答上传到专属知识库，确认入库后再让 AI 生成投放与选品建议。`
    : '经营档案还没有填写完整。补充客单价、核心品类和目标市场后，AI 回答会自动带上这些上下文。';
  return { summary, actions: PROFILE_ACTIONS.slice(0, 3), model: null, provider: null };
}

async function analyzeProfileWithLlm(profile) {
  const settings = dao.getSettings();
  const prompt = `你是跨境电商经营顾问。根据下面的商家经营档案，给出 3-5 条具体、可执行的建议。
要求：只输出 JSON 对象，不要解释。
输出格式：{"summary":"一段 100 字以内的诊断","actions":["建议1","建议2","建议3"]}

经营档案：
${JSON.stringify(profile, null, 2)}`;
  const result = await llm.complete(prompt, settings);
  if (result?.content) {
    try {
      const clean = result.content.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
      const summary = String(parsed.summary || '').trim();
      const actions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 6).map((a) => String(a).slice(0, 300)) : [];
      if (summary) return { summary, actions, model: result.model, provider: result.provider };
    } catch { /* fall through */ }
  }
  return fallbackProfileAnalysis(profile);
}

async function handleV1(req, res, p, method) {
  const ip = clientIp(req);
  if (method === 'POST' && (p === '/api/v1/auth/register' || p === '/api/v1/auth/login')) {
    if (!enforceRate(res, `auth:${ip}`, RATE_LIMIT_AUTH_MAX)) return;
  }
  const publicRate = p.match(/^\/api\/v1\/public\/([^/]+)\/(messages|asr)$/);
  if (method === 'POST' && publicRate) {
    const isAsr = publicRate[2] === 'asr';
    if (!enforceRate(res, `${isAsr ? 'asr' : 'public'}:${ip}:${publicRate[1]}`, isAsr ? RATE_LIMIT_ASR_MAX : RATE_LIMIT_PUBLIC_MAX)) return;
  }
  if (!enforceRate(res, `v1:${ip}`, RATE_LIMIT_V1_MAX)) return;

  if (p === '/api/v1/auth/register' && method === 'POST') {
    const b = await readBody(req, 100000);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'A valid email is required.' });
    if (password.length < 6) return json(res, 400, { error: 'Password must be at least 6 characters.' });
    if (dao.findUserByEmail(email)) return json(res, 409, { error: 'Email already registered. Please log in.' });
    const tenant = {
      id: id('tenant'),
      name: String(b.store_name || b.storeName || email.split('@')[0] || 'My store').slice(0, 120),
      plan: 'free',
      status: 'active',
      created_at: now()
    };
    const { salt, hash } = hashPassword(password);
    const user = {
      id: id('user'),
      email,
      password_salt: salt,
      password_hash: hash,
      tenant_id: tenant.id,
      role: 'owner',
      created_at: now()
    };
    const registration = dao.registerTenantOwner(tenant, user);
    dao.logEvent('v1_user_registered', { userId: user.id, tenantId: tenant.id });
    setAuthCookies(req, res, registration.accessToken, registration.refreshToken);
    return json(res, 201, {
      token: registration.accessToken,
      access_token: registration.accessToken,
      refresh_token: registration.refreshToken,
      expires_in: registration.accessExpiresIn,
      refresh_expires_in: registration.refreshExpiresIn,
      csrf_token: csrfFor(registration.accessToken),
      user: publicUser(registration.user, registration.tenant)
    });
  }

  if (p === '/api/v1/auth/login' && method === 'POST') {
    const b = await readBody(req, 100000);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const user = dao.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) return json(res, 401, { error: 'Invalid email or password.' });
    const tenant = dao.findTenant(user.tenant_id);
    const pair = dao.createTokenPair(user);
    setAuthCookies(req, res, pair.accessToken, pair.refreshToken);
    return json(res, 200, {
      token: pair.accessToken,
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      expires_in: pair.accessExpiresIn,
      refresh_expires_in: pair.refreshExpiresIn,
      csrf_token: csrfFor(pair.accessToken),
      user: publicUser(user, tenant)
    });
  }

  if (p === '/api/v1/auth/me' && method === 'GET') {
    const auth = requireV1(req, res);
    if (!auth) return;
    return json(res, 200, { user: publicUser(auth.user, auth.tenant) });
  }

  if (p === '/api/v1/auth/refresh' && method === 'POST') {
    const b = await readBody(req, 10000);
    const refreshToken = String(b.refresh_token || '');
    if (!refreshToken) return json(res, 400, { error: 'refresh_token is required.' });
    const pair = dao.rotateRefreshToken(refreshToken);
    if (!pair) return json(res, 401, { error: 'Invalid refresh token.' });
    if (pair.reuse_detected) return json(res, 401, { error: 'Refresh token reuse detected; session family revoked.' });
    if (pair.expired) return json(res, 401, { error: 'Refresh token expired.' });
    setAuthCookies(req, res, pair.accessToken, pair.refreshToken);
    const accessAuth = dao.findSessionByToken(pair.accessToken);
    return json(res, 200, {
      token: pair.accessToken,
      access_token: pair.accessToken,
      refresh_token: pair.refreshToken,
      expires_in: pair.accessExpiresIn,
      refresh_expires_in: pair.refreshExpiresIn,
      csrf_token: csrfFor(pair.accessToken),
      user: accessAuth ? publicUser(accessAuth.user, accessAuth.tenant) : null
    });
  }

  if (p === '/api/v1/auth/logout' && method === 'POST') {
    const auth = requireV1(req, res);
    if (!auth) return;
    dao.revokeFamilyByToken(auth.token);
    clearSessionCookie(req, res);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/v1/auth/logout-all' && method === 'POST') {
    const auth = requireV1(req, res);
    if (!auth) return;
    const count = dao.revokeAllSessions(auth.user.id);
    clearSessionCookie(req, res);
    return json(res, 200, { ok: true, revoked: count });
  }

  if (p === '/api/v1/auth/sessions' && method === 'GET') {
    const auth = requireV1(req, res);
    if (!auth) return;
    return json(res, 200, { items: dao.listSessions(auth.user.id) });
  }

  if (p === '/api/v1/industry-templates' && method === 'GET') {
    return json(res, 200, { templates: INDUSTRY_TEMPLATES });
  }

  const publicSiteMatch = p.match(/^\/api\/v1\/public\/([^/]+)$/);
  if (publicSiteMatch && method === 'GET') {
    const site = siteForEmbedKey(publicSiteMatch[1]);
    if (!site) return json(res, 404, { error: 'Site not found.' });
    return json(res, 200, {
      site: { id: site.id, name: site.name, industry_template: site.industry_template, industry_template_name: site.industry_template_name },
      privacy_notice: privacyNotice(),
      privacy_version: CONSENT_VERSION
    });
  }

  const publicConsentMatch = p.match(/^\/api\/v1\/public\/([^/]+)\/consent$/);
  if (publicConsentMatch && method === 'POST') {
    const site = siteForEmbedKey(publicConsentMatch[1]);
    if (!site) return json(res, 404, { error: 'Site not found.' });
    const b = await readBody(req, 10000);
    const version = String(b.version || CONSENT_VERSION).slice(0, 40);
    const at = now();
    dao.logEvent('privacy_consent', { siteId: site.id, version, consented_at: at });
    return json(res, 200, { ok: true, consented_at: at, version });
  }

  const publicAsrMatch = p.match(/^\/api\/v1\/public\/([^/]+)\/asr$/);
  if (publicAsrMatch && method === 'POST') {
    const site = siteForEmbedKey(publicAsrMatch[1]);
    if (!site) return json(res, 404, { error: 'Site not found.' });
    const b = await readBody(req, 1500000);
    const audioFilename = String(b.audio_filename || 'recording.wav').slice(0, 180);
    const audioBase64 = String(b.audio_base64 || '');
    if (!audioBase64) return json(res, 400, { error: 'audio_base64 is required.' });
    let buffer;
    try { buffer = Buffer.from(audioBase64, 'base64'); } catch { return json(res, 400, { error: 'Invalid audio data.' }); }
    if (buffer.length <= 0) return json(res, 400, { error: 'Invalid audio data.' });
    if (buffer.length > 1000000) return json(res, 413, { error: 'Audio file must be 1 MB or smaller.' });
    const wav = parseWav(buffer);
    if (!wav) return json(res, 400, { error: 'Only valid .wav files are supported.' });
    const transcript = localAsrTranscript(audioFilename);
    dao.logEvent('public_asr_transcribed', { siteId: site.id, audioFilename, audioBytes: buffer.length, durationSec: Number(wav.durationSec.toFixed(2)), provider: 'local-file-fallback' });
    return json(res, 200, {
      transcript,
      provider: 'local-file-fallback',
      audio: { filename: audioFilename, bytes: buffer.length, duration_sec: Number(wav.durationSec.toFixed(2)), sample_rate: wav.sampleRate, channels: wav.channels }
    });
  }

  const publicMessageMatch = p.match(/^\/api\/v1\/public\/([^/]+)\/messages$/);
  if (publicMessageMatch && method === 'POST') {
    const site = siteForEmbedKey(publicMessageMatch[1]);
    if (!site) return json(res, 404, { error: 'Site not found.' });
    const b = await readBody(req, 2500000);
    const inputType = String(b.input_type || 'text');
    const corpus = corpusForSite(site, 'buyer', 'buyer_chat');

    if (inputType === 'voice') {
      const transcript = String(b.transcript || '').trim();
      if (!transcript) return json(res, 400, { error: 'transcript is required for voice messages.' });
      if (transcript.length > 12000) return json(res, 413, { error: 'transcript too long.' });
      const lang = detectLanguage(transcript) || 'zh';
      const intent = inferIntent(transcript);
      const audioFilename = String(b.audio_filename || 'voice.wav').slice(0, 180);
      const audioSize = Number(b.audio_size_bytes || 0) || 0;
      const messageId = id('msg');
      const at = now();

      const financial = financialGuard(transcript);
      if (financial) {
        const reply = {
          lang: financial.reply.lang,
          text: financial.reply.text,
          need_human: true,
          grounded: false,
          status: 'transferred_to_human',
          input_type: 'voice',
          segments: [{ type: 'safe', text: financial.reply.text }]
        };
        const record = {
          id: messageId, tenant_id: site.tenant_id, site_id: site.id, embed_key: site.embed_key,
          message: transcript, transcript, input_type: 'voice', audio_filename: audioFilename,
          audio_size_bytes: audioSize, language: financial.reply.lang, intent: 'Financial / refund', risk: 'high',
          reply, evidence: [], created_at: at
        };
        const escalation = {
          id: id('esc'), tenant_id: site.tenant_id, site_id: site.id, message_id: messageId,
          message: transcript, input_type: 'voice', language: financial.reply.lang,
          intent: 'Financial / refund', risk: 'high', risk_level: 'high', category: 'financial',
          priority: 'urgent', status: 'pending', created_at: at, updated_at: at
        };
        dao.createPublicMessageWithEscalation(record, escalation, {
          type: 'public_financial_transferred_to_human',
          data: { siteId: site.id, messageId, escalationId: escalation.id, language: financial.reply.lang, matched: financial.matched, input_type: 'voice' }
        });
        return json(res, 200, {
          message_id: messageId,
          status: 'transferred_to_human',
          need_human: true,
          reply,
          evidence: [],
          escalation_id: escalation.id,
          category: 'financial',
          priority: 'urgent',
          input_type: 'voice'
        });
      }

      if (isHighRiskMessage(transcript)) {
        const safeText = '已收到您的反馈。商家会尽快联系您处理，请勿重复提交。 / We have received your message. The merchant will follow up shortly.';
        const reply = { lang, text: safeText, need_human: true, grounded: false, input_type: 'voice', segments: [{ type: 'safe', text: safeText }] };
        const record = {
          id: messageId, tenant_id: site.tenant_id, site_id: site.id, embed_key: site.embed_key,
          message: transcript, transcript, input_type: 'voice', audio_filename: audioFilename,
          audio_size_bytes: audioSize, language: lang, intent, risk: 'high', reply, evidence: [], created_at: at
        };
        const escalation = {
          id: id('esc'), tenant_id: site.tenant_id, site_id: site.id, message_id: messageId,
          message: transcript, input_type: 'voice', language: lang,
          intent: intent === 'General question' ? 'Complaint / escalation' : intent,
          risk: 'high', status: 'pending', created_at: at, updated_at: at
        };
        dao.createPublicMessageWithEscalation(record, escalation, {
          type: 'public_voice_escalated',
          data: { siteId: site.id, messageId, escalationId: escalation.id, intent, language: lang }
        });
        return json(res, 200, { message_id: messageId, status: 'replied', reply, evidence: [], escalation_id: escalation.id, input_type: 'voice' });
      }

      const hits = retrieveVoiceHits(transcript, corpus);
      const settings = dao.getSettings();
      const llmResult = await llm.answer(transcript, hits, lang, settings);
      const built = llmResult && !llmResult.error && llmResult.answer
        ? buildLlmVoiceReply(transcript, llmResult, lang)
        : { ...buildVoiceReply(transcript, hits, lang), model: 'extractive-fallback' };
      const reply = { lang, text: built.text, need_human: built.need_human, grounded: built.grounded, input_type: 'voice', model: built.model, segments: built.segments };
      const evidence = hits.map(({ id: knowledgeId, title, score, language }) => ({ id: knowledgeId, title, score: Number(score.toFixed(3)), language }));
      const record = {
        id: messageId, tenant_id: site.tenant_id, site_id: site.id, embed_key: site.embed_key,
        message: transcript, transcript, input_type: 'voice', audio_filename: audioFilename,
        audio_size_bytes: audioSize, language: lang, intent, risk: 'low', reply, evidence, created_at: at
      };
      dao.createPublicMessage(record, { type: 'public_voice_replied', data: { siteId: site.id, messageId, language: lang, grounded: built.grounded, model: built.model } });
      return json(res, 200, { message_id: messageId, status: 'replied', reply, evidence, input_type: 'voice' });
    }

    if (inputType === 'audio') {
      const audioFilename = String(b.audio_filename || 'voice.wav').slice(0, 180);
      const audioBase64 = String(b.audio_base64 || '');
      if (!audioBase64) return json(res, 400, { error: 'audio_base64 is required for voice messages.' });
      let audioBytes = 0;
      try { audioBytes = Buffer.from(audioBase64, 'base64').length; } catch { audioBytes = 0; }
      if (audioBytes <= 0) return json(res, 400, { error: 'Invalid audio data.' });
      if (audioBytes > 1000000) return json(res, 413, { error: 'Voice file must be 1 MB or smaller.' });
      const lang = 'zh';
      const replyText = '已收到您的语音留言。商家会尽快联系您。 / We received your voice message. The merchant will follow up shortly.';
      const reply = { lang, text: replyText, need_human: true, grounded: false };
      const messageId = id('msg');
      const at = now();
      const record = {
        id: messageId, tenant_id: site.tenant_id, site_id: site.id, embed_key: site.embed_key,
        message: '[voice message]', input_type: 'audio', audio_filename: audioFilename,
        audio_size_bytes: audioBytes, language: lang, intent: 'Voice message', risk: 'medium',
        reply, evidence: [], created_at: at
      };
      dao.createPublicMessage(record, { type: 'public_voice_replied', data: { siteId: site.id, messageId, audioBytes, language: lang } });
      return json(res, 200, { message_id: messageId, status: 'replied', reply, evidence: [], input_type: 'audio' });
    }

    const message = String(b.message || '').trim();
    if (!message) return json(res, 400, { error: 'message is required.' });
    if (message.length > 12000) return json(res, 413, { error: 'message too long.' });
    const lang = detectLanguage(message);
    const intent = inferIntent(message);
    const messageId = id('msg');
    const at = now();

    const financial = financialGuard(message);
    if (financial) {
      const reply = {
        lang: financial.reply.lang,
        text: financial.reply.text,
        need_human: true,
        grounded: false,
        status: 'transferred_to_human',
        input_type: 'text',
        segments: [{ type: 'safe', text: financial.reply.text }]
      };
      const record = {
        id: messageId, tenant_id: site.tenant_id, site_id: site.id, embed_key: site.embed_key,
        message, input_type: 'text', language: financial.reply.lang, intent: 'Financial / refund', risk: 'high',
        reply, evidence: [], created_at: at
      };
      const escalation = {
        id: id('esc'), tenant_id: site.tenant_id, site_id: site.id, message_id: messageId,
        message, input_type: 'text', language: financial.reply.lang,
        intent: 'Financial / refund', risk: 'high', risk_level: 'high', category: 'financial',
        priority: 'urgent', status: 'pending', created_at: at, updated_at: at
      };
      dao.createPublicMessageWithEscalation(record, escalation, {
        type: 'public_financial_transferred_to_human',
        data: { siteId: site.id, messageId, escalationId: escalation.id, language: financial.reply.lang, matched: financial.matched }
      });
      return json(res, 200, {
        message_id: messageId,
        status: 'transferred_to_human',
        need_human: true,
        reply,
        evidence: [],
        escalation_id: escalation.id,
        category: 'financial',
        priority: 'urgent'
      });
    }

    if (isHighRiskMessage(message)) {
      const safeText = '已收到您的反馈。商家会尽快联系您处理，请勿重复提交。 / We have received your message. The merchant will follow up shortly.';
      const reply = { lang, text: safeText, need_human: true, grounded: false };
      const record = {
        id: messageId, tenant_id: site.tenant_id, site_id: site.id, embed_key: site.embed_key,
        message, input_type: 'text', language: lang, intent, risk: 'high',
        reply, evidence: [], created_at: at
      };
      const escalation = {
        id: id('esc'), tenant_id: site.tenant_id, site_id: site.id, message_id: messageId,
        message, input_type: 'text', language: lang,
        intent: intent === 'General question' ? 'Complaint / escalation' : intent,
        risk: 'high', status: 'pending', created_at: at, updated_at: at
      };
      dao.createPublicMessageWithEscalation(record, escalation, {
        type: 'public_message_escalated',
        data: { siteId: site.id, messageId, escalationId: escalation.id, intent, language: lang }
      });
      return json(res, 200, { message_id: messageId, status: 'replied', reply, evidence: [], escalation_id: escalation.id });
    }

    const settings = dao.getSettings();
    const hits = retrievePublicHits(message, corpus);
    let result = await llm.answer(message, hits, lang, settings);
    const model = result?.provider && result?.answer ? result.model : 'extractive-fallback';
    if (!result || result.error) result = fallbackAnswer(message, hits, lang);
    const needsHuman = Boolean(result.needsHuman) || (settings.requireEvidence && !hits.length) || (!hits.length && result.confidence < settings.confidenceThreshold);
    const reply = { lang, text: result.answer, need_human: needsHuman, grounded: Boolean(result.grounded), model: result.model || 'extractive-fallback' };
    const evidence = hits.map(({ id: knowledgeId, title, score, language }) => ({ id: knowledgeId, title, score: Number(score.toFixed(3)), language }));
    const record = {
      id: messageId, tenant_id: site.tenant_id, site_id: site.id, embed_key: site.embed_key,
      message, input_type: 'text', language: lang, intent, risk: 'low',
      reply, evidence, created_at: at
    };
    dao.createPublicMessage(record, { type: 'public_message_replied', data: { siteId: site.id, messageId, language: lang, needsHuman } });
    return json(res, 200, { message_id: messageId, status: 'replied', reply, evidence });
  }

  const publicMessageGetMatch = p.match(/^\/api\/v1\/public\/([^/]+)\/messages\/([^/]+)$/);
  if (publicMessageGetMatch && method === 'GET') {
    const site = siteForEmbedKey(publicMessageGetMatch[1]);
    if (!site) return json(res, 404, { error: 'Site not found.' });
    const record = dao.findPublicMessage(site.id, publicMessageGetMatch[2]);
    if (!record) return json(res, 404, { error: 'Message not found.' });
    return json(res, 200, { message_id: record.id, status: 'replied', reply: record.reply, evidence: record.evidence });
  }

  if (p === '/api/v1/escalations' && method === 'GET') {
    const auth = requireV1(req, res);
    if (!auth) return;
    const statusFilter = new URL(req.url, 'http://localhost').searchParams.get('status');
    return json(res, 200, { items: dao.listEscalations(auth.user.tenant_id, statusFilter) });
  }

  const escalationStatusMatch = p.match(/^\/api\/v1\/escalations\/([^/]+)\/status$/);
  if (escalationStatusMatch && method === 'POST') {
    const auth = requireV1(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, 'agent')) return;
    const b = await readBody(req, 100000);
    const status = String(b.status || '');
    if (!['pending', 'in_review', 'resolved'].includes(status)) return json(res, 400, { error: 'Invalid status.' });
    const escalation = dao.updateEscalationStatus(auth.user.tenant_id, escalationStatusMatch[1], status);
    if (!escalation) return json(res, 404, { error: 'Escalation not found.' });
    return json(res, 200, { escalation });
  }

  if (p === '/api/v1/tenants' && method === 'POST') {
    const auth = requireV1(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, 'admin')) return;
    const b = await readBody(req, 100000);
    const name = String(b.name || '').trim();
    if (!name) return json(res, 400, { error: 'Tenant name is required.' });
    const tenant = dao.updateTenant(auth.user.tenant_id, name);
    return json(res, 200, { tenant });
  }

  // ---------------------------------------------------------------- 商家经营档案
  if (p === '/api/v1/tenant-profile' && method === 'GET') {
    const auth = requireV1(req, res);
    if (!auth) return;
    return json(res, 200, { profile: dao.getTenantProfile(auth.user.tenant_id) });
  }
  if (p === '/api/v1/tenant-profile' && method === 'PUT') {
    const auth = requireV1(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, 'agent')) return;
    const b = await readBody(req, 100000);
    const profile = dao.upsertTenantProfile(auth.user.tenant_id, {
      business_name: b.business_name,
      platforms: b.platforms,
      markets: b.markets,
      categories: b.categories,
      monthly_revenue: b.monthly_revenue,
      team_size: b.team_size,
      goals: b.goals,
    });
    dao.logEvent('tenant_profile_saved', { tenantId: auth.user.tenant_id });
    return json(res, 200, { profile });
  }
  if (p === '/api/v1/tenant-profile/analyze' && method === 'POST') {
    const auth = requireV1(req, res);
    if (!auth) return;
    const profile = dao.getTenantProfile(auth.user.tenant_id);
    if (!profile) return json(res, 400, { error: '请先保存经营概况，再让 AI 分析。' });
    const analysis = await analyzeProfileWithLlm(profile);
    const saved = dao.saveTenantProfileAi(auth.user.tenant_id, analysis.summary, analysis.actions);
    dao.logEvent('tenant_profile_analyzed', { tenantId: auth.user.tenant_id, provider: analysis.provider || 'fallback' });
    return json(res, 200, { profile: saved, summary: analysis.summary, actions: analysis.actions, model: analysis.model });
  }

  // ---------------------------------------------------------------- 商家专属知识库
  if (p === '/api/v1/seller/knowledge' && method === 'GET') {
    const auth = requireV1(req, res);
    if (!auth) return;
    return json(res, 200, { items: dao.listTenantKnowledge(auth.user.tenant_id) });
  }
  // OCR：扫描件/图片先识别文字，返回给前端做“二次确认”，确认后才蒸馏入库
  if (p === '/api/v1/seller/knowledge/ocr' && method === 'POST') {
    const auth = requireV1(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, 'agent')) return;
    const b = await readBody(req, 12000000);
    const rawImages = Array.isArray(b.images) ? b.images : (b.image ? [b.image] : []);
    const dataUrls = rawImages
      .map((img) => (typeof img === 'string' ? img : img?.data_url))
      .filter(Boolean)
      .map((url) => (String(url).startsWith('data:') ? String(url) : `data:${String(b.mime || 'image/png')};base64,${url}`))
      .slice(0, 6);
    if (!dataUrls.length) return json(res, 400, { error: 'images 不能为空（base64 或 data URL）。' });
    if (dataUrls.some((url) => url.length > 6000000)) return json(res, 413, { error: '单张图片过大，请压缩到 4MB 以内。' });

    // 配额门禁：OCR 按页计费，每页 10 Credits
    const pages = dataUrls.length;
    const ocrCost = pages * CREDIT_COSTS.ocr_page;
    const quota = dao.checkCredits(auth.user.tenant_id, ocrCost);
    if (!quota.allowed) {
      return json(res, 402, {
        error: '额度不足，请升级套餐',
        code: 'CREDITS_EXCEEDED',
        required_credits: ocrCost,
        remaining_credits: quota.remaining_credits,
        monthly_credits: quota.monthly_credits,
      });
    }

    const result = await llm.completeVision(OCR_PROMPT, dataUrls, dao.getSettings());
    if (!result || result.error) {
      return json(res, 503, {
        error: 'OCR 服务暂不可用，请稍后重试，或直接粘贴文字上传。',
        code: 'OCR_UNAVAILABLE',
        detail: result?.error || 'vision_unavailable',
      });
    }
    const text = String(result.content || '').trim();
    if (!text) return json(res, 422, { error: '没有识别到文字，请换一张更清晰的文件，或手动粘贴文字。', code: 'OCR_EMPTY' });
    const charged = dao.chargeCredits(auth.user.tenant_id, 'ocr_page', ocrCost, { pages, filename: String(b.filename || '').slice(0, 180) });
    dao.logEvent('tenant_knowledge_ocr', { tenantId: auth.user.tenant_id, pages, chars: text.length, credits: ocrCost });
    return json(res, 200, {
      text, chars: text.length, pages, model: result.model, provider: result.provider,
      credits: { charged: charged.charged, remaining_credits: charged.remaining_credits, monthly_credits: charged.monthly_credits },
    });
  }
  if (p === '/api/v1/seller/knowledge/upload' && method === 'POST') {
    const auth = requireV1(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, 'agent')) return;
    const b = await readBody(req, 6000000);
    const filename = String(b.filename || 'upload.txt').slice(0, 180);
    let text = String(b.content || '').trim();
    let pdfDetected = false;

    if (!text && b.file_base64) {
      let buffer;
      try { buffer = Buffer.from(String(b.file_base64), 'base64'); } catch { buffer = null; }
      if (!buffer || buffer.length === 0) return json(res, 400, { error: '文件内容为空或 base64 编码无效。' });
      if (buffer.length > 5 * 1024 * 1024) return json(res, 413, { error: '文件超过 5MB 上限。' });
      if (isPdfBuffer(buffer) || /\.pdf$/i.test(filename)) {
        pdfDetected = true;
        text = extractPdfText(buffer);
        if (!text) {
          return json(res, 422, {
            error: '这个 PDF 没有可提取的文本层（扫描件）。请在前端确认 OCR 识别结果后再提交。',
            code: 'NEEDS_OCR',
          });
        }
      } else {
        text = buffer.toString('utf8').trim();
      }
    }
    if (!text) return json(res, 400, { error: 'content 或 file_base64 至少提供一个。' });
    if (text.length < 10) return json(res, 400, { error: '资料内容太短（至少 10 个字符）。' });
    if (text.length > 200000) text = text.slice(0, 200000);

    // 配额门禁：文本提取 2 Credits；若走云端蒸馏再加 5 Credits
    const settings = dao.getSettings();
    const cloudDistill = llm.status(settings).provider === 'openai';
    const estimate = CREDIT_COSTS.text_extract + (cloudDistill ? CREDIT_COSTS.cloud_distill : 0);
    const quota = dao.checkCredits(auth.user.tenant_id, estimate);
    if (!quota.allowed) {
      return json(res, 402, {
        error: '额度不足，请升级套餐',
        code: 'CREDITS_EXCEEDED',
        required_credits: estimate,
        remaining_credits: quota.remaining_credits,
        monthly_credits: quota.monthly_credits,
      });
    }

    let distillation;
    try {
      distillation = await distillKnowledge(llm, text, filename, settings);
    } catch (error) {
      return json(res, error.status || 502, { error: error.message, code: error.code || 'DISTILL_FAILED' });
    }

    // 成功后才扣费：文本提取固定 2；云端蒸馏额外 5（本地模型不扣）
    const chargeItems = [{ action_type: 'text_extract', credits: CREDIT_COSTS.text_extract, metadata: { filename, chars: text.length } }];
    if (distillation.provider === 'openai') {
      chargeItems.push({ action_type: 'cloud_distill', credits: CREDIT_COSTS.cloud_distill, metadata: { filename, cards: distillation.cards.length, model: distillation.model } });
    }
    const charged = dao.chargeCreditsBatch(auth.user.tenant_id, chargeItems);
    if (!charged.ok) {
      return json(res, 402, {
        error: '额度不足，请升级套餐',
        code: 'CREDITS_EXCEEDED',
        required_credits: charged.total,
        remaining_credits: charged.remaining_credits,
        monthly_credits: charged.monthly_credits,
      });
    }

    const created = [];
    for (const card of distillation.cards) {
      const item = dao.createTenantKnowledge(auth.user.tenant_id, {
        id: id('kb'),
        title: card.title,
        content: card.content,
        tags: card.tags,
        language: detectLanguage(card.content) === 'en' ? 'en' : 'zh',
        type: 'article',
        category: '其他',
        structured_payload: { question: card.title, answer: card.content, source_file: filename },
      });
      created.push(item);
    }
    dao.logEvent('tenant_knowledge_uploaded', {
      tenantId: auth.user.tenant_id, filename, cards: created.length, provider: distillation.provider, credits: charged.charged,
    });
    return json(res, 201, {
      filename,
      extracted_chars: text.length,
      pdf: pdfDetected,
      distilled: true,
      provider: distillation.provider,
      model: distillation.model,
      items: created,
      credits: {
        charged: charged.charged,
        breakdown: chargeItems.map((item) => ({ action_type: item.action_type, credits: item.credits })),
        remaining_credits: charged.remaining_credits,
        monthly_credits: charged.monthly_credits,
      },
    });
  }
  const confirmSellerKb = p.match(/^\/api\/v1\/seller\/knowledge\/([^/]+)\/confirm$/);
  if (confirmSellerKb && method === 'POST') {
    const auth = requireV1(req, res);
    if (!auth) return;
    const item = dao.confirmTenantKnowledge(auth.user.tenant_id, confirmSellerKb[1]);
    if (!item) return json(res, 404, { error: '知识卡不存在或不属于当前商家。' });
    dao.logEvent('tenant_knowledge_confirmed', { tenantId: auth.user.tenant_id, knowledgeId: item.id });
    return json(res, 200, { item });
  }

  if (p === '/api/v1/sites' && method === 'GET') {
    const auth = requireV1(req, res);
    if (!auth) return;
    return json(res, 200, { items: dao.listSitesByTenant(auth.user.tenant_id).map(publicSite) });
  }

  if (p === '/api/v1/sites' && method === 'POST') {
    const auth = requireV1(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, 'admin')) return;
    const b = await readBody(req, 100000);
    const name = String(b.name || '').trim();
    if (!name) return json(res, 400, { error: 'Site name is required.' });
    const template = TEMPLATE_BY_ID.get(String(b.industry_template || ''));
    if (!template) return json(res, 400, { error: 'A valid industry_template is required.' });
    const site = dao.createSite(createSiteForTenant(auth, name, template));
    dao.logEvent('v1_site_created', { siteId: site.id, tenantId: auth.user.tenant_id, template: template.id });
    return json(res, 201, { site: publicSite(site) });
  }

  const uploadMatch = p.match(/^\/api\/v1\/sites\/([^/]+)\/kb\/upload$/);
  if (uploadMatch && method === 'POST') {
    const auth = requireV1(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, 'admin')) return;
    const site = siteForAuth(auth, uploadMatch[1]);
    if (!site) return json(res, 404, { error: 'Site not found.' });
    const b = await readBody(req, 1500000);
    const content = String(b.content || '');
    if (!content.trim()) return json(res, 400, { error: 'File content is required.' });
    if (Buffer.byteLength(content, 'utf8') > 1000000) return json(res, 413, { error: 'Knowledge file must be 1 MB or smaller.' });
    const doc = dao.createSiteKnowledge(site.id, site.tenant_id, {
      id: id('kbdoc'),
      filename: String(b.filename || 'knowledge.txt').slice(0, 180),
      title: String(b.title || b.filename || 'Knowledge draft').slice(0, 180),
      content: content.slice(0, 1000000),
      status: 'draft',
      created_at: now(),
      updated_at: now()
    });
    dao.logEvent('v1_kb_draft_created', { siteId: site.id, documentId: doc.id });
    return json(res, 201, { document: doc });
  }

  const confirmMatch = p.match(/^\/api\/v1\/sites\/([^/]+)\/kb\/confirm$/);
  if (confirmMatch && method === 'POST') {
    const auth = requireV1(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, 'admin')) return;
    const site = siteForAuth(auth, confirmMatch[1]);
    if (!site) return json(res, 404, { error: 'Site not found.' });
    const b = await readBody(req, 100000);
    const doc = dao.confirmSiteKnowledge(site.id, b.document_id || null);
    if (!doc) return json(res, 404, { error: 'Draft document not found.' });
    dao.logEvent('v1_kb_draft_confirmed', { siteId: site.id, documentId: doc.id });
    return json(res, 200, { document: doc });
  }

  const embedMatch = p.match(/^\/api\/v1\/sites\/([^/]+)\/embed-code$/);
  if (embedMatch && method === 'GET') {
    const auth = requireV1(req, res);
    if (!auth) return;
    const site = siteForAuth(auth, embedMatch[1]);
    if (!site) return json(res, 404, { error: 'Site not found.' });
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const origin = `${proto}://${req.headers.host || `${HOST}:${PORT}`}`;
    return json(res, 200, {
      site_id: site.id,
      embed_key: site.embed_key,
      snippet: `<script src="${origin}/widget.js?key=${encodeURIComponent(site.embed_key)}" async></script>`,
      standalone_url: `${origin}/?site=${encodeURIComponent(site.embed_key)}`
    });
  }

  if (p === '/api/v1/privacy/export' && method === 'GET') {
    const auth = requireV1(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, 'owner')) return;
    return json(res, 200, dao.exportTenantData(auth.user.tenant_id));
  }

  if (p === '/api/v1/privacy/messages' && method === 'DELETE') {
    const auth = requireV1(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, 'owner')) return;
    const deleted = dao.deleteTenantMessages(auth.user.tenant_id);
    dao.logEvent('privacy_tenant_messages_deleted', { tenantId: auth.user.tenant_id, ...deleted });
    return json(res, 200, { ok: true, deleted });
  }

  if (p === '/api/v1/privacy/retention' && method === 'GET') {
    const auth = requireV1(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, 'owner')) return;
    return json(res, 200, { privacyRetentionDays: dao.getSettings().privacyRetentionDays });
  }

  if (p === '/api/v1/privacy/retention' && method === 'PATCH') {
    const auth = requireV1(req, res);
    if (!auth) return;
    if (!requireRole(auth, res, 'owner')) return;
    const b = await readBody(req, 10000);
    const days = Math.max(1, Math.min(3650, Number(b.privacyRetentionDays) || 0));
    if (!days) return json(res, 400, { error: 'privacyRetentionDays must be 1..3650.' });
    const settings = dao.updateSettings({ privacyRetentionDays: days });
    return json(res, 200, { privacyRetentionDays: settings.privacyRetentionDays });
  }

  return json(res, 404, { error: 'API route not found' });
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  if (p.startsWith('/api/v1/')) return await handleV1(req, res, p, method);

  if (p === '/api/ops/repair' && method === 'POST') {
    const repairSecret = process.env.REPAIR_WEBHOOK_SECRET || '';
    if (!repairSecret) return json(res, 503, { error: 'repair webhook is not configured.' });
    if (!safeEqual(req.headers['x-repair-secret'] || '', repairSecret)) return json(res, 401, { error: 'Invalid repair webhook secret.' });
    const b = await readBody(req, 250000);
    if (!b || typeof b !== 'object' || Array.isArray(b)) return json(res, 400, { error: 'repair payload must be a JSON object.' });
    const incident = repairQueue.enqueue(b);
    dao.logEvent('repair_incident_queued', {
      incidentId: incident.id, event: incident.event, severity: incident.severity,
      service: incident.service, source: incident.source, worker: incident.worker
    });
    return json(res, 202, {
      ok: true,
      incident_id: incident.id,
      received_at: incident.received_at,
      worker: incident.worker,
      status: 'queued'
    });
  }

  if (p === '/api/health' && method === 'GET') {
    const healthSettings = dao.getSettings();
    const llmStatus = llm.status(healthSettings);
    return json(res, 200, {
      ok: true,
      service: 'RelayDesk',
      version: '0.1.0',
      ollamaConfigured: Boolean(OLLAMA_URL),
      ollamaEnabled: healthSettings.ollamaEnabled,
      llmConfigured: llmStatus.configured,
      llmProvider: llmStatus.provider,
      knowledgeCount: dao.countGlobalKnowledge(),
      uptimeSeconds: Math.round(process.uptime())
    });
  }
  if (!enforceRate(res, `legacy:${clientIp(req)}`, RATE_LIMIT_LEGACY_MAX)) return;
  // 仪表盘接口需要会话（或 APP_API_KEY）；买家窗口用的 /api/chat* 与反馈接口保持公开。
  // /api/chat* 未鉴权时强制 buyer；带会话/机器凭证时强制 seller，绝不允许 all。
  const PUBLIC_LEGACY = new Set(['/api/chat', '/api/chat/stream', '/api/feedback', '/api/insights']);
  // APP_API_KEY 只在显式配置时才作为「机器凭证」放行；未配置时一律要求会话，
  // 否则开放实例会把 /api/bootstrap 等租户接口直接暴露出去。
  const legacyKeyOk = Boolean(process.env.APP_API_KEY) && authorized(req);
  // /api/ops/* 走自己的凭证模型（APP_API_KEY 或 op secret），不参与会话校验。
  if (!PUBLIC_LEGACY.has(p) && !p.startsWith('/api/insights/') && !p.startsWith('/api/ops/') && !v1Auth(req) && !legacyKeyOk) {
    return json(res, 401, { error: 'Authentication required. Use Authorization: Bearer <token>.' });
  }

  const settings = dao.getSettings();
  if (p === '/api/ops/metrics' && method === 'GET') {
    return json(res, 200, {
      ...metrics.snapshot(),
      database: dao.opsCounts(),
      llm: llm.status(settings),
      sqlite: { journal_mode: 'wal', driver: 'node:sqlite' }
    });
  }
  if (p === '/api/bootstrap' && method === 'GET') {
    const bootstrapAuth = v1Auth(req);
    const tenantId = bootstrapAuth?.user?.tenant_id;
    return json(res, 200, {
      settings,
      profile: tenantId ? dao.getTenantProfile(tenantId) : null,
      sellerKnowledge: tenantId ? dao.listTenantKnowledge(tenantId) : [],
      knowledge: dao.listGlobalKnowledge(),
      glossary: dao.listGlossary(),
      conversations: dao.listConversations(),
      stats: dao.stats()
    });
  }
  if (p === '/api/knowledge' && method === 'GET') return json(res, 200, { items: dao.listGlobalKnowledge() });

  // 公开内容页：行业洞察 / 商业策略（只返回摘要，不含客服问答数据）
  if (p === '/api/insights' && method === 'GET') {
    const limit = Number(url.searchParams.get('limit')) || 24;
    return json(res, 200, {
      categories: dao.insightCategories,
      items: dao.listInsights(limit),
    });
  }
  const insightMatch = p.match(/^\/api\/insights\/([^/]+)$/);
  if (insightMatch && method === 'GET') {
    const item = dao.findInsightById(insightMatch[1]);
    if (!item) return json(res, 404, { error: 'Insight not found' });
    return json(res, 200, { item });
  }
  if (p === '/api/knowledge' && method === 'POST') {
    const b = await readBody(req);
    if (!String(b.title || '').trim() || !String(b.content || '').trim()) return json(res, 400, { error: 'title and content are required' });
    if (String(b.content).length > 500000) return json(res, 413, { error: 'Knowledge entry too large (500 KB maximum)' });
    const sourceId = String(b.source_id || '').trim();
    if (!sourceId) {
      return json(res, 400, { error: 'source_id is required. Register the source in source_registry first (built-in: manual_editor).' });
    }
    try {
      const item = dao.createGlobalKnowledge({
        id: id('kb'),
        title: String(b.title).trim().slice(0, 180),
        type: String(b.type || 'article').slice(0, 40),
        language: String(b.language || 'en').slice(0, 12),
        tags: Array.isArray(b.tags) ? b.tags.slice(0, 30).map((x) => String(x).slice(0, 60)) : [],
        content: String(b.content).trim(),
        // 双引擎：seller 知识只对后台可见，买家窗口永远检索不到
        audience: b.audience === 'seller' ? 'seller' : 'buyer',
        category: String(b.category || '其他').slice(0, 40),
        source_id: sourceId,
        status: b.status
      });
      dao.logEvent('knowledge_created', { knowledgeId: item.id, sourceId, status: item.status });
      return json(res, 201, { item });
    } catch (error) {
      if (error.status === 403 || error.status === 400) {
        return json(res, error.status, { error: error.message, decision: error.decision || null });
      }
      throw error;
    }
  }
  const kbMatch = p.match(/^\/api\/knowledge\/([^/]+)$/);
  if (kbMatch && method === 'DELETE') {
    if (!dao.deleteGlobalKnowledge(kbMatch[1])) return json(res, 404, { error: 'Knowledge entry not found' });
    dao.logEvent('knowledge_deleted', { knowledgeId: kbMatch[1] });
    return json(res, 200, { ok: true });
  }
  if (p === '/api/glossary' && method === 'GET') return json(res, 200, { items: dao.listGlossary() });
  if (p === '/api/glossary' && method === 'POST') {
    const b = await readBody(req);
    if (!String(b.source || '').trim()) return json(res, 400, { error: 'source term is required' });
    const item = dao.createGlossary({
      id: id('gl'),
      source: String(b.source).slice(0, 160),
      preferred: b.preferred && typeof b.preferred === 'object' ? b.preferred : {},
      forbidden: Array.isArray(b.forbidden) ? b.forbidden.slice(0, 30) : [],
      notes: String(b.notes || '').slice(0, 1000)
    });
    return json(res, 201, { item });
  }
  if (p === '/api/settings' && method === 'PATCH') {
    const b = await readBody(req);
    const allowed = ['storeName', 'defaultLanguage', 'supportedLanguages', 'confidenceThreshold', 'requireEvidence', 'humanHandoff', 'ollamaEnabled', 'freeMonthlyReplies', 'privacyRetentionDays', 'adsEnabled', 'adDisclosure'];
    const patch = {};
    for (const key of allowed) {
      if (!(key in b)) continue;
      if (key === 'confidenceThreshold') patch[key] = Math.max(0, Math.min(1, Number(b[key]) || 0));
      else if (key === 'supportedLanguages' && Array.isArray(b[key])) patch[key] = [...new Set(b[key].map(String))].slice(0, 100);
      else if (['requireEvidence', 'humanHandoff', 'ollamaEnabled', 'adsEnabled'].includes(key)) patch[key] = Boolean(b[key]);
      else if (key === 'freeMonthlyReplies') patch[key] = Math.max(0, Math.min(100000, Number(b[key]) || 0));
      else if (key === 'privacyRetentionDays') patch[key] = Math.max(1, Math.min(3650, Number(b[key]) || 0));
      else patch[key] = String(b[key]).slice(0, 1000);
    }
    return json(res, 200, { settings: dao.updateSettings(patch) });
  }
  if (p === '/api/chat/stream' && method === 'POST') {
    const b = await readBody(req);
    const question = String(b.message || '').trim();
    if (!question) return json(res, 400, { error: 'message is required' });
    if (question.length > 12000) return json(res, 413, { error: 'message too long' });
    const lang = String(b.language || detectLanguage(question)).slice(0, 12);
    // 买家用 buyer 语料，后台会话/机器凭证用 seller 语料；两边的 SQL 都必须带 audience 硬过滤。
    const sellerRequest = Boolean(v1Auth(req)) || legacyKeyOk;
    const audience = sellerRequest ? 'seller' : 'buyer';
    // 后台请求：把「经营概况」注入 Prompt，让 AI 回答带商家上下文
    const chatAuth = v1Auth(req);
    const chatProfile = chatAuth ? dao.getTenantProfile(chatAuth.user.tenant_id) : null;
    const promptQuestion = profileContext(chatProfile) ? `${profileContext(chatProfile)}${question}` : question;
    // FinancialGuard 面向买家退款/赔付诉求；卖家后台问的是运营流程，不能被退款模板拦截。
    const streamFinancial = sellerRequest ? null : financialGuard(question);
    if (streamFinancial) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({
        done: true,
        result: {
          status: 'transferred_to_human',
          need_human: true,
          grounded: false,
          answer: streamFinancial.reply.text,
          text: streamFinancial.reply.text,
          lang: streamFinancial.reply.lang,
          model: 'financial-guard'
        }
      })}\n\n`);
      res.end();
      return;
    }
    // 检索池已在上面按 audience 硬过滤（买家 buyer / 卖家 seller），不存在 all。
    const hits = rankKnowledge(question, dao.listGlobalKnowledge(audience, { includeQuarantined: false, surface: 'seller_console' }));
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    });
    const send = (payload) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    try {
      let result = await llm.stream(promptQuestion, hits, lang, settings, (token) => send({ token }));
      if (!result || result.error) {
        const fallback = fallbackAnswer(question, hits, lang);
        send({ token: fallback.answer });
        result = { ...fallback, model: 'extractive-fallback' };
      }
      dao.logEvent('answer_generated', {
        language: lang, intent: inferIntent(question), confidence: result.confidence,
        grounded: result.grounded, needsHuman: result.needsHuman, model: result.model || 'extractive-fallback', stream: true
      });
      send({ done: true, result });
    } catch (error) {
      send({ error: error.message });
    } finally {
      res.end();
    }
    return;
  }
  if (p === '/api/chat' && method === 'POST') {
    const b = await readBody(req);
    const question = String(b.message || '').trim();
    if (!question) return json(res, 400, { error: 'message is required' });
    if (question.length > 12000) return json(res, 413, { error: 'message too long' });
    const lang = String(b.language || detectLanguage(question)).slice(0, 12);
    // 买家用 buyer 语料，后台会话/机器凭证用 seller 语料；两边的 SQL 都必须带 audience 硬过滤。
    const sellerRequest = Boolean(v1Auth(req)) || legacyKeyOk;
    const audience = sellerRequest ? 'seller' : 'buyer';
    const chatAuth = v1Auth(req);
    const chatProfile = chatAuth ? dao.getTenantProfile(chatAuth.user.tenant_id) : null;
    const promptQuestion = profileContext(chatProfile) ? `${profileContext(chatProfile)}${question}` : question;
    // FinancialGuard 面向买家退款/赔付诉求；卖家后台问的是运营流程，不能被退款模板拦截。
    const chatFinancial = sellerRequest ? null : financialGuard(question);
    if (chatFinancial) {
      return json(res, 200, {
        status: 'transferred_to_human',
        need_human: true,
        reply: chatFinancial.reply,
        result: {
          status: 'transferred_to_human',
          need_human: true,
          grounded: false,
          answer: chatFinancial.reply.text,
          text: chatFinancial.reply.text,
          lang: chatFinancial.reply.lang,
          model: 'financial-guard'
        },
        evidence: []
      });
    }
    // 检索池已在上面按 audience 硬过滤（买家 buyer / 卖家 seller），不存在 all。
    const hits = rankKnowledge(question, dao.listGlobalKnowledge(audience, { includeQuarantined: false, surface: 'seller_console' }));
    let result = await llm.answer(promptQuestion, hits, lang, settings);
    const model = result?.provider && result?.answer ? result.model : 'extractive-fallback';
    if (!result || result.error) result = fallbackAnswer(question, hits, lang);
    const needsHuman = Boolean(result.needsHuman) || result.confidence < settings.confidenceThreshold || (settings.requireEvidence && !hits.length);
    const answer = {
      id: id('ans'),
      question,
      language: lang,
      intent: inferIntent(question),
      answer: result.answer,
      confidence: result.confidence,
      grounded: Boolean(result.grounded),
      needsHuman,
      evidence: hits.map(({ id: knowledgeId, title, score, language }) => ({ id: knowledgeId, title, score: Number(score.toFixed(3)), language })),
      model,
      createdAt: now()
    };
    dao.logEvent('answer_generated', { language: lang, intent: answer.intent, confidence: answer.confidence, grounded: answer.grounded, needsHuman, model: answer.model });
    return json(res, 200, { result: answer });
  }
  if (p === '/api/conversations' && method === 'GET') return json(res, 200, { items: dao.listConversations() });
  if (p === '/api/conversations' && method === 'POST') {
    const b = await readBody(req);
    const message = String(b.message || '').trim();
    if (!message) return json(res, 400, { error: 'message is required' });
    const at = now();
    const conversation = dao.createConversation({
      id: id('conv'),
      tenant_id: null,
      customer: String(b.customer || 'New customer').slice(0, 120),
      channel: String(b.channel || 'Website').slice(0, 40),
      language: String(b.language || detectLanguage(message)).slice(0, 12),
      intent: inferIntent(message),
      status: 'open',
      lastMessage: message,
      created_at: at,
      updated_at: at
    }, { id: id('msg'), text: message, at });
    return json(res, 201, { item: conversation });
  }
  const convMatch = p.match(/^\/api\/conversations\/([^/]+)\/reply$/);
  if (convMatch && method === 'POST') {
    const b = await readBody(req);
    const text = String(b.message || '').trim();
    if (!text) return json(res, 400, { error: 'message is required' });
    const conversation = dao.addConversationReply(convMatch[1], text, b.status);
    if (!conversation) return json(res, 404, { error: 'Conversation not found' });
    return json(res, 200, { item: conversation });
  }
  if (p === '/api/feedback' && method === 'POST') {
    const b = await readBody(req);
    if (!['helpful', 'not_helpful', 'wrong_intent', 'unsafe'].includes(b.rating)) return json(res, 400, { error: 'invalid rating' });
    dao.logEvent('feedback', { rating: b.rating, answerId: String(b.answerId || '').slice(0, 80), comment: String(b.comment || '').slice(0, 1000) });
    return json(res, 201, { ok: true });
  }
  if (p === '/api/test/run' && method === 'POST') {
    const cases = [
      { name: 'shipping retrieval', q: 'Where is my tracking number? My shipping has not updated.', expected: 'Shipping status', shouldGround: true },
      { name: 'returns retrieval', q: 'Can I get a refund or return this item?', expected: 'Returns and refunds', shouldGround: true },
      { name: 'warranty retrieval', q: 'Does the product have a warranty if faulty?', expected: 'Product warranty', shouldGround: true },
      { name: 'unsupported query escalation', q: 'Can you guarantee arrival by tomorrow and send a free replacement?', expected: 'General question', shouldGround: false },
      { name: 'Chinese policy query', q: '我想申请退款，退货政策是什么？', expected: 'Returns and refunds', shouldGround: true }
    ];
    const results = cases.map((testCase) => {
      const hits = rankKnowledge(testCase.q, dao.listGlobalKnowledge('all', { includeQuarantined: false, surface: 'seller_console' }));
      const intent = inferIntent(testCase.q);
      const grounded = hits.length > 0;
      return { ...testCase, actualIntent: intent, grounded, pass: intent === testCase.expected && grounded === testCase.shouldGround };
    });
    const run = dao.createTestRun({
      id: id('test'),
      at: now(),
      total: results.length,
      passed: results.filter((item) => item.pass).length,
      results
    });
    dao.logEvent('test_run', { passed: run.passed, total: run.total });
    return json(res, 200, { run });
  }
  if (p === '/api/tests' && method === 'GET') return json(res, 200, { runs: dao.listTestRuns() });
  if (p === '/api/metrics' && method === 'GET') return json(res, 200, { stats: dao.stats(), recentEvents: dao.listEvents(50), testRuns: dao.listTestRuns(10) });
  if (p === '/api/export' && method === 'GET') return json(res, 200, { exportedAt: now(), store: dao.exportStore() });
  return json(res, 404, { error: 'API route not found' });
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  const requestId = String(req.headers['x-request-id'] || crypto.randomUUID()).slice(0, 100);
  const requestPath = (() => {
    try { return new URL(req.url, 'http://localhost').pathname; } catch { return '/invalid-url'; }
  })();
  const startedAt = process.hrtime.bigint();
  res.setHeader('x-request-id', requestId);
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    metrics.record({ method: req.method, path: requestPath, status: res.statusCode, durationMs });
    console.log(JSON.stringify({
      level: res.statusCode >= 500 ? 'error' : 'info',
      request_id: requestId,
      method: req.method,
      path: requestPath,
      status: res.statusCode,
      duration_ms: Number(durationMs.toFixed(1))
    }));
  });
  applySecurityHeaders(req, res);
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const file = path.resolve(PUBLIC_DIR, '.' + pathname);
    if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, 'index.html')) return send(res, 403, 'Forbidden');
    try {
      const body = await fs.readFile(file);
      return send(res, 200, body, mime[path.extname(file)] || 'application/octet-stream');
    } catch {
      return send(res, 404, 'Not found');
    }
  } catch (error) {
    console.error('API_ERROR', redactPII(error?.stack || error?.message || error));
    return json(res, error.status || 500, { error: error.status ? redactPII(error.message) : 'Internal server error' });
  }
});

function shutdown(signal) {
  server.close(() => {
    closeDatabase(db);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  server.listen(PORT, HOST, () => console.log(`RelayDesk MVP running at http://${HOST}:${PORT} (SQLite ${DB_PATH})`));
}

export { rankKnowledge, inferIntent, detectLanguage, fallbackAnswer, stats, server, dao, db };
