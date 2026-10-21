/**
 * 翻译结果物理校验（本地 Qwen / 云端 DeepSeek 共用）
 *
 * 三条硬规则：
 *  1. JSON 结构：可解析，且对象 Key 路径与原版完全一致
 *  2. 语种断言：目标语种为 sw/pl 等时，若结果 80% 以上是英文词，或完全检测不到目标语特征 → LOCAL_FAILED
 *  3. 实体比对：原文中的数字与特殊符号必须原样出现在译文中
 */

const EN_WORDS = new Set(`
the a an and or of to in for on with is are was were be been being by at from this that these those
it its as not no yes you your we our they their he she his her can could will would shall should may
might must do does did done have has had having if then than so such but also more most less least
about into over under between during before after above below up down out off again further once here
there when where why how all any both each few many some own same other another very just only too
ad ads spend spending sales sale sales cost costs budget campaign campaigns keyword keywords bid bids
keep under target result results divided divide click clicks conversion conversions revenue return returns
customer customers product products order orders store stores market markets price prices shipping delivery
` .split(/\s+/).filter(Boolean));

const TARGET_STOPWORDS = {
  pl: new Set(`
    i w na z do nie jest są się że to oraz lub ale dla od po przez przy tym tego tej te ten ta jak
    co który która które ze za pod nad być może można także już tylko bardzo jako którymi których
    ` .split(/\s+/).filter(Boolean)),
  sw: new Set(`
    na ya kwa ni wa katika hii hiyo huyo kama za la kwenye kutoka hadi au lakini pia sana yake zake wake
    ni kitu hiki hicho cha vya kwa hivyo hiyo huo huo wao sisi wewe mimi yeye
    ` .split(/\s+/).filter(Boolean)),
  en: EN_WORDS,
};

const SYMBOLS = ['%', '$', '€', '£', '¥', '#', '@', '+', '=', '×', '÷'];
const DIACRITICS = /[ąćęłńóśźż]/i;

export function collectKeyPaths(value, prefix = '') {
  const paths = new Set();
  if (Array.isArray(value)) {
    for (const item of value) {
      for (const p of collectKeyPaths(item, `${prefix}[]`)) paths.add(p);
    }
    return paths;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const p = prefix ? `${prefix}.${key}` : key;
      paths.add(p);
      for (const nested of collectKeyPaths(child, p)) paths.add(nested);
    }
  }
  return paths;
}

export function tokenize(text) {
  return String(text || '').toLowerCase().match(/[a-zà-ÿąćęłńóśźż]+/g) || [];
}

export function languageStats(text, lang) {
  const tokens = tokenize(text);
  const total = tokens.length || 1;
  const englishHits = tokens.filter((t) => EN_WORDS.has(t)).length;
  const targetHits = tokens.filter((t) => TARGET_STOPWORDS[lang]?.has(t)).length;
  return {
    tokens: tokens.length,
    englishHits,
    englishRatio: englishHits / total,
    targetHits,
    hasDiacritics: DIACRITICS.test(String(text || '')),
  };
}

export function extractEntities(text) {
  const numbers = String(text || '').match(/\d+(?:[.,]\d+)?%?/g) || [];
  const symbols = SYMBOLS.filter((symbol) => String(text || '').includes(symbol));
  return { numbers, symbols };
}

export function checkKeys(source, translated) {
  const sourceKeys = collectKeyPaths(source);
  const translatedKeys = collectKeyPaths(translated);
  const missing = [...sourceKeys].filter((key) => !translatedKeys.has(key));
  const extra = [...translatedKeys].filter((key) => !sourceKeys.has(key));
  return { ok: missing.length === 0 && extra.length === 0, missing, extra };
}

export function checkLanguage(text, lang) {
  const stats = languageStats(text, lang);
  if (lang === 'en') return { ok: true, stats };
  // 规则 1：英文词占比 >= 80%（按英文常用词命中率近似）
  if (stats.tokens >= 8 && stats.englishRatio >= 0.8) {
    return { ok: false, code: 'LANG_MISMATCH', detail: `English ratio ${(stats.englishRatio * 100).toFixed(0)}% >= 80%`, stats };
  }
  // 规则 2：完全检测不到目标语特征（波兰语无变音符号且目标停用词命中为 0；斯瓦希里语停用词命中为 0）
  if (lang === 'pl' && stats.targetHits === 0 && !stats.hasDiacritics && stats.tokens >= 10) {
    return { ok: false, code: 'LANG_MISMATCH', detail: 'no Polish diacritics/stopwords detected', stats };
  }
  if (lang === 'sw' && stats.targetHits === 0 && stats.tokens >= 10) {
    return { ok: false, code: 'LANG_MISMATCH', detail: 'no Swahili stopwords detected', stats };
  }
  return { ok: true, stats };
}

export function checkEntities(sourceText, translatedText) {
  const source = extractEntities(sourceText);
  const missingNumbers = source.numbers.filter((n) => !String(translatedText).includes(n));
  const missingSymbols = source.symbols.filter((s) => !String(translatedText).includes(s));
  return { ok: missingNumbers.length === 0 && missingSymbols.length === 0, missingNumbers, missingSymbols, source };
}

function flattenText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenText).join('\n');
  if (value && typeof value === 'object') return Object.values(value).map(flattenText).join('\n');
  return '';
}

/**
 * 完整校验入口。
 * @returns {{ok:boolean, failures:Array<{code:string,detail:string}>}}
 */
export function validateTranslation(source, translated, targetLang) {
  const failures = [];
  if (!translated || typeof translated !== 'object') {
    return { ok: false, failures: [{ code: 'JSON_INVALID', detail: 'translated result is not an object' }] };
  }

  const keys = checkKeys(source, translated);
  if (!keys.ok) {
    failures.push({ code: 'KEY_MISMATCH', detail: `missing=[${keys.missing.join(',')}] extra=[${keys.extra.join(',')}]` });
  }

  const sourceText = flattenText(source);
  const translatedText = flattenText(translated);
  const lang = checkLanguage(translatedText, targetLang);
  if (!lang.ok) failures.push({ code: lang.code, detail: lang.detail });

  const entities = checkEntities(sourceText, translatedText);
  if (!entities.ok) {
    failures.push({
      code: 'ENTITY_MISSING',
      detail: `numbers=[${entities.missingNumbers.join(',')}] symbols=[${entities.missingSymbols.join(',')}]`,
    });
  }

  return { ok: failures.length === 0, failures, stats: { keys, language: lang.stats, entities: entities.source } };
}
