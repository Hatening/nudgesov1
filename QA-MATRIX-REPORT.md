# NudgeSo QA Matrix Report

Date: 2026-10-24  
Scope: NudgeSo / `nudgev2` only. The shared DeepSeek conversation also discusses
the separate K12 product (`minolet_V00`); its A1–A26 billing anchors are **not**
applicable to NudgeSo and are not silently copied here.

## Evidence

- `artifacts/qa-matrix/ui-inventory.json`
- `artifacts/qa-matrix/dead-links.json`
- `artifacts/qa-matrix/locale-coverage.json`
- `artifacts/runs/RUN-20261030-111743-D1-FINAL/`
- `artifacts/playwright/report/index.html`

## Current numbers

| Item | Result |
|---|---|
| Independent HTML pages | 13 |
| Discovered links | 107 |
| Discovered buttons | 52 |
| Discovered inputs / selects / textareas | 12 |
| Unique same-origin links checked | 27 |
| Dead links | **0** |
| Node / unit tests | **89 / 89 pass** |
| Playwright full suite | **66 pass, 4 intentionally skipped** |
| Phase 13 UI matrix | **6 / 6 pass** |
| Visual baselines | **3 / 3 pass locally** |
| Geometry warnings | **15 warnings, 0 hard failures** |
| UI locales with translated copy | **40** (`zh` default plus 39 generated locale bundles) |
| Dashboard language options | **20** |

The 4 skipped tests are:

- 3 Windows-only visual baselines (opt-in local gate);
- 1 read-only cloud smoke (requires an explicit deployed URL).

## Landing conversation carousel

The landing page now has a single global language selector in the navigation.
Changing it localizes the full landing page and the demo together; there is no
bilingual demo-only selector left. The page has 39 generated locales plus the
`zh` default.

The landing page now uses an accessible four-scenario conversation carousel:

- shipping delay;
- return or exchange;
- product compatibility;
- complaint / human handoff.

It auto-advances only while visible and playing, pauses on pointer/focus,
respects `prefers-reduced-motion`, and exposes previous/next/play-pause controls.
The demo canvas reserves a fixed 360px thread area on desktop and 420px on
phones, so typewriter growth never moves the sections below. Typewriter steps
are 23ms (previously 16ms, about 30% slower) and auto-advance is 5.88s
(previously 4.2s, 40% longer).
All 39 generated page and demo locales are loadable through the global language
selector, with RTL direction for Arabic, Hebrew, Persian and Urdu.

The old homepage-only Approve / Regenerate / See another draft controls were
removed: they simulated product actions and made the marketing page feel like a
live console. The demo now demonstrates the draft and handoff without pretending
to send anything.

Seven Playwright checks cover the carousel and global localization: multi-scenario
navigation, 39-locale coverage, stable demo height during typing, reduced
motion, 390px overflow, timed auto-advance, and full-page language switching.

## A+B — cross-page language context (2026-10-27)

A real defect was reproduced before it was fixed:

```text
English pricing → Preview Pro → onboarding rendered in Chinese
```

Root cause: landing saved `nudgeso_site_locale`, onboarding reads
`relaydesk_locale` or `?lang=`, and the CTA carried neither. The fix synchronizes
both locale keys and appends `?lang=` to onboarding/login links. Three tests now
cover English continuity, Spanish through refresh, and Arabic RTL; AC-01 was
updated to accept the correct English onboarding heading.

## D1 deterministic contract generator (2026-10-30)

`docs/quality/d1-contracts.json` is a reviewed, 12-route manifest. The generator
emits `e2e/D1-GENERATED.spec.ts` and refuses unreviewed or invalid manifests.
Generated assertions are limited to HTTP status, primary selector, reviewed
marker text, auth boundary, overflow and page errors. Business assertions remain
hand-written. The generated suite passes 12/12 and the full gate passes 66/66.

## C6 query/filter context (2026-10-30)

`e2e/CONTEXT-C6.spec.ts` verifies that the insights category is encoded in the
URL, survives refresh and browser back/forward, preserves unrelated query
parameters (`lang`, `utm`), and normalizes an invalid category to `all` without
losing other parameters. Chip clicks use `pushState`; initial load uses
`replaceState`; `popstate` reapplies the URL category.

## C4 preview plan + C5 wizard state (2026-10-28)

`e2e/CONTEXT-C4-C5.spec.ts` adds four contracts:

- Pro plan intent (`plan=pro`) survives from pricing into onboarding;
- selected billing (`monthly` / `yearly`) survives the same boundary;
- the onboarding banner says the plan is preview-only and no payment request
  is made;
- refreshing the onboarding KB step restores that step for the same tenant;
- a stale wizard state belonging to another tenant is discarded and returns to
  site creation.

The onboarding state now records `tenantId`, `plan` and `billing`; it is cleared
when the authenticated tenant no longer matches. C4 is intentionally
non-binding: no subscription or charge is created.

## C2 auth returnTo + C3 tenant isolation (2026-10-28)

`e2e/CONTEXT-C2-C3.spec.ts` adds seven contracts:

- every protected surface sends its exact local `returnTo` to login;
- successful login returns to that URL;
- protocol-relative and encoded-backslash redirects stay on-origin;
- an expired token is removed and returns to login with `returnTo`;
- browser queue data is tenant-isolated while switching accounts;
- cross-tenant site upload returns 404;
- tenant API list never contains another tenant's marker.

`login.html` / `safeRedirect()` was hardened to reject backslash redirects in
addition to `//` protocol-relative paths. C3 role enforcement remains covered by
the existing `P3-02 auth/RBAC` Node test (viewer read-only, admin create,
owner-only endpoints).

## Knowledge upload formats (2026-10-27)

Uploads now support:

```text
TXT / MD   5 MB
DOCX       10 MB
XLSX       10 MB
PDF        15 MB, text layer only
```

The onboarding API accepts `multipart/form-data`, extracts text without writing
the original file to disk, validates magic bytes and extension, and rejects
legacy `.doc/.xls`, macro-enabled files, corrupt archives and scanned PDFs
(`NEEDS_OCR`). The standalone upload page uses the same multipart endpoint for
Word/Excel/PDF; scanned-PDF OCR is disabled for this release.

Tests added:

```text
6 parser/validation unit tests
1 multipart API test (DOCX + legacy rejection)
AC-01 now uploads DOCX through the real UI
```

## Quality system — 2026-10-25

A quality gate layer was added around the existing tests rather than replacing
them. It separates route relationships, user journeys, permissions, runtime
coverage, failure evidence and unexecuted risk.

### New assets

- `docs/product/page-registry.json`
- `docs/product/user-journeys.md`
- `docs/product/permissions-matrix.csv`
- `docs/quality/quality-gates.md`
- `docs/quality/test-strategy.md`
- `docs/quality/i18n-policy.md`
- `docs/quality/visual-baselines.md`
- `docs/quality/ai-repair-policy.md`
- `scripts/quality-static-audit.mjs`
- `e2e/QUALITY-MATRIX.spec.ts`
- `artifacts/quality/static-audit.json` / `.md`
- `artifacts/quality/runtime-matrix.json`

### Executed quality matrix

| Check | Result |
|---|---|
| Static pages | 11 |
| Local asset references | 29 checked, 0 missing |
| Duplicate static DOM ids | 0 |
| Images without alt | 0 |
| Locale bundles | UI 39 + `zh` default; landing 39; demo 39 |
| Locale key/empty-value failures | 0 (placeholder mismatches: 0) |
| High-confidence secrets | 0 |
| Dependency audit (prod) | 0 vulnerabilities |
| Runtime routes × viewports | 40 rows: 40 PASS, 0 page errors, 0 console errors, 0 overflow |
| Workspace views at 320/1440 | 11 × 2: PASS |
| API anonymous/malformed matrix | PASS |
| Landing locale switching (7 risk locales) | PASS |
| Node test suite | 89 / 89 pass |
| Playwright full suite | 33 pass, 4 skipped |
| Visual baselines | 3 / 3 pass (local approved Windows Chromium) |
| QA inventory | 11 pages, 89 links, 52 buttons, 12 inputs |
| Dead links | 24 checked, 0 dead |
| Geometry warnings | 15 warnings, 0 hard failures |

### Defects found and fixed during the redesign

1. `/insights.html` at 320px had horizontal overflow (347/320): the top header
   actions did not wrap. Fixed with a narrow-screen header layout; matrix now
   passes at 320/390/768/1440.
2. The insights newsletter email input had no accessible name. Added an
   accessible label.
3. `/languages` workspace view overflowed at 320px. The language grid now uses
   one column below 400px.
4. Dashboard search/reply/assistant/knowledge/settings controls lacked static
   names or associated labels. Added explicit accessible names; the runtime
   matrix now checks these controls.
5. Test-only false positives were corrected: the public-page matrix no longer
   reuses an authenticated page (which redirected marketing pages to the
   dashboard), and accessible-name checks now account for image alt text and
   wrapping labels. These are test corrections, not product weakening.

### Final orange token sweep (2026-10-26)

- Every UI primary/shadow token now uses the accessible deep orange `#B84A1D`
  with dark hover `#9A3B10`; old `#EE6E3A` and `#C8541F` are absent from UI
  CSS/HTML except the intended logo token.
- Logo orange is isolated as `--logo-orange: #EE6E3A` and applied to logo
  marks; the logo image assets are unchanged.
- Added a regression test asserting logo orange and primary orange tokens.
- Static audit now fails if the old primary leaks back into UI CSS/HTML (logo
  token exempt).
- Visual evidence refreshed to 47 screenshots; 36-test full suite passes.

### Phase 2 additions (2026-10-26)

- Landing copy was corrected to describe the currently live website chat and
  shared inbox, not unconnected Email/WhatsApp/Instagram channels.
- Paid plans are explicitly preview pricing with no payment collected; CTAs are
  `Preview Pro` / `Talk to us`.
- `/privacy.html` and `/terms.html` were added as noindex, visibly marked draft
  templates with placeholders for legal review. They are not final legal documents.
- Landing was regenerated in all 39 locales for the corrected copy and the new
  Privacy/Terms footer labels.
- Legal draft tests verify status, noindex, draft banner and footer links.
- Full suite now includes 35 passing tests; axe scan covers 12 surfaces; legal
  pages are in the route, cross-browser and visual evidence matrices.

### Phase 1 additions (2026-10-25)

- **axe-core 4.14.0 WCAG 2 A/AA scan**: 11 core surfaces, 0 serious/critical
  violations after contrast and FAQ ARIA fixes. Full report:
  `artifacts/quality/axe-results.json`.
- **Cross-browser CI projects**: Firefox and WebKit smoke tests added; CI installs
  both engines and runs the cross-browser spec. Local cached-engine evidence:
  Chromium 12/12, Firefox 12/12, WebKit 12/12.
- **Performance evidence**: `scripts/performance-audit.mjs`, all measured pages
  under the warning budgets (`artifacts/quality/performance.json`); Lighthouse is
  still NOT RUN.
- **Full visual evidence**: 43 screenshots across public pages and 11 workspace
  views at 390/1440 (`artifacts/quality/visual-evidence/index.html`). These are
  review evidence, not approved baselines.
- **Backup/restore drill**: SQLite backup passed integrity, WAL and foreign-key
  checks; backup counts match source (`artifacts/quality/backup-drill.sqlite`).
- **Post-deploy verifier**: `npm run verify:deploy` checks health, landing assets,
  www CORS, Render live SHA and service config. It passed against `c5bf9ba`.
- **Content truth audit**: `docs/quality/content-truth-audit.md` records landing
  claims that are ahead of implementation (channels, pricing, legal pages).

### Not run / residual risk

- Native-speaker semantic review for 39 generated locales.
- Real iOS/Android devices.
- Firefox and WebKit.
- Full axe-core/WCAG audit (structural checks only).
- Lighthouse/performance budget (not configured).
- Visual baselines for the 11 dashboard views and non-onboarding pages.
- Production write/payment/destructive-data tests.
- Dynamic insight-detail route in the isolated quality fixture when no insight
  exists; this is recorded as NOT RUN rather than a pass.

## Match against the shared test framework

| Shared requirement | Status | Evidence / limit |
|---|---|---|
| UI asset inventory | **Implemented** | `npm run qa:inventory` |
| Dead-link inventory | **Implemented** | `npm run qa:links`; 24 checked, 0 dead |
| Page + 11 dashboard views | **Pass** | Phase 13 + Crawler Tier 1 |
| Click controls without JS errors | **Pass with safety rules** | Crawler Tier 2: 41 clicks, 4 writes mocked |
| Auth boundary / raw 401 | **Pass** | Crawler Tier 3, Dashboard auth, AC-02 |
| Chinese / English / Arabic UI | **Pass** | Phase 13, I18N-AR, NUDGE-UI |
| Arabic RTL | **Pass** | Chat, onboarding, queue |
| No Chinese in English/Arabic UI | **Pass** | Phase 13; fixed queue chrome |
| 390px and 1440px horizontal overflow | **Pass** | Phase 13, UI-390 |
| 39-locale structure and landing matrix | **Pass for executed checks** | static bundle audit + 39-locale landing test; native review NOT RUN |
| Text truncation / overlap / 24px target audit | **Partial** | Overflow is tested; overlap/truncation not yet a gate |
| Screenshot evidence | **Pass** | zh/en/ar + queue/chat screenshots |
| Financial firewall | **Pass** | FinancialGuard unit + AC-03 + Phase 13 |
| Tenant / audience isolation | **Pass** | audience-isolation, kb-isolation, rag-isolation |
| PII redaction | **Pass** | Unit + gateway + server `/api/chat` outbound body assertion |
| Timeout / fallback | **Pass** | llm-fallback, LLM tests |
| Concurrent writes | **Pass** | db-concurrency test |
| Billing / free tier paywall | **Not implemented for NudgeSo chat** | Credits are enforced for OCR/upload; no subscription/payment provider |
| Local model deployed to production | **Not done** | No GPU on Render; requires a separate GPU host |

## P2 — geometry warnings

`npm run qa:geometry` now records non-blocking warnings for:

- clipped text (`scrollWidth/scrollHeight` larger than the client box);
- clickable targets under 24px;
- overlapping adjacent controls over 20%.

It currently reports 15 warnings, all from small text links on the login
fallback page. They are evidence for a UI polish pass, not a hard gate yet.

## P3 — outbound PII

The LLM gateway now applies `redactPII` to the customer question and retrieved
evidence before both OpenAI-compatible and Ollama requests. The integration test
in `test/llm.test.js` captures the server's actual outbound `/api/chat` request
and asserts that email, phone and card values are absent and the `[redacted-*]`
placeholders are present.

## Deployment check

The read-only cloud smoke passed against `https://nudgeso.onrender.com` after
the QA commit. Render environment variables and persistent-disk status still
need dashboard access; the cloud smoke cannot prove those settings.

## P1 — full target locale set

Generated 39 locale bundles with the DeepSeek API, covering the 37 locale
variants from the screenshot plus `en`, `th` and `ur`; Chinese base remains the
default `zh` shell. The Phase 13 matrix checks all 39 generated locales at
390px, their `lang` attribute, and the correct RTL direction.

**Still required:** native-speaker review, especially for privacy, refund and
legal copy. The bundles are explicitly marked as generated drafts.

## What is actually strong

1. Financial requests are hard-blocked and escalated before free-form LLM use.
2. Tenant, audience, and knowledge isolation have real tests, not just UI checks.
3. English/Arabic onboarding and queue no longer leak Chinese chrome.
4. The UI suite now has route coverage, link checks, RTL, mobile overflow, and
   screenshot evidence.
5. The project already has a large Node suite and functional AC tests; the new
   matrix complements rather than replaces them.
6. Production deploys do not get monkey clicks or destructive writes.

## What is not done, and why

### 1. 37-language copy/visual matrix

The screenshot lists 37 locale variants. The UI now supports the full target set
through 39 generated locale bundles plus the default Chinese bundle:

```text
ar, az, bg, bn, cs, da, de, el, en, en-AU, es, fa, fr, he, hi, hr, hu,
id, it, ja, ko, ms, nl, no, pl, pt-BR, pt-PT, ro, ru, sk, sv, sw, th, tr,
uk, ur, vi, zh-CN, zh-TW
```

All 39 locale bundles were generated through the DeepSeek API. `th` (Thai) and
`ur` (Urdu, RTL) were added beyond the 37-item list. The default `zh` shell
remains available as the Chinese base.

The 390px overflow/direction matrix now covers all 39 generated locales. Native
speaker review is still required for legal, privacy and refund copy; the bundles
are API-generated drafts, not certified translations.

### 2. Full 37-language translation

A local model can generate drafts, but UI translation also needs:

- stable locale keys;
- RTL layout;
- pluralization/date/currency formats;
- legal/privacy copy review;
- native-speaker review for high-risk copy.

Translating 34 additional languages without review would be a release risk, not
a feature.

### 3. Billing A1–A26

Those anchors belong to the separate K12 product described in the shared
conversation. NudgeSo has a different credit model (OCR/pages/cloud distillation),
and it has no real payment/subscription provider yet. Copying those tests would
test the wrong product.

### 4. Local model on Render

Render runs the web container; it has no suitable GPU. A Qwen3.8-35B-A3B model
needs its own GPU host or a secure local tunnel. Putting it directly in the
Render web container would be slow and operationally fragile.

### 5. Overlap / truncation / minimum target size as a hard gate

Overflow is deterministic and already gated. Overlap and truncation need
careful whitelisting and human review, otherwise icon buttons and intentionally
ellipsized labels produce false failures. They should be added as warnings first,
not as a false green/red gate.

## Local model assessment (not executed)

The user-described `Qwen3.8-35B-A3B-Q5_K_M` is treated here as a 35B
Mixture-of-Experts model with about 3B active parameters, 5-bit K-quant weights.

Estimated memory:

- weights: roughly 24 GB at Q5_K_M;
- runtime/KV overhead: roughly 2–8 GB depending on context length;
- practical target: 32 GB VRAM for Q5 + 8–16K context;
- 24 GB VRAM: Q4_K_M or Q5 with short context / partial CPU offload;
- 16 GB VRAM: not realistic without heavy offload;
- 64–128 GB unified memory: workable with slower generation;
- CPU-only with 64 GB RAM: can run, but not suitable for low-latency chat.

The A3B active-parameter design makes generation faster than a dense 35B model
when the weights fit in memory. It can cover many of the listed 37 locales, but
translation quality still needs per-language evaluation and native review.

It cannot be deployed as a Render web-container model: Render has no suitable
GPU. Run it on a GPU host or the local PC, and expose it through an authenticated
private tunnel if the Render app must reach it.

## Recommended order

1. Push/deploy the current UI fixes; configure Render LLM env and disk.
2. Add real locale files for the highest-value languages first.
3. Add geometry warnings for truncation/overlap/target size.
4. Add outbound PII request assertion.
5. Only then expand the full locale matrix.
