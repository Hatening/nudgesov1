# 知识卡质量报告（KB-INGEST-001 收口）

生成时间：2026-10-20T12:56Z（Asia/Shanghai 20:56）

## 最终口径

| 数据源 | 输入 | 通过强校验 | 拒绝 |
|---|---:|---:|---:|
| WixQA（expertwritten 200 + simulated 200 + synthetic 6,221） | 6,621 | 1,292 | 5,329 |
| ecommerce-ai-skills | 498 | 454 | 44 |
| **合计** | **7,119** | **1,746** | **5,373** |

- 通过强校验的知识卡：**1,746 张**（WixQA 1,292 / ecommerce-ai-skills 454）。
- 拒绝明细写入 `db/seed/knowledge.rejected.jsonl`，不进入 seed、不进入线上库。
- 参考卡全部为 `audience=seller`；语言分布 en 1,292 / zh 454。

## 隔离来源（绝对未入库）

| 来源 | 候选卡 | 处理 |
|---|---:|---|
| Bitext | 286 | 排除：CDLA-Sharing-1.0，法务未确认 |
| WebFAQ / traveling | 200 | 排除：许可证未知 |
| seller_extra 公开网页 | 5 | 排除：不在本次批准范围 |

校验方式：对 `db/seed/knowledge.jsonl` 做全文扫描，`bitext` / `webfaq` / `traveling` 命中数为 **0**；`source_type` 只允许 `wixqa`、`ecommerce_ai_skills`。运行时 `scripts/seed-kb.mjs` 还会二次拒绝并清理旧污染行。

## 强校验规则（build-kb-seed.py）

1. source 必须存在且可解析（WixQA 通过 `article_ids` 关联 `wix_kb_corpus`；skills 通过源文件路径）。
2. 卡片中的每个 URL、数字、实体/引号短语都必须出现在原文中（NFKC + 小写 + 空白归一化）。
3. 校验结果逐卡写入 `validation_json`，`missing` 必须为空才允许进入 seed。
4. 不调用本地模型；WixQA 的 expertwritten/simulated/synthetic 与 ecommerce 候选卡均为确定性提取。
5. 按规范化 question 去重；seed 内重复标题为 **0**。
6. 运行时白名单 + `public_web`/Bitext/WebFAQ 清理，防止旧库或手工操作再次混入。

## 产出与线上数量

| 表 / 文件 | 数量 |
|---|---:|
| `db/seed/knowledge.jsonl` | 1,746 |
| `db/seed/knowledge.rejected.jsonl` | 5,373 |
| `db/seed/gpc_taxonomy.jsonl` | 6,463 |
| live `knowledge` 表 | **1,880**（参考卡 1,746 + 原有 demo/站点文档 134） |
| live `knowledge` 中 reference 卡 | 1,746（WixQA 1,292 / ecommerce 454） |
| live `knowledge` 中 Bitext/WebFAQ | **0** |
| live `knowledge` 中重复 reference 标题 | **0** |
| live `gpc_taxonomy` 表 | **6,463**（Segment 45 / Family 162 / Class 938 / Brick 5,318） |

数据库校验：`PRAGMA integrity_check = ok`，`PRAGMA foreign_key_check` 违规 **0**。

## 部署

`Dockerfile` 的启动命令为：

```sh
node scripts/auto-migrate.mjs && node scripts/seed-kb.mjs && exec node server.js
```

因此 Render 每次部署/重启都会：

1. 执行全部迁移（含 `006_gpc_taxonomy`、`007_knowledge_tenant_meta`）；
2. 用 `db/seed/knowledge.jsonl` 重建 1,746 张参考卡，并删除 `public_web` / Bitext / WebFAQ 旧行；
3. 用 `db/seed/gpc_taxonomy.jsonl` 重建 6,463 条 GPC 分类；
4. 启动服务。

`DATA_DIR=/data` 必须挂载 Render Persistent Disk；磁盘上的租户/会话/消息数据不会被 seed 删除，只有参考卡与 GPC 会被原子重建。

## 测试

- `npm test`：**31 / 31 pass，0 fail，0 skipped**。
- `npm run test:kb`：3 / 3 pass（seed 白名单/强校验证据、GPC 种子完整性、seed-kb 清理与幂等）。
