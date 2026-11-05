# Lworkstation 开发历史

整理日期：2026-11-05（北京时间）。本页记录开发阶段、已交付结果及追溯入口；当前执行范围以[任务看板](CODEX_TASK_BOARD.md)为准。

## 当前交付与 GitHub

- 当前公开稳定版：[2.0.0](https://github.com/love70805/lworkstation/releases/tag/v2.0.0)，2026-11-05 01:09 发布。发布服务返回非草稿、非预发布，5 个资产均已上传。
- 软件标签和本轮核对的远端 main 同为 `caf95151157ab1ffd5bdf148a176f398c1e39d82`。[PR #323](https://github.com/love70805/lworkstation/pull/323) 已合并，[该软件主线 CI](https://github.com/love70805/lworkstation/actions/runs/41872909985) 成功。
- 截至本次核对，GitHub 可见 116 个 Release、203 个分支、10 个开放 PR、0 个独立开放 Issue。10 个 PR 均为依赖更新；数量是整理前快照，不包括本次文档 PR。
- 本次整理文档与对话索引，不改变软件版本、发布资产、业务数据或依赖。GitHub 的当前值可在[仓库](https://github.com/love70805/lworkstation)、[开放 PR](https://github.com/love70805/lworkstation/pulls)、[Actions](https://github.com/love70805/lworkstation/actions)查看。

## 开发阶段

| 阶段 | 交付重点 | 追溯入口 |
| --- | --- | --- |
| 0.2 系列，2026-09 | 建立选品资料、ERP 证据、台账和月度利润的基础工作流；逐步完善桌面交付 | [0.2.19](RELEASE_0.2.19.md)、[完整发布索引](archive/RELEASE_INDEX_2026_11_05.md) |
| 0.3 Beta / RC / 稳定版，2026-09 至 10 月初 | 梳理导入、成本恢复、采购历史和桌面稳定流程，明确候选与稳定通道 | [0.3.0](RELEASE_0.3.0.md)、[0.3.13](RELEASE_0.3.13.md) |
| 0.4 系列，2026-10 | 负责货号范围、商品资料、正式成本核对、代发/扣款导出、任务接续和大数据响应；后期补齐备份恢复与清空边界 | [0.4.0](RELEASE_0.4.0.md)、[0.4.44](RELEASE_0.4.44.md)、[0.4.54](RELEASE_0.4.54.md) |
| 1.0 RC 与 1.0.0，2026-10-22 至 23 | 加固恢复、更新安装与成本任务，统一模糊/精准货号识别，进入 1.0 稳定版 | [RC1](RELEASE_1.0.0-rc.1.md)、[1.0.0](RELEASE_1.0.0.md) |
| 1.0.1 至 1.0.11，2026-10-24 至 11-03 | 降低后台内存；修复跨范围、历史成本、任务接收和权限恢复；简化导入与日常核算 | 下表及各批契约 |
| 1.0.12 与 1.2 系列，2026-11-04 | 采购表批量采集、异常补查；来源合并与顺序、导出布局；整项核算和插件适配 | 下表及各批契约 |
| 2.0.0，2026-11-05 | 合并核算入口，账本随时调整，异常单项/多选/全部忽略和恢复，商品资料独立补齐，优化加载与反馈 | [2.0 实施记录](integration/DESKTOP_WORKFLOW_2.0.0.md)、[使用指南](USER_GUIDE_2.0.md) |

## 近期版本与对应 PR

日期均按北京时间列出，描述表示该版本的历史交付，不将旧操作流程当作现行要求。

| 版本 | 公开日期 | 交付结果 | PR / 实施证据 |
| --- | --- | --- | --- |
| [2.0.0](https://github.com/love70805/lworkstation/releases/tag/v2.0.0) | 11-05 | 统一核算工作流、可撤回异常处理、移除定稿锁定、商品资料补齐 | [#323](https://github.com/love70805/lworkstation/pull/323) · [契约](integration/DESKTOP_WORKFLOW_2.0.0.md) |
| [1.2.4](https://github.com/love70805/lworkstation/releases/tag/v1.2.4) | 11-04 | 整项核算、助手 8.0.58、插件回滚/工作区读取/汇总显示修复 | [#322](https://github.com/love70805/lworkstation/pull/322) · [契约](integration/ERP_TASK_FLOW_1.2.4.md) |
| [1.2.3](https://github.com/love70805/lworkstation/releases/tag/v1.2.3) | 11-04 | 浅蓝表头、汇总下移、取消冻结 | [#321](https://github.com/love70805/lworkstation/pull/321) · [契约](integration/EXPORT_SUMMARY_LAYOUT_1.2.3.md) |
| [1.2.2](https://github.com/love70805/lworkstation/releases/tag/v1.2.2) | 11-04 | 内置扩展旧回执误报修复 | [#320](https://github.com/love70805/lworkstation/pull/320) · [契约](integration/ERP_EXTENSION_STATUS_1.2.2.md) |
| [1.2.1](https://github.com/love70805/lworkstation/releases/tag/v1.2.1) | 11-04 | 代发表恢复来源顺序与同组合并 | [#319](https://github.com/love70805/lworkstation/pull/319) · [契约](integration/DISPATCH_SOURCE_ORDER_1.2.1.md) |
| [1.2.0](https://github.com/love70805/lworkstation/releases/tag/v1.2.0) | 11-04 | 黑字、细边框、店铺首列、逐字段来源合并及覆盖格清空 | [#318](https://github.com/love70805/lworkstation/pull/318) · [契约](integration/EXPORT_LAYOUT_1.2.0.md) |
| [1.0.12](https://github.com/love70805/lworkstation/releases/tag/v1.0.12) | 11-04 | 后台批量采购表、选择性补查、原方式兜底 | [#317](https://github.com/love70805/lworkstation/pull/317) · [契约](integration/ERP_BULK_COST_1.0.12.md) |
| [1.0.11](https://github.com/love70805/lworkstation/releases/tag/v1.0.11) | 11-03 | 任务接收确认、有限重连、资料按需整理 | [#316](https://github.com/love70805/lworkstation/pull/316) · [契约](integration/ERP_TASK_SYNC_1.0.11.md) |
| [1.0.10](https://github.com/love70805/lworkstation/releases/tag/v1.0.10) | 11-03 | ERP 店铺权限异常暂停与同任务恢复 | [#315](https://github.com/love70805/lworkstation/pull/315) · [契约](integration/ERP_PERMISSION_RECOVERY_1.0.10.md) |
| [1.0.9](https://github.com/love70805/lworkstation/releases/tag/v1.0.9) | 11-03 | 工作台响应、草稿提示、收件通知与 ERP 重登恢复 | [#314](https://github.com/love70805/lworkstation/pull/314) · [契约](integration/RESPONSE_OPTIMIZATION_1.0.9.md) |
| [1.0.8](https://github.com/love70805/lworkstation/releases/tag/v1.0.8) | 11-03 | 成本证据排序、完整性、工作区隔离与历史补齐 | [#313](https://github.com/love70805/lworkstation/pull/313) · [契约](integration/ACCOUNTING_LOGIC_1.0.8.md) |
| [1.0.7](https://github.com/love70805/lworkstation/releases/tag/v1.0.7) | 11-03 | ERP 任务浮窗、成本证据复用与跨月任务保持 | [#312](https://github.com/love70805/lworkstation/pull/312) · [契约](integration/ERP_TASK_COSTS_1.0.7.md) |
| [1.0.6](https://github.com/love70805/lworkstation/releases/tag/v1.0.6) | 11-03 | 货号预选、一次匹配、后台 ERP 成本采集 | [#310](https://github.com/love70805/lworkstation/pull/310) · [契约](integration/SUPPLIER_COST_WORKFLOW_1.0.6.md) |
| [1.0.5](https://github.com/love70805/lworkstation/releases/tag/v1.0.5) | 11-02 | 代发可选导出、货号筛选与人工更正简化 | [#308](https://github.com/love70805/lworkstation/pull/308) · [记录](RELEASE_1.0.5.md) |
| [1.0.4](https://github.com/love70805/lworkstation/releases/tag/v1.0.4) | 11-02 | 清空后 ERP 旧 SKC、任务及检查点残留修复 | [#306](https://github.com/love70805/lworkstation/pull/306) · [记录](RELEASE_1.0.4.md) |
| [1.0.3](https://github.com/love70805/lworkstation/releases/tag/v1.0.3) | 10-27 | 移除成本核对重复按钮 | [#301](https://github.com/love70805/lworkstation/pull/301) · [记录](RELEASE_1.0.3.md) |
| [1.0.2](https://github.com/love70805/lworkstation/releases/tag/v1.0.2) | 10-26 | 逐店货号导航、收件身份及旧备份账本恢复 | [#295](https://github.com/love70805/lworkstation/pull/295) · [记录](RELEASE_1.0.2.md) |
| [1.0.1](https://github.com/love70805/lworkstation/releases/tag/v1.0.1) | 10-24 | 后台证据内存及重新打开等待优化 | [#293](https://github.com/love70805/lworkstation/pull/293) · [记录](RELEASE_1.0.1.md) |
| [1.0.0](https://github.com/love70805/lworkstation/releases/tag/v1.0.0) | 10-23 | 模糊/精准货号识别与逐店范围隔离 | [#289](https://github.com/love70805/lworkstation/pull/289) · [记录](RELEASE_1.0.0.md) |

其余版本见[完整发布索引](archive/RELEASE_INDEX_2026_11_05.md)。缺少单独 `RELEASE_*.md` 的新批次，直接沿用同批 PR、Release 和 `docs/integration/` 契约，不补造一次软件发布。

## 已被后续决策替代的历史流程

| 历史记录 | 后续结果与当前理解 |
| --- | --- |
| 0.4.44 清空前自动备份 | 0.4.54 按用户要求取消；清空直接删除约定范围，手动导出文件与账号设置保留。不能按旧记录重新加回前置备份。 |
| 1.0 RC 成本后自动补资料/建档 | 1.0.11 改为按需手动整理；2.0 将资料操作集中到商品资料页，档案只补资料。 |
| 固定每批 5 个 SKC | 1.2.4 正常任务改为整项核算；异常恢复及大载荷分段属于内部处理。 |
| 日常定稿、锁定与重开 | 2.0 明确取消；当前账本可调整并重新导出，历史报告文件与来源快照独立保留。 |
| 人工更正强制填写说明 | 1.0.5 已简化；当前输入非负成本并确认，系统记录操作说明与审计。 |
| 固定只递增 1.0.x | 用户后来明确指定 1.2.0、2.0.0；这些版本已经发布，不将旧版本约定倒推为当前版本。 |
| 云账号与云数据库规划 | 当前交付仍以本机 Windows 桌面版为准；历史云方案不自动恢复实施。 |

## GitHub 仍开放的依赖 PR

这些是待评估的依赖更新，不表示当前稳定版有同数量的故障。本次不安装、合并或关闭它们。

| PR | 依赖 | 目标分支 |
| --- | --- | --- |
| [#305](https://github.com/love70805/lworkstation/pull/305) | electron | main |
| [#304](https://github.com/love70805/lworkstation/pull/304) | electron-updater | main |
| [#303](https://github.com/love70805/lworkstation/pull/303) | lucide | main |
| [#297](https://github.com/love70805/lworkstation/pull/297) | electron-builder | main |
| [#168](https://github.com/love70805/lworkstation/pull/168) | vitest | main |
| [#167](https://github.com/love70805/lworkstation/pull/167) | @tanstack/react-table | main |
| [#166](https://github.com/love70805/lworkstation/pull/166) | @supabase/supabase-js | main |
| [#76](https://github.com/love70805/lworkstation/pull/76) | semver | codex/selection-profit-erp-sync（历史保护分支） |
| [#73](https://github.com/love70805/lworkstation/pull/73) | react / react-dom | main |
| [#71](https://github.com/love70805/lworkstation/pull/71) | @fontsource/inter | main |

分支名称和创建时间不能证明任务未完成，也不能证明可以删除。源码恢复优先使用已合并 PR、软件标签与提交；本次保留历史分支和标签，未重写 Git 历史。

## 资料入口与维护

| 要查的内容 | 入口 |
| --- | --- |
| 当前软件用法 | [2.0 使用指南](USER_GUIDE_2.0.md) |
| 当前版本、通道、安装包哈希 | [发布状态](RELEASE_STATUS.md)、[候选登记](../releases/README.md) |
| 当前范围和未决事项 | [任务看板](CODEX_TASK_BOARD.md) |
| 各版本交付 | 本页近期时间线、[全部 Release 索引](archive/RELEASE_INDEX_2026_11_05.md)、GitHub PR / Release |
| 历史审查及撤回结论 | [AI 讨论区](agent-discussions/README.md) |
| 本轮整理前公开看板 | [固定提交快照](https://github.com/love70805/lworkstation/blob/caf95151157ab1ffd5bdf148a176f398c1e39d82/docs/CODEX_TASK_BOARD.md) |
| 本机对话对应关系、未提交记录和私有证据 | 本机忽略归档 `archive/history-organize-20261105/`，不上传 GitHub |

后续每批只在看板保留当前结果与真实未决项，详细交付沿用同批 PR / Release。历史事实可追溯，过时的“待办”不能自动恢复为新任务。聊天记录继续保留；应用随对话归档的旧执行工作树另记源码恢复入口，规范候选与必要项目归档保留，真实业务数据不在整理范围。
