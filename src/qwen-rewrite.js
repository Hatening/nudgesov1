/**
 * 纯 Qwen 查询改写：单并发串行，把口语问题改写成 5-10 个 SQL LIKE 检索词。
 * 无向量、无 embedding。
 */
const LOCAL_BASE = (process.env.LOCAL_BASE_URL || 'http://192.168.3.227:3679/v1').replace(/\/$/, '');
const LOCAL_MODEL = process.env.LOCAL_MODEL_NAME || 'qwen3.8-35b-a3b@q5_k_m';
const CACHE_MAX = 500;
const cache = new Map();
let chain = Promise.resolve();

const FALLBACK = {
  '包裹': ['物流', '快递', 'shipping', 'delivery', 'parcel'],
  '快递': ['物流', 'shipping', 'delivery'],
  '没到': ['未收到', '延迟', 'delay', 'not received'],
  '退款': ['退货', 'refund', 'return'],
  '收不到': ['未收到', '通知', 'notification'],
  '提醒': ['通知', 'notification', 'push'],
  '广告': ['ACOS', '广告投放', 'advertising', 'ads'],
};

function fallbackTerms(question) {
  const terms = new Set();
  for (const [key, values] of Object.entries(FALLBACK)) if (question.includes(key)) values.forEach((v) => terms.add(v));
  for (const token of question.replace(/[，。！？、,.!?]/g, ' ').split(/\s+/)) {
    if (token.length >= 2 && token.length <= 12) terms.add(token);
  }
  return [...terms].slice(0, 10);
}

function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

function extractJson(text) {
  const clean = String(text || '').replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('[');
  const end = clean.lastIndexOf(']');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(clean.slice(start, end + 1)); } catch { return null; }
}

async function callQwen(question) {
  const prompt = `把用户问题改写成 5-10 个用于 SQL LIKE 模糊检索的关键词（中文或英文），覆盖同义词、口语、错别字、缩写。
只输出 JSON 数组，例如：["物流","快递","未收到","shipping","delivery","delay"]
用户问题：${question}`;
  const res = await fetch(`${LOCAL_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: LOCAL_MODEL, temperature: 0.2, max_tokens: 300,
      messages: [{ role: 'system', content: '你是检索词改写器。只输出 JSON 数组。' }, { role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const parsed = extractJson(data.choices?.[0]?.message?.content);
  const terms = (Array.isArray(parsed) ? parsed : []).map((x) => String(x || '').trim()).filter((x) => x.length >= 1 && x.length <= 20);
  return [...new Set(terms)].slice(0, 10);
}

export function rewriteQuery(question) {
  const key = String(question || '').trim();
  if (!key) return Promise.resolve([]);
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  return enqueue(async () => {
    let terms;
    try {
      terms = await callQwen(key);
      if (!terms.length) terms = fallbackTerms(key);
    } catch {
      terms = fallbackTerms(key);
    }
    cache.set(key, terms);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    return terms;
  });
}
