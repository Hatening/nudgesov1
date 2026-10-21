import test from 'node:test';
import assert from 'node:assert/strict';
import { precheckCard } from '../scripts/lib/precheck.mjs';

const base = { id: 'kb_1', title: '退货政策', content: '商品需在收货后 30 天内申请退货，且保持未使用状态。' };

test('valid source card passes precheck', () => {
  assert.equal(precheckCard(base).ok, true);
});

test('too short content is rejected before any model call', () => {
  assert.equal(precheckCard({ ...base, content: '退货' }).reason, 'TOO_SHORT');
});

test('pure symbols/garbage is rejected', () => {
  assert.equal(precheckCard({ ...base, content: '!!!@@@###$$$%%%^^^&&&***((()))' }).reason, 'NO_LETTERS');
});

test('missing core fields are rejected', () => {
  assert.equal(precheckCard({ ...base, title: '' }).reason, 'MISSING_FIELDS');
  assert.equal(precheckCard(null).ok, false);
});

test('table fragments with very high symbol ratio are rejected', () => {
  const garbage = '|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|--|';
  assert.equal(precheckCard({ ...base, content: garbage }).ok, false);
});
