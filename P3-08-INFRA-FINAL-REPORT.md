# P3-08 + Infra Automation — Final Report

| 项目 | 结果 |
|---|---|
| P3-08 i18n / Arabic RTL | **PASS** |
| CI workflow | **PASS（本地等价演练）** |
| Dockerfile / compose | **已生成，静态校验通过；本机未安装 Docker，未实际 build** |
| Auto-repair webhook PoC | **PASS** |
| Node tests | **29/29 PASS** |
| Full Playwright (real DeepSeek) | **8/8 PASS** |
| Hermetic CI mock Playwright | **8/8 PASS** |
| Final real run | `RUN-20261020-074323-RELEASE-FINAL` |
| Service | PID `23780` / http://127.0.0.1:3030 |

## P3-08 i18n

- `zh` default + `en` + `ar` RTL.
- Language switch in chat/onboarding/queue headers.
- `?lang=ar` sets `html[dir=rtl]` and translates:
  - privacy title/body/consent, chat placeholder/send/voice/upload/footer/welcome;
  - onboarding heading, auth/site/knowledge/embed labels and steps;
  - queue heading/subtitle/table headers/empty state/resolve action/footnote.
- Server Arabic detection already present (`detectLanguage`).
- Tests:
  - `test/i18n.test.js` PASS;
  - `e2e/I18N-AR.spec.ts` PASS (chat, onboarding, queue; RTL; no overflow).
- Docs: `docs/I18N.md`.

## CI/CD

`.github/workflows/ci.yml`:

- triggers on `push` and `pull_request`;
- job name `ci / required`;
- `npm ci`, `npm test`, `npm run check`;
- starts **hermetic mock LLM** on 4010 and app on 3030;
- runs `npx playwright test --workers=1` (all 8 E2E);
- `npm run verify:sqlite`;
- uploads Playwright/server logs;
- `permissions: contents: read`, concurrency cancellation.

**Merge blocking** is enforced by GitHub branch protection selecting the required check `ci / required`. The workflow cannot configure branch protection itself; exact steps are in `HOW-TO-DEPLOY-AND-CI.md`.

A local hermetic CI-like run passed **8/8**:
`RUN-20261020-073750-CI-MOCK-ALL-C`.

## Docker

Generated:

- `Dockerfile` — Node 25 Alpine, production, `/data` volume, healthcheck;
- `.dockerignore`;
- `docker-compose.yml` — one command local/cloud single-node startup.

Quick start:

```powershell
Copy-Item .env.example .env
# set APP_API_KEY / SESSION_SECRET / REPAIR_WEBHOOK_SECRET
docker compose up --build -d
curl.exe http://127.0.0.1:3030/api/health
```

Vercel is not recommended: SQLite and the repair worker need persistent disk/long-running process. Use Docker on a VPS/container platform.

## Auto-repair webhook

`POST /api/ops/repair`:

- requires `x-repair-secret` matching `REPAIR_WEBHOOK_SECRET`, fail-closed 503 when unset;
- accepts event/severity/service/fingerprint/message/log/source;
- redacts email/phone/card PII;
- writes sanitized incident JSON to `REPAIR_QUEUE_DIR`;
- launches `scripts/repair-worker.mjs` (unless `REPAIR_WORKER_ENABLED=0`);
- worker writes `<incident>.prompt.md`, a DSH-ready repair prompt;
- optional `DSH_REPAIR_COMMAND` passes the prompt file to a trusted orchestrator.

This is a safe concept proof: no arbitrary external text is executed by default.

Test: `test/repair.test.js` PASS (secret 401, queue file, PII redaction).

Docs: `docs/AUTO-REPAIR.md`.

## Evidence

- `HOW-TO-DEPLOY-AND-CI.md`
- `docs/I18N.md`
- `docs/AUTO-REPAIR.md`
- `.github/workflows/ci.yml`
- `Dockerfile`, `.dockerignore`, `docker-compose.yml`
- `artifacts/runs/RUN-20261020-074323-RELEASE-FINAL/` — 27 screenshots, real model
- `artifacts/runs/RUN-20261020-073750-CI-MOCK-ALL-C/` — 8/8 hermetic CI
- `artifacts/npm-test-p308-infra.log`
- `artifacts/npm-check-p308-infra.log`
- `test_run/第三阶段-P3-08-INFRA-PASS/` — 100 files incl. 27 real screenshots, CI mock run and infra files

## Boundaries

1. Docker CLI is not installed on this machine, so image build was not executed locally; YAML was parsed and Dockerfile reviewed. CI runners with Docker can build it.
2. GitHub branch protection is a repository setting; the guide gives exact steps for `ci / required`.
3. CI uses a deterministic mock LLM; real DeepSeek/P0.5 acceptance is run locally with the DSH credential and is NOT used in GitHub CI.
4. Repair worker is a prompt generator by default; actual DSH session launch requires explicitly setting `DSH_REPAIR_COMMAND`.
5. Full ICU/translation service, RTL visual regression across all pages, and multi-region deployment are follow-ups.
