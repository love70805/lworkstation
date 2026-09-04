# Codex 任务看板

这份文件是跨电脑、跨账户继续开发时的项目级任务入口。Codex 对话本身不会写入 GitHub，因此新设备上应根据本看板重新创建任务对话。

## 当前基线

- GitHub 仓库：`love70805/lworkstation`
- 集成分支：`codex/selection-profit-erp-sync`
- 最新集成提交：`40e4da8`（beta.7 更新源引导版的发布提交；线上资产已回读）
- 当前草稿 PR：`#1`
- 本地开发地址：`http://127.0.0.1:5173`
- 官方桌面版本：`0.2.6-beta.7`；下一候选：待规划
- 发布状态入口：`desktop/release-plan.json` 与 `docs/RELEASE_STATUS.md`

## 进行中的跨模块协调

### ERP 原始证据与正式成本职责调整

- 主责实现：原始证据职责调整从 `039ba21` 起步；精确回传、证据合同、自动载入与恢复链路最终收口于 `18d4bd4`，由项目开发主线合并为 `ef6cd14`。
- 总控范围：公共 `erpCostBatchEnvelope`、`erpBridgeContract`、ERP inbox payload 与 `profitRepository` 发布契约的审查、合并和完整回归。
- ERP 扩展职责：只采集、提示异常、预览并回传完整原始证据；异常不得阻止复制、导出或回传，扩展不得确认、修正或发布正式成本。
- Shopeers 职责：`CostMatching` 负责 median/MAD 异常检测、修正、真实价确认和审计；repository 独立复算，并阻止未处置异常、零价或篡改成本发布。
- 成本口径：正式成本继续使用最近最多三次有效采购记录按数量加权；全部有效历史只用于异常基线；ERP 正式、1688 参考的业务口径不变。新产生的 ERP/1688 单件成本、采购成本、仓储、扣款、利润与利润率统一直接舍弃小数点后两位，不四舍五入；已结算历史数据保持原值。
- Contract 状态：ERP batch envelope `formatVersion: 2`，inbox transport v2；`requestId + ledgerId + 完整 SKC 集合` 必须精确匹配。同一仓库 SKU 可共享给多个平台 SKU/SKC；当前账本使用的行标记为 `ledgerScopeRole: expected`，同查询 SKC 下但本账本未使用的额外变体标记为 `auxiliary`。辅助变体只保留预览与审计，不参与匹配兜底、证据完整性阻断或正式成本发布。任一层 v1 均只按 `legacy_partial` 预览；非法警告、重复证据身份、无效币种或负成本在落盘前拒绝，正式发布必须使用完整 v2 `warehouseEvidence`。
- 集成结果：利润/ERP 最终链路 `18d4bd4`、ERP 证据归属修复 `e216f29`、桌面 packaged smoke 适配 `0f00b4f`、1688 心跳兼容修复 `92d10ac`、ERP 复制回退 `b4b4859`、未映射证据折叠 `dc75782`、证据状态区分 `b5e2682` 与共享仓库映射修复 `8020c8e` 已合入集成分支；`0.2.5` 正式发布提交为 `9f002fb`。
- 最新集成回归：60 个前端测试文件、317 项测试、前端构建、ERP bridge/inbox/result-policy、desktop verify/inbox 生命周期与发布产物夹具全部通过。包含 `8020c8e` 的桌面 build 和 packaged smoke 仍是下一次正式发布的前置条件。
- 软件内更新：`acacf2e` 已加入受控更新状态机，`a412684` 隔离更新 smoke 缓存；beta.1 至 beta.7 已公开为 GitHub prerelease，`autoDownload=false`、`autoInstallOnAppQuit=false`，发现更新后仍由用户确认下载并显式重启安装。beta.6 的已发布安装包未启用 beta 更新源，须手工安装 beta.7 一次；beta.7 之后继续使用 beta 通道更新，稳定源默认关闭。
- 桌面版本：`0.2.5` 保留现有安全壳与 ERP/1688 内置扩展，并加入 ERP 成本复制回退、未映射证据折叠和证据不完整原因/补齐指引；桌面层不执行异常判断、人工确认或正式成本发布。
- UI 集成：`edac462`、桌面壳 `d112b08`、利润/ERP `18d4bd4` 与桌面 smoke `0f00b4f` 均由 `desktop/release-plan.json` 作为正式发布前置提交检查。
- ERP Assistant：`v8.0.15`，38,645 bytes，SHA-256 `EDA7774D60791FCAF02AA25D47645E4C39A578C2656DED7BC1BE36FB0EDB900C`。该版支持采购页 iframe 注入，并在 ERP 替换页面 DOM 后自动恢复右下角核算按钮。
- beta.7 安装包已发布：`Lworkstation-Setup-0.2.6-beta.7.exe`，88,799,017 bytes，SHA-256 `753A8C876C77D021AA633F8EF3076E7B93D50511A27AAC5D11D4EBAFB1E85560`。beta.6 不能替换已下载的同名资产，需手工安装 beta.7 一次，之后从 beta 通道接收后续软件内更新。
- 待发布 UI/桌面候选：全局 UI `ca4ceda`，桌面壳/缩放 `15c8db5`，Windows 品牌与图标 `cf3c36a`，发布与偏好恢复加固 `3657664`，发布定位文档 `b9936d2` 与 `5acae7d` 已合入集成分支。主工作区候选包为 `desktop/release/Lworkstation Setup 0.2.5.exe`，88,623,760 bytes，SHA-256 `E49CD34AE5885FAA21D3E11A2B42685C1BDC070A6067F4E6CE41C52D52E74447`；该候选生成于 `8020c8e` / ERP Assistant v8.0.14 之前，必须从最新集成分支重新构建并通过 desktop build、packaged smoke、`release:organize` 与 `release:check`，不得视为当前可发布版本。
- 待人工验收：真实 ERP 登录态跨重启、采购页扩展注入、真实分页、SKU/SKC/仓库 SKU 映射、供应商与 1688 链接、真实 `warehouseEvidence` 完整性。
- 本轮不通知选品与全局 UI 对话；若最终 contract 改变选品参考读模型或共享视觉组件，再按路由规则补充广播。

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

扩展兼容记录：当前 POC 对 `erp-assistant-extension` 和 `1688-selection-extension` 使用 Electron `session.loadExtension()` 加载解压 MV3 目录。ERP 的 MAIN world 内容脚本、1688 的 service worker / action popup 仍需在真实 ERP 和 1688 登录页做运行时确认；不兼容时记录状态，不回退到无提示白屏。

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
- 主线发布前必须更新 `desktop/release-plan.json`，依次运行 `pnpm --dir desktop release:organize` 和 `pnpm --dir desktop release:check`；前者维护 `releases/latest` 与 `releases/history`，后者检查分支、必需提交、版本、安装包、blockmap 与 `latest.yml`，并输出 SHA-256。
- 只有 `docs/RELEASE_STATUS.md` 记录为已验证且发布检查通过后，主线才能向用户报告“已发布”。

## 对话路由表

| 用户需求 | 主责对话 | 需要广播的典型情况 |
| --- | --- | --- |
| 商品档案、SKC/SKU、多供应商、1688 参考成本 | 选品工作台 | 需要 ERP 历史成本或共享采集 contract 时通知利润/ERP与总控 |
| 台账导入、月度利润、ERP 正式成本、成本回传 | 利润核算与 ERP | 改动选品参考读模型或桌面桥接时通知对应对话与总控 |
| React 工作站导航、页面布局、响应式、设计令牌 | 全局 UI 与导航 | 同时影响 Electron 外壳视觉规范时通知桌面主线 |
| Electron 外壳、内置 ERP/1688、扩展加载、安装包 | Shopeers 桌面化主线 | 需要业务页面或数据 contract 配合时通知对应业务对话与总控 |
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
项目：Shopeers 经营管理工作台
基线：codex/selection-profit-erp-sync
任务范围：
不修改：
业务约束：先阅读 AGENTS.md 和 docs/CODEX_TASK_BOARD.md
验收标准：
验证命令：pnpm --dir frontend test && pnpm --dir frontend build
完成后请汇报：改动文件、测试结果、潜在回归、需要总控处理的接口
```

