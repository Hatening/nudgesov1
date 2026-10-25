# Internationalization policy

## Locale sources

| Surface | Source | Expected coverage |
|---|---|---|
| Shell UI | `public/ui-locales.js` plus `zh` default | 40 effective locales (39 bundles + zh default) |
| Landing page | `public/landing-locales.js` | 39 generated locales plus `en` |
| Landing demo | `public/demo-locales.js` | 39 generated locales plus `en` |
| Runtime app messages | `src/i18n.js` | `zh`, `en`, `ar`; RTL `ar` |

## Static rules

1. Every locale object has the same keys as its base dictionary.
2. No empty translated value.
3. Placeholder sets must match the base dictionary; mismatch is a warning until
   the affected ICU construct is reviewed.
4. `html lang` must equal the selected locale.
5. RTL locales are `ar`, `he`, `fa`, `ur`; the landing and demo set `dir="rtl"`.
6. No blanket "English page must not contain CJK" assertion. Product names,
   quoted source text and intentional bilingual labels are allowed; checks use
   locale, known keys, expected control copy and an explicit allowlist.
7. Locale selection persists in `localStorage` and accepts `?lang=` on first
   load. Refresh must preserve the selected locale.
8. Do not build sentences by concatenating fragments; use whole-string keys or
   a placeholder-aware formatter.

## Runtime matrix

- All 39 landing locales: render, non-empty hero, correct direction.
- Seven risk languages: `en`, `de`, `uk`, `ar`, `he`, `zh-CN`, `zh-TW` at 390px.
- Arabic: `dir=rtl` on page and demo.
- Long German/Ukrainian: no horizontal overflow at 320/390.
- Existing Phase 13 matrix checks all generated UI locale bundles at 390px.

## Allowed residue policy

A string may remain untranslated only when it is:

- the brand/product name (`NudgeSo`, `RelayDesk`);
- a quoted source message or fixture;
- a technical token, URL, email, API key name or code sample;
- explicitly listed in a test allowlist with a reason.

The static audit does not ban CJK globally. It reports structure and empty values.

## Not run

- Native-speaker review of the 39 generated landing/demo/UI sets.
- Pseudo-localization expansion pass.
- Font glyph coverage per locale.
- Live RTL screen-reader testing.
