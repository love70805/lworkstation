# Lworkstation 发布状态

更新时间：2026-09-05

## 已发布公开 Beta

- 公开仓库：love70805/lworkstation
- v0.2.6-beta.1：引导版，需手工安装一次；安装包 88,726,534 bytes，SHA-256 1FA2C36A64AB9D9EB05C96BB113A8F19229CC93A3FE414040E2274B4B6C8D7D0。
- v0.2.6-beta.2：软件内自动更新验收版；安装包 88,726,544 bytes，SHA-256 0EA54ACAE4A29102A1DF32350C7414A1635C12A12587C255A1174CD09A4B891F。
- v0.2.6-beta.3：公开仓库基线与更新时间安全修复；安装包 88,726,721 bytes，SHA-256 787EDBD10582719303E163A96E0A0C740BE976180047D39E1E52843223D83E14。
- v0.2.6-beta.4：公开更新链验证版；安装包 88,726,356 bytes，SHA-256 6FBFC490EC41538BE211A62FEFFD7EDCEF0CB75D1207A17C9798F6BAAD3898A6。
- v0.2.6-beta.6：数据保留与安全传输集成版；安装包 88,798,962 bytes，SHA-256 6F0C6F802DBFE640AF75AF0DC91D1A6115E6CDDE4A9F406CF6DD19FFE9EC6CBA；blockmap SHA-256 4F584BFEBB9E0DDCB66D96107263CAB381C687AC4E6E7CC8178E5A5FA0C2A8AD；beta.yml SHA-256 4E83F8F7C0881FA903986A9A99BCD93394AC0F06A019A5D11C77B326BD1889C3。
- 六个版本均为 GitHub prerelease，完整上传 EXE、blockmap、beta.yml 和 SHA256.txt。
- 自动下载和退出即装保持关闭，更新必须由用户确认下载并显式重启安装。
- Windows 代码签名尚未配置，首次安装可能显示“未知发布者”。

## 最新发布 Beta

- 版本：`0.2.6-beta.6`
- 集成分支：`codex/selection-profit-erp-sync`
- 发布提交：`048cb6d`
- 安装包：`Lworkstation-Setup-0.2.6-beta.6.exe`
- 文件大小：`88,798,962` bytes
- SHA-256：`6F0C6F802DBFE640AF75AF0DC91D1A6115E6CDDE4A9F406CF6DD19FFE9EC6CBA`
- blockmap：`93,989` bytes，SHA-256 `4F584BFEBB9E0DDCB66D96107263CAB381C687AC4E6E7CC8178E5A5FA0C2A8AD`
- beta.yml：`373` bytes，SHA-256 `4E83F8F7C0881FA903986A9A99BCD93394AC0F06A019A5D11C77B326BD1889C3`
- 更新路径：`0.2.6-beta.5 -> 0.2.6-beta.6`
- GitHub Release：`v0.2.6-beta.6`，已于 2026-09-04 18:41 UTC 发布为 prerelease。

## 当前发布候选

- 目标版本：`0.2.6-beta.7`
- 目标更新路径：`0.2.6-beta.6 (手工安装一次) -> 0.2.6-beta.7 -> 后续 beta (软件内更新)`
- 本轮包含：把 beta 更新配置仅在 prerelease 打包后的资源目录中受控写入；稳定包继续保持 `enabled: false`、`channel: latest`。
- 状态：候选构建和 GitHub prerelease 发布待执行。beta.6 的线上资产已有下载，不能替换或原地修复。

## 发布门禁

- [x] 公开仓库基线、更新时间安全修复和预发布发布工具已合入集成分支。
- [ ] 桌面版本与 `release-plan.json` 推进到 `0.2.6-beta.7`；历史更新夹具继续固定为 beta.4 回归链。
- [ ] 前端测试与生产构建。
- [ ] Desktop verify、update smoke 与发布产物契约测试。
- [ ] beta.7 安装包构建、`release:organize` 与 `release:check`。
- [ ] EXE、blockmap 与 beta.yml 的 SHA-256 写入并回读。
- [ ] GitHub Release 资产回读：beta.7 标签、prerelease 状态、文件名、大小、SHA-256 与 beta.yml 均匹配。
- [ ] 真实公开更新：从手工安装的 beta.7 发现、下载并显式安装后续 beta；未完成前不作通过声明。

## 权威规则

专职对话和专职 Worktree 只能交付模块提交与预览包。正式版本以本文件、`desktop/release-plan.json`、集成分支 ancestry 和主 Worktree 的发布检查结果为准；对话中的“已完成”不能替代上述门禁。

真实 ERP 登录态、采购页注入、真实分页、SKU/SKC/仓库 SKU 映射、供应商与 1688 链接、`warehouseEvidence` 完整性仍需在用户实际账号环境手工验收。
