# Observability, Backup and CI Runbook

## Request tracing

Every HTTP response includes `x-request-id` (incoming header is reused if present). Access logs are JSON lines:

```json
{"level":"info","request_id":"...","method":"GET","path":"/api/health","status":200,"duration_ms":3.2}
```

Logs do not contain request bodies. Error messages are PII-redacted.

## Metrics

`GET /api/ops/metrics` (legacy API auth; production requires `APP_API_KEY`) returns:

- requests/errors/rate-limited totals
- status counts
- latency p50/p95/max
- requests by path
- DB counts: tenants, sites, messages, pending escalations, active sessions, knowledge
- LLM provider/status/circuit state
- SQLite WAL/driver

Target SLOs:

| Metric | Target |
|---|---|
| Availability | 99.9% |
| Chat first token p95 | < 2s |
| Full chat p95 | < 5s |
| High-risk first response p95 | < 15 min |
| 5xx rate | < 0.5% |

## Backup

```powershell
npm run backup:sqlite
```

Uses SQLite `VACUUM INTO` to produce a consistent snapshot and verifies `PRAGMA integrity_check` plus message/escalation counts. Backups default to `artifacts/backups/`.

For full file-level backup, stop writes and copy `relaydesk.sqlite`, `relaydesk.sqlite-wal`, `relaydesk.sqlite-shm` together. See `docs/SQLITE-MIGRATION.md`.

## Restore drill

1. Stop the service.
2. Archive current DB files.
3. Restore the verified backup.
4. Run `npm run verify:sqlite`.
5. Start the service; run `/api/health`, `/api/bootstrap`, and the 5 Playwright ACs.
6. Record RPO/RTO and any data gap.

## CI

`.github/workflows/ci.yml` runs:

- Node 25 `npm ci`, `npm test`, `npm run check`
- Chromium install
- start SQLite test server
- Playwright AC-01..AC-05
- `npm run verify:sqlite`
- upload server/Playwright artifacts

## Alerting (external)

Wire `/api/ops/metrics` or logs into the chosen platform:

- 5xx rate > 1% for 5 min
- p95 > 5s for 5 min
- pending escalations > 20 or oldest > 15 min
- SQLite disk usage > 80%
- backup failure / integrity != ok
- LLM circuit open > 5 min

No external alerting provider is configured in this local sprint.
