// scripts/seed-insights-demo.mjs — 往本地开发库塞几条「行业洞察 / 商业策略」示例卡，
// 仅用于 /insights 页面联调与截图；生产环境请用蒸馏脚本导入真实内容。
//
// 用法：node scripts/seed-insights-demo.mjs [--db .data/relaydesk.sqlite]
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const dbArg = argv.indexOf('--db') > -1 ? argv[argv.indexOf('--db') + 1] : '.data/relaydesk.sqlite';
const dbPath = path.isAbsolute(dbArg) ? dbArg : path.resolve(ROOT, dbArg);

const now = new Date().toISOString();
const items = [
  {
    title: '2026 跨境电商广告成本走势：ACOS 中位数上升 18% 后怎么打',
    category: '行业洞察',
    tags: ['广告成本', 'ACOS', '行业数据'],
    content: '过去四个季度，北美站点的平均 ACOS 从 21% 升至 24.8%，主要受流量竞价与节假日投放挤兑影响。建议把预算拆成「防守型」与「测试型」两条线，防守线锁定品牌词与高转化长尾，测试线不超过总预算的 15%，并用周维度的搜索词报告清理零订单花费。',
  },
  {
    title: '平台规则变化：欧盟 GPSR 生效后，listing 合规字段怎么补',
    category: '行业洞察',
    tags: ['合规', '欧盟', 'GPSR'],
    content: 'GPSR 要求所有面向欧盟消费者的商品提供负责人信息与安全警示。跨境卖家需要在 listing 属性中补齐制造商/进口商信息，并在产品页展示可追溯的批次信息。未补齐的商品在部分类目会被下架，建议在 30 天内完成存量商品盘点。',
  },
  {
    title: '从铺货到精品：中小卖家供应链策略的三个拐点',
    category: '商业策略',
    tags: ['选品', '供应链', '精品模式'],
    content: '拐点一：单 SKU 月销稳定超过 300 单，此时锁定期货比空运更划算；拐点二：退货率超过 8%，说明产品描述与实物偏差，需要回头修 listing 而不是继续投流；拐点三：出现第二个爆款苗头时，优先复制供应链而不是复制广告，否则现金流会被库存吃空。',
  },
  {
    title: '内容电商转化模型：短视频引流到独立站的 4 个断点',
    category: '商业策略',
    tags: ['内容电商', '独立站', '转化率'],
    content: '断点一：内容与落地页卖点不一致，跳出率翻倍；断点二：移动端首屏加载超过 3 秒，转化率下降 20%；断点三：缺少社会证明（评价/销量），新客信任不足；断点四：支付方式单一，欧洲市场需补齐 Klarna 与 iDEAL。逐个修复后，同预算下的 ROAS 通常能提升 30%-50%。',
  },
];

const db = new DatabaseSync(dbPath);
let inserted = 0;
for (const [index, item] of items.entries()) {
  const id = `kb_insight_demo_${index + 1}`;
  const exists = db.prepare('SELECT id FROM knowledge WHERE id = ?').get(id);
  if (exists) continue;
  db.prepare(`INSERT INTO knowledge
    (id, tenant_id, site_id, scope, filename, title, type, language, tags_json, content, status, audience, category, created_at, updated_at)
    VALUES (?, NULL, NULL, 'global', NULL, ?, 'article', 'zh', ?, ?, 'confirmed', 'seller', ?, ?, ?)`)
    .run(id, item.title, JSON.stringify(item.tags), item.content, item.category, now, now);
  inserted += 1;
}
console.log(`seeded ${inserted} insight demo card(s) into ${path.relative(ROOT, dbPath)}`);
