---
name: crawler-monkey-test-sop
description: Use before any UI delivery to run safe, full-surface crawler and monkey tests across all pages, navigation, buttons, empty states and auth boundaries. Includes dead-link, white-screen, raw-401 and no-op assertions.
---

# 全量分支与连通性测试 SOP  
## Crawler & Monkey Test SOP

> 目标不是“再跑一次 Happy Path”，而是证明**每个可见入口都有去处，每个分支都有明确状态，每个权限边界都有友好拦截**。
>
> 本 SOP 是项目交付门禁，不是可选建议。

---

## 1. 适用范围与不适用范围

### 适用

- 静态页面：`/index.html`、`/onboarding.html`、`/chat.html`、`/queue.html`
- SPA 视图：Overview、Inbox、AI assistant、Knowledge base、Terminology、Channels、Languages、Analytics、Quality & tests、Seller briefings、Settings
- 导航栏、页头、页脚、空状态卡片、弹窗、Toast、登录/登出、分页/筛选/搜索
- 未登录、已登录、Token 过期、空数据、有数据
- 桌面 1440px 与移动 390px 两种视口

### 不适用/不执行

- 真实删除、清库、批量写入、真实发送消息、支付、真实外部邮件/短信
- 生产 Render 环境上的写操作与 Monkey 点击
- 真实第三方广告、追踪、上传恶意文件
- 未获授权的破坏性 API

---

## 2. 安全遍历纪律（硬规则）

1. **测试数据库必须隔离**
   - 使用临时 `DATA_DIR`、一次性 SQLite 副本或测试租户。
   - 禁止连接生产 DB 做 monkey test。
   - 测试前后记录 DB 行数/文件 hash；发现变化立即 fail。

2. **只点“视图切换/打开/关闭/搜索/筛选”类控件**
   - 导航、Tab、面包屑、筛选、搜索、打开表单、关闭弹窗、复制、帮助/状态提示。
   - 不确认 `window.confirm`、不点“删除/重置/发送/保存/创建/运行测试/提交反馈”。
   - 遇到危险按钮：只断言它可见、可聚焦、有明确的确认/权限守卫，然后 **dismiss**。

3. **网络写请求必须被拦截或 mock**
   - 对 `POST/PATCH/PUT/DELETE` 使用 `page.route` 返回固定 fixture，或使用只读测试账号。
   - 禁止让 monkey 测试调用真实 LLM、ASR、邮件、支付、导出外部系统。
   - 外部请求（非 same-origin）一律阻断，并作为失败信号。

4. **不离开测试 origin**
   - 外链、`target="_blank"`、下载链接：只验证 `href`，不实际打开。
   - 拦截 `popup`/`download`，不执行外部导航。

5. **点击总量与超时上限**
   - 每个页面最多 60 次安全点击；总预算 ≤ 8 分钟。
   - 单次点击等待 ≤ 2 秒；禁止无限循环。
   - 使用 selector/路由/视图 fingerprint 去重。

6. **测试账号与密钥**
   - 测试账号通过 `/api/v1/auth/register` 临时创建，禁止把真实账号/密钥写入仓库。
   - 不使用 `APP_API_KEY` 作为浏览器 side secret；使用真实 session/Bearer。
   - 记录测试环境变量名称，不记录值。

---

## 3. 当前项目路由清单（按代码扫描）

### 3.1 静态页面

| 路由 | 作用 | 鉴权 |
|---|---|---|
| `/` | 商家 Dashboard SPA | 登录后数据；未登录显示登录卡 |
| `/onboarding.html` | 商家注册/登录、站点、知识、embed | 公开 |
| `/chat.html?site=<embed_key>` | 客户聊天/隐私同意/语音 | 公开 |
| `/queue.html` | 升级队列 | 需要商家 session |

### 3.2 Dashboard SPA 视图（`public/app.js` 的 `pages`）

```text
overview
inbox
assistant
knowledge
glossary
channels
languages
analytics
tests
growth
settings
```

这些视图不改变 URL，靠 `data-page` / `#page` / `#pageCrumb` / `.nav-item.active` 判断切换。

### 3.3 主要服务端路由组

```text
GET  /api/health                 公开
POST /api/ops/repair             x-repair-secret，fail-closed
GET  /api/bootstrap              legacy，需要 admin session 或 x-api-key
GET  /api/metrics                legacy，有权限
GET  /api/tests                  legacy，有权限
POST /api/chat                   legacy，有权限
POST /api/conversations          legacy，有权限
POST /api/conversations/:id/reply legacy，有权限
POST /api/feedback               legacy，有权限
POST /api/test/run               legacy，有权限
PATCH /api/settings              legacy，有权限
GET  /api/export                 legacy，有权限
POST /api/v1/auth/register      公开
POST /api/v1/auth/login         公开
GET  /api/v1/auth/me             Bearer / Cookie
POST /api/v1/auth/refresh        refresh token
POST /api/v1/auth/logout         Bearer / Cookie
GET  /api/v1/public/:key        公开
POST /api/v1/public/:key/consent 公开
POST /api/v1/public/:key/messages 公开
POST /api/v1/public/:key/asr    公开
GET  /api/v1/escalations         Bearer / Cookie
GET  /api/v1/privacy/...         owner
```

> 旧 Dashboard 的 legacy API 目前是 **admin/owner session** 级别；测试要验证“未登录 401 → 登录卡，而不是白屏”。

---

## 4. 控件分类与安全矩阵

### 4.1 安全可点击（默认 Monkey 点击）

- `[data-page]`：Overview、Inbox、AI assistant、Knowledge、Terminology、Channels、Languages、Analytics、Tests、Growth、Settings
- `goto-*`：跳转到对应视图
- `show-kb-form` / `hide-kb-form`
- `show-term-form` / `hide-term-form`
- `copy-*`（只点击，不验证剪贴板真实内容；避免权限弹窗）
- `api-health`（只打开页面内提示/链接，不实际外跳）
- `channel-info`（预期 Toast/提示）
- 搜索框、筛选、语言选择器（只切换，不提交保存）
- 登录卡：登录/注册链接；未登录时只验证提示

### 4.2 禁止确认的写操作（只检查守卫）

```text
delete-kb
reset-demo
send-reply
new-conversation
run-tests
save-languages
save settings / PATCH settings
feedback-good / feedback-bad
POST /api/test/run
POST /api/feedback
POST /api/conversations
POST /api/conversations/:id/reply
PATCH /api/settings
```

处理方式：

1. 只断言按钮可见、未禁用、可聚焦；
2. 若点击会弹 `confirm`，安装 dialog handler 并 **dismiss**；
3. 不点击最终确认；
4. 对 `delete-kb` 等按钮，断言有二次确认，而不是直接执行。

### 4.3 文件上传/下载

- `input[type=file]`：只验证控件存在，不上传陌生内容；需要测试上传时使用隔离 fixture 并明确允许。
- `export-data`：只验证是下载型入口，不实际落盘；或 route mock。
- 不测试大规模导出/真实客户数据。

---

## 5. 全量发现算法

> 不允许只按手写列表点。每进入一个视图，都重新扫描当前 DOM。

对每个视图执行：

```text
1. 等待页面稳定（标题可见、#page 非空）
2. 收集当前所有可见可交互元素：
   a[href]
   button
   [role="button"]
   [data-page]
   [data-action]
   nav [role="menuitem"]
   input/select 的可见控件（搜索/筛选，不提交）
3. 对每个元素生成稳定 fingerprint：
   tag | text/label | data-page | data-action | href
4. 去重；忽略隐藏、disabled、危险写操作
5. 逐个：
   - 记录 before snapshot（#page 文本、标题、active nav、URL、可见弹窗/Toast）
   - 点击
   - 等待 ≤ 2s
   - 记录 after snapshot
   - 断言至少一个变化：
     * 标题变化
     * #page 文本/HTML 变化
     * active nav 变化
     * 弹窗/Toast 出现
     * URL 变化
   - 断言无异常/白屏/401 文案
   - 若进入了新视图，重新扫描该视图
6. 点击前把当前视图状态保存，避免测试自身把选中的页面改乱
```

### 发现优先级

1. 所有 `[data-page]` 导航（必须 100%）
2. 所有静态页面链接（`/onboarding.html`、`/queue.html`、`/chat.html`、`/api/health`）
3. 每页主要 CTA 与表单开关
4. 搜索/筛选/语言切换
5. 危险按钮的守卫检查
6. 空状态与权限状态（单独 fixture）

---

## 6. 死链、死路、白屏与未捕获错误断言

每次点击必须通过以下检查：

- **DOM 变化**：不能“点了完全没反应”。
- **视图可达**：`#page` 非空，且有可见标题/主内容。
- **不能白屏**：`#page` 不能只有空白容器或 `<div></div>`。
- **不能停在当前页面无响应**：至少一个变化；如果产品定义是 no-op，必须有明确 Toast。
- **不能出现原始异常**：
  - 页面不得出现 `Unauthorized`、`Unable to connect`、`Request failed (401)`、`Internal server error`、`SQLITE_BUSY` 等内部文案。
  - `pageerror` 计数必须为 0。
  - console error 不得包含未捕获异常/资源 500。
- **不能整页跳外部**：origin 必须保持测试 origin。
- **不能重复死循环**：同一 fingerprint 在同一视图最多点击 1 次。

### 允许的 no-op

只有以下情况允许“页面不切换”：

- 打开/关闭表单、弹窗；
- Toast/提示出现；
- 已知的只读开关，有 `aria-pressed`/active 状态变化；
- 明确标记 `data-noop-safe` 且测试白名单登记。

否则一律按死路失败。

---

## 7. 空状态契约

每个数据列表视图必须在无数据时给出**可行动**空状态：

```text
标题：暂无数据 / No data yet
说明：为什么为空
下一步：一个明确 CTA 或导航入口
```

### 必测空状态

| 视图 | 空状态要求 |
|---|---|
| Inbox | 没有会话时不能只显示空白列表，必须有“暂无会话，去知识库/新建会话”提示 |
| Knowledge base | 没有知识时必须有“暂无文章，去添加”提示 |
| Terminology | 没有术语时不能只剩空表，必须有“暂无术语，去添加” |
| Queue | 必须保留现有 `#emptyState` 友好空状态 |
| Tests | 没有 test run 时必须有“尚无测试运行”提示 |
| Analytics | 指标为 0 时要有说明，不得误导为“有数据” |
| Languages | 语言列表有内置值，不要求空；但筛选无结果要有“无匹配”提示 |
| 其他静态/说明页 | 静态内容可见即可 |

空状态 fixture：

- 使用全新临时 DB / 全新 tenant；
- 不能先创建大量数据再删（破坏性）；
- 通过 seed 最小数据或拦截 API 返回空数组；
- 断言空状态可见、CTA 可点击、无控制台错误。

---

## 8. 鉴权与权限分支

### 未登录

- 打开 `/`：看到登录卡，不是 `Unauthorized` 原始错误；
- 点击任意受保护 nav：仍显示登录卡/登录提示，不白屏；
- 打开 `/queue.html`：显示登录提示或友好空状态；
- 不直接请求 `/api/bootstrap` 等受保护端点作为页面展示。

### 登录后

- 通过测试账号 `/api/v1/auth/login` 登录；
- Dashboard 加载 Overview；
- 所有 11 个 SPA 视图都要能切换；
- 旧的 `.data` 不存在时，新 DB 可 seed；
- 测试账号是 owner/admin；viewer 的只读分支另测。

### Token 过期/撤销

- 清空/撤销 token；
- 下一次 API 请求 401 时，前端必须回到登录卡；
- 不得在页面上显示原始 401。

### 权限边界

- 未登录：不显示真实数据；
- viewer 只读；
- 跨 tenant 请求 404/403；
- 旧 Dashboard 只允许 admin/owner session，不能把 API key 暴露给浏览器。

---

## 9. 当前项目的已知分支与当前缺口

> 扫描代码后的结论；在写测试脚本前必须先补或明确豁免。

### 已覆盖/已修复

- `/` 未登录登录卡与 `DASHBOARD.spec.ts` 已覆盖登录/菜单切换；
- 左侧菜单通过 `data-page` 绑定；
- 旧 `/api/*` 支持 admin session Bearer/Cookie，不再要求浏览器持有 `APP_API_KEY`；
- `/queue.html` 已有空状态；
- `/chat.html` 有隐私同意/欢迎态。

### 仍需补的空状态/交互

- **Inbox**：`cs.length === 0` 时没有明显的“暂无会话”空状态，只有空白列表；
- **Terminology**：没有术语时是空表格，缺少行动型空状态；
- **Quality & tests**：没有 runs 时的空状态需明确；
- **Analytics**：全 0 指标需要解释性空/零状态；
- **Dashboard 的 lang 切换**：Dashboard 本身尚未接 P3-08 i18n（P3-08 只覆盖 chat/onboarding/queue）；
- **危险按钮**：`delete-kb`、`reset-demo`、`send-reply` 等只能做守卫测试，不能实际确认。

这些是 SOP 执行时必须显式登记为 `known-gap` 或先实现；不能因为“页面没崩”就当作通过。

---

## 10. 分层执行顺序

### Tier 0：静态/链接

- 所有 HTML 页面返回 200；
- 所有 `<a href>` 同源或明确的 external；
- 无 404 静态资源；
- 无 CSP 阻断。

### Tier 1：未登录

- `/` 登录卡；
- nav 点击不出现原始 401；
- queue/chat/onboarding 可达；
- 无白屏/异常。

### Tier 2：登录后全量导航

- 11 个 SPA 视图逐个进入；
- 所有 `<button data-page>` 都切换；
- 页面标题/`#page`/active nav 变化；
- 0 未捕获异常。

### Tier 3：安全控件

- 所有安全 `data-action` 点击；
- 危险按钮只验证守卫并 dismiss；
- 搜索/筛选/语言切换；
- 空状态 fixture。

### Tier 4：响应式与视觉

- 1440 / 390；
- 无水平溢出；
- 关键标题/CTA 可见。

### Tier 5：回归

- `npm test`；
- 本 SOP 的 Crawler/Monkey spec；
- 业务 AC 全套；
- 失败即阻断交付。

---

## 11. 报告格式

必须输出：

```text
Routes discovered: N
Routes visited: N
Safe controls discovered: N
Safe controls exercised: N
Dead links: 0/…
Empty-state checks: pass/fail
Auth checks: pass/fail
Page errors: 0
Raw 401/500 in UI: 0
Mutations attempted: 0
DB before/after: unchanged
Screenshots/traces: path
```

每个失败必须包含：

- 页面/路由
- 选择器与可见文本
- 点击前/后 DOM 指纹
- network 状态与 console/pageerror
- 截图/trace
- 是否已知 gap
- 复核结果

### 绿色门禁

只有以下全部满足才能宣称 UI 连通性通过：

- [ ] 100% 导航/静态页面覆盖
- [ ] 所有安全控件有断言或白名单
- [ ] 0 死链/死路/白屏
- [ ] 0 未捕获页面错误
- [ ] 0 原始 401/500 UI 文案
- [ ] 空状态全部通过
- [ ] 未登录/登录/过期三种鉴权状态通过
- [ ] 1440/390 无溢出
- [ ] 测试期间 DB 未被修改
- [ ] 所有既有 AC 断言仍通过

---

## 12. 实施顺序（确认后）

1. 先补 Inbox/Terminology/Tests/Analytics 的空状态与 Dashboard i18n（如纳入范围）；
2. 写 **只读 Crawler**（Tier 0–2）；
3. 加安全控件与危险按钮守卫（Tier 3）；
4. 加空状态/鉴权 fixture；
5. 加 390 响应式；
6. 生成 route/control coverage 报告；
7. 把 SOP 作为 CI 门禁的一部分，阻止“只有 Happy Path 绿”却上线。

> 先确认本 SOP 的边界和“当前缺口”处理方式，再写测试脚本。不要先写脚本后补规则。
