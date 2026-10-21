#!/usr/bin/env node
/**
 * 来源合规性门禁（只读盘点）
 *
 * 产出：
 *   source_license_audit.csv            项目根目录，供人工审核
 *   reports/license/license_audit_summary.md  盘点结论与风险提示
 *
 * 约束：只读扫描文件与 SQLite，不修改任何数据，不运行蒸馏。
 *
 * 用法：node scripts/license-audit.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'raw_data');
const LP = 'D:/Documents/AI_Projects/NudgeSo/language_prompt';

const exists = (p) => fs.existsSync(p);
const countFiles = (dir, filter) => {
  if (!exists(dir)) return 0;
  let n = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) { if (entry.name !== '.git') walk(full); }
      else if (!filter || filter(entry.name)) n += 1;
    }
  };
  walk(dir);
  return n;
};

// ---------------------------------------------------------------- 来源登记表
const SOURCES = [
  {
    source_id: 'ecommerce-ai-skills',
    name: 'ecommerce-ai-skills（跨境电商知识本体）',
    url: 'https://github.com/kangise/ecommerce-ai-skills',
    license: 'CC0-1.0',
    risk: 'CLEAR',
    usage: '蒸馏商用',
    path: 'raw_data/ecommerce-ai-skills',
    evidence: '仓库 LICENSE 文件首行 "CC0 1.0 Universal"',
    dp: (db) => db.prepare("SELECT COUNT(*) c FROM knowledge WHERE source_id LIKE '%ecommerce-ai-skills%'").get().c,
  },
  {
    source_id: 'ecommerce-ai-skills/glossary',
    name: '术语表（由本体 ontology 生成）',
    url: 'https://github.com/kangise/ecommerce-ai-skills',
    license: 'CC0-1.0（继承本体）',
    risk: 'CLEAR',
    usage: '蒸馏商用',
    path: 'raw_data/glossary/terms.json',
    evidence: '文件头注明生成自 ontology/entities.yaml；本体为 CC0',
    dp: null,
  },
  {
    source_id: 'wixqa',
    name: 'WixQA（Wix 帮助中心 RAG 基准）',
    url: 'https://huggingface.co/datasets/Wix/WixQA',
    license: 'MIT',
    risk: 'CLEAR',
    usage: '蒸馏商用',
    path: 'raw_data/WixQA-full + language_prompt/GPT/02_WixQA',
    evidence: 'LICENSE-NOTICE.md 的 dataset card: license: mit；HF API 返回 "mit"',
    dp: (db) => db.prepare("SELECT COUNT(*) c FROM knowledge WHERE source_type='wixqa'").get().c,
  },
  {
    source_id: 'webfaq2',
    name: 'WebFAQ2（多语言 FAQ）',
    url: 'https://huggingface.co/datasets/WebFAQ/WebFAQ2',
    license: 'ODC-By（Open Data Commons Attribution）',
    risk: 'CLEAR',
    usage: '蒸馏商用',
    path: 'language_prompt/01_webfaq2 + raw_data/webfaq_traveling.jsonl',
    evidence: 'README.md "## License" 段：Open Data Commons Attribution License (ODC-By)',
    dp: (db) => db.prepare("SELECT COUNT(*) c FROM knowledge WHERE source_id LIKE '%webfaq%'").get().c,
  },
  {
    source_id: 'massive',
    name: 'Amazon MASSIVE（意图/槽位）',
    url: 'https://github.com/alexa/massive',
    license: 'CC BY 4.0（上游）/ Apache-2.0（mteb 镜像卡）',
    risk: 'CLEAR',
    usage: '内部学习',
    path: 'raw_data/massive',
    evidence: '上游仓库 LICENSE 为 CC BY 4.0；HF mteb 镜像卡返回 apache-2.0',
    dp: null,
  },
  {
    source_id: 'mtop',
    name: 'MTOP（多语言任务型对话）',
    url: 'https://huggingface.co/datasets/WillHeld/mtop',
    license: '未声明（HF 卡无 license；上游 fb/mtop 为 CC BY-SA 4.0 且需申请）',
    risk: 'CONDITIONAL',
    usage: '内部学习',
    path: 'raw_data/mtop',
    evidence: 'HF API cardData.license = none；官方 fb/mtop 返回 401（gated）',
    dp: null,
  },
  {
    source_id: 'multiwoz',
    name: 'MultiWOZ 2.2（多领域对话）',
    url: 'https://huggingface.co/datasets/pfb30/multi_woz_v22',
    license: 'Apache-2.0（镜像卡）/ MIT（上游）',
    risk: 'CLEAR',
    usage: '蒸馏商用',
    path: 'raw_data/multiwoz',
    evidence: 'HF API cardData.license = ["apache-2.0"]',
    dp: null,
  },
  {
    source_id: 'clinc150',
    name: 'CLINC150（英文意图）',
    url: 'https://huggingface.co/datasets/clinc/clinc_oos',
    license: 'CC-BY-3.0',
    risk: 'CLEAR',
    usage: '蒸馏商用',
    path: 'raw_data/clinc150',
    evidence: 'HF API cardData.license = ["cc-by-3.0"]',
    dp: null,
  },
  {
    source_id: 'bitext',
    name: 'Bitext Customer Support（客服意图/话术）',
    url: 'https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset',
    license: 'CDLA-Sharing-1.0',
    risk: 'CONDITIONAL',
    usage: '内部学习',
    path: 'language_prompt/03_Bitext + raw_data/bitext.jsonl',
    evidence: 'dataset card license: cdla-sharing-1.0；商业使用/再分发义务待法务',
    dp: (db) => db.prepare("SELECT COUNT(*) c FROM knowledge WHERE source_id LIKE '%bitext%'").get().c,
  },
  {
    source_id: 'gs1-gpc',
    name: 'GS1 GPC 商品分类字典',
    url: 'https://gpc-browser.gs1.org/',
    license: 'GS1 专有条款（内部使用，禁止再分发）',
    risk: 'CONDITIONAL',
    usage: '内部学习',
    path: 'language_prompt/GPC（JSON 导出）',
    evidence: 'README_GS1_GPC.txt：不得绕过授权；需核对商业使用与再分发许可',
    dp: null,
  },
  {
    source_id: 'shopify-blog',
    name: 'Shopify Blog（Marketing / Sell Online）',
    url: 'https://www.shopify.com/blog/topics/marketing',
    license: 'Shopify 版权与站点条款（专有）',
    risk: 'HIGH',
    usage: '禁止',
    path: 'raw_data/seller_extra/shopify-*.md（5 篇）',
    evidence: '政策门禁：Shopify Blog 内容一律 LICENSE_RISK_HIGH，不得进入蒸馏',
    dp: (db) => db.prepare("SELECT COUNT(*) c FROM knowledge WHERE source_id LIKE '%seller_extra/%' AND source_id NOT LIKE '%seller_extra2%'").get().c,
  },
  {
    source_id: 'google-digital-garage',
    name: 'Google Digital Garage / Grow with Google',
    url: 'https://grow.google/certificates/digital-marketing-ecommerce/',
    license: 'Google 站点条款（专有）',
    risk: 'HIGH',
    usage: '禁止',
    path: 'raw_data/seller_extra/google-*.md（1 篇）',
    evidence: '政策门禁：Google 官方内容高风险，不得进入蒸馏',
    dp: 0,
  },
  {
    source_id: 'shipbob-blog',
    name: 'ShipBob Blog（物流/履约）',
    url: 'https://www.shipbob.com/blog/',
    license: '未声明（专有版权，无开放许可）',
    risk: 'CONDITIONAL',
    usage: '内部学习',
    path: 'raw_data/seller_extra2（24 篇）',
    evidence: 'robots 允许抓取，但站点无开放许可声明；商用需授权',
    dp: (db) => db.prepare("SELECT COUNT(*) c FROM knowledge WHERE source_id LIKE '%seller_extra2%'").get().c,
  },
  {
    source_id: 'amazon-seller-university',
    name: 'Amazon Seller University',
    url: 'https://sellercentral.amazon.com/learn',
    license: 'Amazon 官方条款（专有）',
    risk: 'HIGH',
    usage: '禁止',
    path: '（未下载）',
    evidence: '政策门禁：一律 LICENSE_RISK_HIGH',
    dp: 0,
  },
  {
    source_id: 'tiktok-shop-academy',
    name: 'TikTok Shop Academy',
    url: 'https://seller-us.tiktok.com/university',
    license: 'TikTok 官方条款（专有）',
    risk: 'HIGH',
    usage: '禁止',
    path: '（未下载；seller_extra2 中的 tiktok-fulfillment 属 ShipBob 原创内容，另见 ShipBob 行）',
    evidence: '政策门禁：一律 LICENSE_RISK_HIGH',
    dp: 0,
  },
  {
    source_id: 'ebay-official',
    name: 'eBay 官方内容',
    url: 'https://www.ebay.com/sellercenter',
    license: 'eBay 官方条款（专有）',
    risk: 'HIGH',
    usage: '禁止',
    path: '（未下载官方内容；ecommerce-ai-skills 内 eBay 指南属 CC0 原创，见下）',
    evidence: '政策门禁：一律 LICENSE_RISK_HIGH',
    dp: 0,
  },
  {
    source_id: 'google-ads-help',
    name: 'Google Ads 帮助中心',
    url: 'https://support.google.com/google-ads',
    license: 'Google 官方条款（专有）',
    risk: 'HIGH',
    usage: '禁止',
    path: '（未下载）',
    evidence: '政策门禁：一律 LICENSE_RISK_HIGH',
    dp: 0,
  },
  {
    source_id: 'banking77',
    name: 'BANKING77（意图分类）',
    url: 'https://huggingface.co/datasets/PolyAI/banking77',
    license: 'CC BY 4.0',
    risk: 'CLEAR',
    usage: '蒸馏商用',
    path: '（未下载，计划源）',
    evidence: '用户口径：BANKING77 = CC BY 4.0',
    dp: 0,
  },
  {
    source_id: 'ecommerce-ai-skills/platform-guides',
    name: '本体内的 eBay / TikTok / Amazon 平台指南（作者原创）',
    url: 'https://github.com/kangise/ecommerce-ai-skills',
    license: 'CC0-1.0（仓库整体许可）',
    risk: 'CLEAR',
    usage: '蒸馏商用',
    path: 'raw_data/ecommerce-ai-skills/src/d-platforms/*.md',
    evidence: '这些是仓库作者的原创指南，不是平台官方文档；整仓 CC0 覆盖',
    dp: null,
  },
  {
    source_id: 'derived-pools',
    name: '派生文件（candidates / rescued / rejected / recycle pools / quarantine）',
    url: '（继承上游）',
    license: '混合（取决于来源行，见 source_id 字段）',
    risk: 'CONDITIONAL',
    usage: '内部学习',
    path: 'raw_data/*.jsonl + raw_data/quarantine',
    evidence: '派生数据需逐行按 source_id 追溯上游许可；禁止整体商用',
    dp: null,
  },
];

// ---------------------------------------------------------------- 生成 CSV
const rows = [];
for (const s of SOURCES) {
  const cleanPath = s.path.split(' + ')[0].replace(/（[^）]*）/g, '').trim();
  const resolvePath = (p) => (path.isAbsolute(p)
    ? p
    : p.startsWith('language_prompt')
      ? path.join(ROOT, '..', p)
      : path.join(ROOT, p));
  let fileCount = 0;
  if (cleanPath && !s.path.includes('未下载')) {
    if (cleanPath.includes('*')) {
      const prefix = cleanPath.slice(0, cleanPath.indexOf('*'));
      const slash = prefix.lastIndexOf('/');
      const dir = resolvePath(prefix.slice(0, slash));
      const base = prefix.slice(slash + 1);
      if (exists(dir)) fileCount = countFiles(dir, (name) => name.startsWith(base));
    } else {
      const target = resolvePath(cleanPath);
      if (exists(target)) {
        const stat = fs.statSync(target);
        fileCount = stat.isFile() ? 1 : countFiles(target, null);
      }
    }
  }
  rows.push({
    source_id: s.source_id,
    来源: s.name,
    许可证: s.license,
    风险等级: s.risk,
    允许用途: s.usage,
    来源URL: s.url,
    本地路径: s.path,
    文件数: fileCount,
    证据: s.evidence,
  });
}

const header = ['source_id', '来源', '许可证', '风险等级', '允许用途', '来源URL', '本地路径', '文件数', '证据'];
const csv = [header.join(',')]
  .concat(rows.map((r) => header.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(',')))
  .join('\n') + '\n';

const outCsv = path.join(ROOT, 'source_license_audit.csv');
fs.writeFileSync(outCsv, csv);

// ---------------------------------------------------------------- 库内行数（只读）
let dbCounts = {};
try {
  const db = new DatabaseSync(path.join(ROOT, '.data', 'relaydesk.sqlite'));
  for (const s of SOURCES) {
    if (typeof s.dp === 'function') {
      try { dbCounts[s.source_id] = s.dp(db); } catch { dbCounts[s.source_id] = null; }
    }
  }
  db.close();
} catch { dbCounts = {}; }

const clear = rows.filter((r) => r.风险等级 === 'CLEAR');
const conditional = rows.filter((r) => r.风险等级 === 'CONDITIONAL');
const high = rows.filter((r) => r.风险等级 === 'HIGH');

const md = [];
md.push('# 来源合规性盘点（只读）');
md.push('');
md.push(`生成时间：${new Date().toISOString()}`);
md.push('');
md.push('## 结论');
md.push('');
md.push(`- LICENSE_CLEAR：${clear.length} 个源（可继续蒸馏）`);
md.push(`- LICENSE_CONDITIONAL：${conditional.length} 个源（仅内部学习，商用待授权）`);
md.push(`- LICENSE_RISK_HIGH：${high.length} 个源（禁止进入蒸馏流水线）`);
md.push('');
md.push('## 高风险源（禁止蒸馏）');
md.push('');
md.push('| source_id | 来源 | 本地是否已下载 | 备注 |');
md.push('|---|---|---|---|');
for (const r of high) md.push(`| ${r.source_id} | ${r.来源} | ${r.本地路径} | ${r.允许用途} |`);
md.push('');
md.push('## 条件许可源（仅内部学习）');
md.push('');
md.push('| source_id | 来源 | 许可证 |');
md.push('|---|---|---|');
for (const r of conditional) md.push(`| ${r.source_id} | ${r.来源} | ${r.许可证} |`);
md.push('');
md.push('## 需人工关注的问题');
md.push('');
md.push('1. **Shopify/Google 内容曾产生 5 张候选卡**（`raw_data/candidates.seller_extra.jsonl`）；当前知识库内 0 行。按本次门禁应标记 HIGH，候选文件不得再进入蒸馏。');
md.push('2. **ShipBob 内容（352 张卡）** 无开放许可，属 CONDITIONAL；当前已在知识库中，商用前需授权确认。');
md.push('3. **MTOP 未声明许可**（HF 镜像卡无 license，官方 gated），仅可内部学习。');
md.push('4. **GS1 GPC 为专有条款**，内部使用可，再分发需 GS1 授权。');
md.push('5. **BANKING77 尚未下载**，如启用需按 CC BY 4.0 署名。');
md.push('');

const outMd = path.join(ROOT, 'reports', 'license', 'license_audit_summary.md');
fs.mkdirSync(path.dirname(outMd), { recursive: true });
fs.writeFileSync(outMd, md.join('\n'));

console.log(`[csv] ${path.relative(ROOT, outCsv)}  (${rows.length} sources)`);
console.log(`[md]  ${path.relative(ROOT, outMd)}`);
console.log(`[summary] CLEAR=${clear.length} CONDITIONAL=${conditional.length} HIGH=${high.length}`);
console.log('[db rows]', JSON.stringify(dbCounts));
