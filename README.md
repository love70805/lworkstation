# Lworkstation 经营管理工作台

面向组内运营的本机 Windows 桌面工作台。导入月度台账后，获取 ERP 成本、核对利润与异常，然后导出报告。商品资料可以按需补齐。

**[下载 Windows 稳定版](https://github.com/love70805/lworkstation/releases/latest)** · [2.2 使用指南](docs/USER_GUIDE_2.0.md) · [开发指南](docs/DEVELOPMENT_WORKSPACE.md) · [发布记录](docs/RELEASE_STATUS.md)

稳定版支持应用内更新。从独立 Beta 转入正式版时，先在 Beta 的「系统与备份」导出备份。需要带入这些账本时，在正式版备份现有工作区后导入。

## 主要功能

- **台账导入**：同月多店批量导入，按模糊识别或精准识别选择自己的商品，自主筛选变动类型，预览数量、金额和覆盖范围。完整月重导替换本店本月的选择，部分日期来源保留分组追加或替换规则。
- **预存区与选品库**：导入资料先进入预存区，逐步补齐名称、图片、SKU 属性、售价及供应商来源；达到完整标准后自动进入选品库。1688 成本与利润用于选品参考。
- **ERP 成本采集**：后台批量取得采购表，按需补查缺项与异常；正常任务整项核算，保留中断恢复、原方式兜底及完整采购证据。分别显示送达与本机采用进度。
- **月度利润核算**按台账收入、采用的单件成本、仓储费率和已登记的代发及扣款计算。采购详情可查看历史价格区间、采购凭证和逐笔异常原因。
- **经营分析与本地管理**：每日／月度销售趋势、店铺和 SKC 构成、明细与 Excel 导出，以及工作区备份、恢复和系统检查。

## 开始使用

1. 从 [Releases](https://github.com/love70805/lworkstation/releases/latest) 下载 Windows x64 安装包并安装。
2. 打开工作站，导入月度文件；月份优先按台账日期或当前账本识别，必要时补选，确认店铺、负责货号和变动类型。
3. 提前登录 ERP，从工作台发起成本采集，在统一核算页核对成本与异常。
4. 在「代发与扣款」登记已取得的来源，按当前账本导出 Excel。代发可选填，扣款未齐可先导出未扣款报告。

业务数据保存在本机。更换电脑或执行恢复前，先通过应用的备份功能保全工作区。不要把业务 Excel、本机数据库、登录信息、Cookie 或 Token 提交到仓库。

## 业务口径

- 默认币种为人民币（CNY）。平台 SKC 为商品父级，平台 SKU 为工作区全局唯一的属性分支。
- ERP 成本用于正式利润核算，1688 成本用于参考。
- 单件成本允许真实零值。利润明细列出该店铺 SKU 实际采用的成本和来源。
- 后续 ERP 回传保留人工更正及其审计。每次导出独立保存 Excel 原件和来源快照，可在「导出记录」中下载原件。

## 本地开发

前置环境：Windows、Node.js 和 pnpm；版本及依赖以仓库锁文件和 CI 配置为准。

```powershell
pnpm --dir frontend install
pnpm --dir desktop install
pnpm --dir desktop dev
```

`frontend/` 为 Electron 内置界面，开发时由 Vite 提供热更新；当前产品以 Windows 桌面安装版交付。长期业务口径与授权见[项目约束](AGENTS.md)。页面入口、模块边界、命令和验证方法见[开发指南](docs/DEVELOPMENT_WORKSPACE.md)。

常用验证：

```powershell
pnpm --dir frontend test
pnpm --dir frontend build
pnpm --dir desktop verify
```

准备桌面候选：

```powershell
pnpm --dir desktop release:build
pnpm --dir desktop smoke:packaged
pnpm --dir desktop release:organize
pnpm --dir desktop release:check
```

按改动影响选择用户路径与桌面验证，发布后核对通道和上传结果。[发布方法](docs/DEVELOPMENT_WORKSPACE.md#软件发布) · [候选登记](releases/README.md)

## 仓库导航

| 目录 | 用途 |
| --- | --- |
| `frontend/` | 工作站界面、业务契约、本机数据库与测试 |
| `desktop/` | Electron 桌面壳、扩展加载、本机收件服务管理和更新 |
| `integrations/` | ERP Assistant 集成 |
| `tools/` | 契约验证、采集回归、构建和辅助工具 |
| `docs/` | 当前任务、发布记录、业务契约及历史归档 |
| `releases/` | 候选和历史产物的登记说明；安装包从 Releases 下载 |

[当前发布状态](docs/RELEASE_STATUS.md) · [开发历史](docs/DEVELOPMENT_HISTORY.md) · [开发任务看板](docs/CODEX_TASK_BOARD.md) · [跨电脑续接](docs/CODEX_RESTART_GUIDE.md) · [贡献说明](CONTRIBUTING.md) · [安全报告](SECURITY.md)

源码许可证为 [Apache License 2.0](LICENSE)。品牌与修改版分发说明见 [TRADEMARKS.md](TRADEMARKS.md)。历史计划和旧验收记录保留供追溯，当前开发范围以任务看板及最新用户要求为准。
