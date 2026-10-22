/** 纯 SQL LIKE 候选排序：按词命中数与标题/标签权重打分，并去重同一源卡的翻译副本。 */
export function canonicalKnowledgeId(id) {
  return String(id || '').replace(/^kb_(?:en-US|es-ES|de-DE|fr-FR|pl-PL)_/, '');
}

export function rankByTerms(items, terms, limit = 5) {
  const normalized = terms.map((t) => String(t || '').toLowerCase()).filter(Boolean);
  const scored = items.map((item) => {
    const title = String(item.title || '').toLowerCase();
    const content = String(item.content || '').toLowerCase();
    const tags = (Array.isArray(item.tags) ? item.tags.join(' ') : String(item.tags || '')).toLowerCase();
    let score = 0;
    for (const term of normalized) {
      if (title.includes(term)) score += 6;
      if (tags.includes(term)) score += 3;
      if (content.includes(term)) score += 1;
    }
    return { item, score };
  }).filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  const out = [];
  const seen = new Set();
  for (const { item, score } of scored) {
    const canonical = canonicalKnowledgeId(item.id);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push({ ...item, score });
    if (out.length >= limit) break;
  }
  return out;
}
