/**
 * LanguageTool 本地语法引擎客户端（无需 API 费用）
 *
 * 默认连接本地 LanguageTool HTTP 服务：http://127.0.0.1:8081
 * 通过 /v2/check 获取波兰语语法匹配，并按 replacements[0] 自动修正。
 */
const LT_URL = (process.env.LANGUAGETOOL_URL || 'http://127.0.0.1:8081').replace(/\/$/, '');
const ALLOWED_CATEGORIES = new Set(['GRAMMAR', 'PHONETICS', 'MISC', 'PUNCTUATION', 'TYPOGRAPHY']);
// 品牌名大小写规则会误伤 ShipBob / Amazon 等，直接禁用
const DENIED_RULES = new Set(['NIETYPOWA_KOMBINACJA_DUZYCH_I_MALYCH_LITER', 'UPPERCASE_SENTENCE_START']);

export async function ltAvailable() {
  try {
    const res = await fetch(`${LT_URL}/v2/languages`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function checkText(text, lang = 'pl-PL', { level = 'picky' } = {}) {
  const body = new URLSearchParams({
    text: String(text || ''),
    language: lang,
    level,
    enabledOnly: 'false',
  });
  const res = await fetch(`${LT_URL}/v2/check`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`LanguageTool HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** 按 offset 从后往前替换，避免偏移错位；只应用有替换建议的匹配。 */
export function applyMatches(text, matches) {
  const source = String(text || '');
  const usable = (matches || [])
    .filter((m) => !DENIED_RULES.has(m.rule?.id))
    .filter((m) => !m.rule?.category?.id || ALLOWED_CATEGORIES.has(m.rule.category.id))
    .filter((m) => Array.isArray(m.replacements) && m.replacements.length && m.replacements[0].value !== undefined)
    .sort((a, b) => b.offset - a.offset);
  let output = source;
  let lastOffset = Infinity;
  const applied = [];
  for (const match of usable) {
    if (match.offset + match.length > lastOffset) continue; // 与已应用区间重叠，跳过
    const before = output.slice(match.offset, match.offset + match.length);
    const after = match.replacements[0].value;
    if (before === after) continue;
    output = output.slice(0, match.offset) + after + output.slice(match.offset + match.length);
    applied.push({
      rule: match.rule?.id || 'unknown',
      message: match.message || match.shortMessage || '',
      before,
      after,
      offset: match.offset,
    });
    lastOffset = match.offset;
  }
  return { text: output, applied, remaining: (matches || []).length - applied.length };
}

/**
 * 对 JSON 对象的指定字段做语法修正，Key 保持不变。
 * @returns {{object: object, corrections: Array, checkedFields: string[]}}
 */
export async function correctObjectFields(obj, fields, lang = 'pl-PL') {
  const output = { ...obj };
  const corrections = [];
  const checkedFields = [];
  for (const field of fields) {
    const value = obj?.[field];
    if (typeof value !== 'string' || !value.trim()) continue;
    checkedFields.push(field);
    const result = await checkText(value, lang);
    const fixed = applyMatches(value, result.matches || []);
    if (fixed.applied.length) {
      output[field] = fixed.text;
      corrections.push(...fixed.applied.map((item) => ({ field, ...item })));
    }
  }
  return { object: output, corrections, checkedFields };
}
