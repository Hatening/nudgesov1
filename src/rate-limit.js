export function createRateLimiter({ now = () => Date.now() } = {}) {
  const buckets = new Map();

  function hit(key, limit, windowMs) {
    const current = now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= current) {
      bucket = { count: 0, resetAt: current + windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000)),
        resetAt: bucket.resetAt
      };
    }
    bucket.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterSec: 0,
      resetAt: bucket.resetAt
    };
  }

  function reset() {
    buckets.clear();
  }

  return { hit, reset };
}
