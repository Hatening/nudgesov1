# Quality gates

Final statuses are limited to **PASS**, **FAIL**, and **BLOCKED**. An unexecuted
test is **NOT RUN** and is never reported as a pass.

## PR Gate — required before merge

| Gate | Command / evidence | Blocking rule |
|---|---|---|
| Syntax and unit tests | `npm test`, `npm run check` | any failure blocks |
| Static quality audit | `npm run quality:static` | hard failures block |
| UI inventory, links, locale structure | `npm run qa:inventory`, `qa:links`, `qa:locales` | dead links, missing bundles or broken asset references block |
| Browser surface matrix | `npm run test:quality` | HTTP failure, page error, unexpected overflow, duplicate id, failed image, unlabeled form control blocks |
| Core P0/P1 journeys | `npm run test:ui` | any failure blocks; no retries to green |
| All 11 workspace views | `PHASE13-UI-MATRIX.spec.ts` | no view may throw or overflow |
| Visual baselines (approved environment) | `npm run test:visual` | only reviewed baselines; never auto-accept |
| Landing 39-locale matrix | `LANDING-DEMO.spec.ts` | locale count, direction, key copy, overflow |
| Secret scan | `quality:static` | high-confidence secret blocks |

`npm run quality:static` must also report warnings for statically unnamed
controls; those warnings require triage, not deletion.

## Release Gate — before a production deploy

- PR Gate is green on the exact commit SHA being deployed.
- Cloud smoke is green after deploy and the deployed SHA matches the tested SHA.
- All P0 journeys pass; P1 failures require an explicit accepted-risk record.
- RTL (Arabic) is visually checked on chat, onboarding and queue.
- 320/390/768/1440 have no unexpected horizontal overflow.
- No unapproved visual diff; no changed baseline without reviewer and rationale.
- API auth matrix is green: anonymous callers receive 401, never tenant data.
- Known limitations and NOT RUN items are listed in `artifacts/quality/`.
- Rollback path is documented and tested at the hosting layer when possible.

## Post-deploy smoke

- Read-only only: landing, login, onboarding, chat with a disposable site,
  health, static assets and one language switch.
- No production registration floods, no real payment, no destructive writes.
- Stop and roll back on unexplained 5xx, CSP/asset failures or page errors.

## Failure classification

Only modify product code when evidence supports a product defect:

1. product defect;
2. test defect;
3. environment/dependency;
4. fixture/data;
5. external service;
6. intended product change.

Every fix records: failing test, stack/trace, hypothesis, minimal diff,
affected modules, regression command, and result.

## AI repair guardrails

- Maximum two automated repair rounds.
- Work in a separate branch/worktree; never rewrite unrelated files.
- Never delete assertions, change a test to `skip`/`fixme`, widen ignores,
  lower thresholds, auto-approve screenshots, or remove product behavior to make
  a test green.
- Necessary test-code fixes must be isolated and must prove the test still
  catches the original defect.
- No production writes, real payments, bulk messages, or key changes without
  explicit human authorization.
- A human owns the final release decision.
