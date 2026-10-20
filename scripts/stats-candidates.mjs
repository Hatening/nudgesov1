// scripts/stats-candidates.mjs — 知识卡质量统计，输出控制台摘要 + Markdown 报告
//
// 用法：
//   node scripts/stats-candidates.mjs raw_data/candidates.merged.jsonl
//   node scripts/stats-candidates.mjs raw_data/candidates.skills.jsonl raw_data/candidates.bitext.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const CATEGORIES = new Set([
  '物流与配送', '退货与退款', '商品与尺码', '支付与结算',
  '账号与安全', '广告与营销', '投诉与纠纷', '平台规则', '其他',
  '行业洞察', '商业策略',
]);

const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!files.length) {
  console.error('usage: node scripts/stats-candidates.mjs <file.jsonl> [...]');
  process.exit(2);
}

const load = (rel) => {
  const full = path.resolve(ROOT, rel);
  if (!fs.existsSync(full)) return null;
  const lines = fs.readFileSync(full, 'utf8').split('\n').filter((l) => l.trim());
  const rows = [];
  let invalid = 0;
  for (const line of lines) {
    try { rows.push(JSON.parse(line)); } catch { invalid += 1; }
  }
  return { rel, rows, invalid };
};

const norm = (q) => String(q).toLowerCase().replace(/[？?！!。.\s"'“”‘’()（）【】[\]]+/g, '');
const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
const top = (map, n = 12) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);

const datasets = files.map(load).filter(Boolean);
const allRows = [];
for (const ds of datasets) for (const row of ds.rows) allRows.push({ ...row, __file: ds.rel });

const byAudience = {};
const byCategory = {};
const bySource = {};
const tags = {};
let badCategory = 0;
let badSource = 0;
let emptyTags = 0;

for (const row of allRows) {
  const audience = row.audience === 'seller' ? 'seller' : 'buyer';
  byAudience[audience] = (byAudience[audience] || 0) + 1;
  byCategory[row.category || '(none)'] = (byCategory[row.category || '(none)'] || 0) + 1;
  if (!CATEGORIES.has(row.category)) badCategory += 1;
  const src = String(row.source || '');
  bySource[src.split('/').slice(-2).join('/')] = (bySource[src.split('/').slice(-2).join('/')] || 0) + 1;
  if (src.includes('\\')) badSource += 1;
  if (!Array.isArray(row.tags) || row.tags.length === 0) emptyTags += 1;
  for (const t of row.tags || []) tags[t] = (tags[t] || 0) + 1;
}

const seen = new Set();
let dup = 0;
for (const row of allRows) {
  const key = norm(row.question);
  if (seen.has(key)) dup += 1;
  else seen.add(key);
}

const lines = [];
lines.push('# 知识卡质量报告');
lines.push('');
lines.push(`生成时间：${new Date().toISOString()}`);
lines.push('');
lines.push('## 总览');
lines.push('');
lines.push('| 数据集 | 卡片数 | JSON 解析失败 |');
lines.push('|---|---|---|');
for (const ds of datasets) {
  lines.push(`| \`${ds.rel}\` | ${ds.rows.length} | ${ds.invalid} |`);
}
lines.push(`| **合计** | **${allRows.length}** | ${datasets.reduce((a, d) => a + d.invalid, 0)} |`);
lines.push('');
lines.push('## 质量指标');
lines.push('');
lines.push('| 指标 | 值 |');
lines.push('|---|---|');
lines.push(`| 受众分布 | buyer ${byAudience.buyer || 0} / seller ${byAudience.seller || 0} |`);
lines.push(`| 重复 question | ${dup} |`);
lines.push(`| 分类不在枚举内 | ${badCategory} |`);
lines.push(`| source 含反斜杠 | ${badSource} |`);
lines.push(`| 无标签卡片 | ${emptyTags} |`);
lines.push(`| 平均 question 长度 | ${avg(allRows.map((r) => String(r.question || '').length))} 字 |`);
lines.push(`| 平均 answer 长度 | ${avg(allRows.map((r) => String(r.answer || '').length))} 字 |`);
lines.push('');
lines.push('## 分类分布');
lines.push('');
lines.push('| 分类 | 卡片数 |');
lines.push('|---|---|');
for (const [k, v] of top(byCategory, 20)) lines.push(`| ${k} | ${v} |`);
lines.push('');
lines.push('## 来源（Top 12）');
lines.push('');
lines.push('| 来源 | 卡片数 |');
lines.push('|---|---|');
for (const [k, v] of top(bySource, 12)) lines.push(`| ${k} | ${v} |`);
lines.push('');
lines.push('## 高频标签（Top 15）');
lines.push('');
lines.push(top(tags, 15).map(([k, v]) => `\`${k}\`(${v})`).join(' · '));
lines.push('');

const outPath = path.join(ROOT, 'raw_data', 'QUALITY-REPORT.md');
fs.writeFileSync(outPath, lines.join('\n'));

console.log(`数据集：${datasets.length} 个，卡片 ${allRows.length} 张（重复 ${dup}，分类越界 ${badCategory}，source 反斜杠 ${badSource}）`);
console.log(`受众：buyer ${byAudience.buyer || 0} / seller ${byAudience.seller || 0}`);
console.log('分类：' + top(byCategory, 8).map(([k, v]) => `${k} ${v}`).join(' · '));
console.log(`报告：${path.relative(ROOT, outPath)}`);
