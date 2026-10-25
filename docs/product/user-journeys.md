# NudgeSo critical user journeys

Source of truth: `docs/product/page-registry.json`, Playwright specs, Node tests, and the current running app. A journey is only "covered" when a test asserts the business result, not merely that a page opened.

| ID | Priority | Actor | Journey | Business result asserted | Test evidence | Status |
|---|---|---|---|---|---|---|
| J-01 | P0 | Guest merchant | Landing/login → register → create site → upload/confirm knowledge → embed code | site and confirmed knowledge exist; embed code is shown | `e2e/AC-01.spec.ts`, `e2e/QUALITY-MATRIX.spec.ts` | PASS (local + CI) |
| J-02 | P0 | Customer | Open standalone chat → consent → ask in Chinese → receive a text answer | privacy gate, locale, answer, no ads/third-party requests | `e2e/AC-02.spec.ts`, `e2e/AC-05.spec.ts` | PASS (local + CI) |
| J-03 | P0 | Customer + merchant | Refund/complaint question → safe template + human escalation → merchant queue | safe response and escalation row visible | `e2e/AC-03.spec.ts`, `e2e/QUALITY-MATRIX.spec.ts` | PASS (local + CI) |
| J-04 | P1 | Customer | Voice upload unavailable → ASR fallback → WAV upload → text answer | explicit fallback copy and usable text path | `e2e/AC-04.spec.ts` | PASS (local + CI) |
| J-05 | P0 | Merchant | Open workspace → navigate all 11 views | each view renders, no JS error, no 390px overflow | `e2e/CRAWLER.spec.ts`, `e2e/PHASE13-UI-MATRIX.spec.ts`, `e2e/QUALITY-MATRIX.spec.ts` | PASS (local + CI) |
| J-06 | P0 | Visitor | Open landing → select 39 locales → watch/take over carousel | correct locale, direction, stable canvas, no mobile overflow | `e2e/LANDING-DEMO.spec.ts`, `e2e/QUALITY-MATRIX.spec.ts` | PASS (local + CI) |
| J-07 | P1 | Merchant | Insights list → open detail → return | article renders, link target resolves, ad slots remain labeled | `e2e/INSIGHTS.spec.ts`, `e2e/PHASE13-UI-MATRIX.spec.ts` | PASS (local + CI) |
| J-08 | P0 | Anonymous attacker | Call protected API without session | 401, no tenant data, no stack trace | `e2e/QUALITY-MATRIX.spec.ts`, `test/auth-rbac.test.js`, `test/security-rate-limit.test.js` | PASS (local + CI) |
| J-09 | P1 | Merchant | Export/delete privacy data; retention update | tenant-scoped result, consent/retention behavior | `test/privacy.test.js`, `test/audience-isolation.test.js` | PASS (unit/integration) |
| J-10 | P2 | Visitor | Hit an unknown route | localized 404 page, return link | `e2e/QUALITY-MATRIX.spec.ts` | PASS (local + CI) |

## Journey notes

### J-01 — Merchant onboarding

The test must prove that knowledge is not used before confirmation. A successful page render alone is not acceptance. The isolated fixture uses a generated account and a disposable SQLite database.

### J-02/J-03 — Customer chat and escalation

The chat must not expose another tenant's knowledge. The privacy gate must block the first message until consent. Refund/complaint intent must route to a safe answer and create an escalation; a model-generated answer alone is not evidence of safe handling.

### J-04 — ASR fallback

This is a degraded-path test. It asserts what the customer is told and that text remains usable; it does not assert that a speech provider was available.

### J-06 — Landing localization

All 39 generated locales are a content-coverage matrix, not a native-speaker approval. Native review remains `NOT RUN` until a human reviews the copy.

### Not covered by automation

- Real iOS/Android devices and assistive technologies.
- Native-language semantic quality.
- Production payment, destructive data, or real outbound messages.
- Firefox/WebKit projects.
- Full WCAG/axe audit.
