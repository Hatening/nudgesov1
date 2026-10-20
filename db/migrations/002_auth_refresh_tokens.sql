ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE sessions ADD COLUMN family_id TEXT;
ALTER TABLE sessions ADD COLUMN replaced_by TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_family ON sessions(family_id);
CREATE INDEX IF NOT EXISTS idx_sessions_kind ON sessions(kind, expires_at);
