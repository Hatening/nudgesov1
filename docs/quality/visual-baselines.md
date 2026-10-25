# Visual and layout baseline policy

## Current approved baselines

- Browser: Playwright Chromium (Windows local baseline set).
- Viewport: 1440 × 900.
- Pages: onboarding `zh`, `en`, `ar`.
- Files: `e2e/PHASE13-VISUAL.spec.ts-snapshots/`.
- Gate: `npm run test:visual`; test-only `npm run test:visual:update` is reserved
  for an intentional reviewed change.

## Rules

1. Never auto-accept a changed baseline to make CI green.
2. A baseline update requires the product-change reason, reviewer, relevant
   functional test result, and the new screenshot in the review record.
3. Baselines are environment-specific. Windows Chromium pixels are not compared
   against Linux CI pixels; Linux visual baselines are **NOT RUN**.
4. Dynamic content (typewriter demo, timestamps, model output) must be frozen,
   masked or asserted semantically rather than screenshot-diffed as truth.
5. Visual regression is not a substitute for DOM geometry, overflow, content,
   accessibility or business assertions.

## Layout audit

`QUALITY-MATRIX.spec.ts` runs a semantic geometry audit at:

- 320 × 844;
- 390 × 844;
- 768 × 1024;
- 1440 × 900.

It checks horizontal overflow, duplicate ids, missing image alt, failed image
decode, unlabeled form controls and unnamed controls. `qa:geometry` adds
heuristic warnings for clipped text, small targets and overlap. These are
heuristic and are not treated as proof of a visual defect without review.

## Not run

- Approved baselines for the 11 dashboard views.
- Firefox/WebKit visual baselines.
- Linux visual baselines.
- Real-device screenshots.
- Design-quality sign-off beyond automated structural checks.
