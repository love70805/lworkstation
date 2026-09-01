# Lworkstation 0.2.6 beta 更新测试清单

状态：仅准备 beta 测试发布，尚未发布到 GitHub Releases。生产稳定更新源继续关闭（`desktop/update-config.json` 的 `enabled: false`、`channel: latest`）。

## 已确认的更新路线

- GitHub 仓库：`love70805/lworkstation`（当前尚未创建；创建并公开前不得声称线上更新可用）
- `0.2.5 -> 0.2.6-beta.1`：不支持软件内发现。`0.2.6-beta.1` 是 beta 引导版，必须手工安装一次。
- `0.2.6-beta.1 -> 0.2.6-beta.2`：用于验证真实的软件内 beta 更新链。
- beta 包使用单独的 `desktop/update-beta-config.json`：`enabled: true`、`channel: beta`。稳定包不包含该配置。
- 客户端策略：`autoDownload=false`、`autoInstallOnAppQuit=false`；发现更新后由用户确认下载和重启安装。
- 本地 smoke 只用 `127.0.0.1` 替代 GitHub 网络传输，不绕过“当前版本必须是 prerelease”与 `beta` 通道判断。

## GitHub prerelease 资产

`v0.2.6-beta.1` 作为手工安装引导版，必须提供：

- `Lworkstation-Setup-0.2.6-beta.1.exe`
- `Lworkstation-Setup-0.2.6-beta.1.exe.blockmap`
- `beta.yml`，其中 `path` / `files.url` 必须严格等于 beta.1 安装包名
- `SHA256.txt`，记录 exe、blockmap 与 `beta.yml` 的 SHA-256

`v0.2.6-beta.2` 作为软件内更新目标，必须提供：

- `Lworkstation-Setup-0.2.6-beta.2.exe`
- `Lworkstation-Setup-0.2.6-beta.2.exe.blockmap`
- `beta.yml`，其中 `path` / `files.url` 必须严格等于 beta.2 安装包名
- `SHA256.txt`，记录 exe、blockmap 与 `beta.yml` 的 SHA-256

两个 GitHub Release 都必须标记为 prerelease。不得把 beta 资产上传到稳定 `latest` Release，也不得用带空格或其他异名资产替代 yml 中的名称。

## 本地验证

```powershell
pnpm --dir desktop build:update-fixtures
pnpm --dir desktop smoke:update
```

夹具写入 `desktop/release-test/0.2.6-beta.1/` 与 `desktop/release-test/0.2.6-beta.2/`，不会写入 `releases/latest/`，也不代表用户可下载安装。`release-internal/` 仅为历史夹具，不能作为 beta 发布说明。

packaged smoke 必须从 beta.1 的真实打包配置启动，读取 `beta.yml`，并验证：检查失败可手动重试、available 不自动下载、下载可取消和重试、稍后不会在普通退出时安装、仅显式操作才调用安装。服务器直接按 `beta.yml` 请求的同名文件读取磁盘，缺失时返回 404 并使测试失败。

## 首次线上 beta 验收

1. 创建 `v0.2.6-beta.1` GitHub prerelease，上传该目录内四类同名资产，并记录大小与 SHA-256。
2. 在隔离 Windows 测试机手工安装 beta.1，确认更新浮窗明确处于 beta 测试通道且现有用户数据、登录态和 persist 分区不变。
3. 创建 `v0.2.6-beta.2` GitHub prerelease，上传 beta.2 的同名资产。
4. 从已安装 beta.1 执行软件内检查，验证 GitHub provider 选择 beta.2 与 `beta.yml`，再完成下载、取消、重试、稍后和显式重启安装。
5. 安装替换完成后核对实际版本为 beta.2，并复测 ERP/1688 登录态、inbox 与工作站读取。

公开 GitHub prerelease 尚未创建前，本地 loopback smoke 只能证明 packaged 更新状态机与 beta 配置可工作，不能声称线上 GitHub 更新已经通过。

## 回滚与失败处理

- beta Release 有问题时撤下或转 draft，不修改稳定 `latest` 源。
- 下载或安装失败时保留当前版本，显示可恢复错误并允许手动重试；不自动回滚，也不在普通退出时安装。
- beta.1 仍可作为手工恢复入口；签名、安全审计和真实 GitHub beta.1 -> beta.2 验收通过后，再由主线决定稳定 `0.2.6` 的发布策略。
- 本轮不执行 `release:organize`，不修改 `releases/latest/`，不发布 GitHub Release。
