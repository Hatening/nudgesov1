# KB-QUALITY-001 · 交付报告

生成时间：2026-10-20T16:08:54.341Z

## 1. 执行命令与退出码

| 步骤 | 命令 | 退出码 |
|---|---|---|
| 语法检查（3 个脚本） | `node --check scripts/kb-quality/{audit,pilot-distill,evaluate}.mjs` | 0 |
| 阶段一：数据审计 | `node scripts/kb-quality/audit.mjs` | 0 |
| 阶段三：抽样 dry-run | `node scripts/kb-quality/pilot-distill.mjs --dry-run --limit 100` | 0 |
| 阶段三：100 篇小批量蒸馏 | `node scripts/kb-quality/pilot-distill.mjs --limit 100 --concurrency 3 --max-cloud-calls 20 --max-cloud-tokens 200000` | 0 |
| 阶段四：质量评估 | `node scripts/kb-quality/evaluate.mjs` | 0 |
| 交付汇总 | `node scripts/kb-quality/report.mjs` | 0 |

## 2. 数据指纹（SHA-256）

| 文件 | 字节 | SHA-256 | 来源 | 许可证 |
|---|---|---|---|---|
| wixqa_expertwritten | 255,510 | `a1bb6888a8394f98…` | https://huggingface.co/datasets/Wix/WixQA | MIT |
| wixqa_simulated | 88,188 | `9a2b9f42c081467b…` | https://huggingface.co/datasets/Wix/WixQA | MIT |
| wixqa_synthetic | 6,216,364 | `1d7e79f328db4653…` | https://huggingface.co/datasets/Wix/WixQA | MIT |
| wix_kb_corpus | 53,743,863 | `46b852c60b85fb18…` | https://huggingface.co/datasets/Wix/WixQA | MIT |
| bitext_csv | 19,202,474 | `6f81102b0100b97b…` | https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset | CDLA-Sharing-1.0 |

## 3. WixQA 质量

- 文章：6,221 条；空正文 0；空标题 0；重复正文 0
- 类型分布：{"article":4109,"feature_request":2049,"known_issue":63}
- 语言分布：{"en":6178,"other":37,"zh":2,"ko":2,"ar":1,"ru":1}
- 长度：median 1205 / p95 7417 / max 51119

| 问答集 | 行数 | 缺 article_ids | 无法解析引用 | 重复问题 |
|---|---|---|---|---|
| wixqa_expertwritten | 200 | 0 | 0 | 0 |
| wixqa_simulated | 200 | 0 | 0 | 0 |
| wixqa_synthetic | 6221 | 0 | 0 | 2 |

## 4. Bitext 质量

- 行数：26,872；列：flags, instruction, category, intent, response
- 重复：instruction 2237 / response 2 / pair 0
- 类别 11 个；意图 27 个
- 异常：非 ASCII 0 / 控制字符 0

## 5. 许可证

| 数据集 | 声明许可 | 商业使用 | 状态 |
|---|---|---|---|
| WixQA | MIT | allowed | approved_with_attribution |
| Bitext Customer Support | CDLA-Sharing-1.0 | review_required | review_required |

## 6. 分类映射

- audience 枚举：seller / buyer / platform_support / internal_eval
- 样本状态：PASS_LOCAL / PASS_CLOUD / CORRECTED / REJECTED / HUMAN_REVIEW / LICENSE_HOLD
- 数据集状态：{"WixQA":"PASS_LOCAL（MIT，需保留署名）","Bitext":"LICENSE_HOLD（CDLA-Sharing-1.0 商业使用待法务确认，禁止发送云端审核）","MASSIVE/MTOP/CLINC150":"internal_eval 专用，不产生事实卡"}

## 7. 小批量蒸馏（100 篇）

- 抽样文章：100；出卡文章：81；失败：19
- 卡片：195（approved 181 / needs_review 14）
- 状态分布：{"PASS_LOCAL":69,"HUMAN_REVIEW":29,"PASS_CLOUD":2}
- 提供方：{"local":80,"cloud":20}
- 预算：{"local_calls":126,"local_tokens_in":112975,"local_tokens_out":267653,"cloud_calls":20,"cloud_tokens_in":22863,"cloud_tokens_out":57451,"cloud_budget_exhausted":true}（上限 {"max_cloud_calls":20,"max_cloud_tokens":200000}）

## 8. 质量评估

| 指标 | 值 |
|---|---|
| schema_pass_rate_pct | 100% |
| evidence_traceability_pct | 93.85% |
| numbers_preserved_pct | 100% |
| units_preserved_pct | 100% |
| duplicate_card_id_rate_pct | 0% |
| duplicate_answer_rate_pct | 1.03% |
| needs_review_rate_pct | 7.18% |
| unsupported_or_unverifiable_pct | 3.08% |

- knowledge_type 分布：{"faq":49,"known_issue":25,"troubleshooting":11,"how_to":71,"feature_explainer":39}
- audience 分布：{"platform_support":195}

## 9. 失败样例与人工复核建议

- 82691e0d64a4e11e05dd678b1084cb6ee52c32c51c9568adde7853dbfb753ab4: Wix Bookings POS: Accepting Payment for Booked Services at a Mobile Point of Sale（article）
- dc16936a46d5d9da4fd877000c7f3f6f9774fd8e57992c99fbc0ce9e1b89a982: Online Programs: Upgrading Your Site（article）
- 00fbb2d2c2d38938abcd1f3915e9c6b84e2115feba253a6c98a207f14d81ef02: Wix Pro Gallery: SEO for Your Pro Gallery（article）
- fb1b4e07ef81640e143e234fd500cca99465e1e2eee73e6f99e828837c18eb10: Wix Bookings: Managing Your Resources（article）
- 8c13e39ce77086031ee3c0fc63f207e39c9df2240f82e98fd26fa010f1cfad87: Online Programs: Customizing the SEO Settings for Your Programs（article）
- f4a6484d0acb2c797a757760285efe82c64095f388ba8f6ce417aafdd471a808: Connecting Faster Payment System as a payment method (through Oceanpayment)（article）
- 888a1c7f5ed1a8bbc90c2702982a3dc8220471effca808492c07ca7f5d8d0755: Studio Editor: Adding a Custom Element（article）
- 3834f22ffea1bcfbe81e0babcb3ad64bc29b0fb3cdc6417c8b66be2350b3ea3e: Wix Blog: Allowing Readers to Subscribe to Your Blog（article）
- cfd27c1dc8244c78b3e327d9c7093622f0d0b7058f4cedaa4a4001e94fd51c2d: Wix Studio: Creating a Branded App for Your Clients（article）
- d0b034b1068346750f6f4fbc5a8733d02d3dbfb64023ae2e6fb7612707b2a74f: Spaces App: Creating and Managing a Group Chat（article）
- needs_review 卡片：14 张，需人工逐条核对证据。
- 建议：先人工抽检 needs_review + 数字校验失败的卡片，再决定是否进入 platform_support 检索池。

## 10. 待人工确认

- Bitext 的 CDLA-Sharing-1.0 商业使用与再分发义务需法务确认（LICENSE_HOLD，未发送云端审核）。
- WixQA 内容来自 Wix Help Center，对外展示需署名并避免暗示官方背书。
- 本批卡片尚未写入任何线上知识库，也未启动全量蒸馏。
