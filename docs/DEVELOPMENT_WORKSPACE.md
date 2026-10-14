# 开发工作区与状态入口

本页说明源码、本机材料和历史工作树的边界。现行执行规则见 [AGENTS.md](../AGENTS.md)，当前范围见 [任务看板](CODEX_TASK_BOARD.md)，公开版本见 [发布状态](RELEASE_STATUS.md)。历史规划、旧 checkout 和构建输出不能单独代表当前产品状态。

## 开发入口

- 主开发目录使用已核对的最新 `origin/main`。开始修改前读取任务看板、相关实现及 `git status`，保留未提交内容；有本机改动时先保全并核对，再同步主线，不能直接覆盖。
- 中大型或发布任务使用独立 `codex/` 分支与 Worktree；小型隔离修改可以使用当前目录。优先复用适合的活动工作树，一个版本由一个执行对话连续完成。
- 软件版本以源码中的版本和公开发布记录为准；本机安装版本单独核对。同步源码不执行安装、数据库迁移或重新采集。
- 依赖和开发构建以当前锁文件及 [贡献指南](../CONTRIBUTING.md) 为准。`node_modules/`、`frontend/dist/` 和 `desktop/release/` 是本机生成物，旧输出不能用于验收新源码。

只读环境摘要使用 `node tools/development-context.mjs`；在其它目录运行时可指定 `--repo "<仓库路径>"`。摘要不访问远端、不更新索引和配置，缓存的主线只作比较；未联网核对时明确保留未知状态，不把 Git 干净当成忽略目录无数据。

当前桌面开发启动命令是 `pnpm --dir desktop dev`。`tools/launch-shopeers.ps1` 是会打开可见浏览器的历史前端入口，不能作为 Electron 候选或正式桌面验收入口；本机后台验收沿用现行规则。

## 每批工作记录与验证

先明确本批目标、影响文件或模块、实际基线、完成信号和验证范围。能由已有需求或实现确定的内容直接补全，只有新的业务取舍、范围冲突或未授权操作才需要询问用户。简短记录放在看板或对应集成文档；绝对路径、私有数据及完整日志放在本机忽略归档，完成后将待办替换为交付结果和证据入口。

| 任务类型 | 有效验证 |
| --- | --- |
| 只读解释或调查 | 核对相关源码、当前状态和已有证据；不能将读过测试用例记作本轮测试通过。 |
| 文档、工作规则或开发辅助工具 | 检查差异、当前链接和适用的工具行为；只读摘要在隔离 Git 目录验证缺失主线、未提交内容和分支状态，不启动真实应用。 |
| 小型页面或隔离逻辑修复 | 先跑相关测试或视觉检查，验证具体用户路径；共享组件、跨模块或持久化影响需要扩大回归。 |
| 成本计算、正式采用、恢复或定稿 | 覆盖工作区/月/店铺/SKU 归属、人工优先、零值和微小值、原子性、撤销及定稿保护；使用隔离数据。 |
| 软件发布 | 完成前端 test/build、适用的 desktop verify、桌面 smoke 和实际用户路径；候选、合并及公开资产分别验证。 |

已有验证只在源码及被测行为一致、证据能够追溯且没有未解决风险时复用；说明验证基线和覆盖范围。PR 和主线的必需 CI 仍须通过，不因文档或辅助工具改动取消仓库门禁。

## 常用定位入口

以下是开始追踪调用的入口，文件路径以仓库根目录为基准。先看对应实现与已有测试，再按实际影响补读调用方和契约，不要求每次整读全部 repository。

| 问题 | 主要实现入口 | 已有验证入口 |
| --- | --- | --- |
| 商品属性、参考利润与预存流转 | `frontend/src/domain/catalogAttributes.js`、`frontend/src/data/repositories/selectionRepository.js` | `frontend/src/domain/catalogAttributes.test.js`、`frontend/src/data/catalogUsability.integration.test.js`、`frontend/src/data/prestorage.integration.test.js` |
| 台账导入与货号筛选 | `frontend/src/pages/ImportPreview.jsx`、`frontend/src/domain/supplierFilterPreview.js`、`frontend/src/workers/import.worker.js` | `frontend/src/domain/supplierFilterPreview.test.js`、`frontend/src/data/batchSalesImport.integration.test.js`、`frontend/src/workers/import.worker.test.js` |
| ERP 回传、人工成本与精确核算 | `frontend/src/domain/costPolicy.js`、`frontend/src/domain/manualCostOverride.js`、`frontend/src/data/repositories/profitRepository.js` | `frontend/src/data/erpAutomaticAdoption.integration.test.js`、`frontend/src/data/manualCostOverride.integration.test.js`、`frontend/src/data/profitRepository.erpCost.integration.test.js` |
| 月度定稿与报告 | `frontend/src/data/repositories/profitReportRepository.js`、`frontend/src/domain/profitReports.js` | `frontend/src/data/profitReports.integration.test.js`、`frontend/src/pages/MonthlyReportManager.test.jsx` |
| 备份与恢复 | `frontend/src/data/repositories/workspaceRepository.js`、`frontend/src/domain/workspaceBackup.js` | `frontend/src/data/workspaceBackup.integration.test.js`、`frontend/src/domain/workspaceBackup.test.js` |
| 桌面与内置浏览器 | `desktop/main.cjs`、`desktop/workspace-recovery.cjs`、`desktop/remote-view-loader.cjs` | `desktop/package.json` 中的 `verify` 及相关 smoke；真实窗口行为集中单独验收。 |

## 目录边界

| 位置 | 用途与维护方式 |
| --- | --- |
| `frontend/`、`desktop/`、`tools/`、`integrations/` | 产品源码、测试、采集集成和工具；按现有模块职责维护。 |
| `docs/CODEX_TASK_BOARD.md` | 当前基线、最近交付、后续范围和约束；详细测试及哈希转到发布记录。 |
| `docs/RELEASE_STATUS.md` 与 `docs/RELEASE_*.md` | 公开版本状态及各批交付证据；候选、合并和公开发布分别记载。 |
| `docs/integration/` | 业务契约和实施记录；已交付计划不继续冒充当前待办。 |
| `docs/archive/` | 可公开的历史规则和看板快照，只用于追溯。 |
| `archive/<任务>/` | 本机私有规划、未提交内容保全、真实数据副本、诊断和验收原始材料；保持忽略，不提交。 |
| `releases/candidates/<版本与用途>/` | 本机候选安装包，按 [发布文件登记](../releases/README.md) 记录；不以工作树里的预览包代替正式交付。 |
| `.worktrees/` 与应用管理的工作树目录 | 独立任务 checkout；任务完成后核对归属、提交和忽略文件，再按规则归档。 |
| 仓库外的独立项目目录 | Infinite Canvas 等独立工具各自保存源码、启动脚本和材料，不混入 Lworkstation 提交。 |

## 历史材料与回退

目录整理先记录原 HEAD、分支、Git 状态、文件哈希和恢复来源。原始未提交内容及本机独有材料保存在本机忽略归档中；已有主线版本的文件保留一份当前入口。

工作树的 Git 状态干净只说明没有可见未提交内容，忽略目录仍可能包含候选、故障证据、真实数据或唯一备份。应用管理的工作树使用管理工具归档；手动工作树核对保全后使用 `git worktree remove`。不自动删除其他对话的工作树，不能用普通文件删除代替 Git 工作树管理。

移动独立项目时核对完整文件和目录清单，保留原始快照，更新必要的绝对路径说明并验证本机入口。不要借整理扩大业务范围、修改用户配置或真实数据库，也不要提交本机保全文件。

纯文档和工作区整理检查差异、当前链接、保全哈希和适用的迁移入口；远端必需 CI 仍须通过，不启动桌面候选、不安装、不创建软件版本。
