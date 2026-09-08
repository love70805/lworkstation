# Lworkstation 经营管理工作台

选品工作台与利润核算面板的一体化内部工具。Lworkstation Windows 桌面安装版是正式交付入口，内置工作站、ERP 和 1688 受控标签；浏览器构建继续保留用于前端开发与调试。云端同步和账号隔离已准备好，未配置云端变量时不会上传业务数据。

## 浏览器开发调试

仅在开发或调试前端页面时，在工作区根目录执行：

```powershell
pnpm --dir frontend install
pnpm --dir frontend dev
```

开发服务器地址为 `http://127.0.0.1:5173/`，不作为正式产品交付入口。常用调试页面：

- `/workspace`：经营概览
- `/products`：选品工作台
- `/products?view=pending`：待确认采集
- `/profit`：利润核算
- `/ledger`：月度账本
- `/cost-matching`：ERP 成本核对
- `/data-security`：备份与恢复

## Lworkstation Windows 桌面版

当前仓库版本为 `0.2.6`。最近一次公开测试版仍为 [`0.2.6-beta.7`](https://github.com/love70805/lworkstation/releases/tag/v0.2.6-beta.7)，属于 GitHub prerelease；本仓库尚未上传 `0.2.6` 安装包。发布记录与待验收事项统一见 [docs/RELEASE_STATUS.md](docs/RELEASE_STATUS.md)。

桌面壳保留现有 `frontend/` 作为 renderer，并在同一窗口中提供 ERP 和 1688 的受控内置标签。两个标签使用独立持久浏览会话；首次启动请在各标签中完成网页登录。

```powershell
pnpm --dir desktop install
pnpm --dir desktop dev
```

`dev` 会启动 Vite 和 Electron。稳定版使用 `pnpm --dir desktop build`。历史 beta 候选使用 `release:build`，先构建 `frontend/dist`，再打入受控 beta 更新配置：

```powershell
pnpm --dir desktop verify
pnpm --dir desktop build
pnpm --dir desktop smoke:packaged
pnpm --dir desktop release:organize
pnpm --dir desktop release:check
```

Beta 安装包命名为 `Lworkstation-Setup-<版本>.exe`，由 `desktop/release-test/<版本>/` 整理到 `releases/prerelease/<版本>/`，更新元数据为 `beta.yml`。稳定版本使用 `pnpm --dir desktop build`，安装包命名为 `Lworkstation Setup <版本>.exe`，整理到 `releases/latest/`，历史稳定版本位于 `releases/history/<版本>/`，更新元数据为 `latest.yml`。具体目录规则见 [releases/README.md](releases/README.md)。

正式桌面包只从集成分支构建。专职 Worktree 产物仅用于模块验收；主线构建后运行 `release:organize` 和 `release:check`，检查 `desktop/release-plan.json` 中的必需提交、版本、安装包与更新元数据，并输出大小和 SHA-256。这些本地命令不上传 GitHub Release，完成本地检查不代表已经发布。

安装时可覆盖旧版，原有 ERP / 1688 登录会话保存在对应 `persist:` 分区。当前尚未配置 Windows 代码签名，首次安装可能显示“未知发布者”。Windows 可能继续显示旧快捷方式图标缓存；覆盖安装后若图标未刷新，请删除旧快捷方式并由安装程序重新创建。

beta.6 的已发布包未启用更新源，需要手工安装 beta.7 一次。beta.7 通过 GitHub beta 通道检查后续预发布版，发现更新后由用户确认下载并显式重启安装；自动下载和退出即装均关闭。稳定通道 `desktop/update-config.json` 继续保持关闭，客户端不得保存 GitHub Token。测试夹具与真实更新验收见 [desktop/UPDATE_RELEASE_CHECKLIST.md](desktop/UPDATE_RELEASE_CHECKLIST.md)。

生产版工作站通过 Electron 内部 `shopeers://` 安全协议读取前端资源；ERP / 1688 采集回传只监听 `127.0.0.1` 本机回环地址，默认端口为 `8790`，测试或受控启动可使用运行时端口。桌面会把实际 inbox origin 注入内置扩展，不接受局域网连接，通常不需要放行 Windows 防火墙。开发模式仍由 Vite 提供热更新页面。

桌面版会尝试加载仓库中的解压 MV3 扩展：`integrations/erp-assistant-extension` 与 `integrations/1688-selection-extension`。扩展加载失败不会影响工作站、ERP 或 1688 页面继续使用。`0.2.2` 起 Electron 会自动启动并管理本机收件服务，并把实际端口同步给内置扩展；若已有兼容服务则复用，若端口被其他程序占用则明确提示且不会终止该程序。左上 ERP 状态圆点及其紧凑浮窗显示通道正常、处理和错误状态；成本异常处置和成本核对仍在工作站业务页面完成，桌面状态浮窗不执行重试或业务跳转。

ERP inbox transport v2 与 batch `formatVersion: 2` 会保留 `warehouseEvidence` 和证据完整状态。旧版 v1 只显示为 `legacy_partial` 预览，不能由桌面层标记为正式成本；正式成本仍只能在 Lworkstation `CostMatching` / `profitRepository` 中处理和发布，`unitCost` 仅为兼容预览值。

自动 packaged smoke 会使用随机本机端口和可控 v2 fixture 验证“扩展格式回传 -> inbox 接收 -> 工作站轮询读取并确认 -> ERP 状态进入待核对阶段”。真实环境仍需手工检查：启动后确认工作站正常显示；分别打开 ERP / 1688 标签并完成一次真实登录；在 ERP 采购页完成一次分页采集，确认扩展注入、平台 SKU/SKC 映射、完整 `warehouseEvidence` 和供应商 1688 链接均已回传；重启桌面应用后确认登录态仍在；点击 1688 搜索结果和商品链接，确认站内新窗口留在当前标签；在任一远程页加载失败时切回“工作站”确认不受影响。最后运行 `pnpm --dir frontend test`、`pnpm --dir frontend build`、`pnpm --dir frontend erp:bridge:test`、`pnpm --dir frontend erp:inbox:test`、`pnpm --dir desktop verify` 和 `pnpm --dir desktop smoke:packaged`。

## 业务口径

- 平台 SKC 是商品父级标识。
- 平台 SKU 是工作区全局唯一标识，也是 SKC 下的属性分支。
- 利润核算从月度台账提取 SKC、SKU、属性、数量和金额。
- ERP 采集成本是正式成本；1688 成本只作参考。
- ERP 缺失时，人工确认的落地成本才可用于正式定稿。
- 默认币种为人民币。

## 验收命令

```powershell
pnpm --dir frontend cloud:check
pnpm --dir frontend test
pnpm --dir frontend release:check
```

GitHub Actions 在 `main`、`master`、`develop`、`codex/selection-profit-erp-sync` 分支推送以及 Pull Request 时运行两项检查：Ubuntu 执行前端 `release:check`，Windows 执行桌面 `verify`。桌面检查覆盖静态约束、IPC、扩展运行时、导航、inbox 生命周期和更新/发布产物契约；打包 smoke、真实 ERP/1688 采集与真实更新安装仍需单独验收。

## 上云

代码上传、Vercel、Supabase、同步 API 和数据迁移流程见 [docs/CLOUD_UPLOAD_GUIDE.md](docs/CLOUD_UPLOAD_GUIDE.md) 与 [frontend/docs/DEPLOYMENT_GUIDE.md](frontend/docs/DEPLOYMENT_GUIDE.md)。

## Codex 多任务续接

项目级开发规则见 [AGENTS.md](AGENTS.md)，多对话任务分工见 [docs/CODEX_TASK_BOARD.md](docs/CODEX_TASK_BOARD.md)。更换电脑或账户后的恢复步骤见 [docs/CODEX_RESTART_GUIDE.md](docs/CODEX_RESTART_GUIDE.md)。

业务台账、Excel 文件、`.env`、本机数据库和备份默认被根目录 `.gitignore` 排除，不应直接提交到代码仓库。
