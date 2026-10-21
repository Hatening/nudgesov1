# Phase 1 地基升级：状态与导入方案（待审核，未执行）

> 本文只描述 **第 3、4 步** 的实现方案。第 1、2 步（治理四表 + 权限闸门）已实现并通过测试。

## 一、knowledge 状态扩展（方案）

现状：`knowledge.status` 是未加 CHECK 的 TEXT，默认 `confirmed`。

新增语义值：

| status | 含义 | 是否可检索 |
|---|---|---|
| `confirmed` | 已审核、有来源、许可清晰 | ✅ |
| `draft` | 有来源、待人工复核 | ❌ |
| `baseline` | 无来源的行业基线/经验值 | ❌ |
| `conditional` | 许可有条件（ALLOW_WITH_LIMITS） | ❌ |
| `blocked` | 高风险/法务 BLOCK | ❌ |

### DDL

```sql
-- status 本身是 TEXT，无需重建表即可写入新值（不做破坏性 CHECK 变更）
CREATE INDEX IF NOT EXISTS idx_knowledge_retrieval_status
  ON knowledge(status, license_status, product_surface);
```

### RAG 强制排除（src/dao.js）

```sql
-- 检索白名单，而不是黑名单拼接
AND status = 'confirmed'
AND license_status <> 'hold'
AND review_status NOT IN ('license_hold','needs_manual_audit','quarantined','rejected')
```

`draft/baseline/conditional/blocked` 天然不在白名单里；再加一条防御性断言：

```sql
AND status NOT IN ('draft','baseline','conditional','blocked')
```

**风险点**：`createGlobalKnowledge()` 当前硬编码 `'confirmed'`，任何新导入脚本只要调它就会绕过审核。方案是把它默认值改为 `draft`，并在函数入口调用 `evaluateSourcePermissions(db, source_id, 'store_fulltext')`；只有显式 `status='confirmed'` 且闸门放行时才写 confirmed。

## 二、Sellers 40 张卡导入方案

### 分级规则

| 审计分类 | 数量 | 目标 status | 其它字段 | 动作 |
|---|---|---|---|---|
| 有来源（sourced） | 14 | `draft` | `source_type` 按来源填；建 claims | 进 review_queue，人工确认后升 confirmed |
| 无来源基线（unsourced baseline） | 26 | `baseline` | `source_id` 空；`license_status='unknown'` | 不建 claims，不检索 |
| 高风险（BLOCK） | 7 | `blocked` | `review_status='license_hold'` | review_queue（priority 1） |

### 每张卡的执行顺序

1. 查 `source_registry`；无记录 → 立即 `baseline` 或 `blocked`，不调用模型。
2. 有记录 → `evaluateSourcePermissions(db, source_id, 'store_fulltext')`；拒绝则降级为 `draft`。
3. 通过 → 写入 `knowledge`（status=`draft`），并写 `claims`（evidence_quote 必填）。
4. 若 `evaluateSourcePermissions(..., 'embed')` 拒绝 → 打 `embed_blocked=1`（或 status=conditional），不进向量库。
5. 全部写入包在 `import_batches`（status: pending → importing → completed），`summary_json` 记录 14/26/7 计数与拒绝原因。

### 必须先确认的算术问题

14 + 26 + 7 = **47**，不是 40。两种可能：

- **A**：7 张 BLOCK 是 26 张无来源中的子集 → 总数 40 = 14 draft + 19 baseline + 7 blocked；
- **B**：审计报告里的 40 是另一口径，实际包里有 47 张。

请提供 Sellers 知识包文件路径（或审计报告的 40 条 ID 清单），我按 A/B 其一生成导入脚本。

## 三、本轮不做的部分

- 不修改 `createGlobalKnowledge` 默认状态；
- 不写 `draft/baseline/conditional` 数据；
- 不改 RAG SQL；
- 不导入任何 Sellers 卡。

等第 1、2 步审核通过后再执行。
