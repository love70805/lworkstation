# Lworkstation 发布文件

- `candidates/<版本与用途>/`：仅供本机验收的候选包与校验清单，不接入公开更新源。
- `prerelease/<版本号>/`：经检查并整理的 Beta 产物，使用 `Lworkstation-Setup-<版本>.exe` 与 `beta.yml`。
- `latest/`：当前稳定版产物，使用 `Lworkstation Setup <版本>.exe` 与 `latest.yml`。
- `history/<版本号>/`：历史稳定版产物，用于回退和核对。
- 仓库根目录下的 `desktop/release/`、`desktop/release-test/`：临时构建产物与更新测试夹具，不作为已发布状态依据。

当前公开稳定版为 [0.3.5](https://github.com/love70805/lworkstation/releases/tag/v0.3.5)，公开 Beta 为 [0.3.0-beta.10](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.10)。Beta 不替代稳定 Latest。本机未安装。

## 版本清单

核对日期：2026-09-30（UTC+8）。0.3.5 已公开为非预发布的 GitHub Latest，四资产匿名全量下载、真实更新通道及主仓库持久复制回读通过；更早版本原标签与资产保留，Beta 最新仍为0.3.0-beta.10。本机按用户要求暂不安装。

| 版本 | 状态 | 入口 |
| --- | --- | --- |
| `0.3.5` 选品与 ERP 修复 | 已公开稳定Latest；PR #131/main CI、四资产匿名全量回读及真实更新通道通过；ERP8.0.26，1141测试、16组桌面、502文件/455输入；EXE FA750D5D…；未安装、未改真实库 | `candidates/0.3.5/`（含`public/`公开原件）；`archive/release-0.3.5/publication/`；[发布记录](../docs/RELEASE_0.3.5.md) |
| `0.3.4` 采集恢复 | 历史公开稳定版，原标签与资产保留；PR #129/main CI、四资产匿名回读及更新通道通过；1108测试、16组桌面验证、真实慢路径、隐藏EXE、489文件/442输入；ERP 8.0.25，未安装 | `candidates/0.3.4/`（含`public/`匿名原件）；`archive/release-0.3.4/`；[验收与哈希](../docs/RELEASE_0.3.4.md) |
| `0.3.3` 选品建档与销量标签 | 历史公开稳定版，原标签及资产保留；PR #127/main CI、1107 测试、16 组桌面验证、隐藏 EXE smoke、476 文件/429 输入、四资产匿名回读、真实更新通道及持久复制通过；含 ERP 8.0.24，未安装 | 主仓库 `candidates/0.3.3/` 及其中 `public/`；`archive/release-0.3.3/`；[验收与哈希](../docs/RELEASE_0.3.3.md) |
| `0.3.2` 共享1688单号 | 历史公开稳定版，原标签及资产保留；PR #125/main CI、1015 测试、隐藏 EXE smoke、461 文件/414 输入哈希、四资产匿名回读和真实更新通道及持久复制通过；未安装 | 主仓库 `candidates/0.3.2/`、其中 `public/` 匿名下载原件及 `archive/release-0.3.2/`；[验收与升级操作](../docs/RELEASE_0.3.2.md) |
| `0.3.1` 导入简化 | 历史公开稳定版，原标签及资产保留；PR #122/#123及main CI通过，1004测试、低级别审计、隐藏EXE smoke、461文件/414输入比对、四资产匿名完整回读与真实更新通道通过；未安装 | 主仓库 `candidates/0.3.1/`、`candidates/0.3.1-public/`；`archive/release-0.3.1/`；[发布验收及哈希](../docs/RELEASE_0.3.1.md) |
| `0.3.0` 正式版 | 历史公开稳定版，原标签及资产保留；PR #119/#120及main CI通过，984测试、隐藏EXE smoke、包体/资源哈希和四资产匿名回读通过；未安装 | 主仓库 `releases/candidates/0.3.0-public/`；原候选 `releases/candidates/0.3.0/`；[验收及哈希](../docs/RELEASE_0.3.0.md) |
| `0.3.0-rc.2` ERP自动采用修复 | 历史验收记录；应用归档后原安装包未寻获，源码已恢复至正式候选；未公开或安装 | [验收记录](../docs/RELEASE_0.3.0_RC_2.md) |
| `0.3.0-rc.1` ERP商品档案 | 历史验收记录；应用归档后原安装包未寻获；未公开、未安装 | [验收与限制](../docs/RELEASE_0.3.0_RC_1.md) |
| `0.3.0-beta.10` saved report / color lamp | 已公开预发布；925测试、Windows候选smoke、PR #115/main CI、四资产匿名回读与通道检查通过，本机未安装 | `candidates/0.3.0-beta.10-export-status/`；[验收](../docs/RELEASE_0.3.0_BETA_10.md) |
| `0.3.0-beta.9` cost rows / identity / ERP lamp / Excel | 已公开 GitHub 预发布；920 测试、桌面 verify、packaged smoke、隔离浏览器 / Electron 通信与两类 XLSX 读回、PR #113 / main CI、四资产匿名回读及通道检查通过，本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.9)；`candidates/0.3.0-beta.9-cost-identity-status-export/`；[验收](../docs/RELEASE_0.3.0_BETA_9.md) |
| `0.3.0-beta.8` published ERP evidence | 已公开 GitHub 预发布；878 测试、桌面 verify、packaged smoke、隔离 11 条采购与旧行只读恢复、PR #111 / main CI、四资产匿名回读及通道检查通过，本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.8)；`candidates/0.3.0-beta.8-evidence-reference/`；[验收](../docs/RELEASE_0.3.0_BETA_8.md) |
| `0.3.0-beta.7` cost recovery | 已公开 GitHub 预发布；876 测试、桌面 verify、packaged smoke、隔离旧草稿 4.59 元业务路径、PR #109 / main CI、四资产匿名回读及通道检查通过，本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.7)；`candidates/0.3.0-beta.7-cost-recovery/`；[验收](../docs/RELEASE_0.3.0_BETA_7.md) |
| `0.3.0-beta.6` automatic ERP adoption | 已公开 GitHub 预发布；865 测试、桌面 verify、packaged smoke、隔离业务路径、PR #107 / main CI、四资产匿名回读及通道检查通过，本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.6)；`candidates/0.3.0-beta.6-auto-erp-profit/`；[验收](../docs/RELEASE_0.3.0_BETA_6.md) |
| `0.3.0-beta.5` workflow consistency | 已公开 GitHub 预发布；837 测试、缓存实测、Windows 候选、PR #103 / main CI、四资产回读及通道隔离通过，本机未安装 | `candidates/0.3.0-beta.5-workflow-consistency/`；[验收](../docs/RELEASE_0.3.0_BETA_5.md) |
| `0.3.0-beta.4` ledger preview | 已公开 GitHub 预发布；772 测试、实际扩展月份传递/自动回传、PR #101 / main CI、四资产回读和更新通道检查通过；本机未安装 | `candidates/0.3.0-beta.4-ledger-preview/`；[验收](../docs/RELEASE_0.3.0_BETA_4.md) |
| `0.3.0-beta.3` cost/recovery | 已公开 GitHub 预发布；755 测试、13 组桌面验证、原生恢复和最终候选交互、PR #98 / main CI、四资产回读与更新检测通过，本机未安装 | `candidates/0.3.0-beta.3-cost-recovery/`；[验收](../docs/RELEASE_0.3.0_BETA_3.md) |
| `0.3.0-beta.2` prior-month latest-three | 已公开 GitHub 预发布；751 测试、PR #94 / main CI、12 组桌面验证、b,a,b 跨月选样/人工更正交互、smoke、四资产回读和更新检测通过；临时试验规则，本机未安装 | `candidates/0.3.0-beta.2-prior-month/`；`prerelease/0.3.0-beta.2/`；[验收](../docs/RELEASE_0.3.0_BETA_2.md) |
| `0.3.0-beta.1` ledger cutoff | 已公开 GitHub 预发布；743 测试、PR #92 / main CI、12 组桌面验证、跨月成本与人工更正 Electron 交互、smoke、四资产回读及通道隔离通过；本机未安装 | `candidates/0.3.0-beta.1-ledger-cutoff/`；[验收](../docs/RELEASE_0.3.0_BETA_1.md) |
| `0.3.0-beta` human first | 历史 GitHub 预发布；719 测试、CI、12 组桌面验证、实际 Electron 交互、packaged smoke、四资产回读及通道隔离通过；本机未安装 | `candidates/0.3.0-beta-human-first/`；`prerelease/0.3.0-beta/`；[验收](../docs/RELEASE_0.3.0_BETA.md) |
| `0.2.19` sales detail | 历史稳定版；709 测试、CI、Windows packaged smoke、四资产回读/稳定通道通过；本机未安装 | `candidates/0.2.19-sales-detail/`；[验收](../docs/RELEASE_0.2.19.md) |
| `0.2.18` stacked sales | 历史稳定版 | [验收](../docs/RELEASE_0.2.18.md) |
| `0.2.17` grouped sales | 历史稳定版 | [验收](../docs/RELEASE_0.2.17.md) |
| `0.2.16` UI/cache | 已公开 GitHub Latest；681测试、CI、Windows候选、四资产回读及稳定通道通过；本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.16)；`candidates/0.2.16-ui-cache/`；[验收](../docs/RELEASE_0.2.16.md) |
| `0.2.15` profit usability | 历史稳定版；649测试、CI、Windows候选、四资产回读/稳定更新通过；本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.15)；`candidates/0.2.15-profit-usability/`；[验收](../docs/RELEASE_0.2.15.md) |
| `0.2.14` daily details | 历史稳定版；643 测试、CI、Windows 候选及四资产回读 / 更新通道通过；本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.14)；本机 `candidates/0.2.14-daily-details/`；[验收](../docs/RELEASE_0.2.14.md) |
| `0.2.13` daily sales | 历史稳定版；640测试、CI、12组浏览器布局/交互、Windows实际候选、四资产匿名回读与通道隔离通过；本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.13)；本机 `candidates/0.2.13-daily-sales/`；[更新与验收](../docs/RELEASE_0.2.13.md) |
| `0.2.12` complete local update | 历史稳定版；612测试、完整候选操作、CI、四资产回读与通道隔离通过；本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.12)；本机 `candidates/0.2.12-complete-local-update/`；[验收](../docs/RELEASE_0.2.12.md) |
| `0.2.11` restore overview | 历史稳定版；582测试/CI/页面/打包/下载与四资产回读通过，本机不安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.11)；本机 candidates/0.2.11-restore-overview；[验收记录](../docs/RELEASE_0.2.11.md) |
| `0.2.10` local desktop | 历史稳定版，581测试/CI/打包运行/更新下载与四资产回读通过；本机暂不安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.10)；本机 `candidates/0.2.10-local-desktop/`；[验收记录](../docs/RELEASE_0.2.10.md) |
| `0.2.9` | 历史稳定版，本机当前安装版；ERP写入修复 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.9)；[验收记录](../docs/RELEASE_0.2.9.md) |
| `0.2.9` ERP inbox recovery | 候选验收、代码合并和公开资产回读已完成 | 本机 `candidates/0.2.9-erp-inbox-recovery/` |
| `0.2.8` | 历史稳定版；本机升级与重启验收通过 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.8)；[验收记录](../docs/RELEASE_0.2.8.md) |
| `0.2.8` stable acceptance | 已完成本机候选验收、代码集成和公开发布，候选与公开包相同 | 本机 `candidates/0.2.8-stable-acceptance/` |
| `0.2.7` | 历史稳定版；可通过稳定更新源发现 0.2.8 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.7) |
| `0.2.6` | 历史稳定版；原资产保留 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.6)；该旧包更新关闭 |
| `0.2.6-beta.7` | 历史公开 Beta | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.6-beta.7)，本机 `prerelease/0.2.6-beta.7/` |
| `0.2.6-beta.8` Security QA | 本机隔离安装、覆盖升级与重启验收通过；未公开发布 | 本机 `candidates/0.2.6-beta.8-security-qa/`，详见 [安全验收记录](../docs/SECURITY_HARDENING_2026-09.md) |

QA 包使用独立应用身份，不能作为正式应用的更新包上传。GitHub Releases 只列出实际创建的发布条目；合并代码和更新本清单不会自动创建 Release。安装包、运行日志及数据库不提交 Git，本机目录仅在归档机器上存在。

本机 beta.8 QA 已补“Lworkstation QA beta.8（仅测试）”桌面快捷方式，使用隔离启动器且公开更新关闭。0.2.7 临时安装验收应用已卸载，只保留证据。旧公开 beta.7 没有严格通道修复，继续 Beta 建议手工下载当前 `0.3.0-beta`；不假定旧安装包可自动升级。

0.3.1使用 `candidateOnly:true` 和 `release:build` 构建稳定配置候选，验收原件位于 `candidates/0.3.1/`，公开副本位于 `candidates/0.3.1-public/`；EXE/blockmap/元数据保持同字节，公开校验清单使用规范文件名。GitHub Latest已切到0.3.1，本机 `latest/` 目录未改动，不能以该历史目录判断公开版本。0.3.0原候选和公开副本保留。

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

## 0.2.17 分组销售图
位置：releases/candidates/0.2.17-grouped-sales/。纯本机 Windows，候选已验收并公开稳定版；本机未安装。详见 docs/RELEASE_0.2.17.md。

## 0.2.18 堆叠销售
位置：releases/candidates/0.2.18-stacked-sales/。Windows候选已通过并公开发布，本机未安装。详见 docs/RELEASE_0.2.18.md。
