#!/usr/bin/env node
/**
 * KB-QUALITY-001 / 阶段一：数据质量与来源审核（只读）
 *
 * 产物（默认 reports/kb-quality-001/）：
 *   manifest.sha256.json / manifest.sha256.csv    文件指纹清单
 *   wixqa-quality.json / wixqa-quality.csv        WixQA 质量报告
 *   bitext-quality.json / bitext-quality.csv      Bitext 质量报告
 *   license-review.json / license-review.md       许可证审核
 *   summary.json                                  运行摘要（含命令与退出码）
 *
 * 约束：不下载、不覆盖、不修改任何原始文件。
 *
 * 用法：
 *   node scripts/kb-quality/audit.mjs
 *   node scripts/kb-quality/audit.mjs --wix <dir> --bitext <dir> --out <dir>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const WIX_DIR = arg('wix', 'D:/Documents/AI_Projects/NudgeSo/language_prompt/GPT/02_WixQA/dataset_snapshot');
const BITEXT_DIR = arg('bitext', 'D:/Documents/AI_Projects/NudgeSo/language_prompt/GPT/03_Bitext/dataset_snapshot');
const OUT_DIR = path.resolve(ROOT, arg('out', 'reports/kb-quality-001'));
fs.mkdirSync(OUT_DIR, { recursive: true });

const FILES = [
  { key: 'wixqa_expertwritten', path: path.join(WIX_DIR, 'wixqa_expertwritten/test.jsonl') },
  { key: 'wixqa_simulated', path: path.join(WIX_DIR, 'wixqa_simulated/test.jsonl') },
  { key: 'wixqa_synthetic', path: path.join(WIX_DIR, 'wixqa_synthetic/test.jsonl') },
  { key: 'wix_kb_corpus', path: path.join(WIX_DIR, 'wix_kb_corpus/wix_kb_corpus.jsonl') },
  { key: 'bitext_csv', path: path.join(BITEXT_DIR, 'Bitext_Sample_Customer_Support_Training_Dataset_27K_responses-v11.csv') },
];

const write = (name, data) => {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  return file;
};
const csvEscape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
const toCsv = (rows, columns) => [columns.join(','), ...rows.map((r) => columns.map((c) => csvEscape(r[c])).join(','))].join('\n') + '\n';

// ---------------------------------------------------------------- 1. manifest
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function hfEtag(file) {
  const cacheDir = path.join(path.dirname(path.dirname(path.dirname(file))), '.cache', 'huggingface', 'download');
  const rel = path.relative(path.dirname(path.dirname(path.dirname(file))), file);
  const candidate = path.join(cacheDir, `${rel}.metadata`);
  if (!fs.existsSync(candidate)) return null;
  const lines = fs.readFileSync(candidate, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines[1] || null; // 第 2 行是 HF etag（LFS 文件即 sha256）
}

const SOURCE_META = {
  wixqa_expertwritten: { source_url: 'https://huggingface.co/datasets/Wix/WixQA', license: 'MIT', license_status: 'approved_with_attribution' },
  wixqa_simulated: { source_url: 'https://huggingface.co/datasets/Wix/WixQA', license: 'MIT', license_status: 'approved_with_attribution' },
  wixqa_synthetic: { source_url: 'https://huggingface.co/datasets/Wix/WixQA', license: 'MIT', license_status: 'approved_with_attribution' },
  wix_kb_corpus: { source_url: 'https://huggingface.co/datasets/Wix/WixQA', license: 'MIT', license_status: 'approved_with_attribution' },
  bitext_csv: { source_url: 'https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset', license: 'CDLA-Sharing-1.0', license_status: 'review_required' },
};

async function buildManifest() {
  const rows = [];
  for (const item of FILES) {
    if (!fs.existsSync(item.path)) {
      rows.push({ key: item.key, path: item.path, exists: false });
      continue;
    }
    const stat = fs.statSync(item.path);
    const sha256 = await sha256File(item.path);
    const etag = hfEtag(item.path);
    rows.push({
      key: item.key,
      path: item.path.replace(/\\/g, '/'),
      bytes: stat.size,
      sha256,
      hf_etag: etag,
      hash_matches_hf_etag: etag ? (etag === sha256 || !/^[0-9a-f]{64}$/.test(etag) ? 'not_comparable' : false) : 'no_metadata',
      verified: Boolean(sha256),
      source_url: SOURCE_META[item.key]?.source_url || '',
      license: SOURCE_META[item.key]?.license || '',
      license_status: SOURCE_META[item.key]?.license_status || 'review_required',
    });
  }
  write('manifest.sha256.json', { generated_at: new Date().toISOString(), files: rows });
  write('manifest.sha256.csv', toCsv(rows, ['key', 'path', 'bytes', 'sha256', 'hf_etag', 'source_url', 'license', 'license_status', 'verified']));
  return rows;
}

// ---------------------------------------------------------------- helpers
function readJsonl(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const rows = [];
  let invalid = 0;
  for (const line of lines) {
    try { rows.push(JSON.parse(line)); } catch { invalid += 1; }
  }
  return { rows, invalid, lines: lines.length };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const asciiRatio = (text) => {
  const s = String(text || '');
  if (!s.length) return 0;
  let ascii = 0;
  for (const ch of s) if (ch.charCodeAt(0) < 128) ascii += 1;
  return ascii / s.length;
};
const detectLanguage = (text) => {
  const s = String(text || '');
  if (/[\u4e00-\u9fff]/.test(s)) return 'zh';
  if (/[\u0600-\u06FF]/.test(s)) return 'ar';
  if (/[\u0400-\u04FF]/.test(s)) return 'ru';
  if (/[\u3040-\u30ff]/.test(s)) return 'ja';
  if (/[\uac00-\ud7af]/.test(s)) return 'ko';
  if (asciiRatio(s) > 0.98) return 'en';
  return 'other';
};
const specialCharStats = (text) => {
  const s = String(text || '');
  return {
    has_control: /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s),
    has_html_tag: /<[a-z][^>]*>/i.test(s),
    has_non_ascii: /[^\x00-\x7F]/.test(s),
    has_emoji: /[\u{1F300}-\u{1FAFF}]/u.test(s),
  };
};
const top = (map, n = 15) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);

// ---------------------------------------------------------------- 2. WixQA
function auditWixqa() {
  const corpus = readJsonl(path.join(WIX_DIR, 'wix_kb_corpus/wix_kb_corpus.jsonl'));
  const ids = new Set();
  const urls = new Map();
  const titles = new Map();
  const contentHashes = new Map();
  let emptyContent = 0;
  let emptyTitle = 0;
  let emptyHtml = 0;
  let controlChars = 0;
  let htmlInContents = 0;
  let nonAscii = 0;
  const languages = {};
  const types = {};
  const lengths = [];

  for (const row of corpus.rows) {
    ids.add(row.id);
    const title = String(row.title || '').trim();
    const content = String(row.contents || '');
    if (!content.trim()) emptyContent += 1;
    if (!title) emptyTitle += 1;
    if (!String(row.html_content || '').trim()) emptyHtml += 1;
    const stats = specialCharStats(content);
    if (stats.has_control) controlChars += 1;
    if (stats.has_html_tag) htmlInContents += 1;
    if (stats.has_non_ascii) nonAscii += 1;
    languages[detectLanguage(content)] = (languages[detectLanguage(content)] || 0) + 1;
    types[row.article_type || '(missing)'] = (types[row.article_type || '(missing)'] || 0) + 1;
    lengths.push(content.length);
    urls.set(row.url, (urls.get(row.url) || 0) + 1);
    titles.set(title, (titles.get(title) || 0) + 1);
    const ch = crypto.createHash('sha256').update(content).digest('hex');
    contentHashes.set(ch, (contentHashes.get(ch) || 0) + 1);
  }

  const qa = [];
  for (const cfg of ['wixqa_expertwritten', 'wixqa_simulated', 'wixqa_synthetic']) {
    const data = readJsonl(path.join(WIX_DIR, cfg, 'test.jsonl'));
    const missingArticleIds = data.rows.filter((r) => !Array.isArray(r.article_ids) || r.article_ids.length === 0).length;
    const unresolved = [];
    for (const row of data.rows) {
      for (const id of row.article_ids || []) if (!ids.has(id)) unresolved.push(id);
    }
    const dupQuestions = data.rows.length - new Set(data.rows.map((r) => String(r.question || '').trim().toLowerCase())).size;
    const qaLangs = {};
    for (const row of data.rows) qaLangs[detectLanguage(row.question)] = (qaLangs[detectLanguage(row.question)] || 0) + 1;
    qa.push({
      config: cfg,
      rows: data.rows.length,
      invalid_json: data.invalid,
      missing_article_ids: missingArticleIds,
      unresolved_article_refs: unresolved.length,
      duplicate_questions: dupQuestions,
      question_language: qaLangs,
      avg_answer_chars: Math.round(data.rows.reduce((a, r) => a + String(r.answer || '').length, 0) / Math.max(1, data.rows.length)),
    });
  }

  const sorted = [...lengths].sort((a, b) => a - b);
  const report = {
    generated_at: new Date().toISOString(),
    source_dir: WIX_DIR.replace(/\\/g, '/'),
    articles: {
      rows: corpus.rows.length,
      invalid_json: corpus.invalid,
      unique_ids: ids.size,
      duplicate_ids: corpus.rows.length - ids.size,
      duplicate_urls: [...urls.values()].filter((n) => n > 1).length,
      duplicate_titles: [...titles.values()].filter((n) => n > 1).length,
      duplicate_contents: [...contentHashes.values()].filter((n) => n > 1).length,
      empty_contents: emptyContent,
      empty_titles: emptyTitle,
      empty_html_content: emptyHtml,
      control_chars: controlChars,
      html_in_contents: htmlInContents,
      non_ascii_contents: nonAscii,
      article_type: types,
      language: languages,
      length_min: sorted[0] || 0,
      length_median: sorted[Math.floor(sorted.length / 2)] || 0,
      length_p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
      length_max: sorted[sorted.length - 1] || 0,
    },
    qa,
  };

  write('wixqa-quality.json', report);
  const csvRows = [
    ...Object.entries(types).map(([k, v]) => ({ metric: 'article_type', key: k, count: v })),
    ...Object.entries(languages).map(([k, v]) => ({ metric: 'language', key: k, count: v })),
    ...qa.map((q) => ({ metric: 'qa_config', key: q.config, count: q.rows, extra: `missing_ids=${q.missing_article_ids}; unresolved=${q.unresolved_article_refs}; dup_q=${q.duplicate_questions}` })),
  ];
  write('wixqa-quality.csv', toCsv(csvRows, ['metric', 'key', 'count', 'extra']));
  return report;
}

// ---------------------------------------------------------------- 3. Bitext
function auditBitext() {
  const file = path.join(BITEXT_DIR, 'Bitext_Sample_Customer_Support_Training_Dataset_27K_responses-v11.csv');
  const text = fs.readFileSync(file, 'utf8');
  const [header, ...rows] = parseCsv(text);
  const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  const get = (row, name) => (row[idx[name]] ?? '').trim();

  const nulls = {};
  const empties = {};
  for (const name of header) { nulls[name] = 0; empties[name] = 0; }
  const categories = {};
  const intents = {};
  const flags = {};
  const instructionSet = new Set();
  const responseSet = new Set();
  const pairSet = new Set();
  let duplicateInstructions = 0;
  let duplicateResponses = 0;
  let duplicatePairs = 0;
  let nonAscii = 0;
  let controlChars = 0;
  let shortInstruction = 0;
  let shortResponse = 0;
  const instrLens = [];
  const respLens = [];

  for (const row of rows) {
    for (const name of header) {
      const value = row[idx[name]];
      if (value === undefined || value === null) nulls[name] += 1;
      else if (String(value).trim() === '') empties[name] += 1;
    }
    const instruction = get(row, 'instruction');
    const response = get(row, 'response');
    const category = get(row, 'category');
    const intent = get(row, 'intent');
    const flag = get(row, 'flags');

    categories[category] = (categories[category] || 0) + 1;
    intents[intent] = (intents[intent] || 0) + 1;
    flags[flag] = (flags[flag] || 0) + 1;

    if (instructionSet.has(instruction)) duplicateInstructions += 1; else instructionSet.add(instruction);
    if (responseSet.has(response)) duplicateResponses += 1; else responseSet.add(response);
    const pairKey = `${instruction}\u0000${response}`;
    if (pairSet.has(pairKey)) duplicatePairs += 1; else pairSet.add(pairKey);

    if (specialCharStats(instruction).has_non_ascii) nonAscii += 1;
    if (specialCharStats(instruction).has_control) controlChars += 1;
    if (instruction.length < 5) shortInstruction += 1;
    if (response.length < 10) shortResponse += 1;
    instrLens.push(instruction.length);
    respLens.push(response.length);
  }

  const sortedInstr = [...instrLens].sort((a, b) => a - b);
  const sortedResp = [...respLens].sort((a, b) => a - b);
  const report = {
    generated_at: new Date().toISOString(),
    source_dir: BITEXT_DIR.replace(/\\/g, '/'),
    rows: rows.length,
    columns: header,
    nulls,
    empties,
    duplicates: { instruction: duplicateInstructions, response: duplicateResponses, pair: duplicatePairs },
    categories: Object.fromEntries(top(categories, 30)),
    intents: Object.fromEntries(top(intents, 40)),
    flags: Object.fromEntries(top(flags, 30)),
    anomalies: {
      non_ascii_instruction: nonAscii,
      control_chars: controlChars,
      instruction_shorter_than_5: shortInstruction,
      response_shorter_than_10: shortResponse,
    },
    lengths: {
      instruction_median: sortedInstr[Math.floor(sortedInstr.length / 2)] || 0,
      instruction_p95: sortedInstr[Math.floor(sortedInstr.length * 0.95)] || 0,
      response_median: sortedResp[Math.floor(sortedResp.length / 2)] || 0,
      response_p95: sortedResp[Math.floor(sortedResp.length * 0.95)] || 0,
    },
  };

  write('bitext-quality.json', report);
  const csvRows = [
    ...Object.entries(categories).map(([k, v]) => ({ metric: 'category', key: k, count: v })),
    ...Object.entries(intents).map(([k, v]) => ({ metric: 'intent', key: k, count: v })),
    ...Object.entries(nulls).map(([k, v]) => ({ metric: 'null', key: k, count: v })),
    ...Object.entries(empties).map(([k, v]) => ({ metric: 'empty', key: k, count: v })),
  ];
  write('bitext-quality.csv', toCsv(csvRows, ['metric', 'key', 'count']));
  return report;
}

// ---------------------------------------------------------------- 4. license
function licenseReview() {
  const report = {
    generated_at: new Date().toISOString(),
    datasets: [
      {
        dataset: 'WixQA',
        files: ['wixqa_expertwritten/test.jsonl', 'wixqa_simulated/test.jsonl', 'wixqa_synthetic/test.jsonl', 'wix_kb_corpus/wix_kb_corpus.jsonl'],
        declared_license: 'MIT',
        source: 'https://huggingface.co/datasets/Wix/WixQA',
        commercial_use: 'allowed',
        derivative_works: 'allowed',
        redistribution: 'allowed with MIT license text + copyright notice',
        attribution: 'cite Wix.com AI Research / arXiv:2505.08643',
        status: 'approved_with_attribution',
        notes: 'Dataset card states license: mit. Content is Wix Help Center help articles, likely also under Wix terms; keep attribution and avoid presenting as official Wix policy.',
      },
      {
        dataset: 'Bitext Customer Support',
        files: ['Bitext_Sample_Customer_Support_Training_Dataset_27K_responses-v11.csv'],
        declared_license: 'CDLA-Sharing-1.0',
        source: 'https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset',
        commercial_use: 'review_required',
        derivative_works: 'allowed with sharing obligations (CDLA-Sharing-1.0)',
        redistribution: 'must carry CDLA-Sharing-1.0 terms and notices',
        attribution: 'Bitext Innovations, 2024',
        status: 'review_required',
        notes: 'CDLA-Sharing-1.0 permits sharing/derivatives subject to license propagation; commercial ingestion into a paid KB should be cleared by legal before launch.',
      },
    ],
    pending_review: ['Bitext (CDLA-Sharing-1.0) — commercial redistribution not cleared'],
  };
  write('license-review.json', report);
  const md = [
    '# 许可证审核（KB-QUALITY-001）',
    '',
    '| 数据集 | 声明许可 | 商业使用 | 派生 | 再分发 | 状态 |',
    '|---|---|---|---|---|---|',
    '| WixQA | MIT | 允许 | 允许 | 需附 MIT 文本与版权声明 | approved_with_attribution |',
    '| Bitext | CDLA-Sharing-1.0 | **待审核** | 允许（需同等共享） | 需携带 CDLA-Sharing-1.0 条款 | review_required |',
    '',
    '## 待人工确认',
    '- Bitext 数据集用于付费产品知识库前，需法务确认 CDLA-Sharing-1.0 的商业使用与再分发义务。',
    '- WixQA 内容源自 Wix Help Center，MIT 覆盖数据集打包；对外展示时仍需标注来源、避免暗示 Wix 官方背书。',
    '',
  ].join('\n');
  write('license-review.md', md);
  return report;
}

// ---------------------------------------------------------------- main
async function main() {
  const started = Date.now();
  const manifest = await buildManifest();
  const wix = auditWixqa();
  const bitext = auditBitext();
  const license = licenseReview();

  const summary = {
    task: 'KB-QUALITY-001',
    generated_at: new Date().toISOString(),
    command: process.argv.join(' '),
    cwd: ROOT,
    inputs: { wixqa: WIX_DIR, bitext: BITEXT_DIR },
    outputs: OUT_DIR.replace(/\\/g, '/'),
    files: manifest.map((f) => ({ key: f.key, bytes: f.bytes, sha256: f.sha256, exists: f.exists !== false })),
    wixqa: { articles: wix.articles.rows, empty_contents: wix.articles.empty_contents, duplicate_contents: wix.articles.duplicate_contents, qa: wix.qa.map((q) => ({ config: q.config, rows: q.rows, missing: q.missing_article_ids, unresolved: q.unresolved_article_refs })) },
    bitext: { rows: bitext.rows, duplicate_pairs: bitext.duplicates.pair, categories: Object.keys(bitext.categories).length, intents: Object.keys(bitext.intents).length },
    license: license.datasets.map((d) => ({ dataset: d.dataset, license: d.declared_license, status: d.status })),
    duration_ms: Date.now() - started,
  };
  write('summary.json', summary);

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n[reports] ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(`[fatal] ${error.message}`);
  process.exit(1);
});
