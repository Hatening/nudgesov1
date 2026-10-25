# Test strategy

NudgeSo uses a single Playwright backbone plus Node tests. We do not add more
browser frameworks for the same job. The strategy is risk-based, evidence-first
and explicit about what was not run.

## Risk tiers

| Tier | Surfaces | Requirement |
|---|---|---|
| P0 | onboarding→knowledge→embed, privacy consent→chat answer, refund/complaint→queue, auth boundary, merchant workspace, landing localization | every release, Chromium, default plus mobile viewport |
| P1 | voice fallback, site/settings, privacy export/delete, 11 workspace views | every release or explicit accepted-risk record |
| P2 | insights detail, manual, 404, secondary settings, non-critical copy | PR or daily regression |

## Layer plan

### L0 — static and build

- `npm run check`: Node syntax check plus unit tests.
- `npm test`: all `test/*.test.js`.
- `quality:static`: assets, duplicate ids, locale structure, empty values,
  placeholders, secret-shaped values, test inventory.
- CI: Node 25, `npm ci`, no generated dependency drift.

### L1 — function and data

Existing Node tests cover intent routing, language mapping, tenant isolation,
RBAC, PII redaction, financial guard, SQLite concurrency, migration, privacy,
RAG isolation, rate limits, observation and source governance. These are the
authoritative tests for pure rules; Playwright is not a substitute.

### L2 — API and permissions

- `QUALITY-MATRIX.spec.ts` checks anonymous protected routes, malformed
  registration, malformed chat and operator repair behavior.
- Existing RBAC/isolation/rate-limit suites cover cross-tenant and abuse paths.
- Server tests use a disposable `DATA_DIR`; no production writes.

### L3 — business journeys

`AC-01` through `AC-05`, `DASHBOARD`, `INSIGHTS`, `P2-LIVE`, `UI-390` and
`PHASE13-UI-MATRIX` exercise real pages through the browser. Each failure
captures a trace; new quality matrix also records structural issues.

### L4 — layout and structure

`QUALITY-MATRIX.spec.ts` visits every public/authenticated surface at
320/390/768/1440 and checks:

- HTTP response;
- horizontal overflow;
- duplicate ids;
- visible images with alt and successful decode;
- visible interactive controls with an accessible name;
- form controls with a label;
- non-empty `lang`, visible `h1`;
- page errors (hard) and console errors (recorded).

### L5 — visual regression

Only onboarding zh/en/ar has approved Playwright baselines on Windows Chromium.
The baseline is not updated automatically. Other pages are evidence-only until
an approved baseline set exists.

### L6 — fonts

Current check: wait for `document.fonts.ready` and record font status. This does
not prove every glyph exists. Full font-resource and pseudo-locale visual checks
are **NOT RUN**.

### L7 — i18n

Static audit covers 39 generated bundles plus the shell default; runtime matrix
covers seven structurally different locales including Arabic RTL and long
Ukrainian/German copies. Native-language semantic review is **NOT RUN**.

### L8 — accessibility, performance, security

- Structural accessibility checks are in the surface matrix.
- Full axe-core and keyboard/screen-reader passes are **NOT RUN**.
- Lighthouse/performance budgets are **NOT RUN**; no invented thresholds.
- Secret scan and dependency lock are in the static audit.
- Real-device tests are **NOT RUN**.

## Combination policy

Do not exhaustively multiply languages × pages × viewports × themes × browsers:

- all locales: static key/empty/placeholder checks;
- all locales: landing render and demo at desktop;
- risky structure: Arabic RTL, long German/Ukrainian, Chinese/Japanese, narrow
  mobile;
- every page: 320/390/768/1440 Chromium;
- every browser: release candidate only, and currently **NOT RUN** for
  Firefox/WebKit;
- themes: no separate theme matrix exists; visual baselines use the current
  theme.

## Evidence policy

- Playwright: HTML report, traces on failure, explicit screenshots where the
  test captures them.
- Static audit: `artifacts/quality/static-audit.json` and `.md`.
- Runtime matrix: `artifacts/quality/runtime-matrix.json`.
- Final report: `artifacts/quality/QUALITY-GATE-REPORT.md`.
- No mock retry-to-green. A flaky test is a defect in the test or environment.
