import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mapping = JSON.parse(fs.readFileSync('config/language_mapping.json', 'utf8'));
const byCode = new Map(mapping.languages.map((l) => [l.code, l]));

test('language mapping covers at least 40 locales across three tiers', () => {
  assert.ok(mapping.languages.length >= 40, `only ${mapping.languages.length} locales`);
  const tiers = new Set(mapping.languages.map((l) => l.tier));
  assert.deepEqual([...tiers].sort(), [1, 2, 3]);
  for (const lang of mapping.languages) {
    assert.ok(lang.code && lang.language && lang.name_zh && lang.name_en, `incomplete entry ${lang.code}`);
    assert.ok([1, 2, 3].includes(lang.tier), `bad tier for ${lang.code}`);
    assert.ok(lang.script, `missing script for ${lang.code}`);
    assert.equal(lang.cloud_review_required, lang.tier === 3, `tier3 cloud review flag wrong for ${lang.code}`);
  }
});

test('required strategic locales are present with expected tiers', () => {
  const expected = {
    'es-ES': 1, 'pt-BR': 1, 'de-DE': 1, 'fr-FR': 1, 'ar-SA': 1,
    'pl-PL': 2, 'cs-CZ': 2, 'el-GR': 2, 'sv-SE': 2,
    'sw-KE': 3, 'zu-ZA': 3, 'fa-IR': 3, 'am-ET': 3, 'ha-NG': 3,
  };
  for (const [code, tier] of Object.entries(expected)) {
    assert.ok(byCode.has(code), `missing ${code}`);
    assert.equal(byCode.get(code).tier, tier, `${code} should be Tier ${tier}`);
  }
});

test('tier 3 locales are RTL/script annotated where applicable', () => {
  assert.equal(byCode.get('fa-IR').rtl, true);
  assert.equal(byCode.get('fa-IR').script, 'Arab');
  assert.equal(byCode.get('sw-KE').script, 'Latn');
  assert.equal(byCode.get('am-ET').script, 'Ethi');
});
