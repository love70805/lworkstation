# Lworkstation 0.2.6 beta 更新测试清单

状态：beta.1 至 beta.6 已发布为 GitHub prerelease；beta.7 是修复包内 beta 更新配置的当前候选。生产稳定更新源继续关闭（`desktop/update-config.json` 的 `enabled: false`、`channel: latest`）。

## 已确认的更新路线

- GitHub 仓库：`love70805/lworkstation`（公开仓库已存在）
- `0.2.5 -> 0.2.6-beta.1`：不支持软件内发现。`0.2.6-beta.1` 是 beta 引导版，必须手工安装一次。
- `0.2.6-beta.1 -> 0.2.6-beta.2`：用于验证真实的软件内 beta 更新链；该路线的同名资产继续作为历史回归夹具保留。
- `0.2.6-beta.2 -> ... -> 0.2.6-beta.5`：GitHub prerelease 元数据链已连续发布；每一版都保持同名 EXE、blockmap、beta.yml 和 SHA256.txt。
- `0.2.6-beta.5 -> 0.2.6-beta.6`：线上 prerelease 已发布，仍需在 beta.5 安装环境中完成真实线上检查、下载和显式重启安装验收。
- `0.2.6-beta.6 -> 0.2.6-beta.7`：beta.6 已发布包的更新源仍关闭，因此必须手工安装 beta.7，不能篡改或替换已被下载的 beta.6 资产。
- `0.2.6-beta.7 -> 后续 beta`：beta.7 包在打包后受控写入 `desktop/update-beta-config.json`，以 `enabled: true`、`channel: beta` 检查后续 prerelease。稳定包不包含该配置。
- 客户端策略：`autoDownload=false`、`autoInstallOnAppQuit=false`；发现更新后由用户确认下载和重启安装。
- 本地 smoke 只用 `127.0.0.1` 替代 GitHub 网络传输，不绕过“当前版本必须是 prerelease”与 `beta` 通道判断。

## GitHub prerelease 资产

`v0.2.6-beta.1` 作为手工安装引导版，必须提供：

- `Lworkstation-Setup-0.2.6-beta.1.exe`
- `Lworkstation-Setup-0.2.6-beta.1.exe.blockmap`
- `beta.yml`，其中 `path` / `files.url` 必须严格等于 beta.1 安装包名
- `SHA256.txt`，记录 exe、blockmap 与 `beta.yml` 的 SHA-256

`v0.2.6-beta.2` 至 `v0.2.6-beta.5` 的历史 prerelease 均必须保留同名四类资产；新版本沿用同一规则。

- 历史回归资产：`Lworkstation-Setup-0.2.6-beta.2.exe`

`v0.2.6-beta.7` 作为后续软件内更新的引导版，必须提供：

- `Lworkstation-Setup-0.2.6-beta.7.exe`
- `Lworkstation-Setup-0.2.6-beta.7.exe.blockmap`
- `beta.yml`，其中 `path` / `files.url` 必须严格等于 beta.7 安装包名
- `SHA256.txt`，记录 exe、blockmap 与 `beta.yml` 的 SHA-256

所有 GitHub Beta Release 都必须标记为 prerelease。不得把 beta 资产上传到稳定 `latest` Release，也不得用带空格或其他异名资产替代 yml 中的名称。

## 本地验证

```powershell
pnpm --dir desktop build:update-fixtures
pnpm --dir desktop smoke:update
```

夹具写入 `desktop/release-test/0.2.6-beta.1/` 与 `desktop/release-test/0.2.6-beta.2/`，不会写入 `releases/latest/`，也不代表用户可下载安装。`release-internal/` 仅为历史夹具，不能作为 beta 发布说明。

packaged smoke 必须从 beta.1 的真实打包配置启动，读取 `beta.yml`，并验证：检查失败可手动重试、available 不自动下载、下载可取消和重试、稍后不会在普通退出时安装、仅显式操作才调用安装。服务器直接按 `beta.yml` 请求的同名文件读取磁盘，缺失时返回 404 并使测试失败。

## 线上 beta 验收

1. beta.1 至 beta.6 的 GitHub prerelease 保持可回读，资产文件名、大小、SHA-256 和 yml URL 必须一致。
2. 手工安装 beta.7，确认更新浮窗处于 beta 测试通道且现有用户数据、登录态和 persist 分区不变。
3. `v0.2.6-beta.7` GitHub prerelease 必须上传 beta.7 的同名资产。
4. 发布后续 beta 版本时，从已安装 beta.7 执行软件内检查，验证 GitHub provider 选择新的 beta.yml，再完成下载、取消、重试、稍后和显式重启安装。
5. 安装替换完成后核对实际版本，并复测 ERP/1688 登录态、inbox 与工作站读取。

线上资产回读只能证明 GitHub 元数据链完整；在隔离 Windows 机完成实际安装替换前，不得声称真实更新安装已经通过。

## 回滚与失败处理

- beta Release 有问题时撤下或转 draft，不修改稳定 `latest` 源。
- 下载或安装失败时保留当前版本，显示可恢复错误并允许手动重试；不自动回滚，也不在普通退出时安装。
- beta.1 与 beta.7 均可作为手工恢复入口；beta.7 后续更新、签名和安全审计完成后，再由主线决定稳定 `0.2.6` 的发布策略。
- beta 资产只写入 `releases/prerelease/<version>/`，不修改 `releases/latest/`。
