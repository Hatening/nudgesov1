-- 005_is_insight.sql
-- 运营类 seller 内容自动成为「可公开的内容营销素材」：
-- 由分类推导 is_insight，/api/insights 只筛 is_insight = 1，避免人工改分类。
ALTER TABLE knowledge ADD COLUMN is_insight INTEGER NOT NULL DEFAULT 0;

UPDATE knowledge
SET is_insight = 1
WHERE audience = 'seller'
  AND category IN (
    '行业洞察', '商业策略',
    '广告与营销', '物流与配送', '退货与退款', '支付与结算',
    '商品与尺码', '平台规则', '投诉与纠纷'
  );

CREATE INDEX IF NOT EXISTS idx_knowledge_insight ON knowledge(is_insight, audience, created_at);
