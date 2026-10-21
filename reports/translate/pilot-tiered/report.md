# 分级阈值 + 抽样 Judge 商业化模拟（10 卡）

- pl-PL：Tier 2，阈值 4.8；es-ES：Tier 1，阈值 4.5
- 本地 Qwen 每卡只跑 1 次；云端 Judge 抽样 20%（pl-PL:kb_8fef840ca0ea2958、es-ES:kb_843896f27382ff6e）

| 语种 | 卡片 | 抽样 | 路由 | 分数 | 入库 |
|---|---|---|---|---|---|
| pl-PL | ShipBob如何协助处理SCOR模型中… | 是 | manual_review | — | ❌ |
| pl-PL | 退货入库（Receiving）阶段的核心… | 否 | local_basic_pass | — | ✅ |
| pl-PL | 什么是ShipBob Promise（承… | 否 | local_basic_pass | — | ✅ |
| pl-PL | 如何构建一个可重复的承运商审核流程？有哪… | 否 | local_basic_pass | — | ✅ |
| pl-PL | ShipBob能否帮助解决Amazon … | 否 | local_basic_pass | — | ✅ |
| es-ES | ShipBob如何协助处理SCOR模型中… | 否 | manual_review | — | ❌ |
| es-ES | 退货入库（Receiving）阶段的核心… | 是 | cloud_sampled_pass | 4.5 | ✅ |
| es-ES | 什么是ShipBob Promise（承… | 否 | local_basic_pass | — | ✅ |
| es-ES | 如何构建一个可重复的承运商审核流程？有哪… | 否 | local_basic_pass | — | ✅ |
| es-ES | ShipBob能否帮助解决Amazon … | 否 | local_basic_pass | — | ✅ |

## 指标

- 入库：8/10
- 本地基础校验直接入库：7；本地抽样通过：0
- 云端基础校验入库：0；云端抽样通过：1
- manual_review：2（20%）
- Judge 调用：5 次（旧策略 53 次云端调用）

## 成本

- 旧策略：¥0.231713（本地电费 + 8410/30517 cloud tokens）
- 新策略：¥0.069346（本地电费 ¥0.019018 + 云端 ¥0.050328）
- **成本下降：70.1%**

