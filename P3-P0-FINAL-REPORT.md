# P3-01 ~ P3-06 最终战报

| 项目 | 结果 |
|---|---|
| 范围 | Phase 3 P0：P3-01 ~ P3-06 |
| 状态 | **PASS（单节点生产基线）** |
| 服务 | `http://127.0.0.1:3030` / PID `29544` |
| 数据库 | `.data/relaydesk.sqlite`（SQLite WAL） |
| Node | `v25.2.1` / `node:sqlite` |
| Final Node tests | **27/27 PASS** |
| Final Playwright | **6/6 PASS**（AC-01~05 + P2 live） |
| Final Node check | **27/27 PASS** |
| Final run | `RUN-20261020-001417-P0-REFRESH-FINAL` |

## 1. P0 模块完成情况

| ID | 模块 | 结果 | 核心证据 |
|---|---|---|---|
| P3-01 | SQLite 持久化与并发安全 | **PASS** | 13 表、DAO、JSON 全量迁移、200 并发单进程 + 200 双进程无丢失 |
| P3-02 | 认证、租户隔离、RBAC | **PASS** | Access 15m + Refresh 30d、轮换/reuse detection/family revoke、cookie+CSRF、RBAC、跨租户测试、production fail-closed |
| P3-03 | API 安全与限流 | **PASS** | 多 scope 限流、429/Retry-After、CSP/HSTS/headers、CORS、fail-closed |
| P3-04 | LLM 网关与 grounded 生成 | **PASS** | OpenAI-compatible/Ollama、JSON schema、grounding、重试/熔断、SSE 流式 |
| P3-05 | 隐私、PII、合规基线 | **PASS** | consent audit、export/delete、retention/purge、PII redaction |
| P3-06 | 可观测性、CI/CD、DR | **PASS** | request-id、结构化日志、ops metrics、backup、CI workflow |

## 2. 最终测试结果

```text
npm test
tests 27
pass 27
fail 0

npm run check
tests 27
pass 27
fail 0
```

Playwright 最终运行：

```text
6 passed (6.9s)
```

- AC-01 merchant onboarding
- AC-02 Chinese customer chat
- AC-03 escalation queue
- AC-04 voice/RAG/high-risk
- AC-05 no ads
- P2 live site package/hours

19 张最终截图在：

`artifacts/runs/RUN-20261020-001417-P0-REFRESH-FINAL/screenshots/`

## 3. 并发与数据完整性

### P3-01 单进程

- 200 个同时 HTTP 写入；
- public messages: **200**
- escalations: **100**
- 唯一 message_id: **200**
- 无丢失、无重复、无覆盖。

### P3-01 双进程共享 WAL

- 两个独立 server 进程；
- 各 100 次写入；
- persisted messages: **200**
- 无 SQLite busy 失败。

### SQLite 最终校验

```json
{
  "integrity": "ok",
  "journal_mode": "wal",
  "foreign_keys": 1
}
```

最终 live backup：

`artifacts/backups/relaydesk-2026-10-19T16-15-11-711Z.sqlite`

backup integrity `ok`；messages 316；escalations 31。

## 4. 安全与会话

- 旧 JSON session token 哈希迁移；旧 localStorage token 通过 `/api/v1/auth/me` 200 验证。
- Refresh Token：
  - Access token 15 分钟；Refresh token 30 天；
  - 独立 `kind/family_id/replaced_by`；`002_auth_refresh_tokens.sql`；
  - `POST /api/v1/auth/refresh` 轮换 access+refresh；旧 refresh 重用会撤销整个 family；
  - 旧 access token 立即 401；旧 legacy token 仍兼容。
- Logout-all 撤销全部 session；Cookie access/refresh + CSRF。
- Logout-all 撤销全部 session。
- Cookie `HttpOnly; SameSite=Lax`；cookie 写入需 `x-csrf-token`。
- RBAC：owner > admin > agent > viewer；viewer 写入 403；跨租户 site/kb/escalation 404。
- Production 无 `APP_API_KEY` 时 legacy `/api/*` 401；health 仍公开。
- 限流：auth/public/ASR/V1/legacy 分桶；429 + Retry-After。
- 安全头：CSP、HSTS（HTTPS）、nosniff、Referrer-Policy、X-Frame-Options、Permissions-Policy。
- PII 日志脱敏。

## 5. LLM / RAG / 语音

- LLM provider 抽象：
  - OpenAI-compatible `/chat/completions`
  - Ollama `/api/chat`
- Grounded prompt：只允许使用检索证据；无证据不调用 LLM；JSON schema。
- 重试 1 次；连续失败 3 次熔断 30s；fallback 到 extractive answer。
- SSE `/api/chat/stream`；OpenAI SSE + Ollama NDJSON 解析。
- 本地 mock provider 测试通过；未配置真实外部模型/API key。
- P3-02 语音链路保留：Web Speech API + 网络失败友好降级 + WAV 上传本地兜底；P2 live 仍通过。

## 6. 隐私与合规

- `POST /api/v1/public/:embed_key/consent` 记录 consent audit。
- `GET /api/v1/privacy/export`：租户数据导出，排除密码哈希。
- `DELETE /api/v1/privacy/messages`：删除租户消息与 escalation。
- `GET/PATCH /api/v1/privacy/retention`：1–3650 天保留策略。
- `npm run prune:data`：清理过期 messages/escalations/events，保留 consent 审计。
- 日志/错误 PII 脱敏。
- 文档：`docs/PRIVACY-COMPLIANCE.md`。

## 7. 可观测性与运维

- 每个响应 `x-request-id`。
- JSON 访问日志（method/path/status/duration）。
- `GET /api/ops/metrics`：requests/errors/rate-limited、status、p50/p95/max、DB counts、queue、LLM、SQLite。
- `npm run backup:sqlite`：一致性快照 + integrity + counts。
- `docs/OBSERVABILITY.md`；SLO/告警/恢复 runbook。
- `.github/workflows/ci.yml`：Node 25、npm test/check、Playwright AC、verify、artifact upload。

## 8. 操作方式

```powershell
npm start
npm test
npm run check
npm run verify:sqlite
npm run backup:sqlite
npm run prune:data
npm run migrate:sqlite   # 仅升级旧 JSON 数据
```

服务：

```text
http://127.0.0.1:3030
```

最终 SQLite：

```text
.data/relaydesk.sqlite
```

## 9. 诚实的剩余边界

P0 **应用层单节点基线**已完成；以下是上线前仍应由运维/法务/后续 P1 处理的外部或增强项，不是本次代码闭环的隐藏失败：

1. `node:sqlite` 仍为 Node 25 experimental；已固定 Node 25.x。SQLite 为单节点，不是多节点水平扩展方案。
2. P3-04 未接真实外部模型进行质量评测；验收使用本地 mock provider 验证适配、grounding、熔断与流式。真实模型需单独配置 key 并跑 golden set。
3. P3-05 提供 consent/export/delete/retention/PII 技术能力；DPA、数据驻留、法务审核仍需组织流程完成。
4. P3-06 提供 metrics/backup/CI 代码与 runbook；外部告警平台、SAST/DAST 商业工具、staging/生产基础设施接入仍需运维配置。
5. P3-03 限流为单进程内存实现；多实例生产需换 Redis/网关限流，WAF/anti-DDoS 属基础设施层。
6. P3-02 已提供 cookie+CSRF 与 Bearer 兼容；前端仍主要使用 localStorage Bearer，后续可统一切换 cookie。邮箱验证/密码找回属于 P3-14（P1）。
7. 没有降低任何 AC 断言；原有 16 个测试仍通过，当前总计 27。

## 10. 证据链接

- `STATE.md`
- `P3-01-SQLITE-VERIFICATION.md`
- `P3-P0-FINAL-REPORT.md`
- `P3-01` 归档：`test_run/第三阶段-P3-01-SQLITE-PASS/`
- `P0` 归档：`test_run/第三阶段-P0-FINAL-PASS/`
- `docs/SQLITE-MIGRATION.md`
- `docs/PRIVACY-COMPLIANCE.md`
- `docs/OBSERVABILITY.md`
- `artifacts/npm-test-p0-final.log`
- `artifacts/npm-check-p0-final.log`
- `artifacts/runs/RUN-20261020-001417-P0-REFRESH-FINAL/`
- `artifacts/backup-refresh-final.log`
- `artifacts/verify-refresh-final.log`
- `artifacts/ops-metrics-refresh-final.json`
- `artifacts/backups/relaydesk-2026-10-19T16-15-11-711Z.sqlite`
