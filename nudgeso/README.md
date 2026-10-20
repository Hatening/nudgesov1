# RelayDesk — self-hostable multilingual support MVP

A runnable Node.js MVP for small online sellers: support inbox, store knowledge base, glossary, language coverage, local AI answer drafting, explicit handoff cues, quality analytics, regression smoke tests, seller briefings with clearly labeled sponsored cards, JSON export, and local Ollama integration.

> **Honest status:** this is a development MVP, not a production-ready multi-tenant SaaS. It has been designed to run without third-party npm dependencies. The automated tests cover basic functions and deterministic smoke behavior; they do not prove production answer accuracy, 70+ language parity, security, channel delivery, or deployment readiness. Real customer messages are not sent to external channels.

## Requirements
- Node.js 20 or later
- Optional: [Ollama](https://ollama.com/) with a local model such as `qwen2.5:7b`

## Run locally

```bash
# Windows PowerShell
cd relaydesk-mvp
Copy-Item .env.example .env
node --version
npm test
npm start
```

Open `http://127.0.0.1:3030`.

The app stores data in `.data/store.json`. Stop the server before backing up or restoring that file. Do not commit `.env` or `.data/` to Git.

## Optional local model
1. Install Ollama on the same machine as the Node server (or use a private reachable endpoint).
2. Pull a model, for example `ollama pull qwen2.5:7b`.
3. Set environment variables before starting the app:

```bash
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_TIMEOUT_MS=25000
```

4. Open Settings and enable “Ollama local model”.

The server asks Ollama for a structured JSON response. If the model is unavailable or times out, it falls back to a simple extractive answer using retrieved knowledge. The fallback is deliberately conservative, but lexical search is not production-grade multilingual RAG.

## Included screens
1. Overview
2. Inbox
3. AI assistant / answer sandbox
4. Knowledge base
5. Terminology and glossary
6. Channel setup
7. Language coverage
8. Analytics
9. Quality and regression tests
10. Seller briefings / sponsored content
11. Settings / model and monetization

The UI is responsive and uses common admin patterns: left navigation, searchable tables/cards, evidence panels, explicit status badges, and familiar forms.

## API endpoints
- `GET /api/health`
- `GET /api/bootstrap`
- `GET|POST /api/knowledge`
- `DELETE /api/knowledge/:id`
- `GET|POST /api/glossary`
- `PATCH /api/settings`
- `POST /api/chat`
- `GET|POST /api/conversations`
- `POST /api/conversations/:id/reply`
- `POST /api/feedback`
- `POST /api/test/run`
- `GET /api/tests`
- `GET /api/metrics`
- `GET /api/export`

Example:

```bash
curl -X POST http://127.0.0.1:3030/api/chat \
  -H 'content-type: application/json' \
  -d '{"message":"Where is my tracking number?","language":"en"}'
```

## Security and production checklist
Do **not** expose the default configuration directly to the public internet. Before production, implement and independently test:
- Authentication, password reset, MFA option, RBAC, tenant isolation and per-tenant data access checks.
- Production database (PostgreSQL), migrations, backups, restore drills and retention/deletion policies.
- HTTPS termination, reverse proxy, request-size and rate limits, CSRF/CORS policy, secure headers and abuse monitoring.
- API secrets stored server-side; never put provider keys in frontend code or logs.
- Signed webhooks, OAuth and provider-specific permissions for real messaging channels.
- Prompt-injection defenses, untrusted document isolation, PII redaction, audit logs and incident handling.
- Per-language labeled golden sets, retrieval metrics, answer faithfulness review, adversarial tests, latency and cost monitoring.
- Consent, privacy, cookie/advertising disclosures and jurisdiction-specific ad rules. Do not use hidden ads, forced watch time or accidental-click patterns.

`APP_API_KEY` adds a basic shared API key check when set, but it is not a substitute for user authentication or tenant isolation. Use it only behind a secure server-side integration, never expose the secret in browser JavaScript.

## Test

```bash
npm test
npm run check
```

The test suite is a small smoke baseline. Expand it with real, reviewed customer questions and expected evidence for every language and business domain before using the system to answer customers autonomously.

## License
No third-party code is vendored in this MVP. Add a project license and audit all external models, packages, datasets and source documents before commercial distribution.
