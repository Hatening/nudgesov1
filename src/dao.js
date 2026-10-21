import crypto from 'node:crypto';
import { id, now, hashToken, tokenPrefix } from './core.js';
import { seedSettings } from './seed.js';
import { transaction } from './db.js';

const parseJson = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

// 运营类 seller 内容：自动标记为可公开展示的内容营销素材（is_insight = 1）
const OPERATIONAL_CATEGORIES = [
  '广告与营销', '物流与配送', '退货与退款', '支付与结算',
  '商品与尺码', '平台规则', '投诉与纠纷',
];

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    password_salt: row.password_salt,
    password_hash: row.password_hash,
    tenant_id: row.tenant_id,
    role: row.role,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at || null
  };
}

function mapTenant(row) {
  if (!row) return null;
  return { id: row.id, name: row.name, plan: row.plan, status: row.status, created_at: row.created_at };
}

function mapKnowledge(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    site_id: row.site_id,
    scope: row.scope,
    filename: row.filename,
    title: row.title,
    type: row.type,
    language: row.language,
    tags: parseJson(row.tags_json, []),
    content: row.content,
    status: row.status,
    audience: row.audience || 'buyer',
    category: row.category || '其他',
    is_insight: Boolean(row.is_insight),
    product_surface: row.product_surface || 'general',
    locale: row.locale || row.language || 'en',
    license_status: row.license_status || 'clear',
    valid_from: row.valid_from || null,
    valid_until: row.valid_until || null,
    structured_payload: parseJson(row.structured_payload, null),
    created_at: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at || row.created_at
  };
}

function mapSite(row, knowledgeCount = 0) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    industry_template: row.industry_template,
    industry_template_name: row.industry_template_name,
    embed_key: row.embed_key,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    knowledge_count: Number(knowledgeCount || 0)
  };
}

function mapConversation(row, messages = []) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    customer: row.customer,
    channel: row.channel,
    language: row.language,
    intent: row.intent,
    status: row.status,
    lastMessage: row.last_message,
    updatedAt: row.updated_at,
    created_at: row.created_at,
    messages
  };
}

function mapMessage(row) {
  if (!row) return null;
  const base = {
    id: row.id,
    tenant_id: row.tenant_id,
    site_id: row.site_id,
    conversation_id: row.conversation_id,
    embed_key: row.embed_key,
    source: row.source,
    role: row.role,
    input_type: row.input_type,
    message: row.message,
    transcript: row.transcript,
    language: row.language,
    intent: row.intent,
    risk: row.risk,
    needs_human: Boolean(row.needs_human),
    audio_filename: row.audio_filename,
    audio_size_bytes: row.audio_size_bytes,
    created_at: row.created_at
  };
  if (row.reply_json) base.reply = parseJson(row.reply_json, null);
  if (row.evidence_json) base.evidence = parseJson(row.evidence_json, []);
  return base;
}

function mapLegacyMessage(row) {
  return { role: row.role, text: row.message, at: row.created_at };
}

function mapEscalation(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    site_id: row.site_id,
    message_id: row.message_id,
    message: row.message,
    input_type: row.input_type,
    language: row.language,
    intent: row.intent,
    risk: row.risk,
    risk_level: row.risk_level || row.risk || 'high',
    category: row.category || 'general',
    priority: row.priority || 'normal',
    status: row.status,
    assigned_to: row.assigned_to,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
    ...(row.site_name ? { site_name: row.site_name } : {})
  };
}

function mapGlossary(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    preferred: parseJson(row.preferred_json, {}),
    forbidden: parseJson(row.forbidden_json, []),
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapEvent(row) {
  if (!row) return null;
  const data = parseJson(row.data_json, {});
  return { id: row.id, type: row.type, at: row.created_at, ...data };
}

function mapTestRun(row) {
  if (!row) return null;
  return { id: row.id, at: row.created_at, total: row.total, passed: row.passed, results: parseJson(row.results_json, []) };
}

export function createDao(db) {
  const dao = {};

  dao.transaction = (fn, options) => transaction(db, fn, options);

  // Tenants / users / sessions
  dao.findTenant = (tenantId) => mapTenant(db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId));
  dao.listTenants = () => db.prepare('SELECT * FROM tenants ORDER BY created_at').all().map(mapTenant);
  dao.createTenant = (tenant) => {
    db.prepare('INSERT INTO tenants (id, name, plan, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(tenant.id, tenant.name, tenant.plan || 'free', tenant.status || 'active', tenant.created_at || now());
    return dao.findTenant(tenant.id);
  };
  dao.updateTenant = (tenantId, name) => {
    db.prepare('UPDATE tenants SET name = ? WHERE id = ?').run(String(name).slice(0, 120), tenantId);
    return dao.findTenant(tenantId);
  };
  dao.findUserByEmail = (email) => mapUser(db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase()));
  dao.findUserById = (userId) => mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
  dao.listUsers = () => db.prepare('SELECT * FROM users ORDER BY created_at').all().map(mapUser);
  dao.createUser = (user) => {
    db.prepare(`INSERT INTO users
      (id, tenant_id, email, password_salt, password_hash, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(user.id, user.tenant_id, user.email, user.password_salt, user.password_hash, user.role || 'owner', user.status || 'active', user.created_at || now(), user.updated_at || null);
    return dao.findUserById(user.id);
  };
  const ACCESS_TTL_MS = 15 * 60 * 1000;
  const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  function insertSessionRow(userId, tenantId, token, kind, familyId, expiresAt, replacedBy = null) {
    db.prepare(`INSERT INTO sessions
      (token_hash, token_prefix, user_id, tenant_id, created_at, expires_at, kind, family_id, replaced_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(hashToken(token), tokenPrefix(token), userId, tenantId, now(), expiresAt, kind, familyId, replacedBy);
  }

  function insertTokenPair(user, familyId = id('fam')) {
    const accessToken = crypto.randomBytes(32).toString('hex');
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS).toISOString();
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_MS).toISOString();
    insertSessionRow(user.id, user.tenant_id, accessToken, 'access', familyId, accessExpiresAt);
    insertSessionRow(user.id, user.tenant_id, refreshToken, 'refresh', familyId, refreshExpiresAt);
    return {
      accessToken,
      refreshToken,
      familyId,
      accessExpiresAt,
      refreshExpiresAt,
      accessExpiresIn: Math.floor(ACCESS_TTL_MS / 1000),
      refreshExpiresIn: Math.floor(REFRESH_TTL_MS / 1000)
    };
  }

  dao.createSession = (user, token = crypto.randomBytes(32).toString('hex')) => {
    const createdAt = now();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO sessions
      (token_hash, token_prefix, user_id, tenant_id, created_at, expires_at, kind, family_id)
      VALUES (?, ?, ?, ?, ?, ?, 'access', ?)`)
      .run(hashToken(token), tokenPrefix(token), user.id, user.tenant_id, createdAt, expiresAt, id('fam'));
    return token;
  };
  dao.createTokenPair = (user) => transaction(db, () => insertTokenPair(user));

  dao.findSessionByToken = (token) => {
    if (!token) return null;
    const row = db.prepare(`
      SELECT s.token_hash, s.token_prefix, s.user_id, s.tenant_id, s.created_at AS session_created_at,
             s.expires_at, s.revoked_at, s.kind, s.family_id, u.*, t.id AS tenant_record_id,
             t.name AS tenant_name, t.plan AS tenant_plan, t.status AS tenant_status,
             t.created_at AS tenant_created_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN tenants t ON t.id = s.tenant_id
      WHERE s.token_hash = ?
        AND s.kind IN ('access', 'legacy')
        AND s.revoked_at IS NULL
        AND (s.expires_at IS NULL OR s.expires_at > ?)
    `).get(hashToken(token), now());
    if (!row) return null;
    return {
      token,
      session: { token_prefix: row.token_prefix, user_id: row.user_id, tenant_id: row.tenant_id, created_at: row.session_created_at, expires_at: row.expires_at, kind: row.kind, family_id: row.family_id },
      user: mapUser(row),
      tenant: mapTenant({ id: row.tenant_record_id, name: row.tenant_name, plan: row.tenant_plan, status: row.tenant_status, created_at: row.tenant_created_at })
    };
  };
  dao.findRefreshToken = (token) => {
    if (!token) return null;
    const row = db.prepare(`
      SELECT s.token_hash, s.user_id, s.tenant_id, s.created_at AS session_created_at,
             s.expires_at, s.revoked_at, s.replaced_by, s.family_id, u.*, t.name AS tenant_name,
             t.plan AS tenant_plan, t.status AS tenant_status, t.created_at AS tenant_created_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      JOIN tenants t ON t.id = s.tenant_id
      WHERE s.token_hash = ? AND s.kind = 'refresh'
    `).get(hashToken(token));
    if (!row) return null;
    return {
      row,
      user: mapUser(row),
      tenant: mapTenant({ id: row.tenant_id, name: row.tenant_name, plan: row.tenant_plan, status: row.tenant_status, created_at: row.tenant_created_at })
    };
  };
  dao.rotateRefreshToken = (refreshToken) => {
    const current = dao.findRefreshToken(refreshToken);
    if (!current) return null;
    const row = current.row;
    if (row.revoked_at || row.replaced_by) {
      if (row.family_id) {
        db.prepare('UPDATE sessions SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL').run(now(), row.family_id);
      }
      return { reuse_detected: true };
    }
    if (row.expires_at && row.expires_at <= now()) return { expired: true };
    return transaction(db, () => {
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL')
        .run(now(), row.family_id);
      const pair = insertTokenPair(current.user, row.family_id);
      db.prepare('UPDATE sessions SET replaced_by = ? WHERE token_hash = ?')
        .run(hashToken(pair.refreshToken), hashToken(refreshToken));
      return pair;
    });
  };
  dao.listSessions = (userId) => db.prepare(`
    SELECT token_prefix, user_id, tenant_id, created_at, expires_at, revoked_at, kind, family_id
    FROM sessions WHERE user_id = ? AND kind IN ('access', 'legacy') ORDER BY created_at DESC
  `).all(userId).map((row) => ({ ...row, active: !row.revoked_at && (!row.expires_at || row.expires_at > now()) }));
  dao.revokeSessionByToken = (token) => {
    const result = db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .run(now(), hashToken(token));
    return Number(result.changes || 0) > 0;
  };
  dao.revokeFamilyByToken = (token) => {
    const row = db.prepare('SELECT family_id FROM sessions WHERE token_hash = ?').get(hashToken(token));
    if (!row) return 0;
    if (row.family_id) {
      return Number(db.prepare('UPDATE sessions SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL').run(now(), row.family_id).changes || 0);
    }
    return Number(db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(now(), hashToken(token)).changes || 0);
  };
  dao.revokeAllSessions = (userId) => {
    const result = db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(now(), userId);
    return Number(result.changes || 0);
  };
  dao.registerTenantOwner = (tenant, user) => {
    return transaction(db, () => {
      dao.createTenant(tenant);
      dao.createUser(user);
      const pair = insertTokenPair(user);
      return { tenant: dao.findTenant(tenant.id), user: dao.findUserById(user.id), ...pair, token: pair.accessToken };
    });
  };

  // Sites
  dao.createSite = (site) => {
    db.prepare(`INSERT INTO sites
      (id, tenant_id, name, industry_template, industry_template_name, embed_key, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(site.id, site.tenant_id, site.name, site.industry_template, site.industry_template_name || '', site.embed_key, site.status || 'active', site.created_at || now(), site.updated_at || null);
    return dao.findSiteById(site.id);
  };
  dao.findSiteById = (siteId) => mapSite(db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId), dao.countKnowledgeForSite(siteId));
  dao.findSiteByTenant = (tenantId, siteId) => mapSite(db.prepare('SELECT * FROM sites WHERE id = ? AND tenant_id = ?').get(siteId, tenantId), dao.countKnowledgeForSite(siteId));
  dao.findSiteByEmbedKey = (embedKey) => mapSite(db.prepare('SELECT * FROM sites WHERE embed_key = ?').get(embedKey), dao.countKnowledgeForSiteByEmbed(embedKey));
  dao.listSitesByTenant = (tenantId) => db.prepare('SELECT * FROM sites WHERE tenant_id = ? ORDER BY created_at').all(tenantId).map((row) => mapSite(row, dao.countKnowledgeForSite(row.id)));
  dao.listAllSites = () => db.prepare('SELECT * FROM sites ORDER BY created_at').all().map((row) => mapSite(row, dao.countKnowledgeForSite(row.id)));
  dao.countKnowledgeForSite = (siteId) => Number(db.prepare('SELECT COUNT(*) AS count FROM knowledge WHERE site_id = ? AND status = ?').get(siteId, 'confirmed').count || 0);
  dao.countKnowledgeForSiteByEmbed = (embedKey) => Number(db.prepare(`SELECT COUNT(*) AS count FROM knowledge k JOIN sites s ON s.id = k.site_id WHERE s.embed_key = ? AND k.status = 'confirmed'`).get(embedKey).count || 0);

  // Knowledge
  // audience: 'buyer' | 'seller' | 'all'（不传 = all）
  const audienceClause = (audience) => (audience && audience !== 'all' ? ` AND audience = '${audience === 'seller' ? 'seller' : 'buyer'}'` : '');
  const VALID_SURFACES = new Set(['buyer_chat', 'seller_console', 'platform_support', 'internal', 'general']);
  const surfaceClause = (surface) => (surface && VALID_SURFACES.has(surface)
    ? ` AND product_surface IN ('${surface}', 'general')`
    : '');
  // 有效期：空表示长期有效；过期/未生效都不可检索。
  const validityClause = () => " AND (valid_from IS NULL OR valid_from <= datetime('now')) AND (valid_until IS NULL OR valid_until >= datetime('now'))";
  // Chat/RAG must never see legally held or manually-audit-pending knowledge.
  // 语义：默认=管理/审计视角（全量）；检索链路必须显式传 { includeQuarantined: false }。
  const quarantineClause = (includeQuarantined) => (includeQuarantined === false
    ? ` AND status = 'confirmed' AND license_status <> 'hold' AND review_status NOT IN ('license_hold', 'needs_manual_audit', 'quarantined', 'rejected')${validityClause()}`
    : '');

  dao.listGlobalKnowledge = (audience = 'all', options = {}) => db.prepare(`SELECT * FROM knowledge WHERE scope = 'global'${audienceClause(audience)}${quarantineClause(options.includeQuarantined)}${surfaceClause(options.surface)} ORDER BY rowid DESC`).all().map(mapKnowledge);
  dao.countGlobalKnowledge = (audience = 'all') => Number(db.prepare(`SELECT COUNT(*) AS count FROM knowledge WHERE scope = 'global'${audienceClause(audience)}`).get().count || 0);
  dao.findGlobalKnowledge = (knowledgeId) => mapKnowledge(db.prepare("SELECT * FROM knowledge WHERE id = ? AND scope = 'global'").get(knowledgeId));
  dao.createGlobalKnowledge = (item) => {
    const audience = item.audience === 'seller' ? 'seller' : 'buyer';
    const category = item.category || '其他';
    const locale = item.locale || (item.language ? String(item.language).slice(0, 8) : 'en');
    const surface = item.product_surface || (audience === 'seller' ? 'seller_console' : 'buyer_chat');
    const licenseStatus = item.license_status || 'clear';
    db.prepare(`INSERT INTO knowledge
      (id, tenant_id, site_id, scope, filename, title, type, language, tags_json, content, status, audience, category, is_insight, created_at, updated_at,
       product_surface, locale, license_status, valid_from, valid_until, structured_payload)
      VALUES (?, NULL, NULL, 'global', NULL, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, item.title, item.type || 'article', item.language || 'en', JSON.stringify(item.tags || []), item.content,
        audience, category, isInsightValue(audience, category, item.is_insight), item.created_at || now(), item.updated_at || now(),
        surface, locale, licenseStatus, item.valid_from || null, item.valid_until || null, JSON.stringify(item.structured_payload || {}));
    return dao.findGlobalKnowledge(item.id);
  };

  // 行业洞察 / 商业策略：公开内容页（内容营销），只读、只返回摘要
  const INSIGHT_CATEGORIES = ['行业洞察', '商业策略'];
  function isInsightValue(audience, category, explicit) {
    if (typeof explicit === 'boolean') return explicit ? 1 : 0;
    if (audience !== 'seller') return 0;
    return INSIGHT_CATEGORIES.includes(category) || OPERATIONAL_CATEGORIES.includes(category) ? 1 : 0;
  }

  dao.listInsights = (limit = 24) => db.prepare(`
    SELECT id, title, category, language, tags_json, content, created_at
    FROM knowledge
    WHERE is_insight = 1 AND audience = 'seller'${quarantineClause(false)}
    ORDER BY datetime(created_at) DESC, rowid DESC
    LIMIT ?`).all(Math.max(1, Math.min(50, Number(limit) || 24))).map((row) => {
      const text = String(row.content || '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_`>#-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        id: row.id,
        title: row.title,
        category: row.category,
        language: row.language,
        tags: parseJson(row.tags_json, []),
        summary: text.length > 170 ? `${text.slice(0, 167)}…` : text,
        created_at: row.created_at,
      };
    });

  // 详情：只允许 is_insight 的 seller 卡公开，其余一律 404（不泄露客服知识）
  dao.findInsightById = (knowledgeId) => {
    const row = db.prepare(`
      SELECT id, title, category, language, tags_json, content, created_at
      FROM knowledge
      WHERE id = ? AND is_insight = 1 AND audience = 'seller'${quarantineClause(false)}`).get(knowledgeId);
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      language: row.language,
      tags: parseJson(row.tags_json, []),
      content: row.content,
      created_at: row.created_at,
    };
  };
  dao.insightCategories = INSIGHT_CATEGORIES;
  dao.deleteGlobalKnowledge = (knowledgeId) => {
    const result = db.prepare("DELETE FROM knowledge WHERE id = ? AND scope = 'global'").run(knowledgeId);
    return Number(result.changes || 0) > 0;
  };
  dao.listSiteKnowledge = (siteId) => db.prepare('SELECT * FROM knowledge WHERE site_id = ? ORDER BY rowid').all(siteId).map(mapKnowledge);
  dao.listConfirmedKnowledgeForSite = (siteId, audience = 'all', options = {}) => db.prepare(`SELECT * FROM knowledge WHERE site_id = ? AND status = 'confirmed'${audienceClause(audience)}${quarantineClause(options.includeQuarantined)}${surfaceClause(options.surface)} ORDER BY rowid`).all(siteId).map(mapKnowledge);
  dao.createSiteKnowledge = (siteId, tenantId, doc) => {
    db.prepare(`INSERT INTO knowledge
      (id, tenant_id, site_id, scope, filename, title, type, language, tags_json, content, status, audience, created_at, updated_at)
      VALUES (?, ?, ?, 'site', ?, ?, 'article', 'zh', '[]', ?, ?, ?, ?, ?)`)
      .run(doc.id, tenantId, siteId, doc.filename || null, doc.title, doc.content, doc.status || 'draft', doc.audience === 'seller' ? 'seller' : 'buyer', doc.created_at || now(), doc.updated_at || now());
    return mapKnowledge(db.prepare('SELECT * FROM knowledge WHERE id = ?').get(doc.id));
  };
  dao.findSiteKnowledge = (siteId, documentId) => mapKnowledge(db.prepare('SELECT * FROM knowledge WHERE id = ? AND site_id = ?').get(documentId, siteId));
  dao.confirmSiteKnowledge = (siteId, documentId) => {
    const doc = documentId
      ? dao.findSiteKnowledge(siteId, documentId)
      : mapKnowledge(db.prepare("SELECT * FROM knowledge WHERE site_id = ? AND status = 'draft' ORDER BY rowid DESC LIMIT 1").get(siteId));
    if (!doc) return null;
    db.prepare("UPDATE knowledge SET status = 'confirmed', updated_at = ? WHERE id = ? AND site_id = ?").run(now(), doc.id, siteId);
    return dao.findSiteKnowledge(siteId, doc.id);
  };

  // Conversations and legacy messages
  const listConversationMessages = (conversationId) => db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid").all(conversationId).map(mapLegacyMessage);
  dao.listConversations = () => db.prepare('SELECT * FROM conversations ORDER BY created_at, rowid').all().map((row) => mapConversation(row, listConversationMessages(row.id)));
  dao.findConversation = (conversationId) => {
    const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
    return row ? mapConversation(row, listConversationMessages(row.id)) : null;
  };
  dao.createConversation = (conversation, firstMessage) => {
    return transaction(db, () => {
      db.prepare(`INSERT INTO conversations
        (id, tenant_id, customer, channel, language, intent, status, last_message, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(conversation.id, conversation.tenant_id || null, conversation.customer, conversation.channel, conversation.language, conversation.intent, conversation.status || 'open', conversation.lastMessage, conversation.created_at || now(), conversation.updated_at || now());
      db.prepare(`INSERT INTO messages
        (id, tenant_id, site_id, conversation_id, embed_key, source, role, input_type, message, language, created_at)
        VALUES (?, ?, NULL, ?, NULL, 'legacy', 'customer', 'text', ?, ?, ?)`)
        .run(firstMessage.id, conversation.tenant_id || null, conversation.id, firstMessage.text, conversation.language, firstMessage.at || now());
      return dao.findConversation(conversation.id);
    });
  };
  dao.addConversationReply = (conversationId, text, status) => {
    return transaction(db, () => {
      const conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
      if (!conversation) return null;
      const at = now();
      db.prepare(`INSERT INTO messages
        (id, tenant_id, site_id, conversation_id, embed_key, source, role, input_type, message, language, created_at)
        VALUES (?, ?, NULL, ?, NULL, 'legacy', 'agent', 'text', ?, ?, ?)`)
        .run(id('msg'), conversation.tenant_id || null, conversationId, text, conversation.language, at);
      const nextStatus = status && ['open','pending','closed'].includes(status) ? status : conversation.status;
      db.prepare('UPDATE conversations SET last_message = ?, updated_at = ?, status = ? WHERE id = ?')
        .run(text, at, nextStatus, conversationId);
      return dao.findConversation(conversationId);
    });
  };

  // Public messages / escalations
  const insertPublicMessage = (record) => {
    db.prepare(`INSERT INTO messages
      (id, tenant_id, site_id, conversation_id, embed_key, source, role, input_type, message, transcript,
       reply_json, evidence_json, language, intent, risk, needs_human, audio_filename, audio_size_bytes, created_at)
      VALUES (?, ?, ?, NULL, ?, 'public', 'customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        record.id, record.tenant_id || null, record.site_id, record.embed_key || null, record.input_type || 'text',
        record.message || '', record.transcript || null, JSON.stringify(record.reply || {}),
        JSON.stringify(record.evidence || []), record.language || null, record.intent || null,
        record.risk || null, record.reply?.need_human ? 1 : 0, record.audio_filename || null,
        Number(record.audio_size_bytes || 0) || null, record.created_at || now()
      );
  };
  dao.createPublicMessage = (record, event) => {
    return transaction(db, () => {
      insertPublicMessage(record);
      if (event) dao.logEvent(event.type, event.data || {});
      return dao.findPublicMessage(record.site_id, record.id);
    });
  };
  dao.createPublicMessageWithEscalation = (record, escalation, event) => {
    return transaction(db, () => {
      insertPublicMessage(record);
      db.prepare(`INSERT INTO escalations
        (id, tenant_id, site_id, message_id, message, input_type, language, intent, risk, risk_level, category, priority, status, assigned_to, created_at, updated_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL)`)
        .run(escalation.id, escalation.tenant_id, escalation.site_id, escalation.message_id, escalation.message || null,
          escalation.input_type || null, escalation.language || null, escalation.intent || null, escalation.risk || 'high',
          escalation.risk_level || escalation.risk || 'high', escalation.category || 'general', escalation.priority || 'normal',
          escalation.status || 'pending', escalation.created_at || now(), escalation.updated_at || now());
      if (event) dao.logEvent(event.type, event.data || {});
      return { message: dao.findPublicMessage(record.site_id, record.id), escalation: dao.findEscalation(escalation.id) };
    });
  };
  dao.findPublicMessage = (siteId, messageId) => {
    const row = db.prepare("SELECT * FROM messages WHERE id = ? AND site_id = ? AND source = 'public'").get(messageId, siteId);
    return mapMessage(row);
  };
  dao.listPublicMessages = () => db.prepare("SELECT * FROM messages WHERE source = 'public' ORDER BY created_at, rowid").all().map(mapMessage);
  dao.findEscalation = (escalationId) => mapEscalation(db.prepare('SELECT * FROM escalations WHERE id = ?').get(escalationId));
  dao.listEscalations = (tenantId, status) => {
    let sql = `SELECT e.*, s.name AS site_name FROM escalations e JOIN sites s ON s.id = e.site_id WHERE e.tenant_id = ?`;
    const params = [tenantId];
    if (status) { sql += ' AND e.status = ?'; params.push(status); }
    sql += ' ORDER BY e.created_at DESC, e.rowid DESC';
    return db.prepare(sql).all(...params).map(mapEscalation);
  };
  dao.listAllEscalations = () => db.prepare('SELECT e.*, s.name AS site_name FROM escalations e LEFT JOIN sites s ON s.id = e.site_id ORDER BY e.created_at, e.rowid').all().map(mapEscalation);
  dao.updateEscalationStatus = (tenantId, escalationId, status) => {
    const escalation = db.prepare('SELECT * FROM escalations WHERE id = ? AND tenant_id = ?').get(escalationId, tenantId);
    if (!escalation) return null;
    const at = now();
    db.prepare('UPDATE escalations SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?')
      .run(status, at, status === 'resolved' ? at : null, escalationId);
    return mapEscalation(db.prepare(`SELECT e.*, s.name AS site_name FROM escalations e JOIN sites s ON s.id = e.site_id WHERE e.id = ?`).get(escalationId));
  };

  // Settings / glossary
  dao.getSettings = () => {
    const row = db.prepare("SELECT value_json FROM settings WHERE key = 'app'").get();
    const stored = row ? parseJson(row.value_json, {}) : {};
    return { ...seedSettings, ...stored };
  };
  dao.updateSettings = (patch) => {
    const settings = { ...dao.getSettings(), ...patch };
    db.prepare(`INSERT INTO settings (key, value_json) VALUES ('app', ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`).run(JSON.stringify(settings));
    return dao.getSettings();
  };
  dao.listGlossary = () => db.prepare('SELECT * FROM glossary ORDER BY rowid DESC').all().map(mapGlossary);
  dao.createGlossary = (item) => {
    db.prepare(`INSERT INTO glossary (id, source, preferred_json, forbidden_json, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(item.id, item.source, JSON.stringify(item.preferred || {}), JSON.stringify(item.forbidden || []), item.notes || '', now(), now());
    return mapGlossary(db.prepare('SELECT * FROM glossary WHERE id = ?').get(item.id));
  };

  // Events / metrics / test runs
  dao.logEvent = (type, data = {}) => {
    const eventId = id('evt');
    const at = now();
    db.prepare('INSERT INTO events (id, type, data_json, created_at) VALUES (?, ?, ?, ?)')
      .run(eventId, type, JSON.stringify(data), at);
    return { id: eventId, type, at, ...data };
  };
  dao.listEvents = (limit = 5000) => db.prepare('SELECT * FROM events ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit).map(mapEvent);
  dao.listEventsByType = (type) => db.prepare('SELECT * FROM events WHERE type = ? ORDER BY created_at, rowid').all(type).map(mapEvent);
  dao.createTestRun = (run) => {
    db.prepare('INSERT INTO test_runs (id, created_at, total, passed, results_json) VALUES (?, ?, ?, ?, ?)')
      .run(run.id, run.at || now(), run.total, run.passed, JSON.stringify(run.results || []));
    return mapTestRun(db.prepare('SELECT * FROM test_runs WHERE id = ?').get(run.id));
  };
  dao.listTestRuns = (limit = 100) => db.prepare('SELECT * FROM test_runs ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit).map(mapTestRun);

  dao.stats = () => {
    const settings = dao.getSettings();
    const answers = dao.listEventsByType('answer_generated');
    const feedback = dao.listEventsByType('feedback');
    const tests = dao.listTestRuns(1);
    const avg = (items) => items.length ? items.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / items.length : 0;
    return {
      knowledgeCount: dao.countGlobalKnowledge(),
      conversationCount: Number(db.prepare('SELECT COUNT(*) AS count FROM conversations').get().count || 0),
      openConversations: Number(db.prepare("SELECT COUNT(*) AS count FROM conversations WHERE status = 'open'").get().count || 0),
      answers: answers.length,
      groundedRate: answers.length ? answers.filter((item) => item.grounded).length / answers.length : 0,
      handoffRate: answers.length ? answers.filter((item) => item.needsHuman).length / answers.length : 0,
      averageConfidence: avg(answers),
      feedbackCount: feedback.length,
      lastTest: tests[0] || null,
      languageCount: settings.supportedLanguages.length
    };
  };

  dao.opsCounts = () => ({
    tenants: Number(db.prepare('SELECT COUNT(*) AS count FROM tenants').get().count || 0),
    sites: Number(db.prepare('SELECT COUNT(*) AS count FROM sites').get().count || 0),
    messages: Number(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count || 0),
    pending_escalations: Number(db.prepare("SELECT COUNT(*) AS count FROM escalations WHERE status = 'pending'").get().count || 0),
    active_sessions: Number(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)").get(now()).count || 0),
    knowledge: Number(db.prepare('SELECT COUNT(*) AS count FROM knowledge').get().count || 0)
  });

  dao.exportStore = () => {
    const sites = dao.listAllSites().map((site) => ({ ...site, knowledge: dao.listSiteKnowledge(site.id) }));
    return {
      settings: dao.getSettings(),
      knowledge: dao.listGlobalKnowledge(),
      glossary: dao.listGlossary(),
      conversations: dao.listConversations(),
      events: dao.listEvents(5000).reverse(),
      testRuns: dao.listTestRuns(100),
      users: dao.listUsers(),
      tenants: dao.listTenants(),
      sites,
      sessions: [],
      publicMessages: dao.listPublicMessages(),
      escalations: dao.listAllEscalations()
    };
  };

  dao.exportTenantData = (tenantId) => {
    const sites = dao.listSitesByTenant(tenantId).map((site) => ({
      ...site,
      knowledge: dao.listSiteKnowledge(site.id)
    }));
    const messages = db.prepare('SELECT * FROM messages WHERE tenant_id = ? ORDER BY created_at, rowid').all(tenantId).map(mapMessage);
    const escalations = dao.listEscalations(tenantId);
    const users = dao.listUsers()
      .filter((user) => user.tenant_id === tenantId)
      .map(({ password_salt, password_hash, ...safe }) => safe);
    const consents = db.prepare("SELECT * FROM events WHERE type = 'privacy_consent' ORDER BY created_at, rowid").all()
      .map(mapEvent)
      .filter((event) => sites.some((site) => site.id === event.siteId));
    return {
      exported_at: now(),
      tenant: dao.findTenant(tenantId),
      users,
      sites,
      messages,
      escalations,
      privacy_consents: consents
    };
  };

  dao.deleteTenantMessages = (tenantId) => transaction(db, () => {
    const escalations = Number(db.prepare('DELETE FROM escalations WHERE tenant_id = ?').run(tenantId).changes || 0);
    const messages = Number(db.prepare('DELETE FROM messages WHERE tenant_id = ?').run(tenantId).changes || 0);
    return { messages, escalations };
  });

  dao.purgeExpiredData = ({ days = 365 } = {}) => {
    const safeDays = Math.max(0, Number(days) || 0);
    const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
    return transaction(db, () => {
      const messages = Number(db.prepare('DELETE FROM messages WHERE created_at < ?').run(cutoff).changes || 0);
      const escalations = Number(db.prepare('DELETE FROM escalations WHERE created_at < ?').run(cutoff).changes || 0);
      const events = Number(db.prepare("DELETE FROM events WHERE created_at < ? AND type <> 'privacy_consent'").run(cutoff).changes || 0);
      return { cutoff, messages, escalations, events };
    });
  };

  return dao;
}
