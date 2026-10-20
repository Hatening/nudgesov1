-- KB-INGEST-001: multi-tenant metadata + provenance for global knowledge.
--
-- `knowledge.tenant_id` already exists (nullable) from 001_init. SQLite cannot
-- alter its default in place, so:
--   1. create the reserved `global` tenant row used by shared knowledge,
--   2. backfill existing NULL rows to `global`,
--   3. add a trigger so future NULL inserts also land in `global`.
--
-- New columns are additive and have defaults, so existing callers keep working.

INSERT OR IGNORE INTO tenants (id, name, plan, status, created_at)
VALUES ('global', 'Global Knowledge', 'internal', 'active', datetime('now'));

ALTER TABLE knowledge ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'low'
  CHECK (sensitivity IN ('low', 'medium', 'high', 'restricted'));

ALTER TABLE knowledge ADD COLUMN freshness TEXT NOT NULL DEFAULT 'static'
  CHECK (freshness IN ('static', 'realtime', 'volatile'));

ALTER TABLE knowledge ADD COLUMN source_type TEXT NOT NULL DEFAULT 'unknown'
  CHECK (source_type IN ('unknown', 'wixqa', 'ecommerce_ai_skills', 'public_web', 'tenant', 'insight'));

ALTER TABLE knowledge ADD COLUMN source_id TEXT;

ALTER TABLE knowledge ADD COLUMN source_url TEXT;

ALTER TABLE knowledge ADD COLUMN review_status TEXT NOT NULL DEFAULT 'candidate'
  CHECK (review_status IN ('candidate', 'needs_human_review', 'approved', 'quarantined'));

ALTER TABLE knowledge ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';

UPDATE knowledge SET tenant_id = 'global' WHERE tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_global_meta
  ON knowledge(tenant_id, audience, sensitivity, freshness);

CREATE TRIGGER IF NOT EXISTS trg_knowledge_global_tenant
AFTER INSERT ON knowledge
WHEN NEW.tenant_id IS NULL
BEGIN
  UPDATE knowledge SET tenant_id = 'global' WHERE id = NEW.id;
END;
