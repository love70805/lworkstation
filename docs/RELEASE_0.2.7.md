# Lworkstation 0.2.7 更新通道验收

状态：2026-09-08 20:55:26（UTC+8）已公开为 [v0.2.7 Latest 稳定版](https://github.com/love70805/lworkstation/releases/tag/v0.2.7)，四个资产下载回读及匿名公开下载通过。

## 已确认范围

- 公开稳定版和 Beta 默认开启更新检查；稳定版仅接收较新的稳定版，Beta 仅接收较新的 Beta，禁止跨通道和降级。
- 下载由用户确认，安装由用户显式触发；不自动下载、不退出即装。
- 本次稳定补丁使用 0.2.7，不替换已公开 0.2.6 的资产。旧 0.2.6 更新关闭，首次切换需手工安装。
- Security QA beta.8 保持独立应用身份、隔离数据、独立 inbox 端口和关闭公开更新。桌面增加“Lworkstation QA beta.8（仅测试）”快捷方式，调用已有隔离启动脚本。
- 不改变业务规则、数据库、正式应用身份或用户数据目录。

## 转接记录

- 主责：桌面化（任务 `01a08103-9373-70e0-89dc-746707e8bd40`）；实现范围为 desktop 更新配置、候选选择、下载安装防护及桌面测试。
- 基线：`codex/selection-profit-erp-sync` 的 `72d21e9c06f6c18904d067b5603184ba6faa5588`。
- 根因：稳定 enabled=false；当前运行时缺少明确目标通道与递增版本防护，底层 provider 与 channel setter 行为需核验。
- 主线负责审查、发布元数据、完整回归、GitHub 集成、正式构建和资产回读；其他业务对话不受影响。
- 合并前置：专职独立 Conventional Commit、通道与降级负例通过、下载安装显式操作通过、QA 不意外接入公开更新。

## 验收门禁

- [x] QA 快捷方式创建并回读，指向隔离 PowerShell 启动器；包内更新仍 enabled=false。
- [x] 桌面专职 `ac61143`，主线承接 `33fc968`，审查通过；desktop verify 10 个脚本通过。实际 AppUpdater/provider 内存响应覆盖跨通道、降级、元数据错配和缓存错配；不代替真实安装。
- [x] 前端 77 文件 / 532 测试、生产构建、desktop verify 10 个脚本。
- [x] 正式 packaged smoke、真实 GitHub 分流回读、稳定 NSIS 下载与哈希、Beta 打包夹具下载/取消/重试/显式安装调用。跨通道/降级负例由真实 provider 内存 HTTP 测试覆盖。
- [x] 独立临时身份实际执行 0.2.6→0.2.7 NSIS 覆盖安装和两次启动，合成数据、外观与缩放保留。此项独立于截获 quitAndInstall 的 Beta smoke。
- [x] PR #30 / #31 合入集成 `b223fb7` 与 main `623afc9`，合并后 CI 通过。
- [x] 正式安装包构建、整理、发布检查；404 个安装包内文件与已通过 smoke 的程序一致。
- [x] GitHub 稳定 Release 上传、下载回读及 Latest 核对，安装包匿名 HTTP 200。

## 产物与边界

- 标签固定在构建基线 `b223fb7a82b742c687ede0abd2dc1bad0c1878fe`；Electron 44.2.0、Windows x64、NSIS。稳定包内 enabled=true / channel=latest，打包的运行时含新通道策略。
- EXE：116,374,384 bytes，SHA-256 `94B8DC67893F233A9E80374A54F822ACA2BBB6697331B6238EFB26E59E6FC810`。
- blockmap：122,307 bytes，SHA-256 `0E8F6A463F235F7D217361426A5C0B4F8E7A467EF8FE49DD209F980C73828B4E`。
- latest.yml：353 bytes，SHA-256 `71B1FD9995C52DF4977BB2F18B09A65A0D7ACE9D98D75E6ABFDFA787ECCBFBFC`。
- 本机 `releases/latest/` 使用空格文件名；公开 EXE/blockmap 使用与 latest.yml 一致的连字符命名，字节相同。SHA256.txt 使用公开文件名。
- 原始安装与新版重启的合成数据哈希均为 `74b6451ef9217e69a2c5c33badf17171ad92e2b454f839118dbe37de46be2720`。临时验收应用已卸载，注册项已删除；正式版、旧 QA 程序及快捷方式哈希未变。
- 未覆盖用户正式安装。0.2.6 需手工安装 0.2.7 一次；旧 beta.7 仍携带旧策略，本轮未发布新 Beta，不能宣称旧客户端已获得通道修复。
- Windows 未配置代码签名。第一次图标生成出现临时 UnknownVizError，重试成功且 PNG/ICO 哈希与已提交资产一致；未修改图标代码或设计。

原始证据放在主仓库 `archive/release-0.2.7-2026-09-08/`；未完成项不得标记通过。真实 ERP/1688 账号与业务数据库不用于自动化验收。
