# Test plan

## Local automated smoke tests
Run `npm test` and `npm run check`. The current baseline covers intent routing, language script heuristics, English retrieval, basic Chinese query expansion, and abstention when no evidence exists.

## Required pre-production validation

### Functional
- Knowledge create/list/delete, file import boundaries, Unicode, long text and malformed payloads.
- Conversation create/reply/status changes and data export/restore.
- Settings validation and model unavailable/timeout/invalid JSON paths.
- Empty state, loading state, API error state, keyboard operation and mobile layout.

### Retrieval and answer quality
- Create a manually reviewed golden dataset for each launch language and top intents.
- Measure intent macro-F1; retrieval Recall@3, MRR; answer evidence precision/recall; faithfulness; unsupported-claim rate; escalation precision/recall.
- Include paraphrases, typos, mixed-language queries, transliteration, short ambiguous questions, product IDs, policy exceptions, conflicting documents and stale versions.
- Run paired regression tests after any model, prompt, chunking, glossary or knowledge change.

### Security and abuse
- Prompt injection in customer messages and retrieved documents.
- Cross-tenant reads/writes, unauthenticated API access, brute force, oversized bodies and malicious file names.
- PII leakage, secret leakage, log scrubbing, XSS in customer content, CSRF/CORS and SSRF paths.
- Rate-limit exhaustion, queue retry storms, duplicate webhook delivery and replayed signatures.

### Operations
- Load test concurrency, memory and CPU on the actual ECS size/model.
- Verify cold boot, process restart, disk-full behavior, backup and restore drills.
- Monitor p50/p95 latency, model timeout rate, cost per resolved conversation, escalation rate and customer satisfaction.

## Release gate proposal
Do not auto-send answers until each target language/domain passes the approved threshold on a held-out dataset. Initially keep AI answers as drafts and route unsupported or sensitive intents to human review. Treat all test reports as evidence only for the exact build and dataset tested.
