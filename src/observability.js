export function createMetrics({ startedAt = Date.now() } = {}) {
  const state = {
    startedAt,
    requests: 0,
    errors: 0,
    rateLimited: 0,
    status: {},
    latencies: [],
    byPath: {}
  };

  function record({ method = 'GET', path = '/', status = 200, durationMs = 0 } = {}) {
    state.requests += 1;
    state.status[String(status)] = (state.status[String(status)] || 0) + 1;
    if (status >= 500) state.errors += 1;
    if (status === 429) state.rateLimited += 1;
    state.latencies.push(Number(durationMs) || 0);
    if (state.latencies.length > 2000) state.latencies.shift();
    const key = `${method} ${path}`;
    state.byPath[key] = (state.byPath[key] || 0) + 1;
  }

  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  }

  function snapshot() {
    return {
      started_at: new Date(state.startedAt).toISOString(),
      uptime_seconds: Math.round((Date.now() - state.startedAt) / 1000),
      requests_total: state.requests,
      errors_total: state.errors,
      rate_limited_total: state.rateLimited,
      status_counts: { ...state.status },
      latency_ms: {
        p50: percentile(state.latencies, 0.5),
        p95: percentile(state.latencies, 0.95),
        max: state.latencies.length ? Math.max(...state.latencies) : 0
      },
      requests_by_path: { ...state.byPath }
    };
  }

  return { record, snapshot };
}
