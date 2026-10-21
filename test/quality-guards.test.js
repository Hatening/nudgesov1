import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLengthRatio, checkProperNouns, checkBlindBox, lengthUnits } from '../scripts/lib/quality-guards.mjs';
import { BasicAcceptanceAuditor } from '../scripts/lib/audit.mjs';

test('length ratio rejects too short or too long translations', () => {
  const source = '退货政策：商品需在收货后 30 天内申请退货，且保持未使用状态，退款原路返回。';
  const ok = 'Zwrot: produkt można zwrócić w ciągu 30 dni od otrzymania, w niezmienionym stanie, a zwrot pieniędzy wraca tą samą metodą.';
  assert.equal(checkLengthRatio(source, ok).ok, true);
  assert.equal(checkLengthRatio(source, 'Zwrot w 30 dni.').ok, false);
  assert.equal(checkLengthRatio(source, ok.repeat(4)).ok, false);
  assert.ok(lengthUnits(source) > 0);
});

test('proper nouns must be preserved exactly', () => {
  const source = 'ShipBob 如何帮助 Amazon FBA 卖家处理退货？';
  assert.equal(checkProperNouns(source, 'ShipBob pomaga sprzedawcom Amazon FBA w zwrotach.').ok, true);
  const missing = checkProperNouns(source, 'Dostawca pomaga sprzedawcom Amazon FBA w zwrotach.');
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ['ShipBob']);
});

test('blind box combines length and proper noun checks', () => {
  const source = { title: 'ShipBob 退货政策', content: 'ShipBob 提供 30 天退货政策，退款原路返回。', tags: ['退货'] };
  const ok = { title: 'Zasady zwrotu ShipBob', content: 'ShipBob oferuje 30-dniową politykę zwrotów, a zwrot pieniędzy wraca tą samą metodą.', tags: ['Zwrot'] };
  assert.equal(checkBlindBox(source, ok).ok, true);
  const bad = { title: 'Zasady zwrotu', content: 'Zwrot w 30 dni.', tags: [] };
  const result = checkBlindBox(source, bad);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.code === 'LENGTH_RATIO' || f.code === 'PROPER_NOUN_MISSING'));
});

test('auditor triggers every 100 admitted cards and alerts on 2 failures', () => {
  const auditor = new BasicAcceptanceAuditor({ batchSize: 100, sampleSize: 5, alertFailures: 2, passThreshold: 4.5 });
  for (let i = 0; i < 99; i += 1) assert.equal(auditor.recordAdmitted().due, false);
  assert.equal(auditor.recordAdmitted().due, true);
  const pass = auditor.review([4.8, 4.6, 4.9, 4.7, 4.5]);
  assert.equal(pass.alert, false);
  const fail = auditor.review([4.8, 4.2, 4.3, 4.7, 4.5]);
  assert.equal(fail.alert, true);
  assert.equal(auditor.snapshot().alerts.length, 1);
});
