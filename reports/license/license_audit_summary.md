# 来源合规性盘点（只读）

生成时间：2026-10-21T00:28:05.111Z

## 结论

- LICENSE_CLEAR：9 个源（可继续蒸馏）
- LICENSE_CONDITIONAL：5 个源（仅内部学习，商用待授权）
- LICENSE_RISK_HIGH：6 个源（禁止进入蒸馏流水线）

## 高风险源（禁止蒸馏）

| source_id | 来源 | 本地是否已下载 | 备注 |
|---|---|---|---|
| shopify-blog | Shopify Blog（Marketing / Sell Online） | raw_data/seller_extra/shopify-*.md（5 篇） | 禁止 |
| google-digital-garage | Google Digital Garage / Grow with Google | raw_data/seller_extra/google-*.md（1 篇） | 禁止 |
| amazon-seller-university | Amazon Seller University | （未下载） | 禁止 |
| tiktok-shop-academy | TikTok Shop Academy | （未下载；seller_extra2 中的 tiktok-fulfillment 属 ShipBob 原创内容，另见 ShipBob 行） | 禁止 |
| ebay-official | eBay 官方内容 | （未下载官方内容；ecommerce-ai-skills 内 eBay 指南属 CC0 原创，见下） | 禁止 |
| google-ads-help | Google Ads 帮助中心 | （未下载） | 禁止 |

## 条件许可源（仅内部学习）

| source_id | 来源 | 许可证 |
|---|---|---|
| mtop | MTOP（多语言任务型对话） | 未声明（HF 卡无 license；上游 fb/mtop 为 CC BY-SA 4.0 且需申请） |
| bitext | Bitext Customer Support（客服意图/话术） | CDLA-Sharing-1.0 |
| gs1-gpc | GS1 GPC 商品分类字典 | GS1 专有条款（内部使用，禁止再分发） |
| shipbob-blog | ShipBob Blog（物流/履约） | 未声明（专有版权，无开放许可） |
| derived-pools | 派生文件（candidates / rescued / rejected / recycle pools / quarantine） | 混合（取决于来源行，见 source_id 字段） |

## 需人工关注的问题

1. **Shopify/Google 内容曾产生 5 张候选卡**（`raw_data/candidates.seller_extra.jsonl`）；当前知识库内 0 行。按本次门禁应标记 HIGH，候选文件不得再进入蒸馏。
2. **ShipBob 内容（352 张卡）** 无开放许可，属 CONDITIONAL；当前已在知识库中，商用前需授权确认。
3. **MTOP 未声明许可**（HF 镜像卡无 license，官方 gated），仅可内部学习。
4. **GS1 GPC 为专有条款**，内部使用可，再分发需 GS1 授权。
5. **BANKING77 尚未下载**，如启用需按 CC BY 4.0 署名。
