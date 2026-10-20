# P3-01 SQLite 重构 — 最终验证报告

| 项目 | 结果 |
|---|---|
| 任务 | P3-01 数据库持久化与并发安全 |
| 状态 | **PASS** |
| Runtime | Node `v25.2.1` / `node:sqlite` (`DatabaseSync`) |
| Database | `.data/relaydesk.sqlite`（WAL） |
| Service | `http://127.0.0.1:3030` / PID `30892` / health 200 |
| Date | 2026-10-19 |

## 1. 交付内容

### 存储层

- `src/db.js`：SQLite 连接、WAL、foreign_keys、busy_timeout、schema migration、`BEGIN IMMEDIATE` 事务、`SQLITE_BUSY` 有界重试。
- `src/dao.js`：tenant/user/session/site/knowledge/message/escalation/conversation/settings/glossary/event/test-run DAO。
- `src/core.js`：纯函数（retrieval/intent/language/fallback/voice/ASR WAV）。
- `src/seed.js`：空库 demo seed。
- `db/migrations/001_init.sql`：13 张表、外键、索引。
- `scripts/migrate-json-to-sqlite.mjs`：JSON 全量迁移、备份、计数校验、幂等、session hash。
- `scripts/verify-sqlite.mjs`：integrity/WAL/foreign_keys/counts。
- `scripts/inject-p2-knowledge.mjs`：改为直接使用 SQLite DAO。
- `server.js`：所有 V1 与 legacy 路由改走 DAO；移除 runtime JSON `persist()`。

### 表

`tenants`、`users`、`sessions`、`sites`、`knowledge`、`conversations`、`messages`、`escalations`、`settings`、`glossary`、`events`、`test_runs`、`schema_migrations`。

### 兼容性

- 旧 JSON `publicMessages` / `conversations.messages` 统一进入 `messages`。
- 旧 `sites[].knowledge` 展平进入 `knowledge`（`scope=site`）。
- 旧 session token 迁移为 SHA-256；旧 localStorage token 仍可认证。
- API 响应结构保持不变。

## 2. 迁移与切换

- 旧服务 PID `32828` 已停止。
- 备份：
  - `artifacts/backups/pre-sqlite-20261019-233220/server.pre-sqlite.js`
  - `artifacts/backups/pre-sqlite-20261019-233220/store.json`
  - `.data/store.json.bak-2026-10-19T15-32-23-333Z`
- 迁移结果：

```json
{
  "tenants": 9,
  "users": 9,
  "sessions": 9,
  "sites": 9,
  "knowledge": 10,
  "conversations": 3,
  "messages": 76,
  "escalations": 4,
  "glossary": 3,
  "events": 107,
  "testRuns": 0
}
```

- `npm run verify:sqlite`：

```json
{
  "ok": true,
  "integrity": "ok",
  "journal_mode": "wal",
  "foreign_keys": 1
}
```

- 新服务 PID `30892`；DB 启动后健康检查通过。
- 旧 JSON token → `/api/v1/auth/me` **200**，session 兼容性验证通过。
- 新 DB 文件：`.data/relaydesk.sqlite`（约 270KB，迁移后）。

## 3. 并发测试

### 单进程：200 同时 HTTP 写入

- 100 条普通 public messages
- 100 条高风险退款 messages
- 结果：
  - HTTP 200：200/200
  - 唯一 `message_id`：**200**
  - `messages`（source=public）：**200**
  - `escalations`：**100**
- 无覆盖、无丢失、无重复。

### 双进程：两个 server 共享同一 WAL DB

- 两个独立 Node server 进程，同一 `DATA_DIR`/SQLite 文件
- 每个进程 100 条并发 public messages
- 结果：
  - HTTP 200：200/200
  - 唯一 `message_id`：**200**
  - 持久化 `messages`：**200**
- `busy_timeout` + `BEGIN IMMEDIATE` + 重试下无 `SQLITE_BUSY` 失败。

## 4. 回归结果

### Node 测试

`npm test`：

```text
tests 20
pass 20
fail 0
```

包含：

- 原有 16 个测试全部通过；
- 新增 1 个 DAO/schema/transaction 测试；
- 新增 1 个 JSON→SQLite migration 测试（含幂等/备份/session hash）；
- 新增 2 个 concurrency 测试（单进程 200 + 双进程 200）。

`npm run check`：**20/20 PASS**。

### Playwright

```text
5 passed (7.3s)
```

- AC-01 onboarding：PASS
- AC-02 中文聊天：PASS
- AC-03 升级队列：PASS
- AC-04 语音/RAG/高风险：PASS
- AC-05 无广告：PASS

实时站点 P2 live：

```text
1 passed (685ms)
```

`6088e64af95d4856959a8275` 的物流/营业时间答复仍通过；迁移未破坏知识。

## 5. 说明与边界

- `node:sqlite` 在 Node 25 仍标记为 experimental；已固定 Node 25.x，并用 DAO 隔离，未来可切 `better-sqlite3` 或 PostgreSQL。
- SQLite 是单节点存储；多节点横向扩展仍需 PostgreSQL（P3-18）。
- 本次只做 P3-01；P3-02 的 session 刷新/RBAC、P3-03 的限流/安全头仍未实现。
- `.data/store.json` 仍保留为迁移源/备份，但运行时不读取、不写入。
- 未降低任何现有断言；测试只做了 cleanup helper 和纯函数导入路径的适配。

## 6. 复现命令

```powershell
npm test
npm run check
npm run verify:sqlite

npx playwright test e2e/AC-01.spec.ts e2e/AC-02.spec.ts e2e/AC-03.spec.ts e2e/AC-04.spec.ts e2e/AC-05.spec.ts --workers=1
npx playwright test e2e/P2-LIVE.spec.ts --workers=1
```

## 7. 证据位置

- `artifacts/npm-test-sqlite-final.log`
- `artifacts/npm-check-sqlite-final.log`
- `artifacts/migration-live-sqlite.log`
- `artifacts/verify-live-sqlite.log`
- `artifacts/runs/RUN-20261019-233233-SQLITE-AC-ALL/`
- `artifacts/runs/RUN-20261019-233247-SQLITE-P2-LIVE/`
- `artifacts/backups/pre-sqlite-20261019-233220/`
- `test/db-dao.test.js`
- `test/db-migration.test.js`
- `test/db-concurrency.test.js`
- `docs/SQLITE-MIGRATION.md`
