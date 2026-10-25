# NudgeSo quality gate report

Date: 2026-10-25  
Commit tested: `c962bb7`  
Scope: NudgeSo / `nudgev2` only  
Executed gate: **PASS**  
Residual risk: explicit **NOT RUN** items below; this is not a claim of complete
product certification.

## Verdict

| Gate | Result |
|---|---|
| Static quality audit | **PASS** |
| Node/unit tests | **PASS — 89 / 89** |
| Playwright full suite | **PASS — 33 passed, 4 intentionally skipped** |
| Runtime surface matrix | **PASS — 40 / 40 rows, 0 page/console errors, 0 overflow** |
| Workspace views (11) at 320 and 1440 | **PASS** |
| API anonymous/malformed matrix | **PASS** |
| 39-locale landing structure + runtime | **PASS for structural/runtime checks** |
| Accessibility structural checks | **PASS for covered rules** |
| Dependency audit (prod) | **PASS — 0 vulnerabilities** |
| Visual baselines | **PASS — 3 / 3 local approved baselines** |
| GitHub Actions | **PASS — run 40158327528** |
| Cloud smoke | **PASS — 1 / 1 read-only** |

The four skipped Playwright tests are intentional:

1. three Windows visual-baseline tests (run separately with `VISUAL_TEST=1`);
2. one cloud smoke test (run separately against the deployed URL).

## What was measured

### Static audit

- 11 HTML pages.
- 29 local asset references checked; 0 missing.
- 0 duplicate DOM ids.
- 0 images without alt.
- 39 UI generated bundles plus the `zh` default; 39 landing and 39 demo bundles.
- 0 missing locale keys, 0 empty values, 0 placeholder mismatches.
- 0 high-confidence committed secrets.
- 50 statically unnamed controls flagged as warnings because their names are
  supplied by JavaScript/custom components; the runtime matrix checked the
  actually visible controls.

### Runtime matrix

- 10 routes × 4 viewports = 40 rows.
- 40 PASS, 0 page errors, 0 unexpected console errors, 0 horizontal overflow.
- Public and authenticated pages were tested in **separate browser contexts** so
  a cached merchant token could not redirect marketing pages to the dashboard.
- Structural checks: duplicate ids, image alt/decode, visible control names,
  form labels, non-empty `lang`, visible `h1`.
- 11 workspace views additionally checked at 320 and 1440.

### Existing domain tests

- Onboarding → site → knowledge → embed: AC-01.
- Privacy consent → customer answer: AC-02.
- Refund/complaint → safe template + escalation queue: AC-03.
- Voice fallback and upload path: AC-04.
- No ads/third-party ad requests: AC-05.
- Tenant, audience, RAG, knowledge, auth/RBAC and privacy isolation: Node suites.
- SQLite migration, concurrency, restore, observability and rate limiting: Node suites.

### Deployment

- GitHub Actions run `40158327528` on `c962bb7`: success.
- Render deployed the same commit; `/api/health` returned 200 in the read-only
  cloud smoke.
- Cloud smoke: landing, login, onboarding, health, static assets and
  English/Arabic onboarding reachable.

## Defects found and fixed during this redesign

| Finding | Fix | Status |
|---|---|---|
| `/insights.html` overflowed at 320px (347/320) | mobile header CTA wrapping | fixed, matrix passes |
| Insights newsletter email had no accessible name | accessible label | fixed |
| `/languages` workspace overflowed at 320px | one-column grid below 400px | fixed |
| Dashboard search/reply/assistant/knowledge/settings fields had no static accessible names | explicit accessible names | fixed; runtime matrix passes |
| Quality test's auth token redirected public pages to workspace | separate public/auth contexts | test corrected |
| Accessible-name check missed image alt and wrapping labels | corrected helper | test corrected |

These are recorded as evidence of a test-driven quality loop, not hidden as
"already passing".

## Not run / residual risk

| Item | Status | Why |
|---|---|---|
| Native-speaker review of 39 generated locales | NOT RUN | requires human linguists |
| Real iOS/Android hardware | NOT RUN | no device lab in this session |
| Firefox / WebKit | NOT RUN | only Chromium project configured |
| Full axe-core/WCAG audit | NOT RUN | structural checks only; axe not installed |
| Lighthouse/performance budget | NOT RUN | no measured budget configured |
| Visual baselines for dashboard and other pages | NOT RUN | only 3 onboarding baselines approved |
| Production writes / payment / destructive tests | FORBIDDEN | must not touch production data |
| Dynamic insight detail at extra viewports | PARTIAL | existing `INSIGHTS.spec.ts` covers 390 and detail rendering; 320/768/1440 not separately run |
| Real load/concurrency test | NOT RUN | no load harness |
| External DAST/pen-test | NOT RUN | no scope/credential authorization |

The overall executed gate is **PASS**. The product is **not** certified for the
NOT RUN items above; they must remain visible until completed.

## Evidence index

- `docs/product/page-registry.json`
- `docs/product/user-journeys.md`
- `docs/product/permissions-matrix.csv`
- `docs/quality/quality-gates.md`
- `docs/quality/test-strategy.md`
- `docs/quality/i18n-policy.md`
- `docs/quality/visual-baselines.md`
- `docs/quality/ai-repair-policy.md`
- `docs/quality/coverage-matrix.md`
- `artifacts/quality/static-audit.json`
- `artifacts/quality/static-audit.md`
- `artifacts/quality/runtime-matrix.json`
- `artifacts/runs/RUN-20261025-112519-QUALITY-GATE-FINAL/`
- `artifacts/playwright/report/index.html`
- GitHub Actions run `40158327528`
- `https://nudgeso.onrender.com/api/health`

## Commands

```powershell
npm test
npm run check
npm run quality:static
npm run qa:inventory
npm run qa:locales
npm run qa:links
npm run qa:geometry
npm run quality:matrix
npx playwright test --workers=1
VISUAL_TEST=1 npx playwright test e2e/PHASE13-VISUAL.spec.ts --workers=1
npm run test:ui:cloud
```

The browser suites require a running app at `BASE_URL` (default
`http://127.0.0.1:3030`) and a disposable `DATA_DIR`; the CI workflow provides
both.
