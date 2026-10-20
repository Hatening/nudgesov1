/**
 * distill-local.mjs — 本地 Qwen3 批量蒸馏：Markdown → 电商问答知识卡
 *
 * 用法：
 *   node scripts/distill-local.mjs --files 3
 *   node scripts/distill-local.mjs --files 3 --chunk 8000 --concurrency 2
 *
 * 后端自动探测：
 *   1) Ollama  http://127.0.0.1:11434  /api/chat
 *   2) LM Studio 的 OpenAI 兼容端点    /v1/chat/completions
 * 可用环境变量覆盖：OLLAMA_URL / LMSTUDIO_URL / MODEL / OLLAMA_MODEL
 *
 * 约束：并发 2；单块 8000 字符；失败重试 2 次；结果追加到 raw_data/candidates.jsonl
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW = path.join(ROOT, 'raw_data');
const SKILLS_DIR = path.join(RAW, 'ecommerce-ai-skills');
const CATEGORIES = [
  '物流与配送', '退货与退款', '商品与尺码', '支付与结算',
  '账号与安全', '广告与营销', '投诉与纠纷', '平台规则', '其他',
];
const PROGRESS_FILE = path.join(RAW, 'distill_progress.json');

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : fallback;
};
const FILE_LIMIT = Number(arg('files', 3));
const CHUNK_SIZE = Number(arg('chunk', 8000));
const CONCURRENCY = Number(arg('concurrency', 2));
const SUB_DIR = arg('dir', 'skills'); // 相对 raw_data/ecommerce-ai-skills，默认只蒸馏技能文档
const INPUT_FILE = arg('input', '');  // JSONL：{question,answer} 或 {text}
const PAIRS_PER_CHUNK = Number(arg('pairs', 15));
const CHUNK_LIMIT = Number(arg('chunks', 0)); // 0 = 不限
const AUDIENCE = arg('audience', 'seller') === 'buyer' ? 'buyer' : 'seller'; // 双引擎知识库受众
const OUT_PATH = arg('out', '');
const OUT_FILE = OUT_PATH ? path.resolve(ROOT, OUT_PATH) : path.join(RAW, 'candidates.jsonl');
const MAX_CARDS = 5;
const RETRIES = 2;
const MAX_TOKENS = 4000; // 推理模型会先思考，给足预算，避免 content 为空

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const LMSTUDIO_URL = process.env.LMSTUDIO_URL || 'http://192.168.3.227:3679/v1';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3.8-35b-a3b-Q5_K_M';
const LMS_MODEL = process.env.MODEL || 'qwen3.8-35b-a3b@q5_k_m';

const PROMPT = `你是一个电商知识库结构化专家。请将以下长文本拆解为多条独立的“问答知识卡”。

要求：
- 每次最多输出 ${MAX_CARDS} 张知识卡（防止输出被截断）。
- 严格输出 JSON 数组，不要输出多余的解释。
- 每张卡必须包含 question、answer、tags（数组）、category。
- category 只能从以下枚举中选一个：${CATEGORIES.join(' / ')}。

格式示例：
[{"question": "...", "answer": "...", "tags": ["物流", "退货"], "category": "售后客服"}]

长文本：
`;

// ---------------------------------------------------------------- 后端探测
async function detectBackend() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const data = await r.json();
      const names = (data.models || []).map((m) => m.name);
      return { kind: 'ollama', url: OLLAMA_URL, model: OLLAMA_MODEL, models: names };
    }
  } catch { /* 继续探测下一个 */ }

  const r = await fetch(`${LMSTUDIO_URL}/models`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`no local backend: ollama ${OLLAMA_URL} down, lmstudio ${LMSTUDIO_URL} ${r.status}`);
  const data = await r.json();
  const ids = (data.data || []).map((m) => m.id);
  const model = ids.includes(LMS_MODEL) ? LMS_MODEL : ids.find((id) => /qwen3\.8-35b/.test(id));
  if (!model) throw new Error(`lmstudio has no suitable model, available: ${ids.join(', ')}`);
  return { kind: 'lmstudio', url: LMSTUDIO_URL, model, models: ids };
}

async function chat(backend, content) {
  if (backend.kind === 'ollama') {
    const r = await fetch(`${backend.url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: backend.model,
        messages: [{ role: 'user', content }],
        stream: false,
        options: { temperature: 0, num_ctx: 32768, num_predict: MAX_TOKENS },
      }),
      signal: AbortSignal.timeout(600_000),
    });
    if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = await r.json();
    return data?.message?.content ?? '';
  }

  const r = await fetch(`${backend.url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer lmstudio' },
    body: JSON.stringify({
      model: backend.model,
      messages: [{ role: 'user', content }],
      temperature: 0,
      max_tokens: MAX_TOKENS,
    }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!r.ok) throw new Error(`lmstudio ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return data?.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------- 文件与切分
const SKIP_DIRS = new Set([
  '.git', '.github', '.planning', 'node_modules', 'dist',
  '.claude-plugin', 'tests', 'scripts', 'release', 'artifacts', 'branding',
]);

async function listMarkdown(dir) {
  const out = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path.join(current, entry.name));
      } else if (entry.name.toLowerCase().endsWith('.md')) {
        const full = path.join(current, entry.name);
        const stat = await fs.stat(full);
        out.push({ path: full, size: stat.size });
      }
    }
  }
  await walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function splitChunks(text, size) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  const push = () => {
    if (current.trim().length >= 200) chunks.push(current.trim());
    current = '';
  };

  for (const p of paragraphs) {
    if (p.length > size) {
      push();
      for (let i = 0; i < p.length; i += size) {
        const piece = p.slice(i, i + size).trim();
        if (piece.length >= 200) chunks.push(piece);
      }
      continue;
    }
    if (current.length + p.length + 2 > size) push();
    current += (current ? '\n\n' : '') + p;
  }
  push();
  return chunks;
}

// ---------------------------------------------------------------- JSON 清洗
function extractJsonArray(text) {
  if (!text) return null;
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  const start = cleaned.indexOf('[');
  if (start === -1) return null;

  // 平衡括号扫描，正确处理字符串里的 ] 和转义
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(cleaned.slice(start, i + 1));
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeCards(cards, meta) {
  if (!Array.isArray(cards)) return [];
  return cards
    .filter((c) => c && typeof c.question === 'string' && typeof c.answer === 'string')
    .map((c) => {
      const rawCat = typeof c.category === 'string' ? c.category.trim() : '';
      const category = CATEGORIES.includes(rawCat)
        ? rawCat
        : CATEGORIES.find((x) => x !== '其他' && rawCat.includes(x)) || '其他';
      return {
        question: c.question.trim().slice(0, 500),
        answer: String(c.answer).trim().slice(0, 2000),
        tags: Array.isArray(c.tags) ? c.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : [],
        category,
        audience: meta.audience === 'buyer' ? 'buyer' : 'seller',
        source: String(meta.source).replace(/\\/g, '/'),
        chunk: meta.chunk,
        model: meta.model,
        at: new Date().toISOString(),
      };
    })
    .slice(0, MAX_CARDS);
}

/** JSONL 输入：每行 {question, answer} 或 {text}，按 pairsPerChunk 合并成块 */
async function jsonlJobs(file, pairsPerChunk, chunkSize) {
  const raw = await fs.readFile(file, 'utf8');
  const rows = raw.split('\n').filter((l) => l.trim()).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const jobs = [];
  let buf = [];
  let bufLen = 0;
  let index = 0;

  const flushBuf = () => {
    if (buf.length >= 3) {
      index += 1;
      jobs.push({ text: buf.join('\n\n'), index, file, rows: buf.length });
      buf = [];
      bufLen = 0;
    }
  };

  for (const row of rows) {
    let text = '';
    if (typeof row.question === 'string' && typeof row.answer === 'string') {
      text = `Q: ${row.question}\nA: ${row.answer}`;
    } else if (typeof row.text === 'string') {
      text = row.text;
    } else if (typeof row.instruction === 'string' && typeof row.response === 'string') {
      text = `Q: ${row.instruction}\nA: ${row.response}`;
    }
    if (!text.trim()) continue;

    buf.push(text);
    bufLen += text.length + 2;
    if (buf.length >= pairsPerChunk || bufLen >= chunkSize) flushBuf();
  }
  flushBuf();
  return jobs;
}

// ---------------------------------------------------------------- 并发池
function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active -= 1;
      next();
    });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 主流程
async function main() {
  const backend = await detectBackend();
  console.log(`[backend] ${backend.kind}  url=${backend.url}  model=${backend.model}`);
  if (backend.kind === 'ollama' && !backend.models.includes(OLLAMA_MODEL)) {
    console.log(`[warn] ollama 中没有 ${OLLAMA_MODEL}，现有: ${backend.models.slice(0, 5).join(', ')}`);
  }

  const jobs = [];
  if (INPUT_FILE) {
    const abs = path.isAbsolute(INPUT_FILE) ? INPUT_FILE : path.resolve(ROOT, INPUT_FILE);
    const list = await jsonlJobs(abs, PAIRS_PER_CHUNK, CHUNK_SIZE);
    const limited = CHUNK_LIMIT > 0 ? list.slice(0, CHUNK_LIMIT) : list;
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    limited.forEach((j) => jobs.push({ sourcePath: rel, text: j.text, index: j.index, progressKey: `${rel}#chunk${j.index}` }));
    console.log(`[input] ${rel} → ${limited.length} 块（每块 ≤${PAIRS_PER_CHUNK} 对问答）`);
  } else {
    // --dir 既可以是 ecommerce-ai-skills 下的子目录，也可以是 raw_data/xxx 或绝对路径
    const scanRoot = path.isAbsolute(SUB_DIR)
      ? SUB_DIR
      : SUB_DIR.startsWith('raw_data')
        ? path.resolve(ROOT, SUB_DIR)
        : path.join(SKILLS_DIR, SUB_DIR);
    const files = (await listMarkdown(scanRoot)).slice(0, FILE_LIMIT);
    if (!files.length) throw new Error(`no markdown under ${scanRoot}`);
    console.log(`[files] 扫描 ${path.relative(ROOT, scanRoot)}，命中 ${files.length} 个待处理文件（上限 ${FILE_LIMIT}）`);

    for (const file of files) {
      const text = await fs.readFile(file.path, 'utf8');
      const chunks = splitChunks(text, CHUNK_SIZE);
      console.log(`  - ${path.relative(SKILLS_DIR, file.path)}  ${(file.size / 1024).toFixed(1)}KB  ${chunks.length} 块`);
      chunks.forEach((chunk, i) => jobs.push({
        sourcePath: path.relative(ROOT, file.path).replace(/\\/g, '/'),
        text: chunk,
        index: i + 1,
        progressKey: path.relative(ROOT, file.path).replace(/\\/g, '/'),
      }));
    }
    if (CHUNK_LIMIT > 0 && jobs.length > CHUNK_LIMIT) jobs.length = CHUNK_LIMIT;
  }

  // ---- 断点续传：读取进度，跳过已完成文件 ----
  let progress = { files: {} };
  try { progress = JSON.parse(await fs.readFile(PROGRESS_FILE, 'utf8')); } catch { /* 首次运行 */ }
  progress.files ||= {};

  const before = jobs.length;
  const pending = jobs.filter((j) => !progress.files[j.progressKey]);
  const skipped = before - pending.length;
  if (skipped > 0) console.log(`[resume] 跳过已完成 ${skipped} 组，剩余 ${pending.length} 组`);

  const totalByKey = new Map();
  for (const job of pending) {
    const s = totalByKey.get(job.progressKey) || { total: 0, done: 0, cards: 0 };
    s.total += 1;
    totalByKey.set(job.progressKey, s);
  }

  console.log(`[plan] 共 ${pending.length} 个切块，并发 ${CONCURRENCY}，单块 ${CHUNK_SIZE} 字符\n`);

  const saveProgress = async () => {
    progress.updatedAt = new Date().toISOString();
    await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  };

  const limit = createLimiter(CONCURRENCY);
  let done = 0, produced = 0, failed = 0;
  const outHandle = await fs.open(OUT_FILE, 'a');

  await Promise.all(pending.map((job) => limit(async () => {
    const label = `${path.basename(job.sourcePath)}#${job.index}`;
    let cards = [];
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        const raw = await chat(backend, PROMPT + job.text);
        const parsed = extractJsonArray(raw);
        if (!parsed) throw new Error(`unparseable output (${raw.length} chars)`);
        cards = normalizeCards(parsed, {
          source: job.sourcePath,
          chunk: job.index,
          model: backend.model,
          audience: AUDIENCE,
        });
        if (cards.length === 0) throw new Error('parsed array had no valid cards');
        break;
      } catch (e) {
        if (attempt === RETRIES) {
          failed += 1;
          console.error(`  [fail] ${label}: ${String(e.message).slice(0, 120)}`);
        } else {
          await sleep(1500 * (attempt + 1));
        }
      }
    }

    if (cards.length) {
      await outHandle.write(cards.map((c) => JSON.stringify(c)).join('\n') + '\n');
      produced += cards.length;
    }
    done += 1;

    const st = totalByKey.get(job.progressKey);
    if (st) {
      st.done += 1;
      st.cards += cards.length;
      if (st.done >= st.total) {
        progress.files[job.progressKey] = { chunks: st.total, cards: st.cards, at: new Date().toISOString() };
        await saveProgress();
        console.log(`  ✓ ${job.progressKey} 完成（${st.total} 块 / ${st.cards} 卡），进度已保存`);
      }
    }

    console.log(`  [${done}/${pending.length}] ${label} → ${cards.length} 卡`);
  })));

  await outHandle.close();
  console.log(`\n完成：${produced} 张卡写入 ${path.relative(ROOT, OUT_FILE)}（失败块 ${failed}）`);
}

main().catch((e) => {
  console.error(`fatal: ${e.message}`);
  process.exit(1);
});
