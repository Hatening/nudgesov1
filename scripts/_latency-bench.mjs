const url = 'http://127.0.0.1:3030/api/chat';
const body = JSON.stringify({ message: '我的订单显示已签收但没收到，怎么办？', language: 'zh' });
async function once() {
  const t = Date.now();
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  await res.text();
  return { ms: Date.now() - t, status: res.status };
}
await new Promise((r) => setTimeout(r, 3000));
for (let i = 0; i < 3; i += 1) await once();
const results = [];
for (let i = 0; i < 20; i += 1) results.push(await once());
const times = results.map((r) => r.ms).sort((a, b) => a - b);
const p = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
console.log(JSON.stringify({ statuses: [...new Set(results.map((r) => r.status))], min: times[0], p50: p(0.5), p95: p(0.95), max: times[times.length - 1], samples: times }, null, 2));
