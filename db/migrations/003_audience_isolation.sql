-- 003_audience_isolation.sql
-- 双引擎知识库：买家侧（buyer）与卖家侧（seller）语料隔离。
-- 历史数据默认 buyer，因为此前知识库只服务买家/客服场景。
ALTER TABLE knowledge ADD COLUMN audience TEXT NOT NULL DEFAULT 'buyer';

CREATE INDEX IF NOT EXISTS idx_knowledge_audience ON knowledge(audience, scope, status);
