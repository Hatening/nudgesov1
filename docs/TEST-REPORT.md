# Automated test report

**Build:** RelayDesk MVP 0.1.0  
**Execution environment:** Node.js 25.2.1 / SQLite WAL / Playwright 1.48 / Chromium 130  
**Commands:** `npm test`; `npm run check`; `npx playwright test e2e/AC-01..05 --workers=1`  
**Result:** 20 Node tests passed, 0 failed; 5/5 Playwright AC passed; P2 live smoke passed.

## Covered
- Intent routing for shipping, returns/refunds, warranty and general questions.
- Script-based language detection smoke checks for Chinese, Arabic, Spanish and English fallback.
- Lexical retrieval for the three demo policies.
- Basic Chinese policy query expansion for returns and shipping.
- Abstention behavior when no knowledge evidence matches.
- HTTP integration smoke test: health, bootstrap, knowledge create, chat response, 5-case regression endpoint, and invalid knowledge payload handling.
- **SQLite DAO**: schema, WAL, foreign keys, CRUD, transaction rollback, hashed sessions.
- **JSON→SQLite migration**: all collections, count verification, backup, session hash, idempotent re-run.
- **Concurrency**: 200 simultaneous HTTP writes; two server processes sharing one WAL DB, 200 writes, no loss/duplicates.
- **Playwright AC-01 ~ AC-05**: onboarding, Chinese chat, escalation queue, voice/RAG/high-risk, no-ads customer window.
- **P2 live smoke**: migrated site `6088...` returns logistics 3–5 days and hours 09:00–21:00.

## Regression endpoint baseline
The built-in 5-case baseline passed in the integration test at the time this report was generated.

## Not covered / not claimed
- No 70+ language quality validation, no human-reviewed golden dataset and no calibrated confidence.
- No real Ollama inference was tested; tests use the deterministic fallback path.
- No real email, WhatsApp, Instagram or ecommerce channel sends/receives.
- No production multi-tenant RBAC/penetration test/rate-limit/security review, billing, advertising attribution or full restore drill.
- SQLite is single-node; no multi-node/horizontal-scale test.
- No claim of production-level customer answer accuracy.

**Release recommendation:** SQLite/WAL persistence is now in place for the single-node phase. Keep generated answers as drafts and require human review until the remaining P0/P1 production gates are implemented and measured.

