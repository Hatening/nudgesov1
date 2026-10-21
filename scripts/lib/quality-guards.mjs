/**
 * 盲盒排雷：入库前的极便宜本地规则。
 *  - 长度比例：译文/原文的"语义单位"比例必须在 0.5~1.5
 *  - 专有名词：原文出现的品牌/平台名，译文必须原样保留（大小写敏感）
 */

export const DEFAULT_PROPER_NOUNS = [
  'ShipBob', 'Amazon', 'FBA', 'Shopify', 'TikTok', 'eBay', 'Google', 'Walmart',
  'IPP', 'SCOR', 'RMA', 'ACOS', 'ROAS', 'Wix', 'Zelle', 'Western Union',
];

/** 粗略语义单位：CJK 字符 1 个，拉丁词 1.8 个（让中英长度可比）。 */
export function lengthUnits(text) {
  const source = String(text || '');
  const cjk = (source.match(/[\u4E00-\u9FFF]/g) || []).length;
  const latin = (source.match(/[A-Za-zÀ-ÿ]+/g) || []).length;
  return cjk + latin * 1.5;
}

export function checkLengthRatio(sourceText, translatedText, { min = 0.5, max = 1.5 } = {}) {
  const sourceUnits = lengthUnits(sourceText);
  const translatedUnits = lengthUnits(translatedText);
  if (sourceUnits === 0) return { ok: true, ratio: 1, source_units: 0, translated_units: translatedUnits };
  const ratio = translatedUnits / sourceUnits;
  return {
    ok: ratio >= min && ratio <= max,
    ratio: Number(ratio.toFixed(2)),
    source_units: Number(sourceUnits.toFixed(1)),
    translated_units: Number(translatedUnits.toFixed(1)),
  };
}

export function checkProperNouns(sourceText, translatedText, nouns = DEFAULT_PROPER_NOUNS) {
  const source = String(sourceText || '');
  const translated = String(translatedText || '');
  const missing = nouns.filter((noun) => source.includes(noun) && !translated.includes(noun));
  return { ok: missing.length === 0, missing };
}

export function checkBlindBox(source, translated) {
  const sourceText = [source?.title, source?.content, ...(source?.tags || [])].filter(Boolean).join('\n');
  const translatedText = [translated?.title, translated?.content, ...(translated?.tags || [])].filter(Boolean).join('\n');
  const length = checkLengthRatio(sourceText, translatedText);
  const nouns = checkProperNouns(sourceText, translatedText);
  const failures = [];
  if (!length.ok) failures.push({ code: 'LENGTH_RATIO', detail: `ratio ${length.ratio} outside 0.5-1.5` });
  if (!nouns.ok) failures.push({ code: 'PROPER_NOUN_MISSING', detail: nouns.missing.join(',') });
  return { ok: failures.length === 0, failures, length, nouns };
}
