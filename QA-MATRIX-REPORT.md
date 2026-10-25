# NudgeSo QA Matrix Report

Date: 2026-10-24  
Scope: NudgeSo / `nudgev2` only. The shared DeepSeek conversation also discusses
the separate K12 product (`minolet_V00`); its A1–A26 billing anchors are **not**
applicable to NudgeSo and are not silently copied here.

## Evidence

- `artifacts/qa-matrix/ui-inventory.json`
- `artifacts/qa-matrix/dead-links.json`
- `artifacts/qa-matrix/locale-coverage.json`
- `artifacts/runs/RUN-20261025-081442-FINAL-CAROUSEL-ALL/`
- `artifacts/playwright/report/index.html`

## Current numbers

| Item | Result |
|---|---|
| Independent HTML pages | 11 |
| Discovered links | 89 |
| Discovered buttons | 55 |
| Discovered inputs / selects / textareas | 12 |
| Unique same-origin links checked | 24 |
| Dead links | **0** |
| Node / unit tests | **89 / 89 pass** |
| Playwright full suite | **27 pass, 4 intentionally skipped** |
| Phase 13 UI matrix | **6 / 6 pass** |
| Visual baselines | **3 / 3 pass locally** |
| Geometry warnings | **15 warnings, 0 hard failures** |
| UI locales with translated copy | **40** (`zh` default plus 39 generated locale bundles) |
| Dashboard language options | **20** |

The 4 skipped tests are:

- 3 Windows-only visual baselines (opt-in local gate);
- 1 read-only cloud smoke (requires an explicit deployed URL).

## Landing conversation carousel

The landing page now uses an accessible four-scenario conversation carousel:

- shipping delay;
- return or exchange;
- product compatibility;
- complaint / human handoff.

It auto-advances only while visible and playing, pauses on pointer/focus,
respects `prefers-reduced-motion`, and exposes previous/next/play-pause controls.
All 39 generated demo locales are loadable through the demo language select, with
RTL direction for Arabic, Hebrew, Persian and Urdu.

Five Playwright checks cover the carousel: multi-scenario navigation, locale
coverage, reduced motion, 390px overflow, and timed auto-advance.

## Match against the shared test framework

| Shared requirement | Status | Evidence / limit |
|---|---|---|
| UI asset inventory | **Implemented** | `npm run qa:inventory` |
| Dead-link inventory | **Implemented** | `npm run qa:links`; 24 checked, 0 dead |
| Page + 11 dashboard views | **Pass** | Phase 13 + Crawler Tier 1 |
| Click controls without JS errors | **Pass with safety rules** | Crawler Tier 2: 41 clicks, 4 writes mocked |
| Auth boundary / raw 401 | **Pass** | Crawler Tier 3, Dashboard auth, AC-02 |
| Chinese / English / Arabic UI | **Pass** | Phase 13, I18N-AR, NUDGE-UI |
| Arabic RTL | **Pass** | Chat, onboarding, queue |
| No Chinese in English/Arabic UI | **Pass** | Phase 13; fixed queue chrome |
| 390px and 1440px horizontal overflow | **Pass** | Phase 13, UI-390 |
| 37-language copy/visual matrix | **Not done** | Only 3 UI locales exist; see below |
| Text truncation / overlap / 24px target audit | **Partial** | Overflow is tested; overlap/truncation not yet a gate |
| Screenshot evidence | **Pass** | zh/en/ar + queue/chat screenshots |
| Financial firewall | **Pass** | FinancialGuard unit + AC-03 + Phase 13 |
| Tenant / audience isolation | **Pass** | audience-isolation, kb-isolation, rag-isolation |
| PII redaction | **Pass** | Unit + gateway + server `/api/chat` outbound body assertion |
| Timeout / fallback | **Pass** | llm-fallback, LLM tests |
| Concurrent writes | **Pass** | db-concurrency test |
| Billing / free tier paywall | **Not implemented for NudgeSo chat** | Credits are enforced for OCR/upload; no subscription/payment provider |
| Local model deployed to production | **Not done** | No GPU on Render; requires a separate GPU host |

## P2 — geometry warnings

`npm run qa:geometry` now records non-blocking warnings for:

- clipped text (`scrollWidth/scrollHeight` larger than the client box);
- clickable targets under 24px;
- overlapping adjacent controls over 20%.

It currently reports 15 warnings, all from small text links on the login
fallback page. They are evidence for a UI polish pass, not a hard gate yet.

## P3 — outbound PII

The LLM gateway now applies `redactPII` to the customer question and retrieved
evidence before both OpenAI-compatible and Ollama requests. The integration test
in `test/llm.test.js` captures the server's actual outbound `/api/chat` request
and asserts that email, phone and card values are absent and the `[redacted-*]`
placeholders are present.

## Deployment check

The read-only cloud smoke passed against `https://nudgeso.onrender.com` after
the QA commit. Render environment variables and persistent-disk status still
need dashboard access; the cloud smoke cannot prove those settings.

## P1 — full target locale set

Generated 39 locale bundles with the DeepSeek API, covering the 37 locale
variants from the screenshot plus `en`, `th` and `ur`; Chinese base remains the
default `zh` shell. The Phase 13 matrix checks all 39 generated locales at
390px, their `lang` attribute, and the correct RTL direction.

**Still required:** native-speaker review, especially for privacy, refund and
legal copy. The bundles are explicitly marked as generated drafts.

## What is actually strong

1. Financial requests are hard-blocked and escalated before free-form LLM use.
2. Tenant, audience, and knowledge isolation have real tests, not just UI checks.
3. English/Arabic onboarding and queue no longer leak Chinese chrome.
4. The UI suite now has route coverage, link checks, RTL, mobile overflow, and
   screenshot evidence.
5. The project already has a large Node suite and functional AC tests; the new
   matrix complements rather than replaces them.
6. Production deploys do not get monkey clicks or destructive writes.

## What is not done, and why

### 1. 37-language copy/visual matrix

The screenshot lists 37 locale variants. The UI now supports the full target set
through 39 generated locale bundles plus the default Chinese bundle:

```text
ar, az, bg, bn, cs, da, de, el, en, en-AU, es, fa, fr, he, hi, hr, hu,
id, it, ja, ko, ms, nl, no, pl, pt-BR, pt-PT, ro, ru, sk, sv, sw, th, tr,
uk, ur, vi, zh-CN, zh-TW
```

All 39 locale bundles were generated through the DeepSeek API. `th` (Thai) and
`ur` (Urdu, RTL) were added beyond the 37-item list. The default `zh` shell
remains available as the Chinese base.

The 390px overflow/direction matrix now covers all 39 generated locales. Native
speaker review is still required for legal, privacy and refund copy; the bundles
are API-generated drafts, not certified translations.

### 2. Full 37-language translation

A local model can generate drafts, but UI translation also needs:

- stable locale keys;
- RTL layout;
- pluralization/date/currency formats;
- legal/privacy copy review;
- native-speaker review for high-risk copy.

Translating 34 additional languages without review would be a release risk, not
a feature.

### 3. Billing A1–A26

Those anchors belong to the separate K12 product described in the shared
conversation. NudgeSo has a different credit model (OCR/pages/cloud distillation),
and it has no real payment/subscription provider yet. Copying those tests would
test the wrong product.

### 4. Local model on Render

Render runs the web container; it has no suitable GPU. A Qwen3.8-35B-A3B model
needs its own GPU host or a secure local tunnel. Putting it directly in the
Render web container would be slow and operationally fragile.

### 5. Overlap / truncation / minimum target size as a hard gate

Overflow is deterministic and already gated. Overlap and truncation need
careful whitelisting and human review, otherwise icon buttons and intentionally
ellipsized labels produce false failures. They should be added as warnings first,
not as a false green/red gate.

## Local model assessment (not executed)

The user-described `Qwen3.8-35B-A3B-Q5_K_M` is treated here as a 35B
Mixture-of-Experts model with about 3B active parameters, 5-bit K-quant weights.

Estimated memory:

- weights: roughly 24 GB at Q5_K_M;
- runtime/KV overhead: roughly 2–8 GB depending on context length;
- practical target: 32 GB VRAM for Q5 + 8–16K context;
- 24 GB VRAM: Q4_K_M or Q5 with short context / partial CPU offload;
- 16 GB VRAM: not realistic without heavy offload;
- 64–128 GB unified memory: workable with slower generation;
- CPU-only with 64 GB RAM: can run, but not suitable for low-latency chat.

The A3B active-parameter design makes generation faster than a dense 35B model
when the weights fit in memory. It can cover many of the listed 37 locales, but
translation quality still needs per-language evaluation and native review.

It cannot be deployed as a Render web-container model: Render has no suitable
GPU. Run it on a GPU host or the local PC, and expose it through an authenticated
private tunnel if the Render app must reach it.

## Recommended order

1. Push/deploy the current UI fixes; configure Render LLM env and disk.
2. Add real locale files for the highest-value languages first.
3. Add geometry warnings for truncation/overlap/target size.
4. Add outbound PII request assertion.
5. Only then expand the full locale matrix.
