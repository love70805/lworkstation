# Lworkstation 发布状态

更新时间：2026-09-10

## 当前公开稳定版 0.2.10

- 仓库版号为 `0.2.10`，PR #47/#48 已合入集成及 main，581 项测试、CI、生产构建、打包运行和真实更新下载校验通过。
- 公开包与本机 `releases/candidates/0.2.10-local-desktop/` 候选相同；详见 [验收记录](RELEASE_0.2.10.md)。本轮不追加或执行云端数据库迁移。
- 用户选择暂不安装；本机正式版为 `0.2.9`，业务数据未改动。[GitHub v0.2.10](https://github.com/love70805/lworkstation/releases/tag/v0.2.10) 已于 2026-09-10 03:13:02（UTC+8）公开 Latest；四资产匿名下载回读校验通过。0.2.9 稳定通道可发现新版，Beta 不接受该包。

## 历史稳定版状态（0.2.9）

- 产品名称：Lworkstation
- 历史正式版号：`0.2.9`；仓库及公开版本已更新为 `0.2.10`
- 状态：已公开为 GitHub Latest 稳定版，四个资产下载回读校验通过；本机旧产物已归档 `releases/history/0.2.9/`，`releases/latest/` 当前保存已公开的 0.2.10 构建
- 稳定更新通道：`desktop/update-config.json` 默认开启；严格同通道升级，用户确认下载与安装
- Windows 安装身份、内部协议与本机数据库名保持不变，以便覆盖安装保留数据
- 本机正式安装仍为 `0.2.9`，公开新版为 `0.2.10`；本轮未执行安装。历史稳定版与 Beta 保留

## 历史稳定版 0.2.9

- [v0.2.9](https://github.com/love70805/lworkstation/releases/tag/v0.2.9)，2026-09-09 11:52:44（UTC+8）公开为GitHub Latest，四个资产匿名下载回读通过。
- 修复ERP收件并发写入和Windows短暂拒绝替换的恢复缺口；失败保留原文件，后续回传保持幂等。
- [Windows x64安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.9/Lworkstation-Setup-0.2.9.exe)：116,376,621 bytes；SHA-256 `739524B980EE295D27B5E7544FD9D611123D2A2DC4DFA130E27A962F198F04B0`。
- 552项测试、完整门禁、打包smoke、打包服务并发/原生Windows拒绝复测及实际NSIS下载校验通过。0.2.8可发现新版，异常电脑升级后的真实回传结果待用户验收。详见 [0.2.9验收](RELEASE_0.2.9.md)。
- 开发测试依赖Vitest已补到4.1.11；不改变利润规则、数据库和安装身份，未执行云端迁移。

## 历史稳定版 0.2.8

- [v0.2.8](https://github.com/love70805/lworkstation/releases/tag/v0.2.8)，2026-09-09 01:00:17（UTC+8）公开为 GitHub Latest，四个资产匿名下载回读通过。
- 构建标签 `8591b5191e5489d87e7d12f4892f29f9f397e2b1`；利润精度、ERP 异常搜索/四位显示、窗口化按钮与单实例修复已交付。
- [Windows x64 安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.8/Lworkstation-Setup-0.2.8.exe)：116,376,271 bytes；SHA-256 `59E8AFBB96A9492FE59A2B0D8596124F634BB071A64E212B6CF4CFF7966C7877`。
- 552 项测试及发布门禁通过。本机使用公开包覆盖原 0.2.7，404 个载荷哈希一致，849 个数据文件在安装过程中未变；启动/重启、业务表指纹、重复启动与快捷方式验收通过。详见 [0.2.8 验收](RELEASE_0.2.8.md)。
- 默认检查稳定更新，0.2.7 可发现新版；Beta 不接收该包。Windows 未签名，0011 云端精度迁移尚未线上执行。

## 历史稳定版 0.2.7

- [v0.2.7](https://github.com/love70805/lworkstation/releases/tag/v0.2.7)，发布于 2026-09-08 20:55:26（UTC+8），非草稿、非预发布，GitHub Latest。
- 发布基线 `b223fb7a82b742c687ede0abd2dc1bad0c1878fe`。默认开启稳定检查；新 Beta 构建严格 beta 通道。禁止跨通道和降级，不自动下载、不退出即装。
- [Windows x64 安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.7/Lworkstation-Setup-0.2.7.exe)：116,374,384 bytes；SHA-256 `94B8DC67893F233A9E80374A54F822ACA2BBB6697331B6238EFB26E59E6FC810`。
- 四个公开资产下载回读一致，匿名下载通过。532 测试、桌面 smoke、实际稳定下载与隔离安装数据保留、GitHub CI 通过，详见 [0.2.7 验收](RELEASE_0.2.7.md)。
- 旧稳定版 0.2.6 需手工安装新版一次；旧 beta.7 未获得本修复，本轮未发布新 Beta，后续需手工迁移到包含修复的同通道版本。用户正式安装未被自动覆盖。Windows 仍未签名。

## 历史稳定版 0.2.6

- [v0.2.6](https://github.com/love70805/lworkstation/releases/tag/v0.2.6)，发布于 2026-09-08 16:39:57（UTC+8），历史稳定版，原资产未变。
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

- 安全代码已通过 PR 合入集成分支及 `main`。本机安全 QA 使用独立身份 `com.shopeers.workstation.securityqa`、名称 `Lworkstation Security QA` 和测试版本 `0.2.6-beta.8`，未公开发布且更新关闭。已补“Lworkstation QA beta.8（仅测试）”桌面快捷方式；当前正式发布为 0.2.7。
- 本机安全 QA 包已归档至 `releases/candidates/0.2.6-beta.8-security-qa/`：`Lworkstation-Security-QA-0.2.6-beta.8.exe`，116,143,571 bytes，SHA-256 `4DFE7B2FD97DFF7759017E01ED73FD5022196946623D45C6C38EB26BC4FC9D86`。本机目录包含校验清单、说明和隔离启动入口；修复、测试、GitHub 集成与安装验收详见 [安全修复与验收](SECURITY_HARDENING_2026-09.md)。
- [版本清单](../releases/README.md) 同时列明当前公开稳定版、历史 Beta 与本机候选。beta.8 QA 从未上传；其安全修复现已纳入正式 0.2.6，但独立 QA 安装验收不能替代正式用户环境验收。
- 下一公开 beta 必须基于 beta.7 的受控 beta 更新配置继续验证真实软件内更新，并按正式发布流程另行推进元数据和构建；本机隔离安装不代替公开更新链验收。
- beta.6 的线上资产已有下载，不能替换或原地修复；需要手工安装 beta.7 一次。

## 历史 0.2.6 与 Beta 发布门禁（当前 0.2.7 见独立验收记录）

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
