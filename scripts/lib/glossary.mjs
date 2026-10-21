import fs from 'node:fs';

let cached = null;

export function loadGlossary(file = 'db/glossary_global.json') {
  if (cached && cached.file === file) return cached.data;
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  cached = { file, data };
  return data;
}

export function termsForLang(glossary, lang) {
  return glossary.terms.filter((term) => Array.isArray(term.translations?.[lang]) && term.translations[lang].length);
}

/** 生成注入 Prompt 的术语表块（只列目标语种）。 */
export function glossaryPromptBlock(glossary, lang) {
  const rows = termsForLang(glossary, lang).map((term) => {
    const source = term.source_terms.slice(0, 2).join(' / ');
    return `- ${source} => ${term.translations[lang].join(' / ')}`;
  });
  if (!rows.length) return '';
  return `【强制术语表】以下术语必须使用指定译法（不得自由发挥）：
${rows.join('\n')}`;
}

function stem(value) {
  const clean = String(value || '').toLowerCase().trim();
  const first = clean.split(/\s+/)[0];
  return first.slice(0, Math.max(4, Math.min(7, first.length - 1 || first.length)));
}

/**
 * 术语强制校验：原文命中 source_terms 时，译文必须包含对应目标语术语（允许词形变化，按词干匹配）。
 */
export function checkGlossary(sourceText, translatedText, lang, glossary) {
  const source = String(sourceText || '').toLowerCase();
  const translated = String(translatedText || '').toLowerCase();
  const missing = [];
  for (const term of termsForLang(glossary, lang)) {
    const hit = term.source_terms.some((s) => source.includes(String(s).toLowerCase()));
    if (!hit) continue;
    const targets = term.translations[lang];
    const matched = targets.some((target) => translated.includes(String(target).toLowerCase()) || translated.includes(stem(target)));
    if (!matched) missing.push({ term: term.id, expected: targets });
  }
  return { ok: missing.length === 0, missing };
}
