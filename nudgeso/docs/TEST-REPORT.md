# Automated test report

**Build:** RelayDesk MVP 0.1.0  
**Execution environment:** Node.js built-in test runner in the code-generation container  
**Commands:** `npm test`; `npm run check`  
**Result:** 6 tests passed, 0 failed; syntax checks passed.

## Covered
- Intent routing for shipping, returns/refunds, warranty and general questions.
- Script-based language detection smoke checks for Chinese, Arabic, Spanish and English fallback.
- Lexical retrieval for the three demo policies.
- Basic Chinese policy query expansion for returns and shipping.
- Abstention behavior when no knowledge evidence matches.
- HTTP integration smoke test: health, bootstrap, knowledge create, chat response, 5-case regression endpoint, and invalid knowledge payload handling.

## Regression endpoint baseline
The built-in 5-case baseline passed in the integration test at the time this report was generated.

## Not covered / not claimed
- No 70+ language quality validation, no human-reviewed golden dataset and no calibrated confidence.
- No real Ollama inference was tested; tests use the deterministic fallback path.
- No real email, WhatsApp, Instagram or ecommerce channel sends/receives.
- No production multi-tenant authorization, penetration test, load test, security review, ECS deployment, billing, advertising attribution or restore drill.
- No claim of production-level customer answer accuracy.

**Release recommendation:** use only as a local/staging prototype. Keep generated answers as drafts and require human review until production gates are implemented and measured.
