import fs from 'node:fs';

let cache = null;

export function loadSynonyms(file = new URL('../db/synonyms.json', import.meta.url)) {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')).expand || {}; } catch { cache = {}; }
  return cache;
}

/** 口语/错别字归一化 + 同义词扩展。 */
export function expandQuery(question, synonyms = loadSynonyms()) {
  const original = String(question || '').trim();
  const normalized = original
    .replace(/咋/g, '怎')
    .replace(/啥/g, '什么')
    .replace(/俺/g, '我')
    .replace(/[?？!！。]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const extras = new Set();
  const lower = normalized.toLowerCase();
  for (const [key, values] of Object.entries(synonyms)) {
    if (lower.includes(key.toLowerCase())) values.forEach((v) => extras.add(v));
  }
  return {
    original,
    normalized,
    expanded: [normalized, ...extras].join(' '),
    additions: [...extras],
  };
}
