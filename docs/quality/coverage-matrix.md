# Coverage matrix — executed quality gate

Generated: 2026-10-25  
Commit tested: `c962bb7`  
Gate result: **PASS for the executed scope**  
All unexecuted checks are explicitly listed as **NOT RUN**.

## 1. Route × viewport

Chromium; isolated SQLite fixture; public and authenticated contexts are separated
(no auth-token redirect contaminating marketing pages).

| Surface | 320 | 390 | 768 | 1440 | Evidence |
|---|---:|---:|---:|---:|---|
| `/landing.html` | PASS | PASS | PASS | PASS | runtime matrix |
| `/login.html` | PASS | PASS | PASS | PASS | runtime matrix |
| `/onboarding.html` | PASS | PASS | PASS | PASS | runtime matrix + AC-01 |
| `/upload.html` | PASS | PASS | PASS | PASS | runtime matrix |
| `/manual.html` | PASS | PASS | PASS | PASS | runtime matrix |
| `/insights.html` | PASS | PASS | PASS | PASS | runtime matrix |
| `/queue.html` | PASS | PASS | PASS | PASS | runtime matrix + AC-03 |
| `/chat.html?site=…` | PASS | PASS | PASS | PASS | runtime matrix + AC-02/04 |
| `/` workspace | PASS | PASS | PASS | PASS | runtime matrix |
| `/404.html` | PASS | PASS | PASS | PASS | runtime matrix |
| `/insight.html?id=…` | NOT RUN | PASS | NOT RUN | NOT RUN | `INSIGHTS.spec.ts` covers detail rendering at 390; no extra-width run |

Route count: 40 executed rows, 40 PASS, 0 page errors, 0 console errors, 0
horizontal overflow, 0 structural failures.

## 2. Workspace views

| View | 320 | 390 | 1440 | Evidence |
|---|---:|---:|---:|---|
| overview | PASS | PASS | PASS | quality matrix + UI-390 + Phase 13 |
| inbox | PASS | PASS | PASS | quality matrix + UI-390 + Phase 13 |
| assistant | PASS | PASS | PASS | quality matrix + UI-390 + Phase 13 |
| knowledge | PASS | PASS | PASS | quality matrix + UI-390 + Phase 13 |
| glossary | PASS | PASS | PASS | quality matrix + UI-390 + Phase 13 |
| channels | PASS | PASS | PASS | quality matrix + UI-390 + Phase 13 |
| languages | PASS | PASS | PASS | quality matrix + UI-390 + Phase 13 |
| analytics | PASS | PASS | PASS | quality matrix + UI-390 + Phase 13 |
| tests | PASS | PASS | PASS | quality matrix + UI-390 + Phase 13 |
| growth | PASS | PASS | PASS | quality matrix + UI-390 + Phase 13 |
| settings | PASS | PASS | PASS | quality matrix + UI-390 + Phase 13 |

## 3. Locale coverage

| Layer | Coverage | Status |
|---|---|---|
| UI bundle structure | 39 generated bundles + `zh` default | PASS (static audit) |
| Landing page | 39 generated locales | PASS (Playwright) |
| Demo | 39 generated locales | PASS (Playwright) |
| Runtime risk locales | en, de, uk, ar, he, zh-CN, zh-TW at 390 | PASS |
| RTL | ar/he/fa/ur direction | PASS |
| Empty values / missing keys / placeholders | 0 missing keys, 0 empty, 0 mismatch | PASS |
| Native semantic review | 39 locales | **NOT RUN** |

## 4. Roles and API boundary

| Check | Status | Evidence |
|---|---|---|
| Anonymous `/api/v1/auth/me` | PASS (401) | quality matrix |
| Anonymous `/api/v1/sites` | PASS (401) | quality matrix |
| Anonymous `/api/v1/escalations` | PASS (401) | quality matrix |
| Anonymous `/api/bootstrap` | PASS (401) | quality matrix |
| Malformed register | PASS (4xx) | quality matrix |
| Malformed chat | PASS (4xx) | quality matrix |
| Operator repair without credentials | PASS (non-2xx) | quality matrix; 503 is safe unconfigured |
| Tenant/user isolation and RBAC | PASS | Node suites |
| Cross-tenant read/write forbidden paths | PASS | Node suites |
| Real payment/subscription | NOT IMPLEMENTED / NOT RUN | no provider |

## 5. Quality layers

| Layer | Executed | Status | Limit |
|---|---|---|---|
| L0 static/build | Node check, static audit, asset scan, secret scan, dependency audit | PASS | no package build step exists |
| L1 unit | 89 Node tests | PASS | 89 / 89 |
| L2 API/auth | Node + quality matrix | PASS | no load test |
| L3 journeys | AC-01..05 + dashboard + quality matrix | PASS | Chromium only |
| L4 layout/structure | 4 viewports, 40 rows, 11 views | PASS | heuristic, not full visual truth |
| L5 visual | 3 onboarding baselines | PASS | Windows Chromium only |
| L6 fonts | `document.fonts.status` only | PARTIAL / NOT RUN | no glyph/fallback audit |
| L7 i18n | static + runtime + RTL | PASS for structure | native review NOT RUN |
| L8 accessibility | structural name/label/alt/id checks | PARTIAL | axe/WCAG NOT RUN |
| L8 performance | not configured | NOT RUN | no invented Lighthouse budget |
| L8 security | secret scan, dependency audit, auth tests | PASS for executed checks | no DAST/pen-test |

## 6. Evidence index

- `artifacts/quality/static-audit.json`
- `artifacts/quality/static-audit.md`
- `artifacts/quality/runtime-matrix.json`
- `artifacts/runs/RUN-20261025-112519-QUALITY-GATE-FINAL/`
- `artifacts/playwright/report/index.html`
- `artifacts/qa-matrix/ui-inventory.json`
- `artifacts/qa-matrix/dead-links.json`
- `artifacts/qa-matrix/ui-geometry-warnings.json`
- GitHub Actions run `40158327528` on `c962bb7` — success
- Cloud smoke — 1 / 1 pass
- Dependency audit — 0 vulnerabilities

## 7. Gate decision

Because every executed P0/P1 check passed and the CHECKED surface has no
unresolved hard failure, the **executed scope** is **PASS**.

The overall product should not be described as fully certified: native language,
real-device, Firefox/WebKit, axe/WCAG, Lighthouse and approved visual baselines
for non-onboarding pages are **NOT RUN** and remain residual risk.
