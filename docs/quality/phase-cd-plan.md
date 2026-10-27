# Phase C / Phase D plan — context contracts and full-site QA agent

Date: 2026-10-27  
Baseline: Phase 2 complete + A+B language-context fix  
Status: **PLAN ONLY** — no C/D implementation has been started.

## What A+B just proved

A failing real defect was reproduced first:

```text
English pricing
→ click Preview Pro
→ /onboarding.html
→ html lang became zh
```

Root cause:

- landing saved `nudgeso_site_locale`;
- onboarding's `i18n.js` reads `relaydesk_locale` or `?lang=`;
- CTA links carried neither;
- onboarding therefore fell back to its Chinese default.

Fix:

- landing now stores both locale keys;
- every onboarding/login link carries `?lang=`;
- saved app locale is used as a fallback when landing has no saved choice;
- `e2e/LANGUAGE-CONTEXT.spec.ts` covers English, Spanish + refresh, Arabic RTL;
- AC-01's onboarding assertion was updated to accept the now-correct English
  heading rather than forcing Chinese.

This is the first reusable **context contract**.

---

# Phase C — generalized cross-page context contracts

## Goal

Make context loss a first-class test category instead of discovering it by
clicking around by hand.

A context contract says:

> Entering this flow with context X must preserve X across the named navigation,
> refresh and back/forward boundaries.

## Contract schema

```json
{
  "id": "locale.pricing-to-onboarding",
  "priority": "P0",
  "source": "/landing.html",
  "initialContext": { "locale": "en" },
  "actions": ["click Preview Pro"],
  "target": "/onboarding.html",
  "mustPreserve": ["locale"],
  "expected": {
    "htmlLang": "en",
    "dir": "ltr",
    "criticalText": "Launch your support site",
    "urlParam": "lang=en"
  },
  "regression": ["zh entry remains zh", "ar entry remains RTL"],
  "evidence": ["screenshot", "trace", "console/network"]
}
```

Contract output fields:

```text
id, priority, source, initialContext, actions, target,
mustPreserve, expected, forbiddenFallbacks, regression, evidence
```

## C1 — locale context (started / already green)

- English pricing → onboarding stays English.
- Spanish selection survives reload and CTA.
- Arabic is RTL on target.
- Add:
  - hero CTA;
  - final CTA;
  - login link;
  - direct onboarding URL with no lang (document default);
  - comparison of every locale that onboarding supports.

Exit proof:

```text
all 39 locale bundles can enter onboarding with the selected locale
or an explicitly documented fallback
```

## C2 — auth and returnTo

Test:

- anonymous user opens protected workspace/queue;
- login;
- returns to the requested target, not the generic dashboard.

Contracts:

```text
auth.protected-returnTo
auth.expired-session
auth.logout-clears-context
```

## C3 — tenant and role isolation

Test:

- account A creates site/knowledge/conversations;
- account B cannot see them;
- switching active tenant resets cached active conversation/site;
- session expiry does not leave stale tenant data visible.

This complements the existing Node RBAC/isolation suites with browser-level
context assertions.

## C4 — plan and price context

Test:

- selecting a preview plan;
- entering onboarding/checkout;
- plan, billing period, currency and locale remain consistent;
- no accidental "payment" when the plan is preview-only.

Current plans are preview-only; the test must assert no payment is initiated.

## C5 — wizard and form state

Test:

- onboarding account → site → knowledge → embed;
- refresh and browser Back at each step;
- invalid input and API error preserve the right step and language;
- no stale draft from another tenant/account.

## C6 — query/filter/experiment context

Test:

- insights category filter survives refresh;
- page query parameters (`?lang`, future `?plan`) survive expected links;
- experiment flags do not silently reset at route boundaries.

## C test architecture

```text
e2e/contexts/
  locale.spec.ts
  auth-returnto.spec.ts
  tenant-isolation.spec.ts
  plan-context.spec.ts
  wizard-state.spec.ts
  filters.spec.ts
e2e/fixtures/
  account.ts
  site.ts
  knowledge.ts
  conversation.ts
```

Shared helpers:

```text
createAccount()
createSite()
createKnowledge()
createConversation()
assertContextContract(contract)
```

Every test captures:

```text
trace
screenshot on failure
current URL
html lang/dir
localStorage locale keys
console/page errors
network 4xx/5xx
same-run account/tenant IDs
```

## C acceptance gate

C is complete only when:

1. Every P0 contract passes in Chromium.
2. Locale/auth/tenant contracts also pass in Firefox and WebKit.
3. Existing AC-01..05 and quality matrix remain green.
4. No production writes; only disposable fixtures.
5. Evidence is stored under `artifacts/quality/contexts/`.
6. Any expected fallback is documented; unexpected fallback is a failure.

## C owner decisions

Before implementing C2–C6, the owner must confirm:

- What should happen when an anonymous user visits a protected URL? Return after
  login to that URL?
- Does the active tenant switch clear the open conversation and stale draft?
- Should preview plan selection persist into onboarding or be dropped?
- Should refreshing onboarding restore the current wizard step?
- Which locales must fall back to English, and is a documented fallback allowed?

---

# Phase D — full-site QA agent

## Goal

An agent orchestrates planning, exploration, test generation, execution, diagnosis,
minimal repair and independent verification across the whole site — while
deterministic tests remain the release authority.

The agent is **not** allowed to say "green" after deleting/skipping tests.

## D1 — read-only site model

Inputs:

```text
docs/product/page-registry.json
docs/product/user-journeys.md
docs/product/permissions-matrix.csv
e2e specs, routes, forms, buttons, API calls
```

Outputs:

```text
page/state graph
reachable controls
required auth/tenant state
API dependencies
gaps vs registry
NOT RUN ledger
```

No writes; no production mutations.

## D2 — test generator

Generate tests from contracts and page model:

```text
navigation targets
locale context
form labels/validation
auth/tenant boundaries
geometry/a11y assertions
```

Generated tests must be reviewed/deterministic before entering the P0 gate.
Agent-generated tests are not evidence until executed.

## D3 — explorer

Use Playwright + fixtures to:

- visit every static route;
- enumerate visible controls;
- click only safe actions (or mocked writes);
- capture URL, console, pageerror, network failures and trace;
- build a coverage matrix: `PASS / FAIL / BLOCKED / NOT RUN`.

Production: read-only only. Writes happen against disposable data.

## D4 — diagnosis and repair

Classifier:

```text
product defect | test defect | environment | fixture | external | expected change
```

Repair rules:

- isolated worktree/branch;
- smallest diff;
- maximum two rounds;
- no assertion deletion, no skip/fixme, no threshold widening, no auto-approved
  visual baseline;
- run failing test → adjacent regression → full P0/P1 gate → build/axe.
- if still failing, stop and produce a reproduction package.

## D5 — verifier and reporter

Machine outputs:

```json
{
  "runId": "...",
  "commit": "...",
  "status": "PASS|FAIL|BLOCKED",
  "contracts": [],
  "failures": [],
  "notRun": [],
  "evidencePaths": []
}
```

HTML report plus a short owner review pack.

## D roles

| Role | Responsibility | May write? |
|---|---|---|
| Planner | Page/context contract graph | docs only |
| Explorer | Read-only crawl/evidence | no |
| Generator | Deterministic test candidates | test branch |
| Runner | Execute fixtures and collect evidence | no product data |
| Diagnostician | Classify root cause | no |
| Fixer | Minimal isolated repair | product branch |
| Verifier | Re-run gates independently | no |
| Reporter | Coverage/FAIL/NOT RUN report | docs/artifacts |
| Human | Business intent, legal, final go/no-go | final approval |

## D staging requirement

For real merchant journeys, use an isolated **staging** Render service and
disposable database. Production remains read-only smoke only.

If staging is not authorized, D can cover only local/CI and public read-only
surfaces; the rest is explicitly NOT RUN.

## D milestones

1. D0: agent skeleton + page/state graph + read-only explorer.
2. D1: contract tests for locale/auth/tenant/plan.
3. D2: evidence collector + coverage matrix.
4. D3: generator + deterministic review.
5. D4: isolated repair loop + verifier.
6. D5: CI and post-deploy reporting.

## D acceptance criteria

- Reaches every registered P0/P1 route from a declared entry point.
- Distinguishes PASS, FAIL, BLOCKED and NOT RUN.
- Never writes to production or triggers real payment.
- Produces trace/screenshot/console/network for failures.
- Repairs only with evidence and maximum two rounds.
- Re-runs affected and adjacent tests after every fix.
- Preserves existing 39-test gate and release SHA verification.
- Human signs the final acceptance pack.

---

# Dependencies and blockers

| Dependency | Needed for | Owner |
|---|---|---|
| Staging Render service + disposable DB | full merchant/tenant journeys | owner |
| Test account factory | auth/tenant/plan contexts | engineering |
| Payment sandbox | checkout contracts | owner |
| Native-language reviewer | translation acceptance | owner |
| Real devices | hardware checks | owner |
| `www.nudgeso.com` DNS/HTTPS | domain acceptance | owner |

C2–C6 can start without staging by using local/CI fixtures. D merchant journeys
need staging; otherwise they stay BLOCKED/NOT RUN.

---

# Recommended order

```text
1. C1 locale contract (already implemented; keep expanding)
2. C2 auth / returnTo
3. C3 tenant and role isolation
4. C4 plan context (preview-only, no payment)
5. C5 wizard/form state
6. C6 filters/query context
7. D0 read-only explorer
8. D1 generator + evidence
9. D2 isolated repair loop
10. D3 CI/release integration
```

C1 is already in the codebase. Phase C should not be declared complete until all
contracts and their regressions are green. Phase D should not claim “full website
tested” beyond its actual coverage matrix.
