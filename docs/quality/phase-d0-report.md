# Phase D0 — read-only site model and explorer

Date: 2026-10-30  
Status: **D0 COMPLETE**; D1–D5 not started.

## Delivered

- `scripts/qa-agent-explore.mjs`
- `npm run qa:agent`
- `artifacts/quality/agent/latest/site-model.json`
- `artifacts/quality/agent/latest/coverage.json`
- `artifacts/quality/agent/latest/report.md`
- screenshot evidence under `artifacts/quality/agent/latest/screenshots/`

The explorer registers a **disposable local fixture account**, creates one local
fixture site, and visits the registry's read surfaces. It does not click
destructive controls, submit forms, send conversations, change settings, trigger
payment, send email, or test external channels.

Production is refused unconditionally: D0 needs a local/staging disposable
database because it creates fixture data.

## Run result

```text
registry pages: 13
explored:       12
PASS:           12
WARN:            0
FAIL:            0
NOT RUN:         1
```

`insight-detail` was NOT RUN because D0 did not seed a known article fixture.

## What the model contains

- page nodes with registry route, observed URL, title, lang/dir, status;
- controls and labels for every observed page;
- internal link edges;
- console errors, page errors, same-origin 5xx responses;
- overflow and presence of a heading;
- coverage summary and explicit NOT RUN records.

## D0 exit criteria

- [x] registry pages are reconciled against observed pages;
- [x] every observed page has an explicit PASS/WARN/FAIL/NOT RUN status;
- [x] evidence is written outside the app DB;
- [x] no production writes;
- [x] no destructive UI actions;
- [x] the explorer is repeatable with one command.

## Not yet delivered

D1 test generation, D2 evidence/report integration beyond D0, D3 isolated repair,
D4 verifier loop, and D5 CI/release automation remain planned.
