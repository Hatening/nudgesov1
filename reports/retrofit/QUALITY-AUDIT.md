# 回刷质量审计（LLM-as-a-Judge）

- 生成时间：2026-10-21T05:47:37.999Z
- 判定模型：deepseek-flash
- 已回刷总量：2179
- 抽检比例：5.0%（样本 109）
- 通过 / 失败 / 判定异常：79 / 30 / 0
- **通过率：72.48%**
- token 用量：108091

## 未通过样例

- `kb_wixqa_a47e87ebf040cc5c` Can I allow clients to book multiple recurring appointments in a single checkout on Wix Bookings?：诊断条件中“涉及Wix Bookings平台的预约功能配置”属于原文未提及的语义推断；原文仅说明当前不支持在单次结账中预订多个重复预约，并未涉及功能配置。
- `kb_wixqa_a94345c3eb2a8e67` Is it possible to translate the PDF viewer app in Wix Multilingual?：遗漏了原文的核心结论与时效条件：原文明确说明“Currently, it is not possible to translate the PDF viewer app in Wix Multilingual”，提取的 JSON 仅复述用户询问，未体现“当前不可翻译”的关键答案及“Currently”限制。
- `kb_wixqa_8a99b983df63999e` Can I sell gift cards for Wix Events that can be used towards the purchase of event tickets?：提取仅复述了用户问题，遗漏了原文核心答案“Currently, it is not possible to sell gift cards that can be used towards the purchase of event tickets”，尤其是“Currently”这一时效限定/关键条件，未完整反映原文结论。
- `kb_a3ccd639177cf4ea` 投机性库存的主要风险和隐性成本有哪些？如何管理？：applicability 字段中的“需求预测相关的库存决策场景”“产品过时或贬值风险评估场景”属于原文未明确给出的场景化推断；diagnostic_conditions 将“滞销后的重新调配处理成本”改写为“处理成本增加”，存在轻微语义添加；同时原文的管理措施（需求预测技术、设定退出策略、控制单次投机规模、借助履约平台优化库存分布与周转效率）未被提取。
- `kb_32303c1a4ca243c9` 如何通过追踪库存状态来防止超卖和缺货？需要管理哪些库存状态？：exception_risks 中包含原文未明说的推断性后果（如“影响可售数量承诺”“无法立即履约”“需要等待检验或处置决定才能释放”“不能计入可用可售数量”），属于过度语义推断；原文仅说明各库存状态的定义及区分状态可准确承诺可售数量并避免跨渠道超卖。
- `kb_wixqa_1647c25dd1dc79fd` What should I do if an animation doesn't display properly when I resize my browser window in the Studio Editor?：过度语义推断：原文仅建议刷新页面以获得最佳显示效果，并未说明“不刷新页面可能导致动画持续显示异常”或“影响最佳观看效果”。JSON 中的“持续显示异常”和“影响最佳观看效果”属于原文未明确表述的推断。
- `kb_wixqa_4c20ade086744559` Can I create responsive Google AdSense ad units to display on my Wix site?：遗漏原文关键限定“Currently”（当前/目前），可能把临时限制误表述为绝对限制；诊断条件“无法选择响应式广告类型”是对“可选择任何其他广告类型”的推断，原文未直接说明，且未保留“可选择任何其他广告类型”这一条件。
- `kbdoc_d7c445e85107` ac01-knowledge.txt：原文为标准配送“normally takes 5-8 business days after dispatch”，提取 JSON 写成确定性的“标准配送在发货后5-8个工作日完成”，遗漏了“通常/正常”这一非保证性限定，且 exception_risks 为空，未体现该例外风险。
- `kb_wixqa_e79cf3e9e17d198b` Can I add additional layouts for categories and questions in the Wix FAQ app?：过度语义推断：原文仅说明当前 Wix FAQ 应用在 Categories 和 Questions 的布局选项方面“limited”，提取的 JSON 却写成“不支持为分类和问题添加额外的布局选项”，将“功能有限”强化为“不支持”，超出原文表述；同时“布局和分类方面存在功能限制”也把原文的“布局选项受限”扩展为“分类功能限制”，不够准确。
- `kb_7c98514d1992df62` 服装退货的质检分级流程是怎样的？：提取的JSON将原文“检查吊牌”写成“检查吊牌完整性”，原文未提“完整性”，属于额外推断；同时遗漏了原文关键分级与处理条件：A级全新可立即重售、B级轻微瑕疵可通过轻度翻新修复，以及第三阶段对B级商品进行粘毛、蒸汽熨烫、重新包装和贴标以恢复可售状态。
- `kb_wixqa_2a971599d4c8a4ca` i want to cancel a business email：遗漏原文关键操作条件：必须通过 Wix 账户的 Premium Subscriptions 页面关闭自动续订，并点击对应商业邮箱旁的 More Actions 选择 'Cancel business email.'；提取结果仅保留适用场景，信息不完整。
- `kb_wixqa_036ecae53897fa48` Can I integrate Wix Invoices with a bookkeeping system?：JSON 只复述了用户问题，遗漏了原文核心答案“Currently, it is not possible to integrate Wix Invoices with a bookkeeping system”，也遗漏了“Currently”这一关键时间限定条件，因此可能把当前不支持误读为永久不支持。
- `rescue_2cec9ef65ab0a461` Broad Match 中如何识别值得提升为 Exact Match 的关键词机会？：遗漏原文关键操作条件：提取结果未包含“对每个候选词列出点击量和转化率”，也未明确包含“将满足条件的词标注为‘提升为 Exact’”。
- `kb_94b21056346d2c21` 如何从5星好评中提取产品的必备卖点？：提取的 JSON 遗漏了原文的关键输出约束：需包含排名前5的满意点表格、针对每个卖点补充“若产品缺失该卖点时的用户反应”清单，以及所有原话必须直接引用输入数据、不得改写或编造。当前 JSON 未体现这些必要条件和限制。
- `kbdoc_dd5cdc1723f3` ac01-knowledge.txt：原文只说“30天内”退货并需订单号，未说明30天从“收货后”起算；JSON加入“收货后”属于原文没有的条件和过度语义推断。另外“有效订单号”中的“有效”也略有推断。
- `kb_bbc06495e68e899c` What is FTZ warehousing and how does it reduce duty costs?：异常风险中“当货物再出口或处置时，可能无法享受关税减免”与原文“eliminate duties on goods you re-export or dispose of”直接矛盾；原文明确再出口或处置可免除关税。另“未正确申报可能导致行政负担增加”属于原文未提及的过度推断，原文仅说明每周申报可降低成本和行政负担。
- `kb_wixqa_95c397581d67c49d` Is it possible to delete all files and folders from Site Files in the Media Manager in one click?：diagnostic_conditions 中“用户尝试使用一键删除功能删除所有文件及文件夹”属于过度语义推断；原文只询问是否支持一键删除，并未说明用户已经尝试。其他关键例外条件已覆盖，且未出现原文没有的数字或 URL。
- `kb_wixqa_5bdf235a200c22d1` Can I add tags to gallery images in the Wix Editor?：遗漏原文关键限制：原文明确说明“Currently, you cannot add tags to gallery images”，提取的 JSON 仅描述用户意图，未在 exception_risks 或相关字段中体现“当前无法添加标签”这一核心结论。
- `kb_ecommerce_ai_skills_813b2fd2205a25b6` 在跟卖场景下，是否适合使用动态定价策略？：提取的 JSON 把原文的核心结论“不适合”遗漏了；同时把“应通过差异化（如捆绑销售、独家变体、品牌备案）将自己移出比价范围，而不是追求更快的跟价”这条建议错误地归入 exception_risks。此外，“价格战情境”是对原文“价格战的终点是所有人都不赚钱”的概括推断，并非原文明确列出的适用情境。
- `kb_ecommerce_ai_skills_cfeb2a713271af97` 在生成客服文案或市场报告时，关于数据和承诺的纪律要求是什么？：exception_risks 中的“虚构承诺可能导致客户投诉或法律纠纷”并非原文内容，属于过度语义推断；原文未提及客户投诉或法律纠纷。
- `kb_241915564967e5a5` 电商应如何选取和应用SCOR核心指标来优化运营？：提取结果遗漏原文关键指标（完美订单履约率、订单履行周期时间、总供应链成本、现金到现金周期、固定资产回报率）及SCOR分级（Level 1、Level 2/3）；并将“可纳入碳足迹等可持续性指标以响应环保消费者需求”简化为“响应环保消费者需求”，丢失了“碳足迹等可持续性指标”这一关键条件。
- `kb_wixqa_b97b1c1f51544f90` Can work be saved when a participant is in an online course?：提取的 applicability 将原文“accidentally log out（意外登出/退出登录）”写成“意外退出在线课程”，语义有偏移，可能被理解为退出/放弃课程；同时遗漏原文关键限定“完成每一步时进度才会自动保存（as they complete each step）”，导致适用条件不完整。
- `kb_ecommerce_ai_skills_d92a90e3f7eb556a` Exact Match搜索词如何制定出价调整策略？：exception_risks 中“可能导致部分关键词无法生成有效调整建议”“生成的出价调整表可能失真”“不能基于经验或直觉进行主观调整”属于原文未明确表述的过度语义推断；原文仅规定仅使用输入数据计算、缺失值不估算、建议附带来源标签，并未说明这些后果或禁止经验/直觉调整。
- `kb_wixqa_0895492173c5acd5` How can I view and chat with live site visitors using the Wix app?：提取结果包含原文未出现的“mobile”，属于过度语义推断；同时遗漏了原文的关键例外条件：未注册访客显示为编号（如 Visitor #9504），而已注册站点成员显示为姓名。
- `kb_wixqa_62980c0cbb9dd369` can I extend my current contract to be a month longer：“Extension limited to up to several additional years only” adds “only” and generalizes the domain-registration limit; the original says domain registration can be extended by up to several additional years, not that all extensions are limited that way. “Must be done through your Wix account” also overgeneralizes a domain-registration condition to all extension actions.
- `kb_wixqa_76ffc3dde41d3e16` Is it possible to integrate Wix Stores with the Ship&co shipping solution?：提取的 JSON 只复述了用户问题，遗漏了原文关键结论：目前 Wix Stores 与 Ship&co 的集成不受支持（not supported），以及“Currently”这一时效性限制条件；因此未完整反映原文的核心例外/限制信息。
- `kbdoc_876b8552f348` ac01-knowledge.txt：遗漏了原文中配送时效的关键条件“5-8 business days after dispatch”；并且“周日店铺不营业，无法处理相关事务”属于原文未明确说明的过度语义推断。
- `kb_wixqa_91384d1c01e69d75` How can I adjust my live stream settings in OBS Studio to ensure optimal performance with Wix Video?：提取的 JSON 存在过度语义推断：原文仅说带宽不足时应降低比特率、保持双倍带宽有助于应对波动，并未明确说会导致“直播中断”。同时遗漏了原文关键设置条件 Codec: x264；并将“Advanced 可能引起问题”绝对化为“会导致直播问题”。
- `kb_wixqa_b51505d28b878429` Is it possible to remove test data from Wix Analytics reports?：遗漏原文核心限制：原文明确“Currently, it's not possible to remove data from Wix Analytics”，即无法直接从 Wix Analytics 删除数据，只是在“能取消 Store Orders/Bookings 中创建的测试订单”的前提下，测试数据才会从 Sales 报告中消失；JSON 未体现这一关键例外/限制，反而把 applicability 窄化为“从 Wix Analytics 销售报告中移除测试数据”，属于对原文范围的过度收窄（原文标题与问题针对 Wix Analytics 报告整体）。此外“报告更新需要等待一小时”原文是更新延迟提示，被归为 exception_risks 略有语义拔高。
- `kb_01c623d81c73059c` 不在亚马逊销售的品牌能否采用SIOC模式？退货环节如何处理？：遗漏关键例外条件：原文明确“易碎或高价值商品建议提供专用退货运包，以保护产品状态与二次销售价值”，JSON 未保留该建议及其目的；同时将“需评估原箱能否承受往返运输”推断为“易碎或高价值商品退货时原箱可能无法承受往返运输”，属于过度语义推断。

