# Lworkstation 经营管理工作台

面向组内运营的 Windows 桌面工作台，将月度台账、选品商品资料、1688 参考采集、ERP 成本核对和利润核算放在同一个本机工作区。

**[下载最新稳定版](https://github.com/love70805/lworkstation/releases/latest)** · [全部版本](https://github.com/love70805/lworkstation/releases) · [v0.4.10 更新说明](docs/RELEASE_0.4.10.md)

当前稳定版为 **v0.4.10**，ERP 采集显示实际完成量、各并发路和分页进度；成本已送达、证据缺项及资料齐全分别展示，并保留具体异常原因。工作站、ERP 和 1688 在桌面应用内分别打开；首次使用时在相应标签完成登录。本机版无需配置云端数据库，下载和安装更新由用户操作，升级不会自动清空业务数据。

## 主要功能

- **台账导入**：同月多店批量导入，按关键词或货号后缀选择自己的商品，自主筛选变动类型，预览数量、金额和覆盖范围。完整月重导替换本店本月的选择，部分日期来源保留分组追加或替换规则。
- **预存区与选品库**：导入资料先进入预存区，逐步补齐名称、图片、SKU 属性、售价及供应商来源；达到完整标准后自动进入选品库。1688 成本与利润用于选品参考。
- **ERP 成本采集**：默认每批 20 个 SKC，分批回传，支持暂停、停止、失败重试及重启后手动继续；按实际完成量显示阶段与各并发路，分别展示已采集、已送达、已采用和资料缺项。
- **月度利润核算**：使用台账收入和 ERP 正式成本，人工更正优先，保留成本审计、月度定稿和历史报告。
- **经营分析与本地管理**：每日／月度销售趋势、店铺和 SKC 构成、明细与 Excel 导出，以及工作区备份、恢复和系统检查。

## 开始使用

1. 从 [Releases](https://github.com/love70805/lworkstation/releases/latest) 下载 Windows x64 安装包并安装。
2. 打开工作站，导入月度文件，确认月份、店铺、负责货号和变动类型。
3. 按完成页引导取得本月正式成本：在 ERP 标签登录并采集成本，在利润核算页核对缺失或异常项。
4. 确认利润后保存月度报告并导出；可稍后进入预存区补齐商品资料。

业务数据保存在本机。更换电脑或执行恢复前，先通过应用的备份功能保全工作区。不要把业务 Excel、本机数据库、登录信息、Cookie 或 Token 提交到仓库。

## 业务口径

- 默认币种为人民币（CNY）。平台 SKC 为商品父级，平台 SKU 为工作区全局唯一的属性分支。
- ERP 成本用于正式利润核算，1688 成本用于参考。
- 显式人工更正优先于 ERP，需填写非负单件成本及说明，并保留可撤销审计。
- 后续回传不得覆盖有效人工更正，也不得静默改变已定稿利润。

## 本地开发

前置环境：Windows、Node.js 和 pnpm；版本及依赖以仓库锁文件和 CI 配置为准。

```powershell
pnpm --dir frontend install
pnpm --dir desktop install
pnpm --dir desktop dev
```

`frontend/` 为 Electron 内置界面，开发时由 Vite 提供热更新；当前产品以 Windows 桌面安装版交付。工作站入口和模块边界见 [AGENTS.md](AGENTS.md)。

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

按改动范围补充实际用户路径和桌面验证；构建成功不等于已经发布。发布要求及候选目录见 [开发规则](AGENTS.md)、[发布文件登记](releases/README.md) 和 [更新验收清单](desktop/UPDATE_RELEASE_CHECKLIST.md)。

## 仓库导航

| 目录 | 用途 |
| --- | --- |
| `frontend/` | 工作站界面、业务契约、本机数据库与测试 |
| `desktop/` | Electron 桌面壳、扩展加载、本机收件服务管理和更新 |
| `integrations/` | ERP Assistant 与 1688 采集扩展 |
| `tools/` | 契约验证、采集回归、构建和辅助工具 |
| `docs/` | 当前任务、发布记录、业务契约及历史归档 |
| `releases/` | 候选和历史产物的登记说明；安装包从 Releases 下载 |

[当前发布状态](docs/RELEASE_STATUS.md) · [开发任务看板](docs/CODEX_TASK_BOARD.md) · [跨电脑续接](docs/CODEX_RESTART_GUIDE.md) · [贡献说明](CONTRIBUTING.md) · [安全报告](SECURITY.md)

源码许可证为 [Apache License 2.0](LICENSE)。品牌与修改版分发说明见 [TRADEMARKS.md](TRADEMARKS.md)。历史计划和旧验收记录保留供追溯，当前开发范围以任务看板及最新用户要求为准。
