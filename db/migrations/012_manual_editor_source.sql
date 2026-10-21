-- 012_manual_editor_source.sql
-- 内置“人工编辑”来源：作为后台手工写入的登记来源（不是外部内容许可）。
-- 关键限制：
--   - rights_status = ALLOW_WITH_LIMITS（仅允许站内人工录入与加工）
--   - embed_allowed = 0（默认不进向量库）
--   - 所有经此来源写入的卡片默认 status='draft'，确认需要人工改状态
INSERT OR IGNORE INTO source_registry (
  id, canonical_url, domain, publisher, source_type, access_method, license_name,
  rights_status, store_fulltext_allowed, transform_allowed, model_inference_allowed,
  display_quote_allowed, embed_allowed, attribution_required, notes, created_at, updated_at
) VALUES (
  'manual_editor', 'https://relaydesk.local/manual', 'relaydesk.local', 'RelayDesk operator',
  'internal_manual', 'manual', 'internal operator entry (not externally verified)',
  'ALLOW_WITH_LIMITS', 1, 1, 1, 1, 0, 0,
  'Built-in source for authenticated admin manual entries. Writes default to draft; embedding is disabled.',
  datetime('now'), datetime('now')
);
