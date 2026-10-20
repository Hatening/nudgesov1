# Privacy, PII and Data Retention Runbook

## Data inventory

| Data | Storage | Purpose | Default retention |
|---|---|---|---|
| Account email, password hash, role | `users` | Authentication/RBAC | account lifetime |
| Tenant/site config | `tenants`, `sites` | Service configuration | account lifetime |
| Knowledge documents | `knowledge` | RAG answers | tenant-controlled |
| Customer messages/replies/transcripts | `messages` | Support delivery | `privacyRetentionDays` (default 365) |
| Escalations | `escalations` | Human handoff | 365 / resolved policy |
| Consent events | `events` (`privacy_consent`) | Consent audit | retained |
| Operational events/test runs | `events`, `test_runs` | Metrics/quality | 365 |

## Consent

- Customer consent is recorded via `POST /api/v1/public/:embed_key/consent`.
- The chat UI sends version `2026-10-19` when the user clicks “同意并继续”.
- Consent events include site, version and timestamp; no message body.
- A new privacy notice version requires a new consent event.

## Retention and purge

```powershell
npm run prune:data
# or
node scripts/prune-data.mjs --days 90
```

`dao.purgeExpiredData` deletes stale messages/escalations/events and preserves `privacy_consent` audit events. Configure `privacyRetentionDays` per tenant via `PATCH /api/v1/privacy/retention` (owner only).

## Data subject requests

Owner-authenticated endpoints:

- `GET /api/v1/privacy/export` — tenant/site/message/escalation/consent export; excludes password hashes.
- `DELETE /api/v1/privacy/messages` — deletes the tenant's messages and escalations.

Runbook:

1. Verify requester identity and authority.
2. Export and review scope.
3. Execute deletion; record request ID/time in the incident/request log.
4. Confirm deletion via export and DB count.
5. Retain only the minimum legal/audit record.

## PII in logs

- Request logs contain method/path/status/duration/request-id only, not bodies.
- Error messages are passed through `redactPII` (email/phone/card patterns).
- LLM prompts may contain the customer message and approved knowledge; do not enable an external provider without a DPA/data-transfer review.

## Security/compliance gates before public launch

- [ ] Legal review of privacy notice, DPA and subprocessor list.
- [ ] Data residency decision for LLM/ASR providers.
- [ ] Encryption at rest/key management for DB and backups.
- [ ] Retention schedule approved by the merchant.
- [ ] GDPR/CCPA request SLAs and identity verification procedure.
- [ ] Breach notification and incident response runbook.
- [ ] Penetration test and access review.

This document is an operational baseline, not legal advice or a completed DPA.
