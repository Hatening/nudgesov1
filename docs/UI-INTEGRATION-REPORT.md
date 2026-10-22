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

## 4. 旧 E2E 迁移完成（15/15 绿）

已按新登录/入驻流程迁移全部旧用例：

- AC-01：landing → onboarding 注册 → 建站 → 上传/确认资料 → embed code
- CRAWLER：Tier 1 标题改为新 UI 文案；Tier 3 未登录断言改为落地页
- DASHBOARD：landing/login → 登录后导航
- INSIGHTS：两个用例注入 token 后访问新洞察页
- AC-03：保留 `data-category=financial`、`data-priority=urgent`、`urgent-row` 断言；视觉文案兼容“涉及钱/要紧”
- AC-05：字体改为本地自托管，客户聊天窗零第三方请求
- UI-390：390px 下 11 个后台视图 + insights/queue/upload/manual + chat/onboarding 全部无横向溢出
- 修复 Export 按钮失败无反馈（现在失败也会 toast）

最终结果：

```
Playwright: 15 passed
node --test: 88 passed
```

## 5. 下一步

1. 观察 Harrier 27B 离线索引完成后跑 2,000 道 QA 召回对比；
2. 持续在真实设备上抽查移动端触摸目标与字号。
