import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocale, isRtl, t, SUPPORTED_LOCALES } from '../src/i18n.js';
import { detectLanguage } from '../src/core.js';

test('P3-08 i18n: locale normalization, Arabic RTL dictionary and language detection', () => {
  assert.deepEqual(SUPPORTED_LOCALES, ['zh', 'en', 'ar']);
  assert.equal(normalizeLocale('ar-EG'), 'ar');
  assert.equal(normalizeLocale('en_US'), 'en');
  assert.equal(normalizeLocale('fr'), 'zh');
  assert.equal(isRtl('ar'), true);
  assert.equal(isRtl('en'), false);
  assert.equal(t('ar', 'chat.consent'), 'أوافق وأتابع');
  assert.match(t('ar', 'queue.heading'), /التصعيد/);
  assert.match(t('en', 'chat.privacyTitle'), /Privacy/);
  assert.equal(detectLanguage('مرحبا، هل المتجر مفتوح اليوم؟'), 'ar');
  assert.equal(detectLanguage('今天营业到几点？'), 'zh');
  assert.equal(detectLanguage('What time do you close?'), 'en');
});
