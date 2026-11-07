# Codex 当前任务看板

2026-11-06 核对。当前公开版本见[最新稳定版](https://github.com/love70805/lworkstation/releases/latest)。软件维护从已置顶的项目主线对话接续，按当次确定的范围实施。[项目约束](../AGENTS.md) · [发布状态](RELEASE_STATUS.md) · [2.0 使用指南](USER_GUIDE_2.0.md)

## 2.0.7-beta.2 · 可并行安装的桌面 Beta

本批以主线 `86826cd` 为基线。经营概览和利润页使用 BoardUI Select 切换月份和店铺，待核对 SKU 直达对应明细。台账导入可多选或拖入文件，商品库按页签切换，搜索支持 Esc 清空。利润页显示成本核对进度与可跳转页码。按钮、状态标签、经营指标和趋势切换共用按本机中英文数字排版适配的 BoardUI 组件。[组件目录](https://www.boardui.com/zh-hans/components)

Windows 并行版使用独立名称、图标、安装标识、工作区和更新通道。第一次使用时，可在稳定版的「系统与备份 → 数据备份」导出完整 JSON，然后在 Beta 同一页面选择「导入备份」并确认恢复。Beta.1 曾作为本机同身份候选交付，公开交付采用 Beta.2 并行安装包。版本与文件见[并行 Beta 发布页](https://github.com/love70805/lworkstation/releases/tag/beta-sidecar-v2.0.7-beta.2)。

## 软件实现与项目约束的差异

| 场景 | 当前主线行为 | 已定口径与待处理项 |
| --- | --- | --- |
| 仓储费率、代发和扣款 | 最低模式没有自己的值时读取常规值。最低模式一旦保存自己的费率或采用自己的来源，两边就可以不同。 | **口径已确认，软件待改。** 同一月度账本的费率与补充来源统一读写，改动后两种模式重算均取同一有效版本。已导出的文件保留当时快照。[费率和来源读取](../frontend/src/data/repositories/inventoryAccountingRepository.js) · [报告取数](../frontend/src/data/repositories/profitReportRepository.js) |
| 商品单件成本 | 最低模式可继承常规人工更正，也可保存本模式的更正，人工价会优先于更低的 ERP 采购价。 | **口径已确认，软件待改。** 同一笔有效人工价在常规核算中优先，在最低模式与合格 ERP 历史最低价取低。ERP 最低同为 5 元时，人工 8 元取 5 元，人工 3 元取 3 元，人工真实 0 元取 0 元。[人工成本读取](../frontend/src/domain/inventoryAccounting.js) · [当前实现用例](../frontend/src/data/inventoryAccounting.integration.test.js) |
| ERP 采购零价 | 在同一份有效采购证据中，普通 0 元被排除。该笔 0 元有明确忽略异常记录时，现行最低模式会取 0 元。 | 此特例与既有采购最低价限正价的口径有差异，留待实施复核。本轮已确认的人工零值可直接参加比价。[采购最低价选择](../frontend/src/domain/inventoryAccounting.js) |
| 新 SKU 只有属性冲突 | 同一店铺、SKC 和 SKU 的两行属性不同，导入保留销售明细，但跳过整条草稿并记录属性冲突。缺属性或属性一致可以建草稿。 | **口径已确认，软件待改。** 身份明确就建最小草稿，冲突属性留空，等用户按需补齐。[草稿逻辑](../frontend/src/domain/ledgerCatalogDraft.js) · [导入用例](../frontend/src/data/ledgerCatalogDraft.integration.test.js) |
| 利润页未选中账本时的说明 | 页头把 ERP、历史和人工成本一起描述为“供你确认”。正常 ERP 项实际自动采用，异常与缺失才需核对。 | 页面说明是否随主线流程更新。本批仅记录文案差异。[页面入口](../frontend/src/pages/ProfitWorkspacePage.jsx) · [自动采用用例](../frontend/src/data/erpAutomaticAdoption.integration.test.js) |

核算口径在 `21bc4cd` 上按用户答复补充。5 项隔离对照确认当前实现：ERP 历史最低 5 元时，常规人工 8 元和 3 元在最低模式分别仍取 8 元和 3 元。两边费率可分别为 0.9 元和 1 元，扣款来源可分别为 5 元和 8 元。有证据的采购零价只有带明确忽略异常记录时能入选最低值。验证覆盖现行入口、文档引用、项目技能和上述对应关系。与主线相同的源码树上，最小草稿、人工更正、跨核算方式与月度报告的 4 组隔离测试共 48 项通过；另用三组合成台账核对属性一致、缺少和冲突的草稿结果。此批只交付规则文档，已确认的实现差异留待单独的软件任务。

## 尚未结案或暂停

| 事项 | 当前证据与边界 |
| --- | --- |
| 导出编号自动忽略“数字以文本存储”提示 | 用户曾要求实现，随后暂停。1.2.3 契约明确不纳入该批；保留长编号文本，不因整理自行恢复修改。见[1.2.3 契约](integration/EXPORT_SUMMARY_LAYOUT_1.2.3.md)。 |
| 历史正常核算的价格确认 | 原对话仍保留未确认价格，已有软件修复不等于用户确认真实价格。明细与报告仅在本机私有材料中；本轮未重新采用或修改数据。 |
| 对话中 XLSX 附件上传持续等待 | 原件可正常读取，曾观察到网络变化日志，但未确认该附件的根因或恢复结果；属于客户端上传复核，不登记为 Lworkstation 已证实缺陷。 |
| 旧任务送达数量与本机采用数量变化 | 1.2.4 已区分送达与采用；旧现场变化缺少完整日志，原因未定。作为历史验收限制保留，不据此宣称故障已复现或启动新修复。 |

云端方案保持暂停。10 个开放依赖 PR 可按依赖和目标分支查阅。[依赖 PR 清单](DEVELOPMENT_HISTORY.md#github-仍开放的依赖-pr)

## 最近交付

2.0.6 基于 `7950869` 调整利润明细的筛选位置、整页吸顶表头和跨页展开，精简成本与商品档案入口。首页销售趋势可直接选周期，新报告区分负利润。[2.0.6 发布记录](RELEASE_STATUS.md#206-利润核对与导出)

2.0.5 基于 `b5397f7` 调整月度利润明细。默认显示分组汇总，逐组或按本页展开 SKU 行，所有状态共用一套列。验收覆盖跨页收起与展开、组内分页、筛选和待补成本直达。[2.0.5 发布记录](RELEASE_STATUS.md#205-月度利润明细)

2.0.1 至 2.0.4 均已公开发布。最近的 2.0.4 改进了成本详情、人工更正入口、待补原因和跨店计数。逐版发布、PR 和验收材料从开发历史进入。[近期版本与对应 PR](DEVELOPMENT_HISTORY.md#近期版本与对应-pr) · [2.0.4 成本核对页逐项验收](https://github.com/love70805/lworkstation/blob/a8d2de2cb26e99e9ee667daee9a2ab155a1da903/docs/CODEX_TASK_BOARD.md#204-成本核对页)

项目约束及两种核算的共用输入口径已合入主线。对应的软件差异列在本页首表。[项目约束重构 PR](https://github.com/love70805/lworkstation/pull/329) · [核算口径 PR](https://github.com/love70805/lworkstation/pull/330)

## 对话与远端仓库整理

2026-11-07 本批以 `v2.0.6` 为新的稳定基线。归档并校验其余 121 个公开 Release 的 485 个附件后整理了发布页，保留 Git 标签。[稳定版安装包与两份图文指南](https://github.com/love70805/lworkstation/releases/tag/v2.0.6) · [发布沿革](DEVELOPMENT_HISTORY.md#当前交付与-github)

本次保留了主线和跟进核算、建档规则的对话。已交付的讨论按版本整理，关联在用工作树的对话单独归类。聊天记录和私有核对材料保存在本机。

本批以远端 `a8d2de2` 为基线，删除了已完整进入主线的 186 个旧分支，每个分支均有恢复记录。[分支清单与恢复方法](DEVELOPMENT_HISTORY.md#2026-11-06-远端分支整理) · [整理前的完整看板](https://github.com/love70805/lworkstation/blob/a8d2de2cb26e99e9ee667daee9a2ab155a1da903/docs/CODEX_TASK_BOARD.md)
