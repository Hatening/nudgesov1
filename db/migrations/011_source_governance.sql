-- 011_source_governance.sql
-- Phase 1 地基：来源账本 / 主张证据 / 人工审核队列 / 导入批次。
-- 设计依据：docs/specs/global-seller-ops-knowledge-pipeline-spec.md（第 98-141、305-333 行）
--
-- 关键原则：
--   1) 权限默认拒绝：rights_status 默认 REVIEW_REQUIRED，所有 *_allowed 默认 0。
--   2) 许可范围细分为独立布尔位，不用单一 is_legal。
--   3) claims 必须能回溯到 source_registry 的具体来源。

CREATE TABLE IF NOT EXISTS source_registry (
  id                       TEXT PRIMARY KEY,
  canonical_url            TEXT NOT NULL,
  domain                   TEXT NOT NULL,
  publisher                TEXT NOT NULL,
  source_type              TEXT NOT NULL,
  platform                 TEXT,
  market_scope             TEXT,
  language                 TEXT,
  access_method            TEXT NOT NULL DEFAULT 'other'
                             CHECK (access_method IN ('manual','official_api','authorized_export','rss','licensed_feed','permissioned_crawler','other')),
  terms_url                TEXT,
  license_name             TEXT,
  license_evidence_url     TEXT,
  -- 许可状态机：默认最保守
  rights_status            TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED'
                             CHECK (rights_status IN ('ALLOW','ALLOW_WITH_LIMITS','METADATA_ONLY','BLOCK','REVIEW_REQUIRED')),
  -- 细分权限位（默认全部 0 = 拒绝）
  fetch_allowed            INTEGER NOT NULL DEFAULT 0 CHECK (fetch_allowed IN (0,1)),
  store_fulltext_allowed   INTEGER NOT NULL DEFAULT 0 CHECK (store_fulltext_allowed IN (0,1)),
  store_raw_file_allowed   INTEGER NOT NULL DEFAULT 0 CHECK (store_raw_file_allowed IN (0,1)),
  transform_allowed        INTEGER NOT NULL DEFAULT 0 CHECK (transform_allowed IN (0,1)),
  embed_allowed            INTEGER NOT NULL DEFAULT 0 CHECK (embed_allowed IN (0,1)),
  model_inference_allowed  INTEGER NOT NULL DEFAULT 0 CHECK (model_inference_allowed IN (0,1)),
  model_training_allowed   INTEGER NOT NULL DEFAULT 0 CHECK (model_training_allowed IN (0,1)),
  display_quote_allowed    INTEGER NOT NULL DEFAULT 0 CHECK (display_quote_allowed IN (0,1)),
  commercial_use_allowed   INTEGER NOT NULL DEFAULT 0 CHECK (commercial_use_allowed IN (0,1)),
  redistribution_allowed   INTEGER NOT NULL DEFAULT 0 CHECK (redistribution_allowed IN (0,1)),
  attribution_required     INTEGER NOT NULL DEFAULT 1 CHECK (attribution_required IN (0,1)),
  share_alike_required     INTEGER NOT NULL DEFAULT 0 CHECK (share_alike_required IN (0,1)),
  no_derivatives_restriction INTEGER NOT NULL DEFAULT 0 CHECK (no_derivatives_restriction IN (0,1)),
  noncommercial_restriction  INTEGER NOT NULL DEFAULT 0 CHECK (noncommercial_restriction IN (0,1)),
  retention_rule           TEXT,
  reviewed_by              TEXT,
  reviewed_at              TEXT,
  review_due_at            TEXT,
  robots_observed          TEXT,
  notes                    TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT
);
CREATE INDEX IF NOT EXISTS idx_source_registry_status ON source_registry(rights_status);
CREATE INDEX IF NOT EXISTS idx_source_registry_domain ON source_registry(domain);

CREATE TABLE IF NOT EXISTS claims (
  id                 TEXT PRIMARY KEY,
  claim_text         TEXT NOT NULL,
  claim_type         TEXT NOT NULL DEFAULT 'fact',
  source_id          TEXT NOT NULL REFERENCES source_registry(id) ON DELETE RESTRICT,
  raw_asset_id       TEXT,
  knowledge_id       TEXT,
  evidence_locator   TEXT,
  evidence_quote     TEXT,
  published_at       TEXT,
  effective_from     TEXT,
  effective_until    TEXT,
  checked_at         TEXT,
  scope_json         TEXT NOT NULL DEFAULT '{}',
  evidence_strength  TEXT,
  confidence         REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  limitations        TEXT,
  review_status      TEXT NOT NULL DEFAULT 'candidate'
                       CHECK (review_status IN ('candidate','approved','rejected','needs_review')),
  created_by_model   TEXT,
  model_version      TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_claims_source ON claims(source_id);
CREATE INDEX IF NOT EXISTS idx_claims_knowledge ON claims(knowledge_id);
CREATE INDEX IF NOT EXISTS idx_claims_review ON claims(review_status);

CREATE TABLE IF NOT EXISTS review_queue (
  id             TEXT PRIMARY KEY,
  item_type      TEXT NOT NULL CHECK (item_type IN ('source','claim','knowledge','import_batch')),
  item_id        TEXT NOT NULL,
  reason         TEXT NOT NULL,
  priority       INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','rejected')),
  assigned_to    TEXT,
  policy_version TEXT,
  created_at     TEXT NOT NULL,
  resolved_at    TEXT,
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status, priority);
CREATE INDEX IF NOT EXISTS idx_review_queue_item ON review_queue(item_type, item_id);

CREATE TABLE IF NOT EXISTS import_batches (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  source_id               TEXT REFERENCES source_registry(id) ON DELETE SET NULL,
  knowledge_count         INTEGER NOT NULL DEFAULT 0 CHECK (knowledge_count >= 0),
  status                  TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','importing','completed','failed','blocked')),
  policy_snapshot_version TEXT,
  started_at              TEXT,
  completed_at            TEXT,
  summary_json            TEXT NOT NULL DEFAULT '{}',
  created_at              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status);
