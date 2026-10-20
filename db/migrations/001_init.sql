-- RelayDesk SQLite schema v1
-- All identifiers/timestamps are TEXT for API compatibility with the JSON store.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  token_prefix TEXT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  industry_template TEXT NOT NULL,
  industry_template_name TEXT,
  embed_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sites_tenant ON sites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sites_embed ON sites(embed_key);

CREATE TABLE IF NOT EXISTS knowledge (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK(scope IN ('global', 'site')),
  filename TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'article',
  language TEXT NOT NULL DEFAULT 'en',
  tags_json TEXT NOT NULL DEFAULT '[]',
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_knowledge_scope ON knowledge(scope, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_site ON knowledge(site_id, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_tenant ON knowledge(tenant_id, status);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  customer TEXT NOT NULL,
  channel TEXT,
  language TEXT,
  intent TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  last_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id, status);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  embed_key TEXT,
  source TEXT NOT NULL CHECK(source IN ('public', 'legacy')),
  role TEXT,
  input_type TEXT,
  message TEXT,
  transcript TEXT,
  reply_json TEXT,
  evidence_json TEXT,
  language TEXT,
  intent TEXT,
  risk TEXT,
  needs_human INTEGER NOT NULL DEFAULT 0,
  audio_filename TEXT,
  audio_size_bytes INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_site ON messages(site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON messages(tenant_id, created_at);

CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  message TEXT,
  input_type TEXT,
  language TEXT,
  intent TEXT,
  risk TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_review', 'resolved')),
  assigned_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_escalations_tenant ON escalations(tenant_id, status, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS glossary (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  preferred_json TEXT NOT NULL DEFAULT '{}',
  forbidden_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at);

CREATE TABLE IF NOT EXISTS test_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  total INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  results_json TEXT NOT NULL DEFAULT '[]'
);
