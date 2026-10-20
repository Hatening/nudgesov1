import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { openDatabase, migrateSchema, tableCount } from '../src/db.js';
import { hashToken, tokenPrefix } from '../src/core.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const sourcePath = path.resolve(option('--source', process.env.JSON_PATH || path.join(process.cwd(), '.data', 'store.json')));
const dbPath = path.resolve(option('--db', process.env.DB_PATH || path.join(process.cwd(), '.data', 'relaydesk.sqlite')));
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

if (!fs.existsSync(sourcePath)) {
  console.error(`JSON source not found: ${sourcePath}`);
  process.exit(1);
}

const raw = fs.readFileSync(sourcePath, 'utf8');
let store;
try {
  store = JSON.parse(raw);
} catch (error) {
  console.error(`Invalid JSON source: ${error.message}`);
  process.exit(1);
}
if (!store || typeof store !== 'object') {
  console.error('JSON source must be an object.');
  process.exit(1);
}

const sourceHash = crypto.createHash('sha256').update(raw).digest('hex');
const migrationKey = `json_import_${sourceHash.slice(0, 16)}`;
const sourceCounts = {
  tenants: (store.tenants || []).length,
  users: (store.users || []).length,
  sessions: (store.sessions || []).length,
  sites: (store.sites || []).length,
  knowledge: (store.knowledge || []).length + (store.sites || []).reduce((sum, site) => sum + (site.knowledge || []).length, 0),
  conversations: (store.conversations || []).length,
  messages: (store.publicMessages || []).length + (store.conversations || []).reduce((sum, conversation) => sum + (conversation.messages || []).length, 0),
  escalations: (store.escalations || []).length,
  glossary: (store.glossary || []).length,
  events: (store.events || []).length,
  testRuns: (store.testRuns || []).length
};

console.log(JSON.stringify({ source: sourcePath, db: dbPath, migrationKey, dryRun, sourceCounts }, null, 2));
if (dryRun) process.exit(0);

const backupPath = `${sourcePath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
fs.copyFileSync(sourcePath, backupPath);
console.log(`backup=${backupPath}`);

const db = openDatabase(dbPath);
migrateSchema(db);

const alreadyImported = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migrationKey);
const existingRows = tableCount(db, 'tenants') + tableCount(db, 'users') + tableCount(db, 'knowledge') + tableCount(db, 'conversations');
if (existingRows > 0 && !alreadyImported && !force) {
  console.error('Database already contains data and this JSON source has not been imported. Re-run with --force only if you are sure.');
  db.close();
  process.exit(1);
}

const json = (value) => JSON.stringify(value ?? null);
const iso = (value) => value || new Date().toISOString();

try {
  db.exec('BEGIN IMMEDIATE');

  const insertTenant = db.prepare('INSERT OR IGNORE INTO tenants (id, name, plan, status, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const tenant of store.tenants || []) {
    insertTenant.run(tenant.id, tenant.name || 'Unnamed tenant', tenant.plan || 'free', tenant.status || 'active', iso(tenant.created_at));
  }

  const insertUser = db.prepare(`INSERT OR IGNORE INTO users
    (id, tenant_id, email, password_salt, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const user of store.users || []) {
    insertUser.run(user.id, user.tenant_id, String(user.email || '').toLowerCase(), user.password_salt || '', user.password_hash || '', user.role || 'owner', user.status || 'active', iso(user.created_at), user.updated_at || null);
  }

  const insertSession = db.prepare(`INSERT OR IGNORE INTO sessions
    (token_hash, token_prefix, user_id, tenant_id, created_at, expires_at, revoked_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`);
  for (const session of store.sessions || []) {
    if (!session.token || !session.user_id || !session.tenant_id) continue;
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    insertSession.run(hashToken(session.token), tokenPrefix(session.token), session.user_id, session.tenant_id, iso(session.created_at), expiresAt);
  }

  const insertSite = db.prepare(`INSERT OR IGNORE INTO sites
    (id, tenant_id, name, industry_template, industry_template_name, embed_key, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertKnowledge = db.prepare(`INSERT OR IGNORE INTO knowledge
    (id, tenant_id, site_id, scope, filename, title, type, language, tags_json, content, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const knowledge of store.knowledge || []) {
    insertKnowledge.run(knowledge.id, null, null, 'global', null, knowledge.title || 'Knowledge', knowledge.type || 'article', knowledge.language || 'en', json(knowledge.tags || []), knowledge.content || '', knowledge.status || 'confirmed', iso(knowledge.createdAt || knowledge.created_at), iso(knowledge.updatedAt || knowledge.updated_at));
  }
  for (const site of store.sites || []) {
    insertSite.run(site.id, site.tenant_id, site.name || 'Unnamed site', site.industry_template || 'restaurant', site.industry_template_name || '', site.embed_key, site.status || 'active', iso(site.created_at), site.updated_at || null);
    for (const doc of site.knowledge || []) {
      insertKnowledge.run(doc.id, site.tenant_id, site.id, 'site', doc.filename || null, doc.title || 'Knowledge', doc.type || 'article', doc.language || 'zh', json(doc.tags || []), doc.content || '', doc.status || 'draft', iso(doc.created_at), iso(doc.updated_at));
    }
  }

  const insertConversation = db.prepare(`INSERT OR IGNORE INTO conversations
    (id, tenant_id, customer, channel, language, intent, status, last_message, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertLegacyMessage = db.prepare(`INSERT OR IGNORE INTO messages
    (id, tenant_id, site_id, conversation_id, embed_key, source, role, input_type, message, language, created_at)
    VALUES (?, ?, NULL, ?, NULL, 'legacy', ?, 'text', ?, ?, ?)`);
  for (const conversation of store.conversations || []) {
    insertConversation.run(conversation.id, conversation.tenant_id || null, conversation.customer || 'Customer', conversation.channel || 'Website', conversation.language || 'en', conversation.intent || 'General question', conversation.status || 'open', conversation.lastMessage || '', iso(conversation.updatedAt || conversation.updated_at || conversation.created_at), iso(conversation.created_at));
    (conversation.messages || []).forEach((message, index) => {
      insertLegacyMessage.run(`msg_${conversation.id}_${index}`, conversation.tenant_id || null, conversation.id, message.role || 'customer', message.text || '', conversation.language || 'en', iso(message.at));
    });
  }

  const insertPublicMessage = db.prepare(`INSERT OR IGNORE INTO messages
    (id, tenant_id, site_id, conversation_id, embed_key, source, role, input_type, message, transcript,
     reply_json, evidence_json, language, intent, risk, needs_human, audio_filename, audio_size_bytes, created_at)
    VALUES (?, ?, ?, NULL, ?, 'public', 'customer', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const publicById = new Map();
  for (const message of store.publicMessages || []) {
    publicById.set(message.id, message);
    insertPublicMessage.run(message.id, message.tenant_id || null, message.site_id || null, message.embed_key || null, message.input_type || 'text', message.message || '', message.transcript || null, json(message.reply || {}), json(message.evidence || []), message.language || null, message.intent || null, message.risk || null, message.reply?.need_human ? 1 : 0, message.audio_filename || null, Number(message.audio_size_bytes || 0) || null, iso(message.created_at || message.createdAt));
  }

  const insertEscalation = db.prepare(`INSERT OR IGNORE INTO escalations
    (id, tenant_id, site_id, message_id, message, input_type, language, intent, risk, status, assigned_to, created_at, updated_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const escalation of store.escalations || []) {
    const sourceMessage = publicById.get(escalation.message_id);
    insertEscalation.run(escalation.id, escalation.tenant_id, escalation.site_id, escalation.message_id || null, escalation.message || sourceMessage?.message || null, escalation.input_type || sourceMessage?.input_type || null, escalation.language || sourceMessage?.language || null, escalation.intent || null, escalation.risk || 'high', escalation.status || 'pending', escalation.assigned_to || null, iso(escalation.created_at), iso(escalation.updated_at || escalation.created_at), escalation.resolved_at || null);
  }

  db.prepare(`INSERT INTO settings (key, value_json) VALUES ('app', ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`).run(json(store.settings || {}));

  const insertGlossary = db.prepare(`INSERT OR IGNORE INTO glossary
    (id, source, preferred_json, forbidden_json, notes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const item of store.glossary || []) {
    insertGlossary.run(item.id, item.source, json(item.preferred || {}), json(item.forbidden || []), item.notes || '', iso(item.created_at), iso(item.updated_at || item.created_at));
  }

  const insertEvent = db.prepare('INSERT OR IGNORE INTO events (id, type, data_json, created_at) VALUES (?, ?, ?, ?)');
  for (const event of store.events || []) {
    const { id: eventId, type, at, ...data } = event;
    insertEvent.run(eventId, type, json(data), iso(at));
  }

  const insertTestRun = db.prepare('INSERT OR IGNORE INTO test_runs (id, created_at, total, passed, results_json) VALUES (?, ?, ?, ?, ?)');
  for (const run of store.testRuns || []) {
    insertTestRun.run(run.id, iso(run.at || run.created_at), Number(run.total || 0), Number(run.passed || 0), json(run.results || []));
  }

  const actualCounts = {
    tenants: tableCount(db, 'tenants'),
    users: tableCount(db, 'users'),
    sessions: tableCount(db, 'sessions'),
    sites: tableCount(db, 'sites'),
    knowledge: tableCount(db, 'knowledge'),
    conversations: tableCount(db, 'conversations'),
    messages: tableCount(db, 'messages'),
    escalations: tableCount(db, 'escalations'),
    glossary: tableCount(db, 'glossary'),
    events: tableCount(db, 'events'),
    testRuns: tableCount(db, 'test_runs')
  };
  const expected = {
    ...sourceCounts,
    knowledge: sourceCounts.knowledge,
    messages: sourceCounts.messages
  };
  const mismatches = Object.entries(expected).filter(([key, count]) => Number(actualCounts[key]) !== Number(count));
  if (mismatches.length) {
    throw new Error(`Migration count mismatch: ${mismatches.map(([key, count]) => `${key} expected ${count}, got ${actualCounts[key]}`).join('; ')}`);
  }

  db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migrationKey, new Date().toISOString());
  db.exec('COMMIT');
  console.log('MIGRATION_OK');
  console.log(JSON.stringify({ db: dbPath, backup: backupPath, actualCounts }, null, 2));
} catch (error) {
  try { db.exec('ROLLBACK'); } catch {}
  console.error(`MIGRATION_FAILED: ${error.message}`);
  db.close();
  process.exit(1);
}

db.close();
