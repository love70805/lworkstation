# 2026-10-19 最终产品审查

作者：Codex。状态：本轮审查完成，以下三项仍待修复；不据此判定产品整体验收通过。

## 范围与基线

- 用户指定本对话承担最终代码审查、使用效果检验、仓库整理和缺陷分析。本轮优先覆盖备份/清空/恢复、收件证据、人工成本和定稿保护；不扩大为新功能开发。
- 实际联网核对 `refs/heads/main` 为 `3906bc518c592bcf42581dbd233fe8203599febc`，与本机 HEAD 一致；前端与桌面源码均为 0.4.45。
- 完成信号：缺陷能由源码和合成数据复现，给出用户影响、修复方向和复验要求；既有已交付项与新发现分开记录。本轮仅提交审查文档。
- 先读任务看板和讨论区最新回复 0010，保留四份既有本机审查原稿。没有安装或重启用户软件，没有读写真实业务库、收件队列或 ERP 账号。

## 待修复缺陷

### R1 / P1：恢复补备份失败后，重试会绕过新收件保全

源码：[desktop/workspace-safety.cjs](../../desktop/workspace-safety.cjs)，`recoverRestore` 第 101—108 行。

服务重启使旧维护锁失效后，恢复流程先把新 `maintenanceId` 写入持久化 journal，再保存 `Lworkstation-recovery-current`。若该文件保存失败，新锁仍保留；第二次调用 `hold` 成功，直接跳过补备份并执行 `restore`。

最小场景：准备完整恢复并模拟业务库已经提交 → 收件服务重启 → 队列新增一批合成收件 → 注入一次补备份文件打开失败 → 重试恢复。状态机探针及真实 Node 子进程/本机 HTTP 维护接口均复现：第二次返回 `committed`，补备份数量为 **0**，有效收件从 **2 批变为 1 批**，新增投递不再出现在索引中。原始证据文件仍有 2 份；这里确认的是索引与可恢复元数据保全缺口，不是原始证据文件被删除，也未声称真实现场已经发生。

建议：把“重启后当前收件已成功保全”作为独立的持久化阶段和凭据；未完成时每次重试都必须补存、回读核验，不能仅凭维护锁有效就进入替换。复验覆盖保存/回读失败后重试、再次进程重启、后到批次和幂等完成。

### R2 / P1：日常“导出完整备份”遗漏桌面收件与任务

源码：[DataSecurity.jsx](../../frontend/src/pages/DataSecurity.jsx) 第 189—190、530 行，[workspaceRepository.js](../../frontend/src/data/repositories/workspaceRepository.js) 第 101—125 行，以及 [workspace-system-ipc.cjs](../../desktop/workspace-system-ipc.cjs) 的 `workspace:save-backup`。

该按钮直接保存 `createWorkspaceBackupPayload()`；此负载包含业务表、业务筛选和成本草稿，没有 `desktopInbox`，普通原生保存器也不会补入。清空前的 `saveCombined` 才执行完整桌面快照合并，两条路径覆盖范围不同。

使用真实 repository、隔离 IndexedDB 和实际 React 按钮复现，原生文件保存接口按当前实现模拟：保存成功提示已出现，文件 `formatVersion=2`，但 `hasDesktopInbox=false`、`desktopInboxIncluded=false`。因此这份日常备份无法单独恢复尚未入业务库的收件、采集任务及相关完整桌面历史；用户迁机或丢失本机存储时，会误把它当成完整保护。测试未操作真实保存对话框或用户文件。

建议：日常完整导出复用经过维护冻结、证据展开和校验的完整快照流程，保持备份操作本身只读；桌面快照失败时不报告完整备份成功。旧局部备份继续兼容并明确范围。复验必须从日常导出按钮开始，包含未处理批次、已归档证据和暂停任务，并在空隔离环境完整恢复。

### R3 / P2：清空完成后，首次导入仍自动套用旧业务筛选

源码：[workspaceRepository.js](../../frontend/src/data/repositories/workspaceRepository.js) 第 370—384 行，[ImportPreview.jsx](../../frontend/src/pages/ImportPreview.jsx) 第 316—345 行；页面危险区承诺“操作后仅保留空白默认工作区”。

清空只移除业务表和成本草稿，`lworkstation:import-supplier-groups:v1:` 与 `lworkstation:import-suppliers:v1/v2:` 留在 localStorage。默认工作区 ID 重用后，首次导入会重新读取 `lastAppliedId` 和店铺选择并自动构造筛选。

隔离复现：保存一组后缀 `OLD` 的货号组及店铺筛选 → 清空成功 → 业务采集数为 0，但 `groupCount=1`、`lastAppliedId=SYNTHETIC-GROUP`、`selected=[A-OLD]`、`hasSaved=true`。配合导入入口可确认旧规则仍会影响新台账筛选，和“空白”提示不一致。

建议：先明确清空对业务筛选的范围；如按空白工作区执行，应纳入备份、清理与故障恢复，继续保留外观等设备偏好。如产品决定保留规则，应明确告知并避免清空后的首次导入未经说明自动沿用。不要把此项扩展成清除任意 localStorage 或凭据。

## 本轮验证

| 检查 | 结果 |
| --- | --- |
| 前端定向回归：人工更正、ERP 成本、利润报告、备份恢复、本机清空、成本策略、备份校验及系统页 | 8 文件 / **146 项通过** |
| `node tools/erp-inbox-disk.test.mjs` | 通过，含 Worker 异常退出后首次冷证据读取 |
| `node tools/erp-inbox-storage.test.mjs` | 通过，含增量传输、外部替换与 Worker 恢复 |
| `node desktop/workspace-safety.test.mjs` | 通过，含备份校验、磁盘失败和提交/回滚恢复 |
| `node desktop/workspace-safety-http.test.mjs` | 通过，真实子进程与 HTTP 完整恢复 |
| 本轮新增故障探针 | R1 状态机与真实 HTTP 两次均复现；R2/R3 的正确行为断言均失败，以上缺陷保持待修 |

前端命令：

```powershell
pnpm --dir frontend test src/data/manualCostOverride.integration.test.js src/data/profitRepository.erpCost.integration.test.js src/data/profitReports.integration.test.js src/data/workspaceBackup.integration.test.js src/data/localWorkspaceReset.integration.test.js src/domain/costPolicy.test.js src/domain/workspaceBackup.test.js src/pages/DataSecurity.system.test.jsx
```

本轮使用 Node 24.20.0、pnpm 11.25.0 和当前共享依赖；未重新隔离安装。上述结果不证明干净依赖的生产构建通过，也不代表完整发布门禁或真实可见窗口验收。人工零值、微小值、人工优先、撤销回退及定稿保护在本次所跑范围内未发现新失败。

探针、JSON 结果和原始证据位于本机忽略目录 `archive/final-product-review-20261019/`，不随文公开。前端临时探针已复制保全并核对 SHA256 后从测试目录移出，未把预期失败的调查用例留进常规测试套件；产品源码未改。

## 仓库整理与优化顺序

- 当前 README 的版本与更新说明已是 0.4.45，旧讨论第 2 项不能继续当作当前漏更缺陷；原历史回复保留，通过新增结论更正状态。
- 新结论统一进入本报告、任务看板和[讨论回复 0011](../agent-discussions/2026-10-19-handover-review/0011-codex-final-review.md)，不覆盖其他作者的本机原稿或重新开启已撤回的问题。
- 优先修复 R1、R2，随后收敛 R3 的清空提示与筛选行为。发布清单收敛、前后端版本一致性门禁、明确 Node 支持范围可合为后续工程小批；不以长文件行数或保留云兼容代码本身判断运行故障。
- 当前 ERP 助手静态目录共 44 个文件、2,429,885 字节；历史 ZIP 的存在属于可评估的整理空间，没有证据表明它是当前卡顿根因。16 个登记 Worktree 和既有本机原稿均未据此删除。

审查文档、软件修复、候选验收和公开发布分别记录。本轮没有软件改动，不创建软件版本；三项缺陷需修复并完成相应验证后才能关闭。
