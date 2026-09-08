# 桌面更新通道隔离

基线：`72d21e9c06f6c18904d067b5603184ba6faa5588`。仅桌面内部策略，未改变业务、数据库、IPC 或同步 contract。版本元数据、最终候选构建及发布由项目主线负责。

## 当前策略

- 新 stable 包默认启用 `latest` 检查；公开 beta 包继续由 release afterPack 写入启用的 `beta` 配置。开发运行关闭检查；QA 包必须继续打入 `enabled: false`，保留独立身份、目录与数据。
- 当前版本必须为合法 SemVer stable 或 beta，且必须与配置通道一致；alpha/rc/未知通道及配置错配禁用。候选必须同通道且 SemVer 严格递增；build metadata 不算升级，beta.10 大于 beta.9。
- stable 读取 GitHub `/releases/latest`，再验证标签与 `latest.yml`；beta 只从 Atom feed 中选择最高 SemVer beta 标签，再读取该标签的 `beta.yml`。不回退到 stable、其他预发布或 `latest.yml`。Atom 没有 beta 时显示可重试错误；feed 有限窗口之外的旧 beta 不猜测、不跨通道补位。
- 标签与元数据版本必须一致。实际 AppUpdater 的 `isUpdateSupported`、应用下载入口、下载完成事件、安装入口均复核版本；安装还复核 updater 的候选及缓存版本。设置 channel 后显式重置 `allowDowngrade=false`。
- `autoDownload=false`、`autoInstallOnAppQuit=false`，仅用户点击下载、显式重启安装。正常退出或“稍后”不会安装。
- 复用锁定的 electron-updater 6.8.9 GitHub 基类/资产解析；`builder-util-runtime@9.7.0`、`semver@7.7.4` 从其既有依赖提升为直接依赖。升级 updater 时必须复跑实际 provider 测试，核验内部候选/缓存字段。

## 自动验证（不联网、不真实安装）

```powershell
pnpm --dir desktop verify
node desktop/update-provider.test.mjs
```

verify 包含真实 AppUpdater/provider 分支的内存 HTTP fixture：复现上游 beta 选择 stable；验证 stable→stable、beta→beta、两个方向跨通道、相同/旧版本、错误配置、无 beta 候选、缺失元数据无回退、标签错配、下载前目标变更、下载后错配、安装缓存错配、SemVer 和无退出自动安装。原 runtime fixture 覆盖检查失败重试、取消、再次下载、稍后；所有 HTTP 由内存 executor 提供，不访问 GitHub。

## 主线候选验收步骤

1. 在隔离 Windows 用户/虚拟机准备同身份、同数据路径的源包与更高版本目标包。stable 与 beta 分别验收，不复用正式用户目录；记录包 SHA-256、appId、注册项、快捷方式、版本和 userData/cache 路径。QA 公共更新配置保持 false。
2. 源包写入合成 IndexedDB/localStorage 记录，以及外观、ERP 缩放偏好；记录导出内容或哈希。不要使用正式业务数据和账号。
3. 对每个通道用本地 HTTP 服务提供对应 `latest.yml` 或 `beta.yml`、同名 EXE/blockmap。由主线隔离验收宿主注入受控 loopback 更新源，不能用公开 GitHub 源代替隔离配置。开发、常规 smoke 或 QA 无显式 loopback 时不得请求公开更新。
4. 检查→发现→确认下载，记录请求与 SHA-512 校验结果；故意一次 503、慢下载取消，然后重试。发现更新时无 EXE 请求；取消后可重试；“稍后”退出、重新启动不得替换程序。分别投放另一通道、相同和旧版本元数据，确认无下载、无安装。
5. 实际安装验收需使用主线专用隔离 harness 或实际操作，点击“重启安装”后观测 NSIS 进程、实际文件替换、新程序进程与新版本。现有 `SHOPEERS_DESKTOP_UPDATE_SMOKE=1` 会截获安装调用，不能用于声称真实安装完成；不要为通过测试把截获计数当作安装证据。
6. 新程序启动后核对合成数据、外观/缩放、隔离身份与数据目录保留；对照正式程序、注册项、正式数据路径无变化。将原始证据和候选按项目规范交主线归档。

现有打包 smoke 可运行：

```powershell
pnpm --dir desktop build:update-fixtures
pnpm --dir desktop smoke:update
```

这条旧 smoke 固定由 update-test-config.json 指定 beta.3→beta.4，构建显式 `--publish never`，会重建 desktop/release-test；先归档需保留产物。它验证本地真实下载及安装调用截获，不是实际安装，也不能代替上述 stable 实际安装。当前专职交付只完成 verify/内存 provider fixture，未构建候选或执行真实安装。

## 旧客户端迁移与发布承接

- 已公开 0.2.6 包关闭更新，需手工安装新的 0.2.7 stable 一次；不得替换 0.2.6 资产。
- 已公开 beta.7 带旧 provider，不能靠新服务器元数据保证它隔离。建议手工安装包含本修复的后续公开 beta，引导之后的 beta→beta。发布哪个 beta 由主线决定；本提交不发布、不替换公开资产。
- 主线集成 package.json 时保留本提交新增依赖、打包文件和 verify 命令，版本号及 release-plan.json 由主线更新。QA 桌面快捷方式继续由主线处理。
