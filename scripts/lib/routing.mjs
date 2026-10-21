/**
 * 语种级熔断器：同一批次里，某语种连续 N 张卡本地重试后仍不及格，
 * 立即拉黑该语种，后续卡片跳过本地 Qwen，直接走云端。
 */
export class LanguageCircuitBreaker {
  constructor(threshold = 3) {
    if (!Number.isInteger(threshold) || threshold < 1) throw new Error('threshold must be a positive integer');
    this.threshold = threshold;
    this.consecutive = new Map();
    this.forced = new Set();
    this.events = [];
  }

  /** 记录一张卡"本地重试后仍不及格"。返回是否刚刚触发熔断。 */
  noteLocalFailure(lang) {
    if (this.forced.has(lang)) return { triggered: false, forced: true, count: this.consecutive.get(lang) || 0 };
    const count = (this.consecutive.get(lang) || 0) + 1;
    this.consecutive.set(lang, count);
    if (count >= this.threshold) {
      this.forced.add(lang);
      this.events.push({ lang, action: 'forced', count, at: new Date().toISOString() });
      return { triggered: true, forced: true, count };
    }
    return { triggered: false, forced: false, count };
  }

  /** 本地通过一张卡，连续失败计数清零（必须"连续"才熔断）。 */
  noteLocalPass(lang) {
    this.consecutive.set(lang, 0);
  }

  isForced(lang) {
    return this.forced.has(lang);
  }

  forcedLanguages() {
    return [...this.forced];
  }

  snapshot() {
    return {
      threshold: this.threshold,
      consecutive: Object.fromEntries(this.consecutive),
      forced: [...this.forced],
      events: this.events,
    };
  }
}

/**
 * 估算熔断避免的本地无效算力。
 * @param {{skippedLocalCards:number, maxAttempts:number, avgAttemptMs:number, avgTokensPerAttempt:number, powerKw:number, pricePerKwh:number}} input
 */
export function estimateLocalWasteAvoided({ skippedLocalCards, maxAttempts, avgAttemptMs, avgTokensPerAttempt, powerKw = 0.5, pricePerKwh = 0.6 }) {
  const attempts = skippedLocalCards * maxAttempts;
  const ms = attempts * avgAttemptMs;
  const tokens = attempts * avgTokensPerAttempt;
  const kwh = (powerKw * ms) / 3600000;
  return {
    skipped_local_cards: skippedLocalCards,
    avoided_local_attempts: attempts,
    avoided_ms: ms,
    avoided_tokens: tokens,
    avoided_kwh: Number(kwh.toFixed(6)),
    avoided_cny: Number((kwh * pricePerKwh).toFixed(6)),
  };
}
