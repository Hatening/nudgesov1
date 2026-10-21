-- 014_tenant_usage.sql
-- 商业计费：Credit 用量账本 + 租户月度配额。
CREATE TABLE IF NOT EXISTS tenant_usage (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action_type      TEXT NOT NULL CHECK (action_type IN ('text_extract','cloud_distill','ocr_page')),
  credits_consumed INTEGER NOT NULL CHECK (credits_consumed >= 0),
  metadata_json    TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant ON tenant_usage(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tenant_usage_action ON tenant_usage(tenant_id, action_type);

ALTER TABLE tenant_profiles ADD COLUMN monthly_credits INTEGER NOT NULL DEFAULT 100;
ALTER TABLE tenant_profiles ADD COLUMN used_credits INTEGER NOT NULL DEFAULT 0;
