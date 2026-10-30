# Phase D1 — deterministic contract test generator

Date: 2026-10-30  
Status: **D1 COMPLETE** for local/CI route contracts; D2–D5 not started.

## Delivered

- `docs/quality/d1-contracts.json` — reviewed contract manifest.
- `scripts/qa-agent-generate.mjs` — deterministic generator; refuses an
  unreviewed manifest or invalid/duplicate contracts.
- `e2e/helpers/d1-fixtures.ts` — disposable merchant/site fixture factory.
- `e2e/D1-GENERATED.spec.ts` — generated Playwright tests.
- `npm run qa:agent:generate` — regenerate tests.
- `npm run test:ui:agent` — run the generated suite.

## Generated coverage

12 route contracts:

```text
landing, login, onboarding, workspace, queue, customer-chat,
upload, manual, insights, privacy-draft, terms-draft, not-found
```

Assertions are deliberately limited to reviewed, stable facts:

- HTTP status < 400;
- a stable primary selector is visible;
- optional reviewed marker text;
- authenticated pages do not end on `/login.html`;
- no horizontal overflow at the selected viewport;
- no uncaught page errors.

Business assertions stay in hand-written specs; the generator does not invent
them and does not delete, skip or weaken existing tests.

## Run result

```text
D1 generated contracts: 12 passed
Full Playwright suite:   66 passed, 4 skipped
Node/unit suite:         96 passed
```

## Safety

- Fixtures are created only through the local/CI API against a disposable DB.
- The generator refuses a manifest with `reviewed: false`.
- No destructive controls are clicked by generated route tests.
- No production writes; no payment/email/external channel actions.

## Not yet delivered

D2 evidence/coverage integration, D3 isolated repair loop, D4 independent
verifier, and D5 CI/release automation remain planned.
