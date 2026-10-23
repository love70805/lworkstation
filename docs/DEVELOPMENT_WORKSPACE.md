# 开发工作区与状态入口

本页说明源码、本机材料和历史工作树的边界。现行执行规则见 [AGENTS.md](../AGENTS.md)，当前范围见 [任务看板](CODEX_TASK_BOARD.md)，公开版本见 [发布状态](RELEASE_STATUS.md)。历史规划、旧 checkout 和构建输出不能单独代表当前产品状态。

## 开发入口

- 主开发目录使用已核对的最新 `origin/main`。开始修改前读取任务看板、相关实现及 `git status`，保留未提交内容；有本机改动时先保全并核对，再同步主线，不能直接覆盖。
- 中大型或发布任务使用独立 `codex/` 分支与 Worktree；小型隔离修改可以使用当前目录。优先复用适合的活动工作树，一个版本由一个执行对话连续完成。
- 软件版本以源码中的版本和公开发布记录为准；本机安装版本单独核对。同步源码不执行安装、数据库迁移或重新采集。
- 依赖和开发构建以当前锁文件及 [贡献指南](../CONTRIBUTING.md) 为准。`node_modules/`、`frontend/dist/` 和 `desktop/release/` 是本机生成物，旧输出不能用于验收新源码。

只读环境摘要使用 `node tools/development-context.mjs`；在其它目录运行时可指定 `--repo "<仓库路径>"`。摘要不访问远端、不更新索引和配置，缓存的主线只作比较；未联网核对时明确保留未知状态，不把 Git 干净当成忽略目录无数据。

当前桌面开发启动命令是 `pnpm --dir desktop dev`。旧的可见浏览器启动脚本 `tools/launch-shopeers.ps1` 已在 1.0 RC 整理中移除，历史版本可由 Git 标签追溯；本机后台验收沿用现行规则。

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

## 开发产物保留与收尾

2026-10-22 用户要求后续开发不再积累多余数据。执行端负责每批创建、使用、保全和清理的完整过程；目录变旧、Git 干净或名称含有 `cache` 都不能单独证明可以删除。

| 对象 | 保存位置与保留条件 | 收尾动作 |
| --- | --- | --- |
| 源码与工作树 | 主目录保持开发入口；一批一个执行工作树，提交和锁文件提供恢复来源。未完成故障/验收的工作树登记保留原因。 | 集成、验收及独有内容保全完成后，及时用应用管理工具归档或 `git worktree remove` 移除本批工作树。不能归档的管理工作树保留登记和源码，只清理确认不在用的本批缓存。 |
| 依赖与构建目录 | 当前环境保留可用依赖；优先复用包管理器的内容缓存。额外隔离依赖只在验证需要时创建。 | 删除不再使用的安装副本、构建输出及隔离依赖；保留锁文件和环境记录。共享依赖按下述引用检查保护。 |
| 临时程序与合成数据 | 新任务统一使用 `archive/<任务>/scratch/`；工具需要时仅对子进程设置 `TEMP`/`TMP`，不改用户全局环境。 | 验收完成且结果已归档后清除本批解包程序、下载暂存、浏览器合成 profile 和可重建测试数据。失败仍未定位、含真实数据或来源不明时登记保留原因。 |
| 候选安装包 | `releases/candidates/<版本与用途>/` 是规范副本；同一内容按 SHA256 识别，不能仅看文件名。 | 当前稳定版、上一稳定版、各在用预发布通道最新候选及明确需要的在测/诊断版本保留。其余已公开包通过发布服务元数据确认资产可恢复后移除本机实体，保留来源、通道、大小及哈希。未公开且唯一的候选不按旧日期直接删除。 |
| 发布暂存与历史副本 | `desktop/release/`、`releases/latest/`、`history/` 及公开资产暂存仅按脚本实际需要使用。 | 在对应检查、上传和恢复用途结束后，将相同哈希副本归并到规范位置，登记引用；不得为了提前去重破坏正在使用的发布路径。 |
| 验收与故障证据 | 每批一个归档入口，保存最终结论、验证基线、命令/环境、必要日志、关键截图、文件清单及哈希；失败保留最小复现输入。 | 相同证据只保留一份并由索引引用。可重建的成功测试环境保留生成脚本、种子和断言结果；不保留每次重试的整套程序、依赖和 profile。不可重现或仍待复核的故障保留原始材料。 |
| 业务与用户文件 | 真实数据库、ERP/1688 收件和检查点、业务表格、用户导出、凭据及唯一备份沿用业务保护规则。 | 不进入开发缓存保留期限或按版本淘汰规则；删除必须有针对具体数据的用户授权。 |

新任务不得把活动工作树的依赖链接指向 `scratch/` 或证据归档。确需共享时，将稳定目标及使用方写入本批忽略的产物索引，记录锁文件哈希；使用方结束后再判断目标是否可清。既有指向归档的依赖先视为受保护，迁移需核对锁文件和使用方构建，不能先删后修。

删除目录前，检查活动工作树及登记使用方的 junction/symlink，解析真实目标并核对祖先目录；不能只检查待删路径本身。目录链接仅解除链接，不递归进入目标；目标被任何活动环境使用时保留。未提交文件和忽略目录中的独有材料必须先确认去向，不能把一份新建的全树副本当作默认保全办法。

每批按以下顺序执行：

1. **开始**：核对现有工作树和可用空间，在本批忽略索引记录临时目录、规范候选、保留项及共享依赖关系。先复用；确需隔离或多个候选时写明用途。
2. **执行**：复用同一候选已通过的验证和同批暂存，失败重试只增加必要诊断。单批可重建产物超过 5 GiB，或 C 盘可用空间低于 30 GiB 时，先收敛本批无用产物；必要占用写明原因，不扩大为全盘清理或自动删除其他任务内容。
3. **验收**：把通过结果及必要失败证据归档，登记候选、源码提交和恢复来源。正在定位的问题或等待用户操作的验收环境保留，不为完成清理而关闭未决任务。
4. **收尾**：完成本批范围内无需重复确认的安全清理，归档工作树，核对保全哈希和当前依赖；必要时补验被影响的使用方。只读文档任务核对差异和链接，不生成新候选。
5. **交付**：简短报告清理结果、仍保留的例外及原因、可用空间。跟踪文档只记录规则和结论，本机绝对路径、完整文件清单及详细删除日志留在忽略归档。

以上是按开发批次执行的工作规则。尚未实施后台定时清理或自动删除程序，不将这份规划描述为已部署的软件功能。

## 历史材料与回退

目录整理先记录原 HEAD、分支、Git 状态、文件哈希和恢复来源。原始未提交内容及本机独有材料保存在本机忽略归档中；已有主线版本的文件保留一份当前入口。

工作树的 Git 状态干净只说明没有可见未提交内容，忽略目录仍可能包含候选、故障证据、真实数据或唯一备份。应用管理的工作树使用管理工具归档；手动工作树核对保全后使用 `git worktree remove`。不自动删除其他对话的工作树，不能用普通文件删除代替 Git 工作树管理。

移动独立项目时核对完整文件和目录清单，保留原始快照，更新必要的绝对路径说明并验证本机入口。不要借整理扩大业务范围、修改用户配置或真实数据库，也不要提交本机保全文件。

纯文档和工作区整理检查差异、当前链接、保全哈希和适用的迁移入口；远端必需 CI 仍须通过，不启动桌面候选、不安装、不创建软件版本。
