# 一次完整更新：利润与首页实施合同

状态：2026-09-13 用户已确认报表留存规则及本机 v15 四表、备份恢复和测试方案。9 月初核算 8 月利润，扣款在 9 月中，即核算当月中旬收到，仍归入 8 月账本。各任务按依赖顺序实施，统一版本验收。

## 目标与边界

完整范围以主仓库 docs/NEXT_UPDATE.md 及用户最终确认 Excel 为准，一次统一发布。纯本机；不部署云数据库，不新增 SQL，不改变盘亏忽略规则，不增加每日利润，不安装本机软件。当前基线 f25a523（业务代码 1932d2d），主线准备 Worktree .worktrees/full-update-integration。

利润与 ERP 主责业务与必要数据适配；桌面化主责主题与桌面体验。全局 UI 任务当前不可用，后续首页/导航组合适配明确交桌面化并顺序执行。主线负责合同、审查、集成和发布，不能代改专职实现。

## 当前问题与事实

- salesImport 保存 unitPrice 和 orderDate，但没有台账添加时间/活动字段，importedAt 只是软件导入时间；现存行不能凭空恢复源日期。
- 旧独立于此需求的 generic penalty 使用绝对值及两位截断；新扣款必须走有符号精确通道。不能重复扣或静默忽略历史罚款。
- 现导入 Worker 仅首 sheet，导出只有单 sheet，并把中文文件名替换掉。新导入/导出需独立能力，不让旧 ERP 导出回退。
- 当前只有一份 profitLines/ledger.profitSummary；重开删当前 profitLines，不能直接承接多次已交付报告。

## 已批准本机结构

仅在 clientDatabase 追加 v15，保留 v1–14，不改旧行、不重算旧定稿。新表均有 workspaceId/ledgerId：

1. monthlySupplementBatches：id，workspaceId，ledgerId，period，kind(dispatch/deduction)，revision，status(draft/adopted/superseded)，来源文件哈希与 sheet，parserVersion，mapping，selection，inputSignature，replacesBatchId，adoptedQuantityExact，创建人/时刻。索引 id,workspaceId,ledgerId,[ledgerId+kind+status]。
2. monthlySupplementRows：id，batchId，workspaceId，ledgerId，kind，源文件哈希/sheet/真实行号，业务单号，本人标记，原始/采用店铺，SKC/供方货号/1688 单号，quantityExact 或 signedAmountExact，选取状态/排除原因。索引 id,workspaceId,ledgerId,batchId,[ledgerId+kind]。不以 sourceRow 跨 sheet 假定唯一。
3. profitReports：id，workspaceId，ledgerId，period，kind(pre_deduction/financial)，revision，baseReportId，supersedesReportId，formulaVersion/templateVersion，warehouseRateExact，sourceFingerprint，adoptedBatchIds，totalsExact/displayTotals，创建人/时刻/原因，payloadHash。索引 id,workspaceId,ledgerId,[ledgerId+kind],[ledgerId+revision],baseReportId。
4. profitReportLines：id，reportId，workspaceId，ledgerId，lineKind(product/dispatch/deduction)，ordinal，store/SKU/SKC/属性/单号，各 exact 金额/数量，costSource 与来源记录，源行引用。索引 id,workspaceId,ledgerId,reportId,[reportId+lineKind],[reportId+store]。

报告不可变。采用相应模板生成并保存原导出文件的 base64、SHA-256 与文件名用于可靠重下载；JSON 备份可往返，不保存本机绝对业务路径。生成/保存失败必须明确失败，可重试，不能声称已发给上级/财务。

销售行新增非索引 sourceAddedAt/sourceAddedDate/rawAddedAt/dateStatus/timezone、unitPriceRaw/amountExact、activityRaw/activityStatus、sourceSheet/真实 sourceRow；不从 orderDate/importedAt 补造日期。小型筛选偏好可放 settings（按工作区），业务批次和报告不得塞 settings。

## 两阶段流程

- 核算草稿期间可导入销售、发布 ERP/人工更正、填写/选取代发。非负代发数量采用用户输入；0 与未填写区分，不受销售件数上限限制、不分摊各店。
- 首次生成未扣款报告前检查成本完整性，事务内复验当前工作区、财务权限、数据 fingerprint、代发采用版本和费率。冻结商品明细、精确总额、代发明细/总数和费率；扣款未到不阻塞。
- 商品基础冻结后，独立扣款仍可登记，无须重开商品。财务报告显式关联未扣款 baseReportId，取该基础商品及代发，仅加入扣款快照；不得读 live 成本替换基础。
- 只改扣款可生成同一基础的新财务修订，旧报告可重下载。更改商品成本、销售、费率或代发需显式重开说明，生成新基础；旧报告不覆盖。
- 同月同店的数据隔离由 repository 验证，不能只靠页面过滤。快照保存采用单事务或具备等价原子性；预览后发生变化要拒绝过期保存并刷新。
- 有报告历史的账本禁止普通删除，草稿账本删除清理新增子表；用户主动整库清理仍走已有明确确认，涵盖报告和补充数据。

## 金额合同

- 使用 Decimal 和 exact 十进制字符串跨持久化/Worker 边界；不以 JS 浮点乘法代替精确核算，不累加已格式化或截断的店/日小计。
- 新流程商品基础 = 销售原额 − 采购成本 − 默认全部销售件数的仓储成本；月总额加 adoptedQuantity × 冻结仓储单价一次。
- 财务总额 = 未扣款基础精确总额 − 精确合计的有符号独立扣款。按源店汇总，减负数体现回补，禁止 abs。
- 报告最终货币金额向零截至两位；商品/店铺展示不作为后续汇总输入。新公式版本和旧公式历史隔离。不能以实现新精度顺带重算旧定稿。
- 遇到旧 generic penalty 的活动账本，提示不兼容的新流程处理入口，禁止静默忽略或与新独立扣款重复扣。用户无旧账本，不开展旧账本迁移访谈。
- 人工更正仅需非负单件成本与说明，含 0 和微小值；人工优先可撤销，ERP 不覆盖，旧参考不升级；已定稿保护继续生效。

## 源表导入

- 代发支持 XLSX/CSV、扣款支持 XLSX，多 sheet 选择、标题行探测/明确映射、真实行号。可读用户授权原表，但任何业务数据不得进入 Git。
- 按姓名或供方货号本人标记选取，保留选择规则与预览；未知归属不推断。扣款源 sheet/实际店铺列为归属依据，不能只从供方货号猜店。
- 忽略标题/空行/合计，展示选择记录数与合计。手输总代发只保存 manual 批次，不能伪造明细订单。
- 去重使用工作区/月/kind/文件哈希/sheet/映射/选取签名，同配置重复导入幂等；不同选取不直接吞掉。相同业务单号并非金额相同就重复，明确冲突/替换采用版本，旧记录保留。
- 选错月份、扣款店不在报告基础或未映射、无有效记录须明确处理，不能“导入成功”却漏数据。
- 长标识符使用文本；原 Excel 数字单元格已经丢失的精度不可虚构，异常明示。日期按工作簿日期系统/源添加时间解析，明确 Asia/Shanghai，不混用交易日期。

## 日趋势与成本内容公共出口

- 利润提供 readLedgerSalesAnalytics({workspaceId,ledgerId,store})，内部验证当前成员和作用域；返回 period/timezone、日期覆盖、每日 {date,quantityExact,revenueExact,sourceRowCount}、未定位日期数量/金额、精确月合计及 SKU 单价/活动摘要。
- aggregateDailySales 纯函数统一被首页/利润使用，不重复定义业务汇总。缺日期或异常月日期独立呈现并纳入对账提示；不借导入时间补造，不静默丢金额。完整月份已知无销售天可补 0，未取得数据为 unknown。
- 同 SKU 均价以销售额/件数加权，min/max 来自逐行实际单价；活动原字段缺失不表示未参加。SKC 多属性汇总不得冒充同 SKU 调价。
- CostMatchingContent({validatedContext,onPublished}) 不套 AppShell；context 含已验证的 ledgerId/workspaceId/store，内容自身仍校验写权限。默认 CostMatching 页面保留 wrapper 或经路由兼容进入利润页。
- 主路径 /profit?ledger=...&store=...&view=cost（或 detail）。保留 q/supplier/missing；无效/跨工作区参数拒绝。统一验证函数白名单支持 view；切换上下文取消过期异步结果。

## 页面与导航

- WorkspacePortal 保留原经营概览，增加月度账本管理区、月份/店筛选、批量导入、进入成本/利润及每日趋势；不得嵌入完整利润表替换首页。
- 侧栏仅工作区首页、选品工作台、利润核算、系统诊断与备份。账本管理与原完整管理页从首页可达，旧 /ledger/旧成本链接继续兼容。
- ProfitWorkspacePage/ProfitPanel 由利润专职修改，内含明细/成本两个页签、全部 SKC 可访问且可展开 SKU，简洁利润名称，缺成本明确待处理。
- 主要操作不依赖全屏，1024×768/1280×800/窄屏实际验证。主题共享文件归桌面化；利润改自己的样式模块。

## Excel 验收

- 最后斑马纹演示为样式基准：汇总 A:I 商品/J 留白/K:O 汇总；商品九列；动态店铺 tabs；代发左明细右件数/金额；扣款左明细右按店明细合计；单行表头、用户逐列居中、浅色 F5F8FA、扣款 C62828。
- 未扣款、财务对账分文件，中文文件名；表内不写第一版/第二版或冗余说明。未扣款无扣款占位和空扣款页。
- 仓储默认已扣，不单列；代发只全局加，名称代发金额；扣款无确认/差额/可改列。
- 报告金额与页面同源，完整长单号；合法处理非法/重复/过长 sheet 名、文件名，不能丢店；零店/多店/大明细不写死五店。
- 软件生成 XLSX 后用独立读取工具复核类型、精确数据来源/最终金额、sheet/列宽/对齐/字体/斑马纹/打印宽度，实际预览检查；不能只看生成函数返回成功。

### 最终样本逐列样式复核（2026-09-13，只读）

此处补录用户已确认的斑马纹样本元数据，避免实现用统一居中模板覆盖手工排版；不是新增业务规则。General表示Excel默认对齐，文本保留文本类型。

| 工作表区域 | 对齐 |
| --- | --- |
| 汇总商品A:I | A/B/C/F General；D/E/G/H/I居中 |
| 汇总右侧K:O | K General；L/M/N/O左对齐 |
| 店铺商品A:I | A/B/C General；D:I居中，F为文本单号 |
| 代发左A:D、右F:G | A/B General；C左；D居中；F/G居中 |
| 扣款左A:E、右G:H | A/B General；C/D左；E居中；G居中、H右 |

商品明细样本10号字、36行高，代发/扣款明细34行高，单行表头30行高。汇总按店分隔，合计与分隔使用粗体/浅色层次；斑马纹只施加明细，不能覆盖右侧汇总原层次。财务店铺页底部保留本店扣款及扣后利润，未扣款页不增加扣款占位；代发仍只总汇总加一次。冻结线以当前有效表头为准，不机械继承用户删除顶部行后遗留的旧A6引用。

## 数据完整性与共同验收

- 备份/恢复包含四新表、报告原文件，旧备份兼容且不补造新报告；校验跨表引用、作用域、金额、行数和哈希，坏备份拒绝且原数据库不变。旧应用不得静默接受新备份。
- 新报告不冒充旧云同步事件。不扩云 SQL；已有云恢复/种子路径不得静默丢新报告或替换其父账本，应明确拒绝不支持的混用并说明纯本机边界。
- 合成回归：0.009 单价、小数销量、多店精确累计、正/负微小扣款、代发量超过销量、人工零/撤销、重复/替换导入、过期预览、跨工作区/月/店、基础冻结后 ERP 更新、扣款后补、修订旧报告重下载、备份恢复及失败回滚。
- 现基线 582 测试、frontend build、11 组 desktop verify、ERP inbox/bridge 定向验证通过。新实现必须运行完整 test/build/release:check、desktop verify 及候选 smoke；只通过旧测试不算完成新需求。
- 主线按依赖审查独立提交后合并，官方候选从集成主 Worktree 构建，版本暂不提前更改。统一公开 GitHub 后回读资产；本机不安装。

## 审查补充与时间口径

- 首次未扣款报告与当前账本定稿原子完成，既有定稿入口须复用报告/代发校验，不能绕过。生成失败可重试，不得误报成功；重开后清晰标识活动修订，历史报告保留，沿用财务写权限与锁定保护。
- 补充数据按工作区+账本+kind整月采用，每种kind一个有效批次，一批可含多文件、多sheet。重新采用候选集合原子替换该kind当前批次，旧批次保留；导入新文件不能无提示丢掉此前文件。adoptedBatchIds最多一个代发批次和一个扣款批次。
- 未取得扣款与明确采用零扣款区分。采用预览显示店铺覆盖、来源与合计，零扣款可通过明确采用零值来源或录入零实现，不在导出增加确认/差额列，不增加逐条复核流程。
- quantityExact与amountExact一起贯穿读取、归一化及Worker，不能仅从Excel格式化显示值恢复精度；各单元格格式以用户最终样本为准，单价/行金额可多位，最终金额最后截断，显示值不回流计算。
- 业务月份独立于收到和录入日期：9月初核算8月利润，9月中收到的对应扣款仍计入8月报告；界面明确目标账本月份，不延到10月、不误入9月账本。
