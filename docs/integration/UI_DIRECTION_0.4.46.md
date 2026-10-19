# 0.4.46 统一 UI 方向与基础层

更新时间：2026-10-19。本批基线为本机已核对的 `origin/main` `d16a2d724a1b1ec4322ef2480fde077a0b7a32f8`。本文件记录目标、影响范围、契约改变和验收证据；候选、合并与公开发布分别记录在发布记录中。

## 目标

把现有前端从"功能完整但基础层碎片化"收敛为一套可维护的视觉方向：**克制、清晰、可信的财务工作台**。数据优先、表面安静、节奏一致、中文优先、层次清楚、深浅一致。只调整表现层，不改业务口径。

## 范围（17 个文件）

- 基础层：`frontend/src/styles/base.css`（令牌、浅深色、排版、按钮/输入/面板/表格/徽标/空态/弹窗/顶栏/侧栏/响应式）。
- 模块样式：`workspace.css`、`ledger.css`、`profit.css`、`product-library.css`、`import-wizard.css`、`operations.css`、`capture-queue.css`、`erp-cost.css`、`product-editor.css`。
- 页面/组件 JSX：`components/DataTable.jsx`、`pages/ProfitWorkspacePage.jsx`、`pages/ProfitPanel.jsx`、`pages/WorkspacePortal.jsx`、`pages/MonthlyLedger.jsx`、`pages/ProductLibrary.jsx`、`pages/DataSecurity.jsx`。

未改：路由、数据模型、IndexedDB schema、成本/利润计算、定稿保护、备份/恢复语义、ERP/1688 协议、桌面主进程。

## 契约与行为变化

1. **设计令牌**：新增 `--font-sans/--font-mono/--text-*/--leading-*/--space-*/--radius-*/--duration-*/--ease-standard`、`--control-border`、`--on-success`；保留全部既有变量名。浅色 `--text-soft` 由 `#7c8796` 改为 `#606977`，`--info` 由 `#2a6fdb` 改为 `#1f5fc4`，`--control-border: #84919f`；深色 `--text-soft` 改为 `#9aa6b4`、`--danger` 改为 `#f47f7f`、`--control-border: #6c7f97`。
2. **排版**：全局 tabular figures；正文行高 1.5→1.6；页头 h1 22/30；说明 13/20；表头 12/600 且去掉 `text-transform: uppercase`；表格单元格 13px；徽标 12px；10px 字号清零（最小 11px）；`JetBrains Mono` 统一走 `--font-mono`。
3. **组件**：按钮/图标按钮/输入框/选择框/搜索框 6px 圆角，默认 36px 高（窄屏 44px）；面板 8px 圆角、默认无阴影；顶栏 56px、发丝边框；侧栏激活态 6px 圆角 + 3px 指示条；弹窗 12px 圆角、toast 8px。
4. **表格空态**：`DataTable` 空提示改为 sticky 消息，窄屏横向滚动时不再居中到屏幕外（仅包一层 `span`，列/数据契约不变）。
5. **页面**：
   - `/profit`：空态改为 `PageHeader + Panel(EmptyState)`，主 CTA 由无效的 `button primary` 修正为 `button button-primary`；选中账本时统一使用共享 `PageHeader`（周期/状态进 eyebrow，本月报告/核算月份/店铺进 actions），删除自定义 `.profit-workspace-header`；窄屏隐藏两个选择框的可见标签（`aria-label` 保留）使三个控件保持一行。
   - `/workspace`：指标值 26px；销售趋势空态改为 panel-header + 说明 + 导入 CTA。
   - `/ledger`：空工作区不再渲染 4 张全零统计卡，空态与 CTA 回到首屏；卡片页脚改用 `--surface-soft`（修复深色下 `#fbfcff` 硬编码）。
   - `/products`：官方库空态区分"没有商品档案"与"筛选为空"；预存区页头"月度账本"由 primary 降为 secondary，消除同屏 3 个 primary 竞争。
   - `/data-security`：手动导出按钮降为 secondary，页面保留一个 primary；危险区/导出图标/预检结果改用语义令牌。
   - `/import-preview`：向导顶栏 56px、标题 22–24/600、卡片 8px 圆角、输入与下拉使用 `--control-border`；深色映射错误、校验成功/警告、上传成功底色改令牌。
   - `/diagnostics`：统计值 22/600 tabular；区块标题统一 16px；去掉无意义 uppercase。
6. **可访问性**：补齐映射下拉、候选搜索、排序下拉 3 处丢失的键盘焦点；焦点轮廓统一 `outline: 2px solid var(--primary-bright)`。

## 验证结果

- 前端：`pnpm --dir frontend test` **211 文件 / 1684 项通过**；`pnpm --dir frontend build` 通过。
- 桌面：`pnpm --dir desktop verify` 19 组通过（候选构建后复核）。
- 发布门禁：`pnpm --dir frontend release:check` 29 项通过（候选前复核）。
- 视觉（合成数据、隔离浏览器 profile）：改动前后各 **88 张**（11 页面 × light/dark × 1440/1280/768/390）；两轮均无页面级横向溢出；数据断言 9/9。
  - 页头 h1 24→22px（桌面）/22→20px（390）；页头说明 14→13px；徽标 11→12px；移动端顶栏 64→56px。
  - `/profit` 390 顶部区域（顶栏+页头+视图标签）267→300px 的同批初测被判定为回退，随后压缩窄屏控件到一行，复测 233px（优于改动前）。
  - 已知预期变化：页面内边距 24→28px 使商品/预存表桌面内部隐藏宽度 +8px（表格容器内滚动，页面不溢出）；workspace 390 的销售图 30 根按日柱状按钮文字裁切为既有实现（SalesAnalytics 本批未改），不计入本批回归。
- 对比度（WCAG，含 `color-mix` 合成）：`--text-soft` 由 3.07–3.64:1 提升到 4.72–5.55:1；`--info/info-bg` 4.24→5.34；深色 `--danger/danger-bg` 4.40→4.98；深色主按钮文字 6.6–7.0；完成态 7.7；控件描边由 1.54/2.22 提升到 3.00–3.21/3.96。仍低于 3:1 的只剩装饰性发丝边框、tab 未选中边框和不承担信息的浅色底（见审计报告 7.4）。
- 独立审计：`archive/ui-direction-20261019/audit-foundations.md`（101 组对比度、P0 修复复核）与 `audit-pages.md`（页头/空态/窄屏），`after-data/after-report.md`（88 组 before/after 度量）。
- 发布前签核（`archive/ui-direction-20261019/audit-final.md`）：冻结提交 `627df31`，12 CSS + 2 JSX 合并 SHA-256 `78141ae8…ec5711a`；P0 6/6 通过——深色亮底元素 2→0、hex 白字 6→0、未定义令牌 15→0、焦点缺失 3→0、文本对比度 32 组全部 ≥4.5:1、控件描边 1.60→3.21:1。仍 <3:1 的只剩装饰性 `--border`/`--border-strong`、`selection-border` 2.62 与 focus-ring 光晕，列入下一批 P1/P2，不阻断发布。

## 限制

- 视觉证据使用合成 fixture 直写 IndexedDB（生产构建无可 import 的 `/src` 模块），**不是**真实业务数据；`/import-preview` 只覆盖未选文件空态；未生成已定稿/锁定账本 fixture。
- 未做屏幕阅读器实测、真实账号 ERP 现场、可见窗口/托盘/焦点验收；本批未涉及这些路径。
- 模块 CSS 中仍有字面量圆角/间距未迁移到令牌；`import-wizard.css` 仍承载部分 profit/ERP 响应式覆盖；术语（账本/台账等）与 `/data-security` 两份备份文案的矛盾依赖 R2 修复口径，本批不改语义。
- 表格内部横向滚动是既有设计（窄屏保留），本批只保证页面级不溢出。

## 回滚

纯前端表现层，无数据库迁移和不可回退写入。回滚方式：安装 0.4.45 稳定包，或 revert 本批 PR；不影响本机数据。

## 交付与候选验收

- [PR #263](https://github.com/love70805/lworkstation/pull/263) 已合并，PR 与[软件主线 CI](https://github.com/love70805/lworkstation/actions/runs/39276509073) 两项均通过；标签 `v0.4.46` 固定于合并提交 `dd1234ecf5513a33982f39c429510c7587319755`，PR 头和合并提交跟踪树一致。
- 候选 `releases/candidates/0.4.46/`：`Lworkstation Setup 0.4.46.exe` 120432125 字节，SHA256 `3D2D15094D03E9C11B29D5C657D7FC2F92A5E1A2DA2EB7C327D458B85097E86B`；`release:check` 通过。
- 隐藏 packaged smoke：ok、packaged、version 0.4.46、hiddenMode、可见窗口 0、updater current；包内 `resources/frontend` 与 `frontend/dist` 654 文件逐字节一致；包内资源 11 页面 × light/dark × 1440/390 共 44 组截图、数据断言 9/9、无页面级横向溢出。
- 2026-10-19T15:34:24Z 已公开稳定 Latest（非草稿、非预发布），发布服务核对四资产上传状态、字节数及 SHA256 digest；公开下载无需验证。详见[发布记录](../RELEASE_0.4.46.md)。
