#!/usr/bin/env node
/**
 * KB-QUALITY-001 / 交付汇总：把各类报告拼成 DELIVERY.md + delivery.json
 *
 * 用法：node scripts/kb-quality/report.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.resolve(ROOT, 'reports/kb-quality-001');
const read = (name, fallback = null) => {
  const file = path.join(OUT, name);
  if (!fs.existsSync(file)) return fallback;
  return file.endsWith('.json') ? JSON.parse(fs.readFileSync(file, 'utf8')) : fs.readFileSync(file, 'utf8');
};

const manifest = read('manifest.sha256.json', { files: [] });
const wix = read('wixqa-quality.json', {});
const bitext = read('bitext-quality.json', {});
const license = read('license-review.json', { datasets: [] });
const taxonomy = read('taxonomy-mapping.json', {});
const pilot = read('pilot-run.json', {});
const evaluation = read('evaluation.json', { metrics: {}, distributions: {} });
const commands = read('commands.json', { runs: [] });

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : n);
const line = (k, v) => `| ${k} | ${v} |`;

const md = [];
md.push('# KB-QUALITY-001 · 交付报告');
md.push('');
md.push(`生成时间：${new Date().toISOString()}`);
md.push('');
md.push('## 1. 执行命令与退出码');
md.push('');
md.push('| 步骤 | 命令 | 退出码 |');
md.push('|---|---|---|');
for (const run of commands.runs || []) md.push(`| ${run.step} | \`${run.command}\` | ${run.exit} |`);
md.push('');
md.push('## 2. 数据指纹（SHA-256）');
md.push('');
md.push('| 文件 | 字节 | SHA-256 | 来源 | 许可证 |');
md.push('|---|---|---|---|---|');
for (const f of manifest.files || []) {
  md.push(`| ${f.key} | ${fmt(f.bytes)} | \`${String(f.sha256 || '').slice(0, 16)}…\` | ${f.source_url || ''} | ${f.license || ''} |`);
}
md.push('');
md.push('## 3. WixQA 质量');
md.push('');
md.push(`- 文章：${fmt(wix.articles?.rows)} 条；空正文 ${wix.articles?.empty_contents}；空标题 ${wix.articles?.empty_titles}；重复正文 ${wix.articles?.duplicate_contents}`);
md.push(`- 类型分布：${JSON.stringify(wix.articles?.article_type || {})}`);
md.push(`- 语言分布：${JSON.stringify(wix.articles?.language || {})}`);
md.push(`- 长度：median ${wix.articles?.length_median} / p95 ${wix.articles?.length_p95} / max ${wix.articles?.length_max}`);
md.push('');
md.push('| 问答集 | 行数 | 缺 article_ids | 无法解析引用 | 重复问题 |');
md.push('|---|---|---|---|---|');
for (const q of wix.qa || []) md.push(`| ${q.config} | ${q.rows} | ${q.missing_article_ids} | ${q.unresolved_article_refs} | ${q.duplicate_questions} |`);
md.push('');
md.push('## 4. Bitext 质量');
md.push('');
md.push(`- 行数：${fmt(bitext.rows)}；列：${(bitext.columns || []).join(', ')}`);
md.push(`- 重复：instruction ${bitext.duplicates?.instruction} / response ${bitext.duplicates?.response} / pair ${bitext.duplicates?.pair}`);
md.push(`- 类别 ${Object.keys(bitext.categories || {}).length} 个；意图 ${Object.keys(bitext.intents || {}).length} 个`);
md.push(`- 异常：非 ASCII ${bitext.anomalies?.non_ascii_instruction} / 控制字符 ${bitext.anomalies?.control_chars}`);
md.push('');
md.push('## 5. 许可证');
md.push('');
md.push('| 数据集 | 声明许可 | 商业使用 | 状态 |');
md.push('|---|---|---|---|');
for (const d of license.datasets || []) md.push(`| ${d.dataset} | ${d.declared_license} | ${d.commercial_use} | ${d.status} |`);
md.push('');
md.push('## 6. 分类映射');
md.push('');
md.push(`- audience 枚举：${Object.keys(taxonomy.audiences || {}).join(' / ')}`);
md.push(`- 样本状态：${Object.keys(taxonomy.sample_states || {}).join(' / ')}`);
md.push(`- 数据集状态：${JSON.stringify(taxonomy.dataset_states || {})}`);
md.push('');
md.push('## 7. 小批量蒸馏（100 篇）');
md.push('');
md.push(`- 抽样文章：${pilot.articles_sampled}；出卡文章：${pilot.articles_with_cards}；失败：${pilot.failed_articles}`);
md.push(`- 卡片：${pilot.cards}（approved ${pilot.approved_cards} / needs_review ${pilot.needs_review_cards}）`);
md.push(`- 状态分布：${JSON.stringify(pilot.states || {})}`);
md.push(`- 提供方：${JSON.stringify(pilot.providers || {})}`);
md.push(`- 预算：${JSON.stringify(pilot.budget || {})}（上限 ${JSON.stringify(pilot.budget_limits || {})}）`);
md.push('');
md.push('## 8. 质量评估');
md.push('');
md.push('| 指标 | 值 |');
md.push('|---|---|');
for (const [k, v] of Object.entries(evaluation.metrics || {})) md.push(line(k, `${v}%`));
md.push('');
md.push(`- knowledge_type 分布：${JSON.stringify(evaluation.distributions?.knowledge_type || {})}`);
md.push(`- audience 分布：${JSON.stringify(evaluation.distributions?.audience || {})}`);
md.push('');
md.push('## 9. 失败样例与人工复核建议');
md.push('');
const failures = evaluation.failures || [];
if (failures.length) {
  for (const f of failures.slice(0, 10)) md.push(`- ${f.source_id}: ${f.title}（${f.type}）`);
} else {
  md.push('- 无整篇失败；部分卡片因证据不足进入 needs_review。');
}
md.push(`- needs_review 卡片：${(evaluation.needs_review || []).length} 张，需人工逐条核对证据。`);
md.push('- 建议：先人工抽检 needs_review + 数字校验失败的卡片，再决定是否进入 platform_support 检索池。');
md.push('');
md.push('## 10. 待人工确认');
md.push('');
md.push('- Bitext 的 CDLA-Sharing-1.0 商业使用与再分发义务需法务确认（LICENSE_HOLD，未发送云端审核）。');
md.push('- WixQA 内容来自 Wix Help Center，对外展示需署名并避免暗示官方背书。');
md.push('- 本批卡片尚未写入任何线上知识库，也未启动全量蒸馏。');
md.push('');

const file = path.join(OUT, 'DELIVERY.md');
fs.writeFileSync(file, md.join('\n'));

const delivery = {
  task: 'KB-QUALITY-001',
  generated_at: new Date().toISOString(),
  commands,
  files: (manifest.files || []).map((f) => ({ key: f.key, bytes: f.bytes, sha256: f.sha256, license: f.license })),
  wixqa: { articles: wix.articles?.rows, qa: wix.qa },
  bitext: { rows: bitext.rows, duplicates: bitext.duplicates },
  license: license.datasets,
  pilot,
  evaluation: { metrics: evaluation.metrics, distributions: evaluation.distributions, failures: evaluation.failures },
  status: 'awaiting_human_review',
};
fs.writeFileSync(path.join(OUT, 'delivery.json'), JSON.stringify(delivery, null, 2));

console.log(`[delivery] ${file}`);
