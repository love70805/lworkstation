# Lworkstation 0.2.6 发布验收

状态：2026-09-08 16:39:57（UTC+8）已公开发布为 Latest 稳定版：[v0.2.6](https://github.com/love70805/lworkstation/releases/tag/v0.2.6)。四个资产下载回读 SHA-256 全部一致，匿名公开校验清单下载通过。

## 范围

- 以集成分支为正式构建源，发布版本 0.2.6；不使用独立应用身份的旧 Security QA 包。
- 纳入安全修复、已验证依赖升级、Lworkstation 对外名称统一、同月多店铺批量台账导入。
- 保留 shopeers-desktop、com.shopeers.workstation、协议、数据库与会话分区等兼容身份。
- 稳定更新通道保持关闭；本轮作为手工下载安装的稳定版发布，不宣称 beta 软件内升级到稳定版已验收。
- 保留现有历史 Beta Release 和资产，不覆盖同名已发布安装包。

## 发布门禁

- [x] 业务代码已合入集成分支与 main；主线 77 文件 / 532 测试、生产构建、桌面 verify、真实合成台账浏览器验收以及合并后 CI 通过。
- [x] release-plan 增加本次四组功能必需提交，避免从旧代码构建。
- [x] 从集成主 Worktree 构建 Windows NSIS 安装包。
- [x] packaged smoke 与包内版本、身份、更新配置、前端和扩展资源检查。
- [x] release:organize、release:check、SHA-256 清单。
- [x] GitHub Release 上传、文件名/大小/哈希回读，确认稳定版及 latest 状态。
- [x] 更新 README、发布清单、RELEASE_STATUS 和本记录的实际产物数据。

## 验收边界

本次自动化验收使用隔离目录和合成数据。真实 ERP/1688 账号操作与真实业务账本仍需用户环境验证；不以合成 smoke 冒充真实账号或线上升级验收。Windows 代码签名尚未配置，安装时可能显示未知发布者。

## 已验证产物

- 正式构建基线：集成 `7d9e279`，Electron 44.2.0，Windows x64 / NSIS，构建显式使用 `--publish never`。
- 构建生成的图标提交为 `56437f1`；发布标签固定在集成 `e0c1e682456a54fd58edb5f1cd6d67e11a5ba27b`，已通过 PR #27 合入 main。后续发布状态文档不改变标签与安装包。
- NSIS 安装包提取出的 404 个程序文件，与已通过 packaged smoke 的应用逐项 SHA-256 一致。
- 公开 SHA256.txt：279 bytes；SHA-256 `1EB7DA85B74BD00AF3A1A1B49BC6B5D8850EADE34FDADADCE30460CD4ED2B17E`。
- 安装包：116,372,923 bytes；SHA-256 `0895FB70CE440911057380E5F371E50AD14E8C1C7B79D3CC86B4B9ADFDB24F33`。
- blockmap：122,302 bytes；SHA-256 `84602F2E821DA0609EA58A2DAEF487B71D9566C69F01A5A6B2A42971D60DA443`。
- latest.yml：353 bytes；SHA-256 `7CB1E61B528FE06621A8FD9EB31AA024333B95E548E934AA3F7187B8BE8F3EC5`。
- 本机正式目录 `releases/latest/` 使用既有 `Lworkstation Setup 0.2.6.exe` 命名。公开资产使用与 latest.yml 完全一致的 `Lworkstation-Setup-0.2.6.exe` 和同名 blockmap；字节内容与本机原件一致，公开 SHA256.txt 按公开文件名生成。
- 构建从校验过的 L7 SVG 母版重新生成 ICO/PNG；本轮提交生成结果，使跟踪的图标与实际包一致。母版与产品设计不变。
- 实际 packaged smoke 已通过：隔离用户目录、ERP/1688 扩展、inbox v2、工作站/远端视图隔离、缩放、更新检查及浮窗生命周期。包内 app.asar 版本 0.2.6、包名 shopeers-desktop，资源更新配置 enabled=false，未含 update-beta-config.json；关键脚本与当前源码逐字节一致。
- 证据归档：主仓库 `archive/release-0.2.6-2026-09-08/`，包含旧构建归档、构建/smoke/整理/发布检查日志、包检查记录、四类上传资产、GitHub 下载回读与公开发布元数据。未对正式用户安装执行覆盖；不声称真实安装迁移或线上更新验收完成。
