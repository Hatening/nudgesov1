# External monitor → local repair queue (POC)

## Flow

```text
monitor / error webhook
  → POST /api/ops/repair (x-repair-secret)
  → artifacts/repair-queue/<timestamp>-<id>.json
  → scripts/repair-worker.mjs
  → <incident>.prompt.md (DSH-ready repair prompt)
  → optional DSH_REPAIR_COMMAND <prompt-file>
```

The default worker is a safe **dry-run prompt generator**. No arbitrary text from the
alert is executed. Set `DSH_REPAIR_COMMAND` to a trusted orchestrator command if you
want the final handoff to launch a DSH session automatically.

## Request

```bash
curl -X POST http://127.0.0.1:3030/api/ops/repair \
  -H 'content-type: application/json' \
  -H 'x-repair-secret: your-repair-secret' \
  -d '{
    "event": "error",
    "severity": "high",
    "service": "relaydesk",
    "fingerprint": "checkout-500",
    "message": "checkout failed; customer email redacted automatically",
    "source": "prometheus"
  }'
```

Response (202):

```json
{
  "ok": true,
  "incident_id": "repair_...",
  "received_at": "2026-10-20T...",
  "worker": "started",
  "status": "queued"
}
```

Failures:

- `503` when `REPAIR_WEBHOOK_SECRET` is unset (fail closed);
- `401` when the header is wrong;
- `413`/`400` for oversized or malformed JSON.

## Configuration

```text
REPAIR_WEBHOOK_SECRET=change-me
REPAIR_QUEUE_DIR=./artifacts/repair-queue
REPAIR_WORKER_ENABLED=1
# trusted local orchestrator command; receives prompt file path as argv[1]
# DSH_REPAIR_COMMAND=C:\path\to\dsh-repair-launcher.exe
```

If `REPAIR_WORKER_ENABLED=0`, the endpoint only queues the incident and returns
`"worker": "disabled"` — useful for dry-run and for tests.

## Worker file

`scripts/repair-worker.mjs` writes:

- `<incident>.prompt.md` — a self-contained DSH repair prompt with repo path,
  reproduction/test/fix requirements, and acceptance-test reminders;
- `repair-worker.log` — append-only queue log.

The prompt includes only the sanitized alert fields; PII is redacted through
`src/privacy.js` before the JSON is written.

## Production boundary

This is a safe **concept proof**, not an unattended auto-merge bot. Before enabling
`DSH_REPAIR_COMMAND`, add:

- webhook secret rotation and IP allow-listing;
- a dedicated low-privilege repair worker;
- approval gates for production changes;
- retention/cleanup for incident prompts and logs.
