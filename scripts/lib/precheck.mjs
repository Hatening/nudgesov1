/**
 * 入池清洗门禁：在调用任何模型/API 之前，用纯代码拒绝垃圾源卡。
 * 规则：
 *  - 缺失核心字段（id/title/content）
 *  - 正文字数 < 10
 *  - 纯符号/乱码（几乎没有字母或 CJK）
 *  - 符号占比 > 85%（乱码/表格残片）
 */
export function precheckCard(card) {
  if (!card || typeof card !== 'object') return { ok: false, reason: 'MISSING_CARD' };
  if (!card.id || !card.title || !card.content) return { ok: false, reason: 'MISSING_FIELDS' };
  const content = String(card.content).trim();
  if (content.length < 10) return { ok: false, reason: 'TOO_SHORT' };
  const letters = (content.match(/[A-Za-z\u4E00-\u9FFF\u0600-\u06FF\u0400-\u04FF\u0E00-\u0E7F]/g) || []).length;
  if (letters < 5) return { ok: false, reason: 'NO_LETTERS' };
  const symbolRatio = 1 - letters / content.length;
  if (symbolRatio > 0.85) return { ok: false, reason: 'SYMBOL_GARBAGE' };
  return { ok: true };
}
