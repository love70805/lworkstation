# 利润与 ERP：分析数据及页内成本核对

2026-09-13。用户完整更新目标中已确认的每日趋势、SKC/SKU、单价活动与成本核对融合部分；此独立任务不依赖待确认的报告冻结方案，不授权四表 v15、报告存储、代发/扣款实现或发布。

## 基线、问题与所有权

基线为本地主仓库集成 `f25a523`，业务 tree 为 `1932d2d`。完整规划 docs/NEXT_UPDATE.md。主线准备分支 codex/full-update-integration 中此包供专职读取；开始前同步本地主仓库最新集成，不仅看远端。

当前标准导入保存 unitPrice、orderDate，但丢弃添加时间和活动；importedAt 不是业务日期。成本核对仍独立页面，利润缺少确认的每日/价格分析。无需修改 Dexie 表结构：新增销售行非索引字段，通过现有 ledgerId 索引读取。

利润与 ERP 主责：salesImport/Worker、分析 domain/repository/hooks、ProfitPanel、ProfitWorkspacePage、CostMatching 与其局部样式/测试。可新增独立小模块以保持 repository facade 简洁。不改 App/AppShell/WorkspacePortal/uiState/共享主题；这些由后续桌面化组合适配。必要的 profitFilter/业务跳转归利润，公共 workspaceNavigation 待后续导航统一适配。

## 数据公共出口（主线定义）

- 新销售行保存 sourceAddedDate（YYYY-MM-DD 或 null）、rawAddedAt、dateStatus（valid/missing/invalid/out_of_period）、timezone（Asia/Shanghai）、sourceSheet、真实 sourceRow、unitPriceRaw/amountExact（可获得时为十进制字符串）、activityRaw 与 activityStatus（known/missing）。保留既有字段，不迁移或伪造旧行日期。
- 添加时间只从明确源列映射。不能默认借 orderDate 或 importedAt 补齐；Excel serial/日期文本解析应识别日期系统，非法/超月日期保留诊断。原源表没有相关字段时正常导入已有业务，不冒充完整日数据。
- 单价沿用实际销售单价；活动字段以实际表头/映射为依据，不能把缺活动当无活动。只保留必要字段，不把全部业务原文件嵌入代码/测试或 Git。
- 新 `readLedgerSalesAnalytics({workspaceId,ledgerId,store='all'})` 校验当前成员及账本作用域后返回：period/timezone、coverage、daily[{date,quantityExact,revenueExact,sourceRowCount}]、undated{quantityExact,revenueExact,count}、outOfPeriod 诊断、monthTotalsExact、skuStats。作用域校验不能只由 UI 负责。
- `aggregateDailySales`/SKU 统计为纯 domain 函数；同一个出口供首页及利润，禁止另造首页公式。不提供每日利润。
- 已纳入的销售类型与既有标准台账一致，盘亏忽略不变。每日使用 Decimal 汇总实际销售行；日精确合计+缺/异常日期记录合计=同范围销售行月精确合计。展示最终截断，不累加日显示值作月合计。
- 本包不改现有月度利润公式/历史定稿。旧月摘要的既有截断差如存在，要以分析出口同范围精确月合计做对账并记录给主线，不能通过丢行/隐瞒差异让旧摘要表面相等；统一财务公式在后续已确认包承接。
- 日期完整月内无销售日可补 0；缺数据与未取得数据为 unknown，不把全部空天默认成已确认零。日期缺失/超月展示可操作提示，不能悄悄移到另一个月。
- skuStats 按店+canonical SKU，均价为销售原额/件数，min/max 来自有效原行单价，标明活动信息覆盖；跨属性汇总不冒充同 SKU 调价。

## 页面与成本内容公共出口

- CostMatching 导出 `CostMatchingContent({validatedContext,onPublished})`，无 AppShell；context 包含 workspaceId/ledgerId/store，写入口仍执行现有 repository 校验。旧 default page 保持兼容 wrapper，后续路由再重定向。
- ProfitWorkspacePage 在现有验证后的工作区/月/店上下文中提供利润明细与成本核对页签，主路径 `/profit?ledger=...&store=...&view=detail|cost`。切换保持 q/supplier/missing 等有效筛选，不因视图切换串账或换店。
- 账本/店铺快速切换丢弃过期异步结果；使用已验证 scope 建 ERP 请求，不能复制点击后才登记，草稿独立收件等旧回归不能退步。
- 利润按 SKC 汇总、全部商品可访问、可展开 SKU 属性。名称简洁，不加冗长毛利解释；成本未齐备显示待核对，不能展示完整利润假象。
- 同屏展示 SKU/属性/数量/销售额及有证据的异常原因和人工更正入口。未知写待查，不从缺成本猜 ERP 未建档。人工非负成本+说明、0/微小值/优先/撤销/审计/定稿保护沿用。
- 每日趋势支持销售额/销量切换，消费上述共同出口；SKU 单价区间与活动信息可按需展开，避免信息堆满首屏。
- 本包暂保留旧代发/扣款以外既有功能入口，不提前实现待确认报表阶段。导航侧栏去重和首页经营概览由后续组合包执行，不侵占其文件。

## 验收与交付

1. 合成数据测日期文本/serial/缺失/非法/超月、既有非销售过滤、月日精确对账、多店/跨工作区保护、单价加权与活动缺失，后续导入不丢新字段，数据库版本保持 14。
2. 利润页成本内嵌与旧成本页均可用，视图切换/重载/快速换店、自动ERP登记/草稿/人工更正与撤销/定稿保护正确。
3. 完整 `pnpm --dir frontend test`、`pnpm --dir frontend build`；必要ERP inbox/bridge定向验证。
4. 真实浏览器合成数据检查1024×768、1280×800和窄屏，主要操作可达、无嵌套AppShell、全部商品可访问，提供截图与证据。业务原表只读本机核验，不提交。
5. 独立 Conventional Commit，报告提交/文件/测试/公共出口/风险/主线承接事项；完成后停止等待主线审查，不发布、不安装。

## 用户原始样本（只读，不提交）

`C:/Users/Administrator/Desktop/03-表格文档/8月台账/680店.xlsx` 包含可用于日期与活动分析的数据。若文件不可用，报告并用合成测试实现，不凭空宣称真实文件验证通过。
