# Codex 任务看板

这份文件是跨电脑、跨账户继续开发时的项目级任务入口。Codex 对话本身不会写入 GitHub，因此新设备上应根据本看板重新创建任务对话。

## 当前基线

### 2026-09-10 0.2.10 更新实施中

用户已批准执行成本回传、人工更正、经营首页整合、安装路径向导与版本弹窗更新。合同见 [0.2.10 更新任务包](integration/UPDATE_0.2.10.md)。当前公开版仍为 0.2.9，以下旧版记录不代表新候选已完成。

- 代码基线：`3d364acddeb1a3894a0950ef2ffa48216080929c`；主线准备分支 `codex/release-0.2.10`，Worktree `.worktrees/release-0.2.10/`。
- 利润与 ERP（`01a07ff8-148a-7bc3-b8ee-2b4458a60878`）负责回传协议、草稿/接收、复制导入、人工更正/撤销、精确核算、同步适配及可嵌入利润内容。
- 桌面化（`01a08103-9373-70e0-89dc-746707e8bd40`）负责安装向导、版本弹窗，并承接合同指定的 AppShell/App/WorkspacePortal 组合适配。全局 UI 专职在本机不可用，不新增长期任务；本次跨模块原因及文件所有权见合同。
- 合并依赖：利润公共出口/数据合同先于首页组合适配；各自独立提交、主线审查。旧 1688 审批不自动提升为正式成本，已定稿快照不变；不执行线上迁移。
- 验收：frontend test/build/release:check、desktop verify 与 packaged/update/installer smoke，以及合同内合成端到端、桌面/窄屏视觉。当前仅实施开始，未测试交付、未发布新版本。

- GitHub 仓库：`love70805/lworkstation`
- 集成分支：`codex/selection-profit-erp-sync`
- beta.7 发布代码提交：`40e4da8`；发布记录提交：`46792e5`。后续维护以集成分支当前 HEAD 为准，PR 状态以 GitHub 实时记录为准。
- 本地开发地址：`http://127.0.0.1:5173`
- 仓库正式版号及公开 Latest：`0.2.7`；发布标签基线：`b223fb7`；本机安全 QA：`0.2.6-beta.8`（独立应用身份，未公开发布）
- 发布状态入口：`desktop/release-plan.json` 与 `docs/RELEASE_STATUS.md`

## 2026-09-08 0.2.7 更新通道发布

- 主责桌面化任务 `01a08103-9373-70e0-89dc-746707e8bd40` 交付 `ac61143`，主线审查承接 `33fc968`；PR #30 / #31 合入集成 `b223fb7`、main `623afc9`。
- 稳定检查默认开启，新 Beta 构建严格同通道；禁止跨通道/降级，下载和安装仍显式操作。旧 beta.7 需后续新 Beta 手工迁移，本轮未发布新 Beta。
- 532 测试、生产构建、desktop verify、packaged/update smoke、真实稳定下载、实际隔离安装与数据保留、main CI、404 载荷文件哈希及 GitHub 资产回读通过。[v0.2.7](https://github.com/love70805/lworkstation/releases/tag/v0.2.7) 已公开 Latest；细节与边界见 [发布验收](RELEASE_0.2.7.md)。
- beta.8 QA 快捷方式已补，临时升级验收安装已卸载；正式安装、旧 QA 及快捷方式哈希未变。

## 2026-09-08 0.2.6 稳定版发布（历史记录）

- 安全修复、Dependabot 更新、对外名称统一及同月多店铺批量台账导入已完成测试、审查和集成；批量导入经 PR #22 / #23 合入集成分支与 main。
- 发布准备及实际包记录经 PR #24–#27 合入。77 文件 / 532 测试、生产构建、桌面 verify、正式 packaged smoke、404 个安装包内文件哈希比对、发布检查通过。
- [v0.2.6](https://github.com/love70805/lworkstation/releases/tag/v0.2.6) 已公开为 Latest 稳定版，四个资产下载回读一致；稳定自动更新关闭，手工安装。验收边界与产物哈希见 [发布验收](RELEASE_0.2.6.md)。

## 2026-09-08 名称与 0.2.6 元数据审查候选（历史记录）

- 分支：`codex/branding-0.2.6`；基线：集成分支 `a4ad756`。本机原有 57 个未提交文件已逐项备份并核对 SHA-256，原工作区未改动；通过三方补丁迁移，保留安全修复、工作区治理和 Dependabot 更新。
- 跨模块原因：仅同步用户可见名称、帮助文档、错误提示和必要版本元数据，不改变业务逻辑。桌面版本为 `0.2.6`；包名、appId、协议、数据库、存储键、备份/同步格式、桥接 API 和扩展版本均不变。
- 当前源码附带的 ERP v8.0.16 ZIP 仅同步名称：39,884 bytes，SHA-256 `F4A3EDCE17B2C42481F3FD1E3C72A818D7C6BEFADE45C3BDA960A8D22C113886`。1688 v1.2.1 ZIP：40,388 bytes，SHA-256 `6621E2201EEFF09F227C2836DA2F26A50E100D6BAF952001D4DC2EBA18A1D8F1`。沿用本机已有 ZIP，22 个文件与解压源码逐项一致；本轮未重新生成仓库下载包，也未覆盖 GitHub Release 资产。
- 验证：按最新锁文件安装依赖，前端 74 文件 / 516 测试、前端生产构建、desktop verify 全部九个脚本、ERP bridge、ERP inbox 和 1688 扩展测试通过。使用 Node.js 26.8.1 / pnpm 11.16.0；测试因 npm 启动审批超时改为直接执行 package scripts 对应的本地入口。
- 遗留：前端构建仍有大 chunk 提示，测试有 Node localStorage 实验性提示；未做本轮浏览器视觉、真实 ERP/1688 账号、安装覆盖和真实更新验收。同版本扩展 ZIP 的名称变更不会触发扩展版本升级，已安装扩展需后续交付时重新加载。
- 交付边界：仅提交分支及草稿 PR 供项目主线审查；不合并、不构建安装包、不发布 Release、不启用稳定更新通道。下方安全验收及历史扩展哈希保持当时记录，不代表本候选已完成安装验收。

## 2026-09-08 工作区治理与发布清单

- 安全修复的 66 个本机产物与验收文件已逐项核对 SHA-256，归档至主仓库 `archive/security-hardening-2026-09/`；候选包、报告和隔离启动入口集中至 `releases/candidates/0.2.6-beta.8-security-qa/`。临时 Worktree 按归档、未提交内容检查、Git 注销的顺序收口，保留必要分支与修复提交。
- 后续临时 Worktree 使用应用管理目录或主仓库 `.worktrees/`，不再新增桌面同级目录；规范以 `AGENTS.md` 为准。
- [版本清单](../releases/README.md) 已补上仅本机验收的 beta.8 QA。GitHub Releases 回读结果仍为公开 beta.7；本次目录治理没有创建公开 Release、覆盖既有资产或改变正式应用更新源。

## 2026-09-07 集成维护验收

- 安全修复经 [PR #1](https://github.com/love70805/lworkstation/pull/1) 合入集成分支 `f68ee37`，经 [PR #2](https://github.com/love70805/lworkstation/pull/2) 合入 `main` 的 `3dc1448`，Linux/Windows 必要 CI 与主分支合并后 CI 均通过。前端 73 文件 / 510 项测试、完整发布检查、桌面 verify 通过；两端依赖审计、GitHub 开放依赖安全告警和 secret 告警均为 0。两条分支已开启 PR/CI 防护，Dependabot 已开启。范围、数据权限契约、删除后审计保护和验收记录见 [安全修复与验收](SECURITY_HARDENING_2026-09.md)。
- 用户指定的本机 Windows 隔离安装验收已通过：旧版 beta.7 首装、beta.8 QA 同目录覆盖、新旧版实际重启成功，合成 IndexedDB/localStorage 数据及外观/缩放偏好保留。正式 beta.7 程序与注册项复核未变；安装报告和复用启动入口见安全验收记录。未公开发布安全候选或执行线上数据库迁移。

### 同日安全修复前的集成维护（历史记录）

- 范围：质量工作流增加集成分支 push 触发与 Windows `desktop verify`；发布文档统一 Beta 构建、归档和更新夹具说明，旧候选与旧回归标记为历史记录。业务代码、公共 contract、数据库与发布版本未变。
- 本机验证：Windows，Node.js `24.20.0`、pnpm `11.25.0`；`pnpm --dir frontend release:check` 通过（71 个测试文件、493 项测试、生产构建、ERP bridge/inbox、同步与部署门禁），`pnpm --dir desktop verify` 通过。补丁完成后复核工作流 YAML、锁文件路径、文档链接、夹具版本，以及 desktop 静态验证与部署检查，均通过。
- 验收边界：新增 GitHub Windows job 尚待推送后执行；CI 使用 Node.js 22、pnpm 11.16.0。本轮未构建安装包或执行打包 smoke，未做真实 ERP/1688 账号、安装更新及页面视觉验收；这些项目仍按发布状态文件单独验收。

## 集成契约与历史记录

### ERP 原始证据与正式成本职责调整

- 主责实现：原始证据职责调整从 `039ba21` 起步；精确回传、证据合同、自动载入与恢复链路最终收口于 `18d4bd4`，由项目开发主线合并为 `ef6cd14`。
- 总控范围：公共 `erpCostBatchEnvelope`、`erpBridgeContract`、ERP inbox payload 与 `profitRepository` 发布契约的审查、合并和完整回归。
- ERP 扩展职责：只采集、提示异常、预览并回传完整原始证据；异常不得阻止复制、导出或回传，扩展不得确认、修正或发布正式成本。
- Lworkstation 职责：`CostMatching` 负责 median/MAD 异常检测、修正、真实价确认和审计；repository 独立复算，并阻止未处置异常、零价或篡改成本发布。
- 成本口径：正式成本继续使用最近最多三次有效采购记录按数量加权；全部有效历史只用于异常基线；ERP 正式、1688 参考的业务口径不变。新产生的 ERP/1688 单件成本、采购成本、仓储、扣款、利润与利润率统一直接舍弃小数点后两位，不四舍五入；已结算历史数据保持原值。
- Contract 状态：ERP batch envelope `formatVersion: 2`，inbox transport v2；`requestId + ledgerId + 完整 SKC 集合` 必须精确匹配。同一仓库 SKU 可共享给多个平台 SKU/SKC；当前账本使用的行标记为 `ledgerScopeRole: expected`，同查询 SKC 下但本账本未使用的额外变体标记为 `auxiliary`。辅助变体只保留预览与审计，不参与匹配兜底、证据完整性阻断或正式成本发布。任一层 v1 均只按 `legacy_partial` 预览；非法警告、重复证据身份、无效币种或负成本在落盘前拒绝，正式发布必须使用完整 v2 `warehouseEvidence`。
- 集成结果：利润/ERP 最终链路 `18d4bd4`、ERP 证据归属修复 `e216f29`、桌面 packaged smoke 适配 `0f00b4f`、1688 心跳兼容修复 `92d10ac`、ERP 复制回退 `b4b4859`、未映射证据折叠 `dc75782`、证据状态区分 `b5e2682` 与共享仓库映射修复 `8020c8e` 已合入集成分支；`0.2.5` 正式发布提交为 `9f002fb`。
- ERP 职责调整阶段回归（历史记录）：当时 60 个前端测试文件、317 项测试、前端构建、ERP bridge/inbox/result-policy、desktop verify/inbox 生命周期与发布产物夹具通过。该记录不代表当前 HEAD 的验收结果；当前版本的发布门禁与待验收事项见 `docs/RELEASE_STATUS.md`。
- 软件内更新：`acacf2e` 已加入受控更新状态机，`a412684` 隔离更新 smoke 缓存；beta.1 至 beta.7 已公开为 GitHub prerelease，`autoDownload=false`、`autoInstallOnAppQuit=false`，发现更新后仍由用户确认下载并显式重启安装。beta.6 的已发布安装包未启用 beta 更新源，须手工安装 beta.7 一次；beta.7 之后继续使用 beta 通道更新，稳定源默认关闭。
- `0.2.5` 历史交付：安全壳、ERP/1688 内置扩展、ERP 成本复制回退、未映射证据折叠和证据不完整原因/补齐指引已纳入后续版本；桌面层不执行异常判断、人工确认或正式成本发布。
- 历史集成提交：全局 UI `edac462`、桌面壳 `d112b08`、利润/ERP `18d4bd4` 与桌面 smoke `0f00b4f`。当前发布检查所需提交以 `desktop/release-plan.json` 的 `requiredCommits` 为准。
- 安全验收时推荐 ERP Assistant：`v8.0.16`，38,999 bytes，SHA-256 `CD5D824B61A71DCBE31D780E2BE0031D4564654B5674C7500326D0DECDEFDD53`，新增 CSV 公式安全处理。历史 `v8.0.15` 归档未变：38,645 bytes，SHA-256 `EDA7774D60791FCAF02AA25D47645E4C39A578C2656DED7BC1BE36FB0EDB900C`，包含采购页 iframe 注入和 DOM 替换后恢复核算按钮。
- beta.7 安装包已发布：`Lworkstation-Setup-0.2.6-beta.7.exe`，88,799,017 bytes，SHA-256 `753A8C876C77D021AA633F8EF3076E7B93D50511A27AAC5D11D4EBAFB1E85560`。beta.6 不能替换已下载的同名资产，需手工安装 beta.7 一次，之后从 beta 通道接收后续软件内更新。
- 历史 UI/桌面集成：全局 UI `ca4ceda`、桌面壳/缩放 `15c8db5`、Windows 品牌与图标 `cf3c36a`、发布与偏好恢复加固 `3657664`、发布定位文档 `b9936d2` 与 `5acae7d` 已合入并纳入后续发布。旧 `0.2.5` 本地候选不再列为待发布版本；下一候选统一以 `docs/RELEASE_STATUS.md` 为准。
- 待人工验收：真实 ERP 登录态跨重启、采购页扩展注入、真实分页、SKU/SKC/仓库 SKU 映射、供应商与 1688 链接、真实 `warehouseEvidence` 完整性。
- 路由规则：仅在 contract 改变选品参考读模型或共享视觉组件时，按受影响范围通知选品或全局 UI 对话。

## 任务分工

### 选品工作台

范围：商品档案、平台 SKC/SKU、多供应商、1688 链接与图片、售价、销售状态、参考成本和参考利润。

验收重点：SKU 全局唯一；SKU 可并列展示属性；ERP 历史成本优先显示；1688 只标记为参考；不会改写月度正式利润。

### 利润核算与 ERP

范围：台账导入、供货方号多选、SKC/SKU/属性/数量/金额解析、ERP 成本抓取、回传、缓存、人工输入和月度定稿。

验收重点：严格遵循 ERP 正式成本口径；成本来源可追溯；分页抓取结果可校验；筛选条件可记忆；误触重新核算有确认。

### 全局 UI 与导航

范围：侧边栏、返回逻辑、页面宽度、响应式、工作区总览、弹窗、按钮反馈、加载和错误状态。

验收重点：中文界面；桌面/移动端不白屏、不溢出、不重叠；主分支不显示返回，小分支可返回；入口和目标页面一一对应。

### 桌面化与内置浏览器 POC

范围：`desktop/` Electron 宿主、桌面壳导航、ERP / 1688 `WebContentsView`、持久浏览分区、受控外部打开、扩展兼容状态和桌面验证脚本。

不修改：`frontend/` 业务页面、ERP inbox transport、月度账本、正式成本策略和利润计算规则。桌面层只能预留受控采集桥接接口，不能直接写入或覆盖成本数据。

验收重点：开发命令显示现有工作站；ERP、1688 可分别打开/切换/刷新/前进/后退并在重启后保留登录会话；1688 站内新窗口在当前受控标签中打开；非活动视图从窗口视图树移除，异常只显示状态栏且不能覆盖工作站；远程页没有 Node 或文件能力；导航、弹窗和权限受宿主白名单限制；扩展加载结果明确可见且失败不影响工作站；自动更新检查通过可配置 HTTPS 静态源运行且客户端不保存仓库令牌；运行 `pnpm --dir desktop verify` 和 packaged smoke，并完成 README 中的手工检查。

扩展兼容记录：当前对 `erp-assistant-extension` 和 `1688-selection-extension` 使用 Electron 44 的 `session.extensions.loadExtension()` 加载解压 MV3 目录。ERP 的 MAIN world 内容脚本、1688 的 service worker / action popup 仍需在真实 ERP 和 1688 登录页做运行时确认；不兼容时记录状态，不回退到无提示白屏。

## 总控流程

### 主线职责与边界

- 项目主线负责与用户确认需求、作出产品/业务/架构/发布决策、复现和定位 Bug、定义公共 contract、拆分任务、制定验收标准与合并顺序。
- 项目主线负责审查专职提交、退回不合格实现、解决机械性合并冲突、执行最终集成回归、合并、推送、打包和发布。
- 项目主线默认不实现选品、利润与 ERP、全局 UI 或桌面化功能代码。公共 contract 由主线设计并指定最相关的专职对话实现；其他专职对话分别适配。
- 主线只直接维护发布元数据、集成状态文档和机械性冲突。发布被极小问题阻塞时，必须先取得用户明确授权，才能直接修改专职模块代码。

### 专职交付流程

1. 主线完成需求确认或 Bug 根因定位，生成包含根因/目标、范围、非目标、业务约束、代码基线、contract、验收标准和验证命令的任务包。
2. 单模块任务自动发送给唯一主责专职对话；跨模块任务由主线定义 contract 和依赖顺序后分别派发，不要求用户重复批准转交。
3. 专职对话从最新 `codex/selection-profit-erp-sync` 开始，只修改对应范围并运行定向测试。
4. 专职对话形成独立 Conventional Commit，并报告提交号、修改范围、测试、风险、contract 变化和主线承接事项，然后停止等待审查。
5. 主线执行 Spec/Standards 审查；不通过的提交退回原专职对话修订，通过后按依赖顺序合并到集成分支。
6. 主线统一运行完整测试、构建和必要的 packaged smoke，通过后再推送、合并到 `main` 或发布。

### 临时子智能体规则

- 普通任务同时最多 1 个；跨模块审查或发布最多 2 个。完成后立即结束，不长期保留。
- 默认用途是只读复现、根因调查、Spec/Standards 审查、contract 对比和测试分析。
- 只有单模块、少量文件、无业务规则/公共 contract/数据库变化且具备明确复现与测试的小型 Bug，才可交给临时子智能体修复。
- 存在可用专职对话时优先派发专职对话；临时子智能体修复必须形成独立 Conventional Commit，再由主线审查合并。

### 发布状态规则

- 对话消息只同步任务意图，不代表代码已经合并，也不代表版本已经发布。
- 专职 Worktree 只交付提交号和模块验收结果；其 `desktop/release/` 产物一律视为预览包。
- 官方安装包只能从 `codex/selection-profit-erp-sync` 主 Worktree 构建。
- 主线发布前必须更新 `desktop/release-plan.json`。Beta 使用 `pnpm --dir desktop release:build`，稳定版使用 `pnpm --dir desktop build`；构建与相关 smoke 通过后，依次运行 `release:organize` 和 `release:check`。Beta 归档至 `releases/prerelease/<版本>/` 并检查 `beta.yml`；稳定版维护 `releases/latest`、`releases/history` 并检查 `latest.yml`。发布检查同时核实分支、必需提交、版本、安装包、blockmap 与 SHA-256。
- 只有 `docs/RELEASE_STATUS.md` 记录为已验证且发布检查通过后，主线才能向用户报告“已发布”。

## 对话路由表

| 用户需求 | 主责对话 | 需要广播的典型情况 |
| --- | --- | --- |
| 商品档案、SKC/SKU、多供应商、1688 参考成本 | 选品工作台 | 需要 ERP 历史成本或共享采集 contract 时通知利润/ERP与总控 |
| 台账导入、月度利润、ERP 正式成本、成本回传 | 利润核算与 ERP | 改动选品参考读模型或桌面桥接时通知对应对话与总控 |
| React 工作站导航、页面布局、响应式、设计令牌 | 全局 UI 与导航 | 同时影响 Electron 外壳视觉规范时通知桌面主线 |
| Electron 外壳、内置 ERP/1688、扩展加载、安装包 | Lworkstation 桌面化主线 | 需要业务页面或数据 contract 配合时通知对应业务对话与总控 |
| 数据库迁移、公共 contract、云端同步、跨模块决策 | 项目开发主线总控 | 主线定义 contract 和顺序，再分别派发给受影响的专职对话 |

执行协议：需求确认后，单模块任务自动发送到主责对话并向用户报告去向；跨模块任务由项目主线保留总控、定义 contract、拆分任务并安排合并顺序。转发内容必须包含用户原始需求或确认后的目标、代码基线、影响范围、不可改变的业务口径、验收标准和验证命令。对话之间通过消息同步意图，通过独立提交与集成分支同步代码，不能假定不同 Worktree 会自动获得彼此提交。

## 当前任务结构

项目侧边栏只长期保留五条任务：`项目主线`、`选品工作台`、`利润与 ERP`、`全局 UI`、`桌面化`。一次性说明、重复讨论、旧版 love7 与 ERP Assistant 分析任务完成后统一归档，不删除历史内容。主线保持唯一置顶；专职任务只在收到新分派时恢复。临时子智能体不替代长期任务，返回诊断或独立提交后立即结束。

## 模块化基线

为降低并行 Worktree 的合并冲突，当前集成分支已建立以下物理边界：

- 数据库版本与 Dexie 表结构：`frontend/src/data/db/clientDatabase.js`
- 选品与采集：`frontend/src/data/repositories/selectionRepository.js`
- 利润、月度台账与 ERP 成本：`frontend/src/data/repositories/profitRepository.js`
- 备份、恢复、云种子与诊断：`frontend/src/data/repositories/workspaceRepository.js`
- 兼容入口：`frontend/src/data/database.js`，只做 re-export，不新增业务逻辑
- 全局样式入口：`frontend/src/styles.css`；实际页面样式位于 `frontend/src/styles/`，导入顺序即级联顺序

修改规则：新功能直接写入对应 repository 或样式模块；只有数据库迁移、公共契约或跨模块字段才允许触碰多个边界。跨边界修改必须在提交说明中列出影响范围，并至少补充一条对应 contract/integration 回归测试。

## 新任务模板

```text
项目：Lworkstation 经营管理工作台
基线：codex/selection-profit-erp-sync
任务范围：
不修改：
业务约束：先阅读 AGENTS.md 和 docs/CODEX_TASK_BOARD.md
验收标准：
验证命令：pnpm --dir frontend test && pnpm --dir frontend build
完成后请汇报：改动文件、测试结果、潜在回归、需要总控处理的接口
```


## 2026-09-08 Dependabot 集成

用户授权合并 #4–#12，主线保留原始提交并统一回归；范围、版本和验收记录见 [依赖更新集成验收](DEPENDABOT_2026-09.md)。本轮不变更业务 contract 或发布版本。

## 2026-09-08 同月多店铺批量台账导入

用户已批准：一批一个月、一文件一店铺、多文件统一预览、明确重复和覆盖、整批事务写入、已定稿保护。金额口径为销售原额。主线 contract、基线、任务边界和验收见 [批量导入任务包](integration/BATCH_LEDGER_IMPORT.md)。当前处于 contract 已准备、实现待分工状态；本机未发现可复用的利润与 ERP 专职任务。

### 专职任务已建立并接单

2026-09-08：用户授权建立长期任务‘利润与 ERP’，任务 ID 01a07ff8-148a-7bc3-b8ee-2b4458a60878。已在应用管理的 f861/Lworkstation Worktree 开始实施，分支 codex/profit-batch-ledger；同步集成基线 77b839f 后承接 contract 9380ec0（专职分支对应提交 5b8edf0）。主责 ImportPreview、利润 repository、导入 Worker/client、局部导入样式和测试；其他业务任务不受影响。按 BATCH_LEDGER_IMPORT.md 完成防重复、覆盖确认、整批事务、定稿保护和多文件浏览器验收，交付独立提交，由项目主线审查、完整回归后集成。此前‘实现待分工’状态已结束，目前实施中。

### 批量台账导入主线验收通过

利润与 ERP 独立交付 964f395，主线承接 c35593b；主线 Spec/Standards 审查、77 文件 / 532 项测试、前端完整 release:check 与 desktop verify 均通过。四格式四店专职浏览器验收及主线独立双文件实际入账通过，记录见 [批量导入任务包](integration/BATCH_LEDGER_IMPORT.md)。当前进入 GitHub PR 集成；未打包、未发布。专职停止实现等待审查结果。

## 2026-09-08 ERP 微小单件成本与窗口化修复

用户确认低于一分钱是真实采购价，已批准正式 ERP 单价四位、先精确累计最后截断。合同和验收见 [微小成本与窗口修复](integration/COST_WINDOWED_FIXES_2026-09.md)。利润与 ERP 承接 02a76aa 基线，主线负责合同/审查/集成；已定稿快照保持原值。窗口布局提交 d1bc55d 已通过 532 项测试与构建，成本实现和最终集成待完成。此新规则在实现并发布后取代上方历史记录中的 ERP 两位单价口径，不修改 1688 参考算法。


### 微小成本修复主线验收通过

利润与 ERP 的 92badfa/e82a077 已审查并承接 ef734cd/2d83e60；选品四位显示 dc68a0a 与窗口布局 d1bc55d 已集成。最终 80 文件/552测试、构建、ERP/同步/数据库/部署门禁、desktop verify及主线合成发布—定稿—导出—历史快照保护验收通过。详情见上述合同记录。进入GitHub PR集成，未打包发布，0011未执行线上迁移。


## 2026-09-09 正式版重复启动防护

用户确认0.2.7单实例正常、重复启动第二个实例报成员初始化UnknownError。桌面化从8292c25交付010d285，主线承接2b02063；在业务初始化前获取同userData单实例锁，重复启动唤回已有窗口。11组desktop verify与主线真实双进程/窗口恢复/不同profile并行/异常重启smoke通过。范围及原数据保护证据见 [桌面单实例验收](integration/DESKTOP_SINGLE_INSTANCE_2026-09.md)。进入PR集成，未发布安装包；原版保持只开一个实例即可。


## 2026-09-09 稳定版 0.2.8 发布与本机安装完成

上述微小成本与窗口修复、重复启动防护已通过 PR #34–#39 集成并统一发布为 0.2.8。主工作区构建标签 8591b5191e5489d87e7d12f4892f29f9f397e2b1，main 099dcc8570559f19020c914be490223f91b1de54 文件树一致。552 项测试、桌面/更新/打包 smoke、公开四资产匿名下载哈希和本机 0.2.7→0.2.8 覆盖安装/重启/业务数据指纹/重复启动验收通过。此前“进入集成、未发布”的记录属于历史阶段。云端 0011 未线上执行；正式与 QA 数据隔离保持原样。详见 [0.2.8 发布验收](RELEASE_0.2.8.md)。

## 2026-09-09 ERP 回传文件 EPERM

用户另一台电脑0.2.8成本回传失败。利润与ERP修复4123774经主线审查承接6c74307，统一GET/POST写队列、独占临时文件和Windows有限重试；并发及原生Windows拒绝复现恢复通过，552项前端测试、构建、桌面verify和inbox/桥接定向检查通过。准备0.2.9候选；发布与用户现场恢复尚未完成。详见 [ERP inbox EPERM修复](integration/ERP_INBOX_EPERM_2026-09.md)。

0.2.9后续状态：用户批准公开发布，安装包已发布为GitHub Latest并完成四资产回读与更新源检查；候选/合并/发布完成，异常电脑待用户升级验收。详情见 RELEASE_0.2.9.md。
