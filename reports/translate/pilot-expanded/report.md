# 扩量验证（25 张：en/es/de/fr/pl × 5 卡）

- 阈值：en/es/de/fr = 4.5；pl = 4.8
- 本地单次 + 20% 分层抽样（每语种 1 张）+ 盲盒规则 + 边界定向润色

## 逐语种

| 语种 | 阈值 | 入库 | manual_review | 平均分 |
|---|---|---|---|---|
| en-US | 4.5 | 5/5 | 0 | 4.8 |
| es-ES | 4.5 | 4/5 | 1 | 4.5 |
| de-DE | 4.5 | 5/5 | 0 | 4.5 |
| fr-FR | 4.5 | 5/5 | 0 | 4.5 |
| pl-PL | 4.8 | 4/5 | 1 | — |

## 总体

- 入库：23/25
- manual_review：2（8%）
- 本地基础校验入库：19；本地抽样通过：0
- 云端基础/结构兜底：0；云端抽样通过：4
- Judge 调用：12；定向润色：1；云端总调用：19
- 盲盒审计：已入库 19 张，下次抽样在 100 张

## 成本

- 旧策略按卡数放大：¥0.579282
- 新策略：¥0.148829（本地电费 ¥0.045217 + 云端 ¥0.103612）
- **成本下降：74.3%**；折合每 1,000 张 ¥5.95

## 逐卡明细

| 语种 | 卡片 | 抽样 | 路由 | 分数 | 入库 |
|---|---|---|---|---|---|
| en-US | ShipBob如何协助处理SCOR模… | 否 | local_basic_pass | — | ✅ |
| en-US | 退货入库（Receiving）阶段的… | 否 | local_basic_pass | — | ✅ |
| en-US | 什么是ShipBob Promise… | 否 | local_basic_pass | — | ✅ |
| en-US | 如何构建一个可重复的承运商审核流程？… | 是 | cloud_sampled_pass | 4.8 | ✅ |
| en-US | ShipBob能否帮助解决Amazo… | 否 | local_basic_pass | — | ✅ |
| es-ES | ShipBob如何协助处理SCOR模… | 否 | local_basic_pass | — | ✅ |
| es-ES | 退货入库（Receiving）阶段的… | 否 | local_basic_pass | — | ✅ |
| es-ES | 什么是ShipBob Promise… | 否 | local_basic_pass | — | ✅ |
| es-ES | 如何构建一个可重复的承运商审核流程？… | 否 | manual_review | — | ❌ |
| es-ES | ShipBob能否帮助解决Amazo… | 是 | cloud_sampled_pass | 4.5 | ✅ |
| de-DE | ShipBob如何协助处理SCOR模… | 否 | local_basic_pass | — | ✅ |
| de-DE | 退货入库（Receiving）阶段的… | 否 | local_basic_pass | — | ✅ |
| de-DE | 什么是ShipBob Promise… | 是 | cloud_sampled_pass | 4.5 | ✅ |
| de-DE | 如何构建一个可重复的承运商审核流程？… | 否 | local_basic_pass | — | ✅ |
| de-DE | ShipBob能否帮助解决Amazo… | 否 | local_basic_pass | — | ✅ |
| fr-FR | ShipBob如何协助处理SCOR模… | 是 | cloud_sampled_pass | 4.5 | ✅ |
| fr-FR | 退货入库（Receiving）阶段的… | 否 | local_basic_pass | — | ✅ |
| fr-FR | 什么是ShipBob Promise… | 否 | local_basic_pass | — | ✅ |
| fr-FR | 如何构建一个可重复的承运商审核流程？… | 否 | local_basic_pass | — | ✅ |
| fr-FR | ShipBob能否帮助解决Amazo… | 否 | local_basic_pass | — | ✅ |
| pl-PL | ShipBob如何协助处理SCOR模… | 是 | manual_review | — | ❌ |
| pl-PL | 退货入库（Receiving）阶段的… | 否 | local_basic_pass | — | ✅ |
| pl-PL | 什么是ShipBob Promise… | 否 | local_basic_pass | — | ✅ |
| pl-PL | 如何构建一个可重复的承运商审核流程？… | 否 | local_basic_pass | — | ✅ |
| pl-PL | ShipBob能否帮助解决Amazo… | 否 | local_basic_pass | — | ✅ |

