# Phase 13 — UI, links, language and layout matrix

This suite is the automated UI gate for the NudgeSo web app.

## What it checks

- Every independent HTML page loads with auth, no page errors and no 390px overflow.
- All 11 dashboard views switch from the navigation.
- All same-origin `href` links resolve to a non-4xx response; `/api/health` is included.
- Chinese / English / Arabic onboarding direction and copy.
- No Chinese UI chrome leaks in English or Arabic onboarding.
- Queue and customer chat render in English/Arabic; user-generated message content is ignored.
- zh/en/ar onboarding screenshots are written to `RUN_DIR` as visual evidence.

Dynamic pages (`/insight.html`) are tested with a real id from `/api/insights`.

## Run locally

Start the app with a temporary data directory, then:

```powershell
$env:BASE_URL='http://127.0.0.1:3030'
$env:RUN_ID='local-phase13'
$env:RUN_DIR='artifacts/runs/local-phase13'
npm run test:ui:phase13
```

The normal `npm test` covers the Node/unit layer. `npm run test:ui` runs the
complete Playwright suite, including this matrix and the existing AC/Crawler
tests.

## Run against the deployed app (read-only)

```powershell
npm run test:ui:cloud
# or a specific URL:
npm run test:ui:cloud -- https://nudgeso.onrender.com
```

The cloud suite is read-only: it checks health, static pages and the
English/Arabic onboarding. It does not register accounts, submit messages or
perform monkey clicks against production.

## Environment

Playwright is already declared in `package.json`; CI installs Chromium with
`npx playwright install --with-deps chromium`. No production dependency is
added by this suite.

## Visual regression

A local, opt-in pixel gate is available for the three onboarding locales:

```powershell
$env:BASE_URL='http://127.0.0.1:3030'
npm run test:visual            # compare against committed baselines
npm run test:visual:update     # intentionally update baselines
```

Baselines are stored under `e2e/PHASE13-VISUAL.spec.ts-snapshots/` with the
platform suffix. The standard CI run keeps the cross-platform DOM/geometry
gates and skips the Windows-specific pixel gate; screenshots from the Phase 13
matrix are still uploaded as visual evidence.

