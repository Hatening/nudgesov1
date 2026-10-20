# Architecture and engineering notes

## Request flow
1. A customer message arrives through the local inbox or `/api/chat`.
2. Language is selected explicitly or estimated with a small heuristic.
3. The retriever ranks the store's approved knowledge articles with lexical overlap and a tiny cross-language alias map.
4. If enabled, the server asks Ollama for a structured JSON answer with the selected evidence in context.
5. The fallback path quotes the best matching article or abstains when no article matches.
6. Confidence threshold, evidence requirement and `needsHuman` decide whether human review is recommended.
7. Events, conversations, messages, sites, knowledge, escalations and sessions are persisted in SQLite (WAL); JSON is only the migration source.

## Storage / DAO
- `src/db.js`: SQLite connection, WAL/foreign-key/busy-timeout pragmas, schema migration, bounded `SQLITE_BUSY` transaction retry.
- `src/dao.js`: tenant/user/session/site/knowledge/message/escalation/conversation/settings/glossary/event/test-run repositories.
- `scripts/migrate-json-to-sqlite.mjs`: transactional JSON migration with count verification and session hashing.
- `scripts/verify-sqlite.mjs`: integrity/WAL/foreign-key/count checks.
- `docs/SQLITE-MIGRATION.md`: cutover, backup and rollback runbook.

## Important limitations
- SQLite (WAL) is the current single-node store; it is not a horizontal-scale database. PostgreSQL remains the later scale-out target.
- JSON-file storage has been removed from the runtime; `.data/store.json` is retained only as migration source/backup.
- Retrieval is lexical, not embedding-based vector search. Use hybrid retrieval (BM25 + multilingual embeddings + exact SKU/order/term matching) for production.
- Language detection and query expansion are illustrative only. Never claim that the starter list equals validated support for 70+ languages.
- The confidence value is a heuristic or model self-report and is not calibrated probability.
- No actual WhatsApp, email, Instagram or commerce API is connected.
- The test suite checks basic intent/retrieval paths, not comprehensive correctness or safety.


## Recommended production evolution
1. Add Postgres schema for tenants, users, knowledge documents, chunks, conversations, messages, answer traces, feedback, usage ledger and audit log.
2. Add auth + tenant-aware authorization at every data access point.
3. Parse approved PDF/DOCX/HTML/CSV inputs in a sandbox, retain source/page/URL metadata, chunk by headings and version documents.
4. Build hybrid multilingual retrieval, reranking, source citations and per-tenant retrieval filters.
5. Add golden sets and CI quality gates: intent macro-F1, retrieval Recall@k/MRR, evidence precision, faithfulness, unsupported-claim rate, language parity, escalation calibration.
6. Integrate real channels via official APIs, idempotent webhooks, durable queue and dead-letter retry policy.
7. Add subscription/usage billing with an append-only ledger. Ad-funded free access must be transparent, privacy-respecting and compliant; do not optimize for accidental clicks or coerced video viewing.
