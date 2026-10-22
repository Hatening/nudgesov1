import test from 'node:test';
import assert from 'node:assert/strict';
import { expandQuery } from '../src/query-expansion.js';
import { rankByTerms, canonicalKnowledgeId } from '../src/like-retrieval.js';

test('query expansion normalizes colloquial Chinese and adds synonyms', () => {
  const result = expandQuery('收不到提醒咋回事？');
  assert.equal(result.normalized.includes('怎'), true);
  assert.equal(result.normalized.includes('咋'), false);
  assert.ok(result.additions.includes('通知'));
  assert.ok(result.additions.includes('推送'));
  assert.match(result.expanded, /notification|通知/);
});

test('rankByTerms weights title hits and de-duplicates translations', () => {
  const items = [
    { id: 'kb_pl-PL_kb_a', title: '物流延迟怎么办', content: '包裹未收到', tags: ['shipping'] },
    { id: 'kb_b', title: '广告 ACOS 优化', content: '广告投放', tags: ['ads'] },
    { id: 'kb_en-US_kb_a', title: 'Shipping delay', content: 'parcel not received', tags: ['delivery'] },
  ];
  const hits = rankByTerms(items, ['物流', 'shipping'], 5);
  assert.equal(hits[0].id, 'kb_pl-PL_kb_a');
  assert.equal(hits.filter((h) => canonicalKnowledgeId(h.id) === 'kb_a').length, 1);
});

test('rankByTerms respects limit and drops zero-score items', () => {
  const hits = rankByTerms([{ id: 'a', title: 'x', content: 'y', tags: [] }], ['nope'], 5);
  assert.equal(hits.length, 0);
});
