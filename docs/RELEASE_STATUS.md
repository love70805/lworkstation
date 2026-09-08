# Lworkstation 发布状态

更新时间：2026-09-08

## 当前仓库版本

- 产品名称：Lworkstation
- 正式版号：`0.2.6`，已写入 `desktop/package.json` 与 `desktop/release-plan.json`
- 状态：已构建并整理到 `releases/latest/`，已公开为 GitHub Latest 稳定版，四个资产下载回读校验通过
- 稳定更新通道：`desktop/update-config.json` 保持关闭
- Windows 安装身份、内部协议与本机数据库名保持不变，以便覆盖安装保留数据
- 最近公开稳定版为 `0.2.6`；历史 Beta 保留

## 当前公开稳定版

- [v0.2.6](https://github.com/love70805/lworkstation/releases/tag/v0.2.6)，发布于 2026-09-08 16:39:57（UTC+8），非草稿、非预发布，GitHub Latest。
- 发布标签：`e0c1e682456a54fd58edb5f1cd6d67e11a5ba27b`；安全、依赖、名称和同月多店铺批量台账导入已集成。
- [Windows x64 安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.6/Lworkstation-Setup-0.2.6.exe)：116,372,923 bytes；SHA-256 `0895FB70CE440911057380E5F371E50AD14E8C1C7B79D3CC86B4B9ADFDB24F33`。
- EXE、blockmap、latest.yml、SHA256.txt 已上传并下载回读，文件名、大小、哈希一致；匿名公开下载校验清单通过。
- 稳定更新通道关闭，退出应用后手工安装；Windows 代码签名尚未配置。完整测试、产物与真实环境验收边界见 [0.2.6 发布验收](RELEASE_0.2.6.md)。

## 已发布公开 Beta

- 公开仓库：love70805/lworkstation
- v0.2.6-beta.1：引导版，需手工安装一次；安装包 88,726,534 bytes，SHA-256 1FA2C36A64AB9D9EB05C96BB113A8F19229CC93A3FE414040E2274B4B6C8D7D0。
- v0.2.6-beta.2：软件内自动更新验收版；安装包 88,726,544 bytes，SHA-256 0EA54ACAE4A29102A1DF32350C7414A1635C12A12587C255A1174CD09A4B891F。
- v0.2.6-beta.3：公开仓库基线与更新时间安全修复；安装包 88,726,721 bytes，SHA-256 787EDBD10582719303E163A96E0A0C740BE976180047D39E1E52843223D83E14。
- v0.2.6-beta.4：公开更新链验证版；安装包 88,726,356 bytes，SHA-256 6FBFC490EC41538BE211A62FEFFD7EDCEF0CB75D1207A17C9798F6BAAD3898A6。
- v0.2.6-beta.6：数据保留与安全传输集成版；安装包 88,798,962 bytes，SHA-256 6F0C6F802DBFE640AF75AF0DC91D1A6115E6CDDE4A9F406CF6DD19FFE9EC6CBA；blockmap SHA-256 4F584BFEBB9E0DDCB66D96107263CAB381C687AC4E6E7CC8178E5A5FA0C2A8AD；beta.yml SHA-256 4E83F8F7C0881FA903986A9A99BCD93394AC0F06A019A5D11C77B326BD1889C3。
- v0.2.6-beta.7：beta 更新源引导版；安装包 88,799,017 bytes，SHA-256 753A8C876C77D021AA633F8EF3076E7B93D50511A27AAC5D11D4EBAFB1E85560；blockmap SHA-256 C1442CCACD36032859CE4FD72F30E779EE3EA0BB01214C6FE1A64885FB3C233B；beta.yml SHA-256 34A597E9AFFE7A9C4EBE6C40BBBE6ADB5610C606468E8345913E322E2E6272B6。
- 七个版本均为 GitHub prerelease，完整上传 EXE、blockmap、beta.yml 和 SHA256.txt。
- 自动下载和退出即装保持关闭，更新必须由用户确认下载并显式重启安装。
- Windows 代码签名尚未配置，首次安装可能显示“未知发布者”。

## 最新发布 Beta

- 版本：`0.2.6-beta.7`
- 集成分支：`codex/selection-profit-erp-sync`
- 发布提交：`40e4da8`
- 安装包：`Lworkstation-Setup-0.2.6-beta.7.exe`
- 文件大小：`88,799,017` bytes
- SHA-256：`753A8C876C77D021AA633F8EF3076E7B93D50511A27AAC5D11D4EBAFB1E85560`
- blockmap：`94,042` bytes，SHA-256 `C1442CCACD36032859CE4FD72F30E779EE3EA0BB01214C6FE1A64885FB3C233B`
- beta.yml：`373` bytes，SHA-256 `34A597E9AFFE7A9C4EBE6C40BBBE6ADB5610C606468E8345913E322E2E6272B6`
- 更新路径：`0.2.6-beta.6 (手工安装一次) -> 0.2.6-beta.7 -> 后续 beta (软件内更新)`
- GitHub Release：`v0.2.6-beta.7`，已于 2026-09-05 03:14（UTC+8）发布为 prerelease。

## 历史本机安全候选与 Beta 更新边界

- 安全代码已通过 PR 合入集成分支及 `main`。用户选择先验收本机 Windows 桌面候选版；本机包使用独立身份 `com.shopeers.workstation.securityqa`、名称 `Lworkstation Security QA` 和测试版本 `0.2.6-beta.8`。它未公开发布。仓库正式版号现为 `0.2.6`，公开更新源仍指向已发布的 beta.7；稳定通道保持关闭。
- 本机安全 QA 包已归档至 `releases/candidates/0.2.6-beta.8-security-qa/`：`Lworkstation-Security-QA-0.2.6-beta.8.exe`，116,143,571 bytes，SHA-256 `4DFE7B2FD97DFF7759017E01ED73FD5022196946623D45C6C38EB26BC4FC9D86`。本机目录包含校验清单、说明和隔离启动入口；修复、测试、GitHub 集成与安装验收详见 [安全修复与验收](SECURITY_HARDENING_2026-09.md)。
- [版本清单](../releases/README.md) 同时列明当前公开稳定版、历史 Beta 与本机候选。beta.8 QA 从未上传；其安全修复现已纳入正式 0.2.6，但独立 QA 安装验收不能替代正式用户环境验收。
- 下一公开 beta 必须基于 beta.7 的受控 beta 更新配置继续验证真实软件内更新，并按正式发布流程另行推进元数据和构建；本机隔离安装不代替公开更新链验收。
- beta.6 的线上资产已有下载，不能替换或原地修复；需要手工安装 beta.7 一次。

## 发布门禁

- [x] 公开仓库基线、更新时间安全修复和预发布发布工具已合入集成分支。
- [x] 桌面版本与 `release-plan.json` 曾推进到 `0.2.6-beta.7`；历史更新夹具继续固定为 beta.4 回归链。
- [x] 仓库正式版号与对外产品名已切换为 `0.2.6` / Lworkstation；内部 `appId`、协议与数据库名未改。
- [x] `0.2.6` 稳定安装包构建、`release:organize` 与 `release:check`。
- [x] GitHub 稳定 Release 上传 `Lworkstation-Setup-0.2.6.exe`、blockmap、`latest.yml`、`SHA256.txt`，下载回读并确认 Latest 状态。
- [x] 前端生产构建。
- [x] Desktop verify、update smoke 与发布产物契约测试。
- [x] beta.7 安装包构建、`release:organize` 与 `release:check`。
- [x] EXE、blockmap 与 beta.yml 的 SHA-256 写入并回读。
- [x] GitHub Release 资产回读：beta.7 标签、prerelease 状态、文件名、大小、SHA-256 与 beta.yml 均匹配。
- [ ] 真实公开更新：从手工安装的 beta.7 发现、下载并显式安装后续 beta；未完成前不作通过声明。

## 权威规则

专职对话和专职 Worktree 只能交付模块提交与预览包。正式版本以本文件、`desktop/release-plan.json`、集成分支 ancestry 和主 Worktree 的发布检查结果为准；对话中的“已完成”不能替代上述门禁。

真实 ERP 登录态、采购页注入、真实分页、SKU/SKC/仓库 SKU 映射、供应商与 1688 链接、`warehouseEvidence` 完整性仍需在用户实际账号环境手工验收。
