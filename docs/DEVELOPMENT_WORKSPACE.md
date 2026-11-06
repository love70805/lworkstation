# Lworkstation 开发指南

项目目标、业务口径与授权边界以[项目约束](../AGENTS.md)为准。本页给出在当前 Windows 桌面项目里执行这些决定的方法。

## 开发入口

1. 阅读[当前看板](CODEX_TASK_BOARD.md)，运行 `node tools/development-context.mjs`，核对目录、分支、HEAD、源码版本和未提交内容。摘要中的 `origin/main` 是本机缓存。开始实现前用 `git ls-remote origin refs/heads/main` 或用户指定的提交确认基线。旧检出可直接阅读[主线规则](https://github.com/love70805/lworkstation/blob/main/AGENTS.md)和[主线看板](https://github.com/love70805/lworkstation/blob/main/docs/CODEX_TASK_BOARD.md)。
2. 先读相关实现、调用方和现有测试。跨模块先写清输入、归属、写入方和验收信号。目标、基线及结果简记在看板、同批集成文档或 PR。只读核对与纯文档工作可直接检查差异和来源。
3. 小修可用当前目录。中大型或发布批次复用合适的独立工作树和 `codex/` 分支，每批一个执行树。优先用应用管理目录，手动创建时用 `.worktrees/<任务>/`。纯文档整理复用已有目录。跨工作区成果通过提交和 PR 集成。

需要开发环境时按锁文件安装 `frontend` 和 `desktop` 的依赖。使用 `pnpm --dir desktop dev` 启动本机开发版。协作审查在仓库的固定入口阅读最新回复，追加自己的署名材料并更新索引。临时协作限独立调查、实现或交叉审查，同一文件由一方编辑。项目规划使用看板，创建新对话或 GitHub Issue 依用户明确要求。[贡献说明](../CONTRIBUTING.md) · [协作审查入口](agent-discussions/README.md) · [可选技能](CODEX_SKILLS.md)

## 常用定位入口

| 使用场景 | 页面与实现 | 合适的核对点 |
| --- | --- | --- |
| 导入、选择月份和店铺 | `/workspace`、`/ledger`、`/import-preview`，`frontend/src/pages/ImportPreview.jsx` | 月份识别、SKU/SKC 对应、店铺范围、重复导入与覆盖范围。 |
| 正式成本与月度利润 | `/profit` 统一展示明细和成本核对，旧 `/cost-matching` 链接转入该页。`frontend/src/data/repositories/profitRepository.js` | 从台账和 ERP 任务追到回执、本机采用及利润。检查人工优先、可撤销、零值、异常处置与缺失值。 |
| 报告导出与历史 | `frontend/src/data/repositories/profitReportRepository.js`、`frontend/src/pages/MonthlyReportManager.jsx` | 调整后当月重算，旧状态账本也可导出。历史文件与来源快照能独立重读。 |
| 商品资料与选品 | `/products`、`?view=reference` 预存区、`?view=pending` 历史采集资料。`frontend/src/data/repositories/selectionRepository.js` | 导入为新 SKU 建最小草稿，保留台账自带且一致的属性。需要时使用已有对应关系补齐档案，保留人工资料。参考采购价留在选品域。`selectionCatalogUtils.js` 仅放无副作用的归一化工具。 |
| 本机数据与桌面 | `frontend/src/data/repositories/workspaceRepository.js` 管备份、恢复和诊断。`desktop/` 管远程页面隔离、收件传输和更新 | 复核工作区、来源、请求与证据。桌面传输后由工作台审核和采用正式成本。 |

`frontend/src/data/db/clientDatabase.js` 统一定义 Dexie 表和追加式迁移。`frontend/src/data/database.js` 保留旧导入接口，业务实现归对应 repository。页面样式放在 `frontend/src/styles/` 的模块文件，保留 `frontend/src/styles.css` 的导入顺序。跨模块字段先更新对应领域契约和测试，再接入页面、桌面或 ERP。

## 金额、历史和真实数据

- 两种核算方式本地复用一次取得的完整历史。全历史最低成本跨采购月份，使用归属相符、有效且未取消的正单价，允许 1 元以及异常高低的正价。本规则与人工更正可为零的口径分别适用。各方式的调整与导出范围见[项目约束](../AGENTS.md)。新模式读取初值与独立写入是两件事，已核实的差异单列在[任务看板](CODEX_TASK_BOARD.md)。
- 旧库读兼容通过读取和投影处理，当前账本按最新有效数据计算，导出快照保留当时来源。迁移追加版本，用隔离数据验证，涉及真实库时执行已授权的备份与回退方案。
- 产品中的“清空本机工作区”由用户输入文字确认后直接清除业务库、桌面收件与任务及其证据和旧格式副本、成本草稿、货号组与店铺筛选。此操作跳过自动备份，保留用户导出、账号凭据、外观和桌面设置。开发目录清理不能调用该入口。
- 业务 Excel、数据库、备份、`.env`、Cookie、Token、ERP 登录信息与私有材料不得提交。用户指定的非公开操作细节同样不得进入公开文档、PR 和发布说明。

## 每批工作记录与验证

| 改了什么 | 怎么验证 |
| --- | --- |
| 文档、规则 | 检查差异、链接、引用入口和相互矛盾的条款，执行仓库必需 CI。 |
| 页面或隔离逻辑 | 先跑相关测试和真实用户路径。界面检查中文、相关浅深色和窗口宽度，默认 headless。 |
| 金额、持久化或共享契约 | 用隔离数据覆盖归属、边界值、人工优先、撤销、快照、重试及中途失败。根据影响扩大回归。 |
| 桌面、更新或安装 | 针对受影响的行为运行 `pnpm --dir desktop verify` 和适用的 smoke。托盘、焦点或最小化需要真实窗口时先说明，由一个任务集中验证。 |

完整前端验证可用 `pnpm --dir frontend test` 和 `pnpm --dir frontend build`。以同一源码、候选及测试覆盖为依据复用通过结果。失败、代码变动或新增风险才补验相应范围，已读测试与实际运行结果分别记录。

## 软件发布

按核实的当前版本和用户指定的目标选择版本号。同批小修只递增一次补丁号，已公开的同号资产保留，稳定、Beta 和 RC 各自核对对应更新清单。常规发布一轮构建，按变更影响验证候选，将安装包与更新清单的校验值对应，再核对 GitHub 返回的标签、通道和资产上传状态即可。候选验收、代码合并和实际公开分别记录，可沿用同批 PR、看板或 Release。发布后的公开下载回读可省略。[发布状态](RELEASE_STATUS.md) · [候选登记](../releases/README.md)

## 开发产物保留与收尾

- 临时文件集中在忽略目录 `archive/<任务>/scratch/`，必要的复现输入、日志及截图留在同批归档。规范安装包在 `releases/candidates/<版本与用途>/`，同一 SHA256 只保留一份长期实体。
- 保留当前及上一稳定版、每个在用预发布通道的最新候选，以及仍在排查的版本。清理其他已公开安装包前，用发布服务元数据确认可恢复，保留来源和哈希。
- 删除前核对绝对路径、归属、未提交内容、恢复来源和在用引用。共享依赖使用包管理器缓存或稳定工具目录。检查工作树的 junction/symlink 及真实目标，解除链接和删除目标分开处理。业务数据、用户文件、未解决故障证据及其他任务的工作树均受保护。
- 只清本批已确认无用的缓存和合成环境。工作树确可归档时，应用管理树走管理入口，手动树用 `git worktree remove`。受保护或仍有独有材料时保留并说明。收尾记录合并进同批交付，有例外才单列。

## 历史材料与回退

已交付的版本事实查[开发历史](DEVELOPMENT_HISTORY.md)与[发布记录](RELEASE_STATUS.md)。旧产品规格、云端设计、版本验收和协作原文供追溯。回退代码或整理旧检出前，先核对提交、未提交和忽略文件，保留唯一恢复来源。
