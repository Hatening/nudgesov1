import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadGlossary, glossaryPromptBlock, checkGlossary } from '../scripts/lib/glossary.mjs';
import {
  validateTranslation, checkDetectedLanguage, checkGrammarSample, detectLanguage,
} from '../scripts/lib/translate-validate.mjs';

const glossary = loadGlossary('db/glossary_global.json');

const source = {
  id: 'kb_return_001',
  title: '退货政策',
  content: '退货需在收货后 30 天内申请，退款原路返回。',
  tags: ['退货'],
};

const polish = {
  id: 'kb_return_001',
  title: 'Zasady zwrotu',
  content: 'Zwrot należy zgłosić w ciągu 30 dni od otrzymania przesyłki, a zwrot pieniędzy zostanie wykonany tą samą metodą płatności.',
  tags: ['Zwrot'],
};

test('glossary file defines e-commerce terms with Polish mappings', () => {
  assert.ok(Array.isArray(glossary.terms) && glossary.terms.length >= 10);
  const returns = glossary.terms.find((t) => t.id === 'return');
  assert.equal(returns.translations.pl[0], 'Zwrot');
  const prompt = glossaryPromptBlock(glossary, 'pl');
  assert.match(prompt, /退货/);
  assert.match(prompt, /Zwrot/);
});

test('glossary enforcement fails when required Polish term is missing', () => {
  assert.equal(checkGlossary(source.content, polish.content, 'pl', glossary).ok, true);
  const missing = { ...polish, title: 'Zasady obsługi', content: 'Zgłoszenie należy złożyć w ciągu 30 dni, a pieniądze wrócą tą samą metodą.' };
  const result = checkGlossary(source.content, missing.content, 'pl', glossary);
  assert.equal(result.ok, false);
  assert.ok(result.missing.some((m) => m.term === 'return' || m.term === 'refund'), JSON.stringify(result.missing));
});

test('tinyld detects Polish and rejects English', () => {
  assert.equal(detectLanguage('To jest polski tekst o zwrotach i dostawach dla klientów sklepu.'), 'pl');
  assert.equal(checkDetectedLanguage(polish.content, 'pl').ok, true);
  const english = 'This is an English text about returns and refunds for customers.';
  const detected = checkDetectedLanguage(english, 'pl');
  assert.equal(detected.ok, false);
  assert.equal(detected.code, 'LANG_DETECTED_MISMATCH');
});

test('50-char grammar sample rejects English/mixed output', () => {
  const grammar = checkGrammarSample(polish.content, 'pl');
  assert.equal(grammar.ok, true);
  const mixed = 'The return is processed and the customer is notified, and the refund is sent by the team.';
  const result = checkGrammarSample(mixed, 'pl');
  assert.equal(result.ok, false);
  assert.ok(['GRAMMAR_SUSPECT', 'MIXED_ENGLISH'].includes(result.code));
});

test('full validation passes only with keys, content, language, grammar and glossary', () => {
  const ok = validateTranslation(source, polish, 'pl', { glossary });
  assert.equal(ok.ok, true, JSON.stringify(ok.failures));

  const noGlossary = { ...polish, title: 'Zasady obsługi', tags: [], content: 'Zgłoszenie należy złożyć w ciągu 30 dni, a pieniądze wrócą tą samą metodą.' };
  const failed = validateTranslation(source, noGlossary, 'pl', { glossary });
  assert.equal(failed.ok, false);
  assert.ok(failed.failures.some((f) => f.code === 'GLOSSARY_MISSING'), JSON.stringify(failed.failures));
});

test('vendored tinyld library is present', () => {
  assert.ok(fs.existsSync('vendor/tinyld.normal.node.mjs'));
  assert.ok(fs.statSync('vendor/tinyld.normal.node.mjs').size > 100000);
});
