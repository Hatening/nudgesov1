# NudgeSo Phase 1 acceptance pack

Date: 2026-10-25  
Code commit: `73c1a53`  
GitHub Actions: `40208663573` — success  
Render live: `73c1a53` / deploy `dep-dbf29fmk1f9s73fq8pi0`  
Overall engineering gate for the executed Phase 1 scope: **PASS**

This is the single human-review pack. You do not need to run commands or inspect
logs. The remaining decisions are product/legal/language/device decisions listed
at the end.

## What changed in Phase 1

### Accessibility

- Added axe-core 4.14.0 (vendored test fixture, MPL-2.0) and an automated
  WCAG 2 A/AA scan over 10 core surfaces.
- Fixed:
  - FAQ `aria-expanded` on a non-interactive container (critical);
  - low-contrast navigation, body and muted text;
  - primary-button contrast (white text);
  - dark demo/footer text contrast;
  - small badge and link contrast.
- Result after fixes:

```text
10 surfaces scanned
0 critical violations
0 serious violations
```

- Raw evidence: `artifacts/quality/axe-results.json`.

### Cross-browser

- Added Firefox and WebKit smoke tests to CI.
- CI installs both engines and runs:
  - landing, login, onboarding, 404;
  - workspace, queue, upload, chat;
  - 390px and 1440px;
  - no page errors, no horizontal overflow.
- CI result: **PASS**.
- Local cached-engine evidence: Chromium/Firefox/WebKit 36/36 checks PASS
  (`artifacts/quality/cross-browser-local.json`).

### Performance

Custom navigation/resource measurement (not Lighthouse):

| Page | DCL | Load | Transfer | Result |
|---|---:|---:|---:|---|
| landing | 80 ms | 187 ms | 907 KB | PASS (warning budget 3 MB) |
| login | 44 ms | 68 ms | 907 KB | PASS |
| onboarding | 180 ms | 188 ms | 1859 KB | PASS |
| insights | 44 ms | 92 ms | 1234 KB | PASS |
| workspace | 34 ms | 71 ms | 907 KB | PASS |

These are local measurements; Lighthouse and real-network budgets remain NOT RUN.

### Visual evidence

43 full-page screenshots captured, not approved baselines:

```text
landing (en/ar/zh) × desktop/mobile
login, onboarding, insights, 404
queue, upload, manual, customer chat
11 workspace views × desktop/mobile
```

Open:

```text
artifacts/quality/visual-evidence/index.html
```

The approved onboarding baselines still pass 3/3 after the contrast change.

### Backup and restore

SQLite backup drill:

```text
integrity: ok
journal_mode: wal
foreign_keys: 1
restored counts: tenants 8, users 7, sites 7, knowledge 3,
conversations 3, messages 3, glossary 3, events 14
```

Evidence: `artifacts/quality/backup-drill.sqlite` and console output.

### Post-deploy verifier

Added `npm run verify:deploy` (read-only). It passed against the live service:

```text
health               200
landing carousel     present
locale asset         200
CORS www origin      allowed
CORS preflight       204
Render live SHA      matches expected
auto deploy          yes
```

### Existing full gate

```text
Node/unit:             89 / 89 PASS
Playwright full:       34 passed, 4 intentionally skipped
Quality runtime:       40 / 40 PASS
QA links:              24 checked, 0 dead
Dependency audit:      0 vulnerabilities
CI:                    PASS
Cloud smoke:           1 / 1 PASS
```

## Residual risk / NOT RUN

| Item | Status | Impact |
|---|---|---|
| Native-speaker review of 39 locales | NOT RUN | High for public launch |
| Real iOS/Android hardware | NOT RUN | Medium; gestures/keyboard may differ |
| Manual keyboard/screen-reader review | NOT RUN | Automated axe cannot cover all WCAG |
| Lighthouse/real-network performance | NOT RUN | Local numbers only |
| Approved visual baselines for every page | NOT RUN | Evidence screenshots only |
| Firefox/WebKit local run | PASS in CI; cached local harness also passed | CI is authoritative |
| Payment/subscription lifecycle | NOT IMPLEMENTED | Blocks selling paid plans |
| Email/WhatsApp/Instagram connectors | NOT IMPLEMENTED | Blocks those marketing claims |
| Privacy Policy / Terms pages | NOT PRESENT | Blocks collecting real customer data |
| www.nudgeso.com DNS/HTTPS | CORS only | Domain ownership/SSL not verified |
| Production write/destructive tests | FORBIDDEN | Must use staging/test fixtures |

## The only decisions I need from you

### 1. Approve the accessible color palette

The original orange (#EE6E3A) failed WCAG AA for white text at 3.03:1. It is now
a darker orange (#B84A1D). The visual-evidence gallery shows all affected pages.

```text
APPROVE new palette
or
ASK FOR A DIFFERENT BRAND COLOR
```

### 2. Decide the commercial claims

Content-truth audit found three important gaps:

```text
- Channels: Email/WhatsApp/Instagram are "Needs setup", not integrated.
- Pricing: plan cards exist, but no payment/subscription provider exists.
- Legal: no standalone Privacy Policy or Terms page.
```

Choose one:

```text
A. We implement the missing product/legal pieces.
B. We adjust the landing copy to match what is truly live today.
C. Split: adjust copy now, build integrations/payments later.
```

### 3. Native language and device sign-off

Only you or a reviewer can do:

- native-speaker review of high-risk locales;
- real iPhone/Android pass;
- legal/business wording approval.

This is the minimum human step; it cannot be automated honestly.

## What I can do next without you

- implement the copy changes you choose;
- add Privacy/Terms draft pages for legal review;
- add a proper staging environment for merchant-end-to-end tests;
- implement Stripe or another provider once you provide the account decision;
- build email/WhatsApp/Instagram connectors once credentials and scope are approved;
- rerun the entire gate after any change.

## Evidence index

- `artifacts/quality/axe-results.json`
- `artifacts/quality/cross-browser-local.json`
- `artifacts/quality/performance.json`
- `artifacts/quality/visual-evidence/index.html`
- `artifacts/quality/post-deploy.json`
- `artifacts/quality/backup-drill.sqlite`
- `docs/quality/content-truth-audit.md`
- `docs/quality/test-strategy.md`
- `docs/quality/coverage-matrix.md`
- GitHub Actions `40208663573`
- Render deploy `dep-dbf29fmk1f9s73fq8pi0`
