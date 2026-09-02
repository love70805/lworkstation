# Lworkstation 发布状态

更新时间：2026-09-02

## 已发布公开 Beta

- 公开仓库：love70805/lworkstation
- v0.2.6-beta.1：引导版，需手工安装一次；安装包 88,726,534 bytes，SHA-256 1FA2C36A64AB9D9EB05C96BB113A8F19229CC93A3FE414040E2274B4B6C8D7D0。
- v0.2.6-beta.2：软件内自动更新验收版；安装包 88,726,544 bytes，SHA-256 0EA54ACAE4A29102A1DF32350C7414A1635C12A12587C255A1174CD09A4B891F。
- v0.2.6-beta.3：公开仓库基线与更新时间安全修复；安装包 88,726,721 bytes，SHA-256 787EDBD10582719303E163A96E0A0C740BE976180047D39E1E52843223D83E14。
- v0.2.6-beta.4：公开更新链验证版；安装包 88,726,356 bytes，SHA-256 6FBFC490EC41538BE211A62FEFFD7EDCEF0CB75D1207A17C9798F6BAAD3898A6。
- 四个版本均为 GitHub prerelease，完整上传 EXE、blockmap、beta.yml 和 SHA256.txt。
- 自动下载和退出即装保持关闭，更新必须由用户确认下载并显式重启安装。
- Windows 代码签名尚未配置，首次安装可能显示“未知发布者”。

## 最新发布 Beta

- 版本：`0.2.6-beta.5`
- 集成分支：`codex/selection-profit-erp-sync`
- 发布提交：`ad8d875`
- 安装包：`Lworkstation-Setup-0.2.6-beta.5.exe`
- 文件大小：`88,799,635` bytes
- SHA-256：`3369A15C9BA77C785F307F0D89F215B34018C371078C8B92FB66B03B117B0C39`
- 更新路径：`0.2.6-beta.4 -> 0.2.6-beta.5`
- GitHub Release：`v0.2.6-beta.5`，已于 2026-09-02 发布为 prerelease。

## 发布门禁

- [x] 公开仓库基线、更新时间安全修复和预发布发布工具已合入集成分支。
- [x] 桌面版本与 `release-plan.json` 已推进到 `0.2.6-beta.5`；历史更新夹具继续固定为 beta.4 回归链。
- [x] 前端测试：71 files / 493 tests。
- [x] 前端生产构建。
- [x] Desktop verify 与发布产物契约测试。
- [x] beta.5 安装包构建。
- [x] Packaged smoke：工作站、ERP、1688、运行时端口注入、ERP inbox v2、工作站读取确认和扩展加载通过。
- [x] Update smoke：历史 beta.3 -> beta.4 更新链通过；beta.5 发布后需补充线上回读。
- [x] `pnpm --dir desktop release:organize`：beta 资产整理到隔离的 prerelease 目录。
- [x] `pnpm --dir desktop release:check`。
- [x] EXE、blockmap 与 beta.yml 的 SHA-256 均写入并通过校验。
- [x] GitHub Release 资产回读：标签、prerelease 状态、文件名与文件大小均匹配。
- [x] GitHub Release 资产回读：标签、文件大小、SHA-256 与 beta.yml 均匹配。
- [x] 真实公开更新：beta.3 从 GitHub 发现、下载 beta.4，并仅在显式操作时触发安装。

## 权威规则

专职对话和专职 Worktree 只能交付模块提交与预览包。正式版本以本文件、`desktop/release-plan.json`、集成分支 ancestry 和主 Worktree 的发布检查结果为准；对话中的“已完成”不能替代上述门禁。

真实 ERP 登录态、采购页注入、真实分页、SKU/SKC/仓库 SKU 映射、供应商与 1688 链接、`warehouseEvidence` 完整性仍需在用户实际账号环境手工验收。
