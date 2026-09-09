# Lworkstation 发布文件

- `candidates/<版本与用途>/`：仅供本机验收的候选包与校验清单，不接入公开更新源。
- `prerelease/<版本号>/`：经检查并整理的 Beta 产物，使用 `Lworkstation-Setup-<版本>.exe` 与 `beta.yml`。
- `latest/`：当前稳定版产物，使用 `Lworkstation Setup <版本>.exe` 与 `latest.yml`。
- `history/<版本号>/`：历史稳定版产物，用于回退和核对。
- 仓库根目录下的 `desktop/release/`、`desktop/release-test/`：临时构建产物与更新测试夹具，不作为已发布状态依据。

当前公开稳定版为 [0.2.10](https://github.com/love70805/lworkstation/releases/tag/v0.2.10)，安装包已整理至 `latest/`，四个公开资产下载回读校验通过，0.2.9可经稳定通道发现新版。用户要求本机暂不安装，正式应用仍为0.2.9。下载入口、发布状态与验收边界以 [发布状态](../docs/RELEASE_STATUS.md) 为准。

## 版本清单

核对日期：2026-09-10。0.2.10 已公开发布；本机按用户要求暂不安装，正式版仍为 0.2.9。

| 版本 | 状态 | 入口 |
| --- | --- | --- |
| `0.2.10` local desktop | 已公开 GitHub Latest，581测试/CI/打包运行/更新下载与四资产回读通过；本机暂不安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.10)；本机 `candidates/0.2.10-local-desktop/`；[验收记录](../docs/RELEASE_0.2.10.md) |
| `0.2.9` | 历史稳定版，本机当前安装版；ERP写入修复 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.9)；[验收记录](../docs/RELEASE_0.2.9.md) |
| `0.2.9` ERP inbox recovery | 候选验收、代码合并和公开资产回读已完成 | 本机 `candidates/0.2.9-erp-inbox-recovery/` |
| `0.2.8` | 历史稳定版；本机升级与重启验收通过 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.8)；[验收记录](../docs/RELEASE_0.2.8.md) |
| `0.2.8` stable acceptance | 已完成本机候选验收、代码集成和公开发布，候选与公开包相同 | 本机 `candidates/0.2.8-stable-acceptance/` |
| `0.2.7` | 历史稳定版；可通过稳定更新源发现 0.2.8 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.7) |
| `0.2.6` | 历史稳定版；原资产保留 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.6)；该旧包更新关闭 |
| `0.2.6-beta.7` | 已公开预发布，当前公开 Beta | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.6-beta.7)，本机 `prerelease/0.2.6-beta.7/` |
| `0.2.6-beta.8` Security QA | 本机隔离安装、覆盖升级与重启验收通过；未公开发布 | 本机 `candidates/0.2.6-beta.8-security-qa/`，详见 [安全验收记录](../docs/SECURITY_HARDENING_2026-09.md) |

QA 包使用独立应用身份，不能作为正式应用的更新包上传。GitHub Releases 只列出实际创建的发布条目；合并代码和更新本清单不会自动创建 Release。安装包、运行日志及数据库不提交 Git，本机目录仅在归档机器上存在。

本机 beta.8 QA 已补“Lworkstation QA beta.8（仅测试）”桌面快捷方式，使用隔离启动器且公开更新关闭。0.2.7 临时安装验收应用已卸载，只保留证据。旧公开 beta.7 没有本轮通道修复，本轮未发布新 Beta。

## 公开 Beta 构建与归档

Beta 候选验证与整理顺序（在仓库根目录执行）：

```powershell
pnpm --dir desktop verify
pnpm --dir desktop release:build
pnpm --dir desktop smoke:packaged
pnpm --dir desktop release:organize
pnpm --dir desktop release:check
```

`release:build` 打入受控 beta 更新配置，将候选暂存于 `desktop/release-test/<版本>/`；`release:organize` 再将其整理至 `releases/prerelease/<版本>/`。稳定版构建使用 `pnpm --dir desktop build`，其余验证与整理步骤相同，由 `release-plan.json` 中的版本决定归档路径和更新元数据。

专职 Worktree 的安装包仍然只是预览包；正式交付必须从集成分支执行对应流程。公开上传与真实安装验收见 [更新测试清单](../desktop/UPDATE_RELEASE_CHECKLIST.md)。
