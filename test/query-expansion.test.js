import test from 'node:test';
import assert from 'node:assert/strict';
import { expandQuery } from '../src/query-expansion.js';
import { mergeHits } from '../src/semantic-retrieval.js';

test('query expansion normalizes colloquial Chinese and adds synonyms', () => {
  const result = expandQuery('收不到提醒咋回事？');
  assert.equal(result.normalized.includes('怎'), true);
  assert.equal(result.normalized.includes('咋'), false);
  assert.ok(result.additions.includes('通知'));
  assert.ok(result.additions.includes('推送'));
  assert.match(result.expanded, /notification|通知/);
});

test('mergeHits prioritizes semantic hits and de-duplicates lexical', () => {
  const semantic = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  const lexical = [{ id: 'b', title: 'B' }, { id: 'c', title: 'C' }];
  const merged = mergeHits(semantic, lexical, 3);
  assert.deepEqual(merged.map((h) => h.id), ['a', 'b', 'c']);
});

test('mergeHits respects limit', () => {
  const merged = mergeHits([{ id: 'a' }, { id: 'b' }], [{ id: 'c' }], 2);
  assert.equal(merged.length, 2);
});
