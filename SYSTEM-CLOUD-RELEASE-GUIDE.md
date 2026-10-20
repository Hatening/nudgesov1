# 系统上云与自动化发布指南

> 本项目是 Node + SQLite 单节点服务。推荐 **Docker + 持久化卷**，不建议直接部署到 Vercel（serverless 文件系统不持久，SQLite/本地 repair worker 不适合）。

## 最终验证（本次发布）

```text
npm test                        29/29 PASS
npm run check                   29/29 PASS
npx playwright test --workers=1 8/8 PASS（真实 deepseek-flash）
最终 run                         RUN-20261020-074323-RELEASE-FINAL
```

原有 27 个 Node 测试和 6 个 Playwright E2E 全部保留并通过；新增 i18n（1 Unit + 1 E2E）和 repair（1 Unit），因此当前为 29 Node / 8 E2E。

## 0. 本次已经生成的文件

| 文件 | 用途 |
|---|---|
| `.github/workflows/ci.yml` | push/PR 自动跑 `npm test`、`npm run check`、`npx playwright test` |
| `Dockerfile` | Node 25 生产镜像，SQLite 数据在 `/data` |
| `.dockerignore` | 缩小构建上下文 |
| `docker-compose.yml` | 本地/单机云端一键启动 |
| `scripts/mock-llm-server.mjs` | CI 用 hermetic OpenAI-compatible 假模型 |
| `scripts/start-with-dsh-llm.mjs` | 本地 DSH 真实模型启动器 |
| `src/repair.js` + `scripts/repair-worker.mjs` | 外部告警 → 本地修复队列 PoC |
| `docs/I18N.md` / `docs/AUTO-REPAIR.md` | P3-08 与自动修复说明 |

---

## 1. 本地 3 分钟启动

### 1.1 准备环境

```powershell
Copy-Item .env.example .env
# 编辑 .env：
# APP_API_KEY=<长随机值>
# SESSION_SECRET=<长随机值>
# NODE_ENV=production
# LLM_PROVIDER=openai
# LLM_BASE_URL=https://api.deepseek.com/v1
# LLM_MODEL=deepseek-flash
# LLM_API_KEY=<你的 key>
# LLM_AUTH_HEADER=authorization
# LLM_AUTH_SCHEME=Bearer
# REPAIR_WEBHOOK_SECRET=<长随机值>
```

如果复用本地 DSH 的 DeepSeek 凭据，不要写 `LLM_API_KEY`，直接：

```powershell
npm run start:llm
```

### 1.2 Docker 一键启动

```powershell
docker compose up --build -d
docker compose ps
curl.exe http://127.0.0.1:3030/api/health
```

打开：

```text
http://127.0.0.1:3030/
```

数据卷：

```text
relaydesk-data  ->  /data/relaydesk.sqlite
```

停止：

```powershell
docker compose down
```

不要删除 volume，除非你确认要清空数据。

### 1.3 不用 compose 的手动 Docker

```powershell
docker build -t relaydesk:local .
docker run -d --name relaydesk `
  -p 3030:3030 `
  -v relaydesk-data:/data `
  --env-file .env `
  -e DATA_DIR=/data `
  -e REPAIR_QUEUE_DIR=/data/repair-queue `
  relaydesk:local
```

查看日志：

```powershell
docker logs -f relaydesk
```

---

## 2. 推送 GitHub 并启用 CI

### 2.1 初始化并推送

```powershell
git init
git add .
git commit -m "RelayDesk: P0.5 real LLM + P3-08 i18n + deploy/CI scaffolding"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`git add .` 前确认 `.env` 没有被跟踪；`.env.example` 可以提交。

### 2.2 CI 会做什么

`.github/workflows/ci.yml` 在以下事件运行：

- push 到 `main`
- 任意 pull request

步骤：

```text
npm ci
npm test                 # 27 + i18n + repair，当前 29/29
npm run check
npx playwright test --workers=1   # 全部 8 条：AC-01..05 + P2 + I18N + UI390
npm run verify:sqlite
```

CI 使用 **本地 mock LLM**（`scripts/mock-llm-server.mjs`），因此：

- 不需要把 DeepSeek/DSH key 放进 GitHub；
- 测试仍然是 hermetic 的；
- `reply.model` 仍为 `deepseek-flash`，断言不缩水；
- 真实模型验收在本地 P0.5 已单独跑过。

### 2.3 让失败真正“阻止合并”

GitHub 的 workflow 失败本身不会自动改分支保护，需要一次性设置：

1. GitHub repo → **Settings → Branches → Add branch protection rule**
2. Branch name pattern: `main`
3. 勾选 **Require status checks to pass before merging**
4. 搜索并选择：**`ci / required`**
5. 勾选 **Require branches to be up to date before merging**
6. （建议）勾选 **Require pull request reviews**、**Do not allow bypassing**

之后 PR 里 `ci / required` 失败或未完成时，Merge 按钮会被禁用。

> 说明：workflow 文件负责“跑并失败”，branch protection 才负责“阻止合并”。这是 GitHub 的产品边界，不可能全部写在 YAML 里。

### 2.4 查看失败证据

失败时在 Actions → `ci / required` 下载：

```text
playwright-and-server-logs
  -> relaydesk-ci-artifacts/
  -> relaydesk-server.log
  -> mock-llm.log
  -> artifacts/playwright/
```

---

## 3. 上云选择

### 推荐：任意支持 Docker 的 VPS / 容器平台

1. 把镜像推送到 GHCR / Docker Hub：

```powershell
docker tag relaydesk:local ghcr.io/<you>/relaydesk:latest
docker push ghcr.io/<you>/relaydesk:latest
```

2. 在云主机或容器平台创建服务：

```text
Image:        ghcr.io/<you>/relaydesk:latest
Port:         3030
Volume:       /data  (必须持久化)
Healthcheck:  /api/health
Env:          APP_API_KEY, SESSION_SECRET, LLM_*, REPAIR_WEBHOOK_SECRET
```

3. 配置 HTTPS 反向代理（Caddy/Nginx/云 LB）：

```text
https://support.example.com -> 127.0.0.1:3030
```

4. 设置 `COOKIE_SECURE=1`，并把 `CORS_ORIGINS` 设为你真正的前端域名。

### Railway（最省事）

1. 把 GitHub repo 连接到 Railway，新建 **Empty Project → Deploy from GitHub**。
2. Service → Settings → **Builder: Dockerfile**；Root Directory 保持仓库根目录。
3. **Volumes → Add Volume**，Mount Path 填 `/data`（这是 SQLite 持久化的关键）。
4. Variables 添加：
   ```text
   APP_API_KEY=<secret>
   SESSION_SECRET=<secret>
   REPAIR_WEBHOOK_SECRET=<secret>
   DATA_DIR=/data
   REPAIR_QUEUE_DIR=/data/repair-queue
   NODE_ENV=production
   ```
5. Networking → Generate Domain；Healthcheck Path 填 `/api/health`。
6. 设置单实例（不要开多副本）：SQLite 是单写节点。

CLI 方式：

```powershell
npm i -g @railway/cli
railway login
railway init
railway up
railway volume add --mount-path /data
```

### Render

1. New → **Web Service** → connect repo → Runtime **Docker**。
2. Health Check Path: `/api/health`。
3. **Disks → Add Disk**：Name `relaydesk-data`，Mount Path `/data`，Size 1GB+。
4. Environment 同上；提交 `Dockerfile` 后 Render 自动 build。
5. 只设置 1 instance；不要开 autoscaling。

### AWS（ECS Fargate + EFS，或单 EC2 + EBS）

最简单可靠的单节点方案：

```powershell
# 1. 构建并推送 ECR
aws ecr create-repository --repository-name relaydesk
docker build -t relaydesk .
docker tag relaydesk:latest <acct>.dkr.ecr.<region>.amazonaws.com/relaydesk:latest
aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com
docker push <acct>.dkr.ecr.<region>.amazonaws.com/relaydesk:latest

# 2. 单 EC2（最直接）：挂 EBS 到 /data，运行容器
docker run -d --name relaydesk `
  -p 80:3030 `
  -v /data/relaydesk:/data `
  --env-file .env `
  <acct>.dkr.ecr.<region>.amazonaws.com/relaydesk:latest
```

ECS Fargate 版本需要：

- EFS 文件系统挂载到 task 的 `/data`；
- ECS Service `desiredCount=1`（SQLite 单写）；
- ALB target group health check `/api/health`；
- Secrets Manager 注入 `APP_API_KEY`、`SESSION_SECRET`、`LLM_API_KEY`、`REPAIR_WEBHOOK_SECRET`。

### 为什么不推荐 Vercel

| 问题 | 影响 |
|---|---|
| 文件系统不持久 | SQLite 数据会在冷启动/重建时丢失 |
| 无长驻 worker | repair worker、后台队列不可靠 |
| 单节点 SQLite | 无法多实例共享写 |
| Playwright/CI | Vercel 不负责跑你的 Playwright 验收 |

如果一定要 serverless，替代方案：

1. **Vercel 只托管前端**，API/Worker 放在 Railway/Render/Fly/AWS Docker；
2. 数据库迁移到 **Neon/Supabase/RDS PostgreSQL**，替换 `src/db.js`/DAO；
3. repair 队列改为 **SQS/QStash/Redis**，worker 放在长驻容器；
4. 文件/录音放 S3/R2，避免依赖本地磁盘。

在这些迁移完成前，Docker + `/data` Volume 是唯一推荐的交付形态。

---

## 4. 真实 LLM 配置

### 4.1 OpenAI-compatible / DeepSeek

```text
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-flash
LLM_API_KEY=<secret>
LLM_AUTH_HEADER=authorization
LLM_AUTH_SCHEME=Bearer
```

### 4.2 本地 DSH 凭据（仅开发）

```powershell
npm run start:llm
```

启动器读取 `~/.dsh/.credentials.yaml` 里的 DeepSeek account token，使用：

```text
x-dsh-auth-token: <token>
```

token 只在进程内存中，不写入仓库。

### 4.3 Ollama

```text
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:7b
```

然后在商家设置中启用 Ollama。

### 4.4 生产建议

不要把 DSH 账号 token 用于生产。使用云 secret manager 注入独立的
provider key，并给模型配置预算/超时/熔断（代码已有重试、熔断与 fallback）。

---

## 5. 外部监控自动触发修复 PoC

### 5.1 配置

```text
REPAIR_WEBHOOK_SECRET=<长随机值>
REPAIR_QUEUE_DIR=/data/repair-queue
REPAIR_WORKER_ENABLED=1
```

### 5.2 发送告警

```powershell
curl.exe -X POST http://127.0.0.1:3030/api/ops/repair `
  -H "content-type: application/json" `
  -H "x-repair-secret: $env:REPAIR_WEBHOOK_SECRET" `
  -d '{
    "event":"error",
    "severity":"high",
    "service":"relaydesk",
    "fingerprint":"checkout-500",
    "message":"checkout failed for customer a@example.test",
    "source":"prometheus"
  }'
```

返回 `202`，并在 `/data/repair-queue/` 生成：

```text
<timestamp>-repair_xxx.json        # sanitized incident
<timestamp>-repair_xxx.prompt.md   # DSH-ready repair prompt
repair-worker.log
```

### 5.3 接入真正的新会话

默认 worker 只生成 prompt，不自动执行外部文本。设置一个受信任的：

```text
DSH_REPAIR_COMMAND=C:\path\to\trusted-dsh-launcher.exe
```

worker 会把 `.prompt.md` 路径作为 `argv[1]` 交给该命令。建议由它创建
低权限 DSH session，并强制 PR + 人工审批，不要直接自动合并生产。

完整安全边界见 [docs/AUTO-REPAIR.md](docs/AUTO-REPAIR.md)。

---

## 6. 运维检查清单

- [ ] `.env` 未提交；`APP_API_KEY`/`SESSION_SECRET`/`REPAIR_WEBHOOK_SECRET` 足够随机
- [ ] `/data` 使用持久化卷，已配置备份
- [ ] `NODE_ENV=production`、`COOKIE_SECURE=1`、HTTPS 终止
- [ ] `/api/health` 和 `/api/ops/metrics` 接入监控
- [ ] GitHub branch protection 强制 `ci / required`
- [ ] CI 失败时能下载 Playwright/服务端日志
- [ ] 真实 LLM key 在 secret manager，不在仓库
- [ ] repair webhook 只对监控网段/白名单开放
- [ ] 定期运行 `npm run backup:sqlite` 并演练 restore

## 7. 验证命令

```powershell
npm test
npm run check
npm run verify:sqlite
docker compose config
docker compose up --build -d
curl.exe http://127.0.0.1:3030/api/health
npx playwright test --workers=1
```

如果 Docker 未安装，至少先运行前三项和 Playwright 本地套件；CI 会在 GitHub 上执行容器外的同一套测试。
