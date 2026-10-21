import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTranslation, checkKeys, checkLanguage, checkEntities, collectKeyPaths, languageStats,
} from '../scripts/lib/translate-validate.mjs';

const source = {
  id: 'card-acos-001',
  title: 'ACOS 广告优化',
  content: 'ACOS = 广告花费 ÷ 广告销售额。目标是把 ACOS 控制在 25% 以下。例如广告花费 500 美元、广告销售额 2000 美元时，ACOS 为 25%。',
  tags: ['广告与营销', 'ACOS'],
};

const polish = {
  id: 'card-acos-001',
  title: 'Optymalizacja reklam ACOS',
  content: 'ACOS = wydatki na reklamę ÷ sprzedaż z reklam. Celem jest utrzymanie ACOS poniżej 25%. Na przykład przy wydatkach 500 USD i sprzedaży 2000 USD ACOS wynosi 25%.',
  tags: ['Reklama i marketing', 'ACOS'],
};

test('valid Polish translation passes all three physical checks', () => {
  const result = validateTranslation(source, polish, 'pl');
  assert.equal(result.ok, true, JSON.stringify(result.failures));
});

test('English output is rejected by language assertion (80% English / no Polish signal)', () => {
  const english = {
    id: 'card-acos-001',
    title: 'ACOS advertising optimization',
    content: 'ACOS is ad spend divided by ad sales. Keep ACOS under 25% at all times.',
    tags: ['advertising', 'optimization'],
  };
  const result = validateTranslation(source, english, 'pl');
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.code === 'LANG_MISMATCH'), JSON.stringify(result.failures));
});

test('missing or extra keys are rejected', () => {
  const missing = { ...polish };
  delete missing.tags;
  assert.equal(checkKeys(source, missing).ok, false);

  const extra = { ...polish, extra_field: 'x' };
  assert.equal(checkKeys(source, extra).ok, false);

  assert.equal(collectKeyPaths({ a: { b: 1 }, list: [{ c: 2 }] }).has('a.b'), true);
  assert.equal(collectKeyPaths({ a: { b: 1 }, list: [{ c: 2 }] }).has('list[].c'), true);
});

test('missing numbers or symbols are rejected (entity comparison)', () => {
  const lossy = { ...polish, content: polish.content.replace('500 USD', 'pięćset').replaceAll('÷', '/') };
  const entities = checkEntities(source.content, lossy.content);
  assert.equal(entities.ok, false);
  assert.ok(entities.missingNumbers.includes('500') || entities.missingSymbols.includes('÷'));

  const result = validateTranslation(source, lossy, 'pl');
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((f) => f.code === 'ENTITY_MISSING'));
});

test('Swahili: English output rejected, real Swahili passes', () => {
  const swahili = {
    id: 'card-acos-001',
    title: 'Uboreshaji wa matangazo ya ACOS',
    content: 'ACOS = gharama za matangazo ÷ mauzo ya matangazo. Lengo ni kuweka ACOS chini ya 25%. Kwa mfano, gharama 500 USD na mauzo 2000 USD hutoa ACOS ya 25%.',
    tags: ['Matangazo', 'ACOS'],
  };
  assert.equal(validateTranslation(source, swahili, 'sw').ok, true, JSON.stringify(validateTranslation(source, swahili, 'sw').failures));
  assert.equal(checkLanguage('ACOS is ad spend divided by ad sales', 'sw').ok, false);
});

test('language stats expose English ratio and target-language signal', () => {
  const stats = languageStats('ACOS is ad spend divided by ad sales and the budget', 'pl');
  assert.ok(stats.englishHits > 0);
  assert.equal(stats.hasDiacritics, false);
});

test('content must be non-empty and must not be the untranslated original', () => {
  const empty = { ...polish, content: '   ' };
  const emptyResult = validateTranslation(source, empty, 'pl');
  assert.equal(emptyResult.ok, false);
  assert.ok(emptyResult.failures.some((f) => f.code === 'CONTENT_EMPTY'));

  const untranslated = { ...polish, content: source.content };
  const untranslatedResult = validateTranslation(source, untranslated, 'pl');
  assert.equal(untranslatedResult.ok, false);
  assert.ok(untranslatedResult.failures.some((f) => f.code === 'UNTRANSLATED'));
});

test('non-Latin script locales require target-script output (Persian)', () => {
  const persian = {
    id: 'card-acos-001',
    title: 'بهینه‌سازی تبلیغات ACOS',
    content: 'ACOS = هزینه تبلیغات ÷ فروش تبلیغاتی. هدف نگه داشتن ACOS زیر 25% است. برای مثال با هزینه 500 دلار و فروش 2000 دلار، ACOS برابر 25% می‌شود.',
    tags: ['تبلیغات', 'ACOS'],
  };
  const pass = validateTranslation(source, persian, 'fa', { script: 'Arab' });
  assert.equal(pass.ok, true, JSON.stringify(pass.failures));

  const english = { ...polish, content: 'ACOS is ad spend divided by ad sales. Keep it under 25%.' };
  const fail = validateTranslation(source, english, 'fa', { script: 'Arab' });
  assert.equal(fail.ok, false);
  assert.ok(fail.failures.some((f) => f.code === 'LANG_MISMATCH'));
});
