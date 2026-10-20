import http from 'node:http';

const port = Number(process.env.MOCK_LLM_PORT || 4010);

function answerFor(text) {
  if (/几点|营业|开门|关门|下班|hours|open|close/i.test(text)) {
    return '您好！我们每天都是早上9点开门，晚上9点关门，欢迎您随时过来～';
  }
  if (/包裹|物流|快递|送达|package|parcel|delivery|shipping/i.test(text)) {
    return '您好！标准快递一般 3-5 个工作日送达，您可以根据这个时间留意物流进度～';
  }
  return '您好，我已经看到您的问题了，会尽量帮您确认，请您稍等一下。';
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'mock-llm' }));
    return;
  }
  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 2_000_000) req.destroy();
  });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch {}
    const userText = [...(body.messages || [])].reverse().find((message) => message.role === 'user')?.content || '';
    const answer = answerFor(String(userText));
    const content = JSON.stringify({ answer, confidence: 0.95, needs_human: false });
    if (body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (let offset = 0; offset < content.length; offset += 24) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(offset, offset + 24) } }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: `mock-${Date.now()}`,
      model: body.model || 'deepseek-flash',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 40, completion_tokens: 30, total_tokens: 70 }
    }));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock LLM listening on http://127.0.0.1:${port}/v1 (hermetic CI only)`);
});
