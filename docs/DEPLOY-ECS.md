# Alibaba Cloud ECS deployment (single-node test environment)

This guide is for a **private test deployment**, not a production security sign-off.

## 1. Prepare the server
- Use a supported Linux distribution and Node.js 20+.
- Create a non-root Linux user for the app.
- Keep the ECS security group closed except for SSH and HTTPS through a reverse proxy. Do not expose port 3030 publicly.
- Install and configure Ollama only if local inference is required. Ensure the selected model fits the server RAM/VRAM.

## 2. Copy and run
Unzip the package to `/opt/relaydesk` (or another directory owned by the app user), then:

```bash
cd /opt/relaydesk/relaydesk-mvp
cp .env.example .env
# Edit .env. For local-only binding:
# HOST=127.0.0.1
# PORT=3030
# DATA_DIR=/var/lib/relaydesk
# OLLAMA_URL=http://127.0.0.1:11434
# OLLAMA_MODEL=qwen2.5:7b
# DB_PATH=/var/lib/relaydesk/relaydesk.sqlite
mkdir -p /var/lib/relaydesk
npm test
npm run check
# Only when upgrading a JSON-based install:
npm run migrate:sqlite
npm run verify:sqlite
npm start
```

Node **25.x** is required because the app uses the built-in `node:sqlite` module. SQLite runs in WAL mode and is a single-node store; PostgreSQL remains the later horizontal-scale target.

If the app runs behind a local reverse proxy, `HOST=127.0.0.1` keeps the Node service private. Configure Nginx/Caddy to proxy only to `127.0.0.1:3030`, terminate TLS, and apply request-size/time limits. Do not publish the `.env` file.

## 3. Backup

Stop writes or stop the service, then copy the SQLite database and its WAL files together:

```bash
sudo systemctl stop relaydesk
cp /var/lib/relaydesk/relaydesk.sqlite* /var/backups/relaydesk-$(date +%F-%H%M%S)/
sudo systemctl start relaydesk
```

Do not copy only `relaydesk.sqlite` while WAL contents are uncheckpointed. Run `npm run verify:sqlite` after a restore and before accepting traffic.

## 4. systemd example
Create `/etc/systemd/system/relaydesk.service` and adjust paths/user:

```ini
[Unit]
Description=RelayDesk MVP
After=network.target

[Service]
Type=simple
User=relaydesk
Group=relaydesk
WorkingDirectory=/opt/relaydesk/relaydesk-mvp
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3030
Environment=DATA_DIR=/var/lib/relaydesk
Environment=DB_PATH=/var/lib/relaydesk/relaydesk.sqlite
EnvironmentFile=/opt/relaydesk/relaydesk-mvp/.env
ExecStart=/usr/bin/node /opt/relaydesk/relaydesk-mvp/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/relaydesk

[Install]
WantedBy=multi-user.target
```

Then run `sudo systemctl daemon-reload && sudo systemctl enable --now relaydesk`. Verify with `curl http://127.0.0.1:3030/api/health`.

## 5. Before real customers
This MVP now has SQLite/WAL persistence, but it still lacks full user authentication/session hardening, tenant RBAC, rate limiting, a billing ledger, production upload parsers, durable background jobs, real channel connectors and a production audit/security review. SQLite is single-node; move to PostgreSQL before horizontal scaling. Do not put confidential customer information in it or expose it publicly until those items are implemented and tested. Use a separate staging environment and a reviewed backup/restore plan.
