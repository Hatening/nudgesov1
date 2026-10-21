import test from 'node:test';
import assert from 'node:assert/strict';
import { applyMatches } from '../scripts/lib/languagetool.mjs';

const grammarMatch = (offset, length, before, after, rule = 'Z_ZE') => ({
  offset, length,
  message: 'test',
  rule: { id: rule, category: { id: 'PHONETICS' } },
  replacements: [{ value: after }],
  context: { text: '', offset: 0, length: 0 },
});

test('applyMatches fixes Polish z -> ze preposition', () => {
  const text = 'Problemy z zgodnością i wysyłką.';
  const result = applyMatches(text, [grammarMatch(9, 1, 'z', 'ze')]);
  assert.match(result.text, /ze zgodnością/);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].before, 'z');
});

test('applyMatches ignores casing rules that would damage brand names', () => {
  const text = 'ShipBob oferuje usługi.';
  const match = {
    offset: 0, length: 7, message: 'casing', rule: { id: 'NIETYPOWA_KOMBINACJA_DUZYCH_I_MALYCH_LITER', category: { id: 'CASING' } },
    replacements: [{ value: 'shipbob' }],
  };
  const result = applyMatches(text, [match]);
  assert.equal(result.text, text);
  assert.equal(result.applied.length, 0);
});

test('applyMatches handles multiple corrections without offset drift', () => {
  const text = 'z zgodnością oraz z zespołem.';
  const matches = [
    { offset: 18, length: 1, rule: { id: 'Z_ZE', category: { id: 'PHONETICS' } }, message: '', replacements: [{ value: 'ze' }] },
    { offset: 0, length: 1, rule: { id: 'Z_ZE', category: { id: 'PHONETICS' } }, message: '', replacements: [{ value: 'ze' }] },
  ];
  const result = applyMatches(text, matches);
  assert.equal(result.text, 'ze zgodnością oraz ze zespołem.');
  assert.equal(result.applied.length, 2);
});

test('applyMatches skips matches without replacements', () => {
  const text = 'To jest tekst.';
  const result = applyMatches(text, [{ offset: 0, length: 2, rule: { id: 'X', category: { id: 'GRAMMAR' } }, replacements: [] }]);
  assert.equal(result.text, text);
});
