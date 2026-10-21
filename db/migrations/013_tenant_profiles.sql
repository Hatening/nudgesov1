-- 013_tenant_profiles.sql
-- 商家经营档案（AI 军师上下文）：每个租户一行。
CREATE TABLE IF NOT EXISTS tenant_profiles (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  business_name     TEXT,
  platforms_json    TEXT NOT NULL DEFAULT '[]',
  markets_json      TEXT NOT NULL DEFAULT '[]',
  categories        TEXT,
  monthly_revenue   TEXT,
  team_size         INTEGER,
  goals             TEXT,
  ai_summary        TEXT,
  ai_actions_json   TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  updated_at        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_profiles_tenant ON tenant_profiles(tenant_id);
