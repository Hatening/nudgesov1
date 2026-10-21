# 4.8 分重试 + 语种熔断 路由验证（5 pl + 5 es）

- 阈值：≥ 4.8 直接入库；4.0–4.79 本地重试（最多 3 次）；<4.0 或重试耗尽 → cloud_required
- 熔断：同语种连续 3 张卡本地失败 → cloud_forced_languages

## 逐卡路由

| 语种 | 卡片 | 本地尝试 | 最终路由 | 分数 | 入库 |
|---|---|---|---|---|---|
| pl-PL | 什么是ShipBob Promise（承诺配… | 3 | local_direct | 4.8 | ✅ |
| pl-PL | 如何构建一个可重复的承运商审核流程？有哪些检… | 4 | cloud_required | 4.8 | ✅ |
| pl-PL | ShipBob能否帮助解决Amazon FB… | 4 | local_direct | 4.8 | ✅ |
| pl-PL | ShipBob如何协助处理SCOR模型中的“… | 4 | manual_review | — | ❌ |
| pl-PL | 退货入库（Receiving）阶段的核心操作… | 4 | manual_review | — | ❌ |

## 熔断与成本

- 触发熔断语种：无
- 本地尝试：19 次（naive 全重试为 20 次，降低 5%）
- 熔断跳过本地卡：0 张；避免本地尝试 0 次、0 tokens、¥0
- 入库：3 / 5（local 2 + cloud 1）；manual_review：2

## 结论

- 仍有未达标卡片，全量需暂缓。

