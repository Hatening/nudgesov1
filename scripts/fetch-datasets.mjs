// scripts/fetch-datasets.mjs
// 一键拉取跨境电商多语言语料：
//   1. ecommerce-ai-skills 本体（git clone，已存在则跳过）
//   2. WixQA（HF，Python datasets）
//   3. MASSIVE（51 语言意图语料）
//   4. MTOP（6 语言任务型对话）
//   5. MultiWOZ 2.2
//   6. CLINC150（英文意图，后续用本地 Qwen 翻小语种）
//   7. ecommerce-ai-skills 内的 glossary / 术语表
//
// 运行：
//   node scripts/fetch-datasets.mjs
//   node scripts/fetch-datasets.mjs --skip-remote        # 只做本地术语提取
//   node scripts/fetch-datasets.mjs --sets massive,mtop  # 只拉指定语料

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'raw_data');
const SKILLS = path.join(RAW, 'ecommerce-ai-skills');

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : fallback;
};

const PYTHON = process.env.PYTHON_BIN
  || 'D:/Documents/AI_Projects/NudgeSo/language_prompt/_distill/.venv-flag/Scripts/python.exe';
const SETS = arg('sets', 'massive,mtop,multiwoz,clinc');

fs.mkdirSync(RAW, { recursive: true });

function step(title) {
  console.log(`\n=== ${title} ===`);
}

// ---------------------------------------------------------------- 1. 本体仓库
step('ecommerce-ai-skills');
if (fs.existsSync(path.join(SKILLS, '.git')) || fs.existsSync(path.join(SKILLS, 'skills'))) {
  console.log('已存在，跳过 clone');
} else if (hasFlag('skip-remote')) {
  console.log('--skip-remote，跳过');
} else {
  execFileSync('git', ['clone', '--depth', '1', 'https://github.com/kangise/ecommerce-ai-skills.git', SKILLS], { stdio: 'inherit' });
}

// ---------------------------------------------------------------- 2-6. HF 数据集
if (!hasFlag('skip-remote')) {
  step(`HF datasets: ${SETS}`);
  const script = path.join(__dirname, 'fetch_hf_datasets.py');
  const env = { ...process.env, HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com' };
  delete env.HTTP_PROXY; delete env.HTTPS_PROXY; delete env.ALL_PROXY;
  delete env.http_proxy; delete env.https_proxy; delete env.all_proxy;
  env.NO_PROXY = '*';

  execFileSync(PYTHON, [script, '--out', RAW, '--sets', SETS], { stdio: 'inherit', env });
}

// ---------------------------------------------------------------- 7. 术语表
step('glossary / terminology');

function parseGlossary(file) {
  const text = fs.readFileSync(file, 'utf8');
  const blocks = text.split(/^## /m).slice(1);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const heading = lines[0].trim();
    const ja = (block.match(/^>\s*(.+)$/m) || [])[1];
    const defZh = (block.match(/^-\s*\*\*ZH\*\*:\s*(.+)$/m) || [])[1];
    const defEn = (block.match(/^-\s*\*\*EN\*\*:\s*(.+)$/m) || [])[1];
    const parts = heading.split(' / ').map((s) => s.trim());
    out.push({
      term_en: parts.length > 1 ? parts[1] : parts[0],
      term_zh: parts.length > 1 ? parts[0] : null,
      term_ja: ja ? ja.trim() : null,
      definition_zh: defZh ? defZh.trim() : null,
      definition_en: defEn ? defEn.trim() : null,
      source: path.relative(ROOT, file).replace(/\\/g, '/'),
    });
  }
  return out;
}

const glossaryFiles = [];
for (const candidate of [
  path.join(SKILLS, 'src', 'resources', 'glossary.md'),
  path.join(SKILLS, 'i18n', 'en', 'src', 'resources', 'glossary.md'),
  path.join(SKILLS, 'i18n', 'ja', 'src', 'resources', 'glossary.md'),
]) {
  if (fs.existsSync(candidate)) glossaryFiles.push(candidate);
}

if (glossaryFiles.length) {
  const merged = new Map();
  for (const file of glossaryFiles) {
    for (const term of parseGlossary(file)) {
      const key = term.term_en.toLowerCase();
      const prev = merged.get(key) || {};
      merged.set(key, {
        ...prev,
        ...Object.fromEntries(Object.entries(term).filter(([, v]) => v !== null && v !== undefined && v !== '')),
        term_ja: term.term_ja || prev.term_ja || null,
        definition_zh: term.definition_zh || prev.definition_zh || null,
        definition_en: term.definition_en || prev.definition_en || null,
      });
    }
  }
  const outDir = path.join(RAW, 'glossary');
  fs.mkdirSync(outDir, { recursive: true });
  const terms = [...merged.values()];
  fs.writeFileSync(path.join(outDir, 'terms.json'), JSON.stringify(terms, null, 2));
  console.log(`术语表：${glossaryFiles.length} 个文件 → ${terms.length} 条术语 → raw_data/glossary/terms.json`);
} else {
  console.log('未找到 glossary.md');
}

// ---------------------------------------------------------------- 汇总
step('summary');
const folders = fs.readdirSync(RAW, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => d.name);

for (const folder of folders) {
  const full = path.join(RAW, folder);
  const files = fs.readdirSync(full, { withFileTypes: true });
  const subdirs = files.filter((f) => f.isDirectory()).length;
  const fileCount = files.filter((f) => f.isFile()).length;
  console.log(`  ${folder}/  (${subdirs} 个子目录, ${fileCount} 个文件)`);
}

const summaryPath = path.join(RAW, 'dataset_summary.json');
if (fs.existsSync(summaryPath)) {
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  console.log('\n数据集明细：');
  for (const [name, info] of Object.entries(summary)) {
    const langs = info.language_count ?? (info.languages || []).length;
    const errs = (info.errors || []).length;
    console.log(`  ${name}: ${langs} 语言/config，${info.rows_total ?? 0} 行，${errs} 个错误`);
  }
}

console.log('\n✅ 拉取完成');
