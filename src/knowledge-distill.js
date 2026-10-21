/**
 * 知识蒸馏：把商家上传的文本拆成结构化问答卡。
 *
 * 规则：
 *  - 必须由模型返回结构化 cards；解析失败或模型不可用一律报错（502），
 *    绝不退化为“整篇长文单卡”。
 *  - 本地 Qwen 与云端 DeepSeek 的路由由 llm.complete 负责（本地失败自动切云端）。
 */

export const MAX_CARDS = 5;

export function buildDistillPrompt(text, filename) {
  return `你是电商知识库结构化专家。请把下面这份商家上传的资料拆成 1-${MAX_CARDS} 张独立的问答知识卡。
要求：
1. 只能使用资料中出现的事实，不得补充资料中没有的政策、金额、时限或承诺。
2. 每张卡包含 title、content、tags（字符串数组）。
3. 如果资料包含多个独立主题，请分别成卡；不要把所有内容塞进一张卡。
4. 只输出 JSON 对象，不要解释、不要 Markdown 围栏。

输出格式：{"cards":[{"title":"...","content":"...","tags":["..."]}]}

文件名：${filename}
资料正文：
${String(text).slice(0, 8000)}`;
}

export function parseCards(content) {
  if (!content) return [];
  const clean = String(content).replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = clean.indexOf('{');
  if (start === -1) return [];
  const end = clean.lastIndexOf('}');
  if (end <= start) return [];
  let parsed;
  try { parsed = JSON.parse(clean.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(parsed.cards)) return [];
  return parsed.cards
    .map((card) => ({
      title: String(card.title || card.question || '').trim().slice(0, 180),
      content: String(card.content || card.answer || '').trim().slice(0, 20000),
      tags: Array.isArray(card.tags) ? card.tags.slice(0, 12).map((t) => String(t).trim()).filter(Boolean) : [],
    }))
    .filter((card) => card.title && card.content)
    .slice(0, MAX_CARDS);
}

/**
 * @param {{ complete: (prompt: string, settings?: object) => Promise<any> }} llm
 * @returns {Promise<{cards: Array, provider: string, model: string, distilled: true}>}
 */
export async function distillKnowledge(llm, text, filename, settings = {}) {
  const result = await llm.complete(buildDistillPrompt(text, filename), settings);
  if (!result || result.error) {
    const error = new Error(`蒸馏服务不可用：${result?.error || '未配置模型'}`);
    error.status = 502;
    error.code = 'DISTILL_UNAVAILABLE';
    throw error;
  }
  const cards = parseCards(result.content);
  if (!cards.length) {
    const error = new Error('蒸馏失败：模型未返回结构化卡片，请重试或更换文件');
    error.status = 502;
    error.code = 'DISTILL_INVALID_OUTPUT';
    throw error;
  }
  return { cards, provider: result.provider, model: result.model, distilled: true };
}
