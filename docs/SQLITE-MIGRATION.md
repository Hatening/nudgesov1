# SQLite Migration & Operations Runbook

## Scope

RelayDesk now uses SQLite (`node:sqlite`, Node 25.2.1) instead of the runtime JSON store.

- Database: `DB_PATH` or `DATA_DIR/relaydesk.sqlite`
- Mode: WAL
- Foreign keys: ON
- Busy timeout: 5000 ms
- JSON source: `.data/store.json` (migration/backup only)

`node:sqlite` is currently marked experimental by Node; pin Node 25.x and keep the DAO boundary so a future move to `better-sqlite3` or PostgreSQL is isolated.

## Tables

- `tenants`
- `users`
- `sessions` (`token_hash`, no plaintext token)
- `sites`
- `knowledge` (global and site-scoped)
- `conversations`
- `messages` (public chat + legacy conversation messages)
- `escalations`
- `settings`
- `glossary`
- `events`
- `test_runs`
- `schema_migrations`

## Migration

Stop the server first.

```powershell
npm run migrate:sqlite
npm run verify:sqlite
npm start
```

Optional explicit paths:

```powershell
node scripts/migrate-json-to-sqlite.mjs `
  --source .data/store.json `
  --db .data/relaydesk.sqlite
```

The script:

1. parses and validates the JSON source;
2. creates a timestamped `.data/store.json.bak-*` backup;
3. creates/migrates the schema;
4. imports all collections in one transaction;
5. hashes legacy session tokens (existing localStorage Bearer tokens keep working);
6. verifies counts against the source before committing;
7. records a `json_import_*` migration marker;
8. is idempotent when run again on the same source.

If the target database already has data from a different source, the script refuses unless `--force` is provided.

## Verification

```powershell
npm run verify:sqlite
```

Checks:

- `PRAGMA integrity_check = ok`
- `journal_mode = wal`
- `foreign_keys = 1`
- table counts

For a full check:

```powershell
npm test        # existing 16 tests + SQLite DAO/migration/concurrency tests
npm run check   # syntax + full Node test suite
npx playwright test e2e/AC-01.spec.ts e2e/AC-02.spec.ts e2e/AC-03.spec.ts e2e/AC-04.spec.ts e2e/AC-05.spec.ts --workers=1
```

## Backup

Preferred: stop writes, then copy all three files together:

```powershell
Copy-Item .data/relaydesk.sqlite      backups/relaydesk.sqlite
Copy-Item .data/relaydesk.sqlite-wal  backups/relaydesk.sqlite-wal
Copy-Item .data/relaydesk.sqlite-shm  backups/relaydesk.sqlite-shm
```

Do not copy only the `.sqlite` file while WAL contents are uncheckpointed.

Restore into a maintenance window:

1. stop the server;
2. archive the current DB files;
3. restore the three backup files;
4. `npm run verify:sqlite`;
5. start and run smoke tests.

## Concurrency model

- One Node process uses synchronous `DatabaseSync` calls; request bodies can interleave, but individual DB statements/transactions do not.
- Multi-statement writes use `BEGIN IMMEDIATE`.
- `busy_timeout` and bounded `SQLITE_BUSY` retry protect two processes sharing the same WAL database.
- Never hold a DB transaction open across an Ollama/network call. LLM work happens before the short insert transaction.
- SQLite is appropriate for this single-node phase. Multi-node/horizontal scaling requires PostgreSQL later.

## Cutover / rollback

The cutover performed on 2026-10-19:

1. stopped the JSON-based server;
2. backed up `.data/store.json` and the pre-refactor `server.js`;
3. migrated `.data/store.json` → `.data/relaydesk.sqlite`;
4. verified integrity/WAL/counts;
5. started the SQLite server;
6. ran all 5 Playwright ACs and the live P2 smoke.

The old JSON file and pre-refactor server are retained under `artifacts/backups/pre-sqlite-*`. A rollback after new SQLite writes would lose those post-cutover writes; only roll back within the cutover/maintenance window or restore a verified SQLite backup.

## Known limitations

- SQLite is single-node; no horizontal write scaling.
- `node:sqlite` is experimental in Node 25.
- P3-02/P3-03 still need session refresh/revocation, RBAC hardening, rate limiting and production security headers.
- `APP_API_KEY` legacy behavior is unchanged in this storage-only sprint.
