-- 010_knowledge_semantic_fields.sql
-- 知识表结构升级：产品面、语言/地区、许可状态、有效期、结构化语义载荷。
--
-- product_surface：这条知识服务于哪个产品面（buyer_chat / seller_console /
--                  platform_support / internal / general）。
-- license_status ：clear / conditional / hold；hold 永不参与检索。
-- valid_from/until：可空；检索时按当前时间过滤。
-- structured_payload：由 retrofit 脚本回刷的 JSON（适用情境/诊断条件/例外风险）。

ALTER TABLE knowledge ADD COLUMN product_surface TEXT NOT NULL DEFAULT 'general';
ALTER TABLE knowledge ADD COLUMN locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE knowledge ADD COLUMN license_status TEXT NOT NULL DEFAULT 'clear';
ALTER TABLE knowledge ADD COLUMN valid_from TEXT;
ALTER TABLE knowledge ADD COLUMN valid_until TEXT;
ALTER TABLE knowledge ADD COLUMN structured_payload TEXT NOT NULL DEFAULT '{}';

-- 回填 locale
UPDATE knowledge SET locale = COALESCE(NULLIF(language, ''), 'en');

-- 回填 license_status（与既有 review_status 对齐）
UPDATE knowledge SET license_status = CASE
  WHEN review_status = 'license_hold' THEN 'hold'
  WHEN review_status = 'needs_manual_audit' THEN 'conditional'
  WHEN review_status IN ('approved', 'cloud-rescued', 'candidate') THEN 'clear'
  ELSE 'unknown'
END;

-- 回填 product_surface
UPDATE knowledge SET product_surface = CASE
  WHEN scope = 'site' THEN 'buyer_chat'
  WHEN audience = 'seller' THEN 'seller_console'
  WHEN audience = 'platform_support' THEN 'platform_support'
  WHEN audience = 'internal_eval' THEN 'internal'
  ELSE 'buyer_chat'
END;

CREATE INDEX IF NOT EXISTS idx_knowledge_surface ON knowledge(product_surface, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_license ON knowledge(license_status);
CREATE INDEX IF NOT EXISTS idx_knowledge_validity ON knowledge(valid_until);
