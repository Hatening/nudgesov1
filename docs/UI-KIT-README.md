# RelayDesk — UI 设计交接包

这是一个 **vanilla JS + Node 原生 HTTP** 的商家客服工作台（无前端框架、无构建步骤）。
本包只包含 UI 设计所需内容：前端页面、样式、后端接口定义、数据样例、现有截图。

## 目录

```
public/            前端全部页面（HTML/CSS/JS）
  index.html       后台主 SPA 入口（侧边栏 + 页面容器）
  app.js           后台所有页面模板（overview/inbox/assistant/knowledge/settings 等）
  styles.css       全局样式与设计变量（颜色、间距、阴影）
  ui.css           组件级样式
  upload.html      商家资料上传 + OCR 二次确认（独立页）
  manual.html      商家使用指南
  chat.html        买家聊天窗口
  onboarding.html  引导页
  queue.html       人工处理队列
  insights.html    行业洞察
server.js          后端全部 HTTP 路由与 API
src/               业务逻辑（数据库、DAO、LLM、权限、OCR、蒸馏）
db/migrations/     数据库表结构（001–014）
docs/              设计系统、架构、商家使用指南
screenshots/       现有页面截图（设计参考）
sample-data/       真实数据样例（档案 / 知识卡 / Credit 流水）
```

## 设计目标

为商家后台做 **B 端 SaaS 视觉与交互升级**，重点页面：

1. **设置页 · 经营概况**（截图 01）：客单价、核心品类、目标市场、AI 诊断结果
2. **上传专属资料**（截图 02/03）：拖拽上传、OCR 二次确认面板、草稿卡确认入库
3. **左下角企业额度**（截图 04/05）：剩余 Credits 进度条、额度不足 402 提示
4. **主工作台**（截图 04 背景）：概览、收件箱、AI 助手、知识库

## 技术约束（设计必须能落地）

- 纯 HTML/CSS/原生 JS，**不能引入 React/Vue**；可以新增 CSS 文件
- 现有样式变量在 `public/styles.css` 的 `:root`；请沿用或扩展，不要破坏
- 页面是服务端静态文件 + fetch API，无 SSR
- 响应式：桌面 1440、移动 390

## 关键 API（设计交互时参考）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/bootstrap | 返回 settings / profile / sellerKnowledge / knowledge / conversations / stats |
| POST | /api/chat | 买家或后台 AI 问答（后台请求自动注入经营档案） |
| PUT | /api/v1/tenant-profile | 保存经营概况 |
| POST | /api/v1/tenant-profile/analyze | AI 诊断 |
| POST | /api/v1/seller/knowledge/upload | 文本/PDF 上传 → 蒸馏为 draft 卡 |
| POST | /api/v1/seller/knowledge/ocr | 图片/扫描件 OCR，返回文字供二次确认 |
| GET | /api/v1/seller/knowledge | 我的知识卡列表 |
| POST | /api/v1/seller/knowledge/:id/confirm | 确认入库（draft → confirmed） |

## 计费规则（UI 文案依据）

- 文本提取 2 Credits
- 云端模型蒸馏额外 5 Credits
- OCR 每页 10 Credits
- 额度不足：HTTP 402，提示「额度不足，请升级套餐」

## 运行方式（可选）

```bash
npm install
npm start          # http://127.0.0.1:3030
```

数据库会在首次启动时自动建表并灌入种子数据，不需要额外准备。
