import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDistillPrompt, parseCards, distillKnowledge } from '../src/knowledge-distill.js';

test('distill: parses structured cards from model output', async () => {
  const llm = {
    complete: async () => ({
      provider: 'openai',
      model: 'deepseek-flash',
      content: JSON.stringify({
        cards: [
          { title: '退货政策', content: '商品需在收货后 30 天内申请退货。', tags: ['退货', '政策'] },
          { title: '物流时效', content: '标准配送 5-8 个工作日。', tags: ['物流'] },
        ],
      }),
    }),
  };
  const result = await distillKnowledge(llm, '退货 30 天内；物流 5-8 天。', 'faq.txt');
  assert.equal(result.cards.length, 2);
  assert.equal(result.cards[0].title, '退货政策');
  assert.equal(result.provider, 'openai');
  assert.equal(result.distilled, true);
});

test('distill: never degrades to a single long card when the model fails', async () => {
  const failing = { complete: async () => ({ error: 'connection refused' }) };
  await assert.rejects(
    () => distillKnowledge(failing, '很长的资料正文', 'scan.pdf'),
    (error) => error.status === 502 && error.code === 'DISTILL_UNAVAILABLE',
  );

  const empty = { complete: async () => ({ provider: 'openai', model: 'm', content: 'not json at all' }) };
  await assert.rejects(
    () => distillKnowledge(empty, '很长的资料正文', 'scan.pdf'),
    (error) => error.status === 502 && error.code === 'DISTILL_INVALID_OUTPUT',
  );
});

test('distill: prompt includes filename and source text; parseCards ignores junk', () => {
  const prompt = buildDistillPrompt('正文内容', 'store-faq.md');
  assert.match(prompt, /store-faq\.md/);
  assert.match(prompt, /正文内容/);
  assert.match(prompt, /1-5 张/);

  assert.deepEqual(parseCards('```json\n{"cards":[{"title":"","content":"x"}]}\n```'), []);
  assert.deepEqual(parseCards('hello'), []);
  const ok = parseCards('{"cards":[{"question":"Q1","answer":"A1","tags":["t"]}]}');
  assert.equal(ok.length, 1);
  assert.equal(ok[0].title, 'Q1');
  assert.equal(ok[0].content, 'A1');
});
