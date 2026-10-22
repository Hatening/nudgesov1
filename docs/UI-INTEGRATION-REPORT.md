# NudgeSo UI 整合升级报告

日期：2026-10-22
来源：`D:\Documents\Downloads\nudgeso-redone-ui (3).zip`
提交：`2f0ed91`

## 1. 已整合内容

用新 UI 完整替换 `public/`，保留旧 `public/vendor/`（marked / pdf.js，供洞察与 PDF 上传使用）：

- 新入口：`landing.html`、`login.html`、`onboarding.html`、`404.html`
- 新后台 SPA：`index.html` + `app.js`（11 个页面）
  - Home / Customer messages / My store info / Product words / Where customers write / Languages / How support is going / Check answer quality / Seller briefings / Settings / AI helper
- 独立页：`insights.html`、`insight.html`、`queue.html`、`upload.html`、`manual.html`、`chat.html`
- 品牌资源：`favicon/*`、`img/logo-*`、`icons.js`、`tailwind.vendor.js`
- 设计文档：`docs/UI-DESIGN-SYSTEM.md`、`docs/NUDGESO-UI-NOTES.md`、`docs/UI-KIT-README.md`

## 2. 后端适配（未替换后端）

新包自带的后端快照比当前主线少了 Qwen 改写 / engine-status 等改动，因此**只合并 UI，不覆盖后端**。仅做三处必要适配：

1. **CSP 允许 Google Fonts**
   - `style-src` 增加 `https://fonts.googleapis.com`
   - `font-src` 增加 `https://fonts.gstatic.com`
   否则 Baloo 2 / Asap 被 CSP 拦掉，品牌字体失效。

2. **`/api/bootstrap` 的 `knowledge` 改为“租户知识 + demo 卡”**
   - 不再把 1.8 万张全局翻译卡全部塞进“My store info”
   - 新账号显示 3 张 demo 卡，商家自己上传的 draft/confirmed 正常显示

3. **前端“等待确认”判断改为 `status !== 'confirmed'`**
   - 新 UI 原来用 `id.startsWith('kb_demo_')` 判断，会把 5,000+ 草稿/翻译卡误显示为“waiting for your okay”
   - 现在 confirmed 卡片显示 “In use”，draft 才显示 “Waiting for you”

## 3. 验证结果

### 后端

```
npm test → 88 / 88 passed
```

### 新 UI 自动化

新增 `e2e/NUDGESO-UI.spec.ts`：

```
1 passed
```

覆盖：
- 注册 + 登录页登录
- 11 个 SPA 页面全部渲染
- 无 pageerror / console error
- `/insights.html`、`/queue.html`、`/upload.html`、`/manual.html` 登录后 200 且渲染

手工 Playwright 审计结果：

| 页面 | H1 | 错误 |
|---|---|---|
| overview | Hello! | 0 |
| inbox | Customer messages | 0 |
| assistant | Try the AI helper | 0 |
| knowledge | My store info | 0 |
| glossary | Product words | 0 |
| channels | Where customers write | 0 |
| languages | Languages | 0 |
| analytics | How support is going | 0 |
| tests | Check answer quality | 0 |
| growth | Seller briefings | 0 |
| settings | Settings | 0 |

截图：
- `reports/ui-integration/landing.png`
- `reports/ui-integration/dashboard.png`

## 4. 已知问题（必须如实说明）

旧的 14 条 Playwright 用例是按**旧 UI 登录流程**写的：

- 旧流程：`/` 直接显示商家登录表单（`#dashboardEmail` / `#dashboardLoginForm`）
- 新流程：`/` 未登录跳 `landing.html` → `login.html` → 登录后回 `/`

因此旧用例（AC-01、CRAWLER、DASHBOARD、UI-390 等）会失败，**不是新 UI 运行错误**，而是测试脚本未迁移。当前以新的 `NUDGESO-UI.spec.ts` 作为 UI 回归基线；旧用例需要按新登录/入驻流程重写后恢复。

## 5. 下一步

1. 重写旧 14 条 Playwright 用例到新登录/入驻流程；
2. 验证 onboarding 注册 → 创建店铺 → 上传资料 → 确认入库完整链路；
3. 视觉走查移动端 390px（新 UI 已带响应式规则，但未逐页截图对比）。
