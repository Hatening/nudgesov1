-- 004_knowledge_category.sql
-- 为知识卡补上分类字段，供 /api/insights（行业洞察 / 商业策略）等内容页筛选。
ALTER TABLE knowledge ADD COLUMN category TEXT NOT NULL DEFAULT '其他';

CREATE INDEX IF NOT EXISTS idx_knowledge_audience_category ON knowledge(audience, category);
