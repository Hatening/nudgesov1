# NudgeSo Phase 2 acceptance pack

Date: 2026-10-26  
Code commit: `e56bc81`  
GitHub Actions: `40244775001` — success  
Render live: `e56bc81` / deploy `dep-dbf9096q1p3s73f019t0`  
Engineering gate for the executed scope: **PASS**  
Commercial launch status: **BLOCKED only on human/legal decisions below.**

This is the human-review pack. No commands need to be run by the owner.

## What was delivered

### Honest landing copy

- Only the **website chat** and **shared merchant inbox** are described as live.
- Email, WhatsApp and Instagram are described as assisted setup / rolling out,
  not as already connected.
- Paid plans are labeled **Preview plan** / **Preview price — no charge**.
- CTAs are **Preview Pro** and **Talk to us**, not purchase CTAs.
- The pricing note explicitly says no payment is collected.
- The old “community support” / “dedicated contact” claims were removed or
  marked preview.
- All **39 landing locales** were regenerated for the corrected copy.

### Legal draft pages

Added:

```text
/privacy.html
/terms.html
```

They are:

- clearly marked **DRAFT FOR LEGAL REVIEW — not legal advice**;
- `noindex,nofollow`;
- excluded from production search indexing;
- full of intentionally unresolved bracketed placeholders;
- linked from the landing footer.

They are **drafts**, not final legal documents. A qualified lawyer must replace
placeholders and approve them before real customer data is collected.

### CORS

`CORS_ORIGINS` now includes:

```text
https://nudgeso.onrender.com
https://www.nudgeso.com
```

GET and OPTIONS preflight both verified.

### Phase 1 accessibility follow-through

- axe-core 4.14.0 scan now covers **12 surfaces**, including Privacy and Terms.
- After fixes:

```text
critical violations: 0
serious violations:  0
```

- The approved accessible orange is now `#B84A1D` (white text 5.20:1).
- Primary buttons, nav accents, links and hover states use `#B84A1D` /
  `#9A3B10`; old shadows and fallbacks were swept.
- Logo orange `#EE6E3A` is isolated in `--logo-orange` and logo image
  assets are untouched. A regression test asserts both tokens.

## Verification

| Check | Result |
|---|---|
| Node/unit tests | 89 / 89 PASS |
| Playwright full suite | 36 passed, 4 intentional skips |
| axe WCAG 2 A/AA | 12 surfaces; 0 critical/serious |
| Cross-browser CI | Firefox + WebKit PASS |
| Local cached cross-browser | Chromium/Firefox/WebKit 36/36 PASS |
| Static audit | PASS; 13 pages, 0 missing assets, 0 duplicate ids, 0 secrets |
| Dead links | 27 checked, 0 dead |
| Visual baselines | 3 / 3 onboarding PASS |
| Visual evidence | 47 screenshots, 390/1440 |
| Performance custom measurement | all under warning budget |
| Backup/restore drill | integrity ok, WAL, foreign keys 1 |
| Post-deploy verifier | PASS |
| Cloud smoke | 1 / 1 PASS |
| Render live SHA | matches `e56bc81` |
| Dependency audit | 0 vulnerabilities |

Performance snapshot (local, not Lighthouse):

```text
landing     209 ms DCL / 253 ms load / 907 KB
login        46 ms DCL /  63 ms load / 907 KB
onboarding  204 ms DCL / 212 ms load / 1859 KB
insights     41 ms DCL /  97 ms load / 1234 KB
privacy      14 ms DCL /  57 ms load / 369 KB
terms        14 ms DCL /  26 ms load / 369 KB
workspace    35 ms DCL /  44 ms load / 907 KB
```

Visual evidence:

```text
artifacts/quality/visual-evidence/index.html
```

## Residual risk / NOT RUN

| Item | Status | Owner |
|---|---|---|
| Legal counsel review and placeholder replacement | NOT RUN | Owner / lawyer |
| Legal page translations | NOT RUN | Owner / lawyer + translator |
| Native-speaker review of 39 locales | NOT RUN | Owner / native reviewers |
| Real iOS/Android devices | NOT RUN | Owner |
| Manual keyboard/screen-reader checks | NOT RUN | Owner / accessibility reviewer |
| Lighthouse / real-network performance | NOT RUN | Owner / performance budget decision |
| Visual baselines for every page | NOT RUN (47 evidence screenshots exist) | Owner approval |
| Payment/subscription implementation | NOT IMPLEMENTED | Future product decision |
| Email/WhatsApp/Instagram connectors | NOT IMPLEMENTED (copy now says so) | Future product decision |
| www.nudgeso.com DNS/HTTPS | CORS only; DNS not verified | Owner |

## What only the owner can do now

1. **Legal review**  
   Send `public/privacy.html` and `public/terms.html` to counsel. Replace each
   bracketed placeholder, choose jurisdiction/entity/contact details, then
   authorize publishing and any needed translations.

2. **Native language review**  
   Arrange review for the high-risk locales: Arabic, Hebrew, Persian, Urdu,
   Japanese, Korean, German, Russian, Traditional Chinese.

3. **Real-device pass**  
   One iPhone and one Android device through landing, login, onboarding, chat,
   queue and the 11 workspace views.

4. **Decide future product scope**  
   Whether to implement payments and real channel connectors, or keep the
   preview positioning.

5. **DNS/HTTPS for `www.nudgeso.com`**  
   CORS is ready; the domain itself still needs DNS/SSL verification.

## Evidence index

- `artifacts/quality/axe-results.json`
- `artifacts/quality/cross-browser-local.json`
- `artifacts/quality/performance.json`
- `artifacts/quality/visual-evidence/index.html`
- `artifacts/quality/post-deploy.json`
- `artifacts/quality/backup-drill.sqlite`
- `docs/quality/content-truth-audit.md`
- `docs/quality/coverage-matrix.md`
- `artifacts/runs/RUN-20261026-072238-ORANGE-FINAL/`
- GitHub Actions `40244775001`
- Render deploy `dep-dbf9096q1p3s73f019t0`

## Verdict

```text
Technical Phase 2 gate: PASS
Commercial launch: BLOCKED on legal, native-language, real-device and DNS decisions
```

No further engineering work is required for the A+B scope you selected.


## Final UI color sweep

- Primary/theme: `#B84A1D`; hover/dark: `#9A3B10`.
- Logo: `#EE6E3A`, isolated from UI primary; logo PNG assets unchanged.
- Old `#EE6E3A` / `#C8541F` removed from production CSS/HTML outside the
  logo token; static audit now fails on re-introduction.
- Translucent old-orange shadows replaced with deep-orange equivalents.
- Light accents remain only for focus rings and semantic badges, not primary
  buttons or body copy.
- Regression test: logo token `#EE6E3A`, primary token `#B84A1D`.
