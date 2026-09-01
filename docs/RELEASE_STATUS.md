# Lworkstation 发布状态

更新时间：2026-09-01

## 已发布公开 Beta

- 公开仓库：love70805/lworkstation
- v0.2.6-beta.1：引导版，需手工安装一次；安装包 88,726,534 bytes，SHA-256 1FA2C36A64AB9D9EB05C96BB113A8F19229CC93A3FE414040E2274B4B6C8D7D0。
- v0.2.6-beta.2：软件内自动更新验收版；安装包 88,726,544 bytes，SHA-256 0EA54ACAE4A29102A1DF32350C7414A1635C12A12587C255A1174CD09A4B891F。
- 两个版本均为 GitHub prerelease，完整上传 EXE、blockmap、beta.yml 和 SHA256.txt。
- 更新路径：手工安装 beta.1 后，在软件内检查更新，确认下载，再选择重启安装到 beta.2。自动下载和退出即装仍保持关闭。
- 本次桌面安全收口提交：72502cf；已通过 desktop verify、desktop build、desktop smoke:packaged 和 desktop smoke:update。
- Windows 代码签名尚未配置，首次安装可能显示“未知发布者”。

## 当前正式候选

- 版本：`0.2.5`
- 集成分支：`codex/selection-profit-erp-sync`
- 集成提交：`9f002fb`
- 全局 UI 提交：`edac462`
- 桌面壳提交：`d112b08`
- 利润与 ERP 最终提交：`18d4bd4`
- 桌面 ERP packaged smoke 提交：`0f00b4f`
- ERP 证据归属修复：`e216f29`
- 1688 心跳兼容修复：`92d10ac`
- 未映射 ERP 证据折叠与补齐提示：`dc75782`
- ERP 成本复制回退：`b4b4859`
- 缺少成本与证据不完整状态区分：`b5e2682`
- 安装包：`releases/latest/Shopeers 工作站 Setup 0.2.5.exe`
- 文件大小：`88,464,108` bytes
- SHA-256：`81F7DEF97D68BF44FEA7D6D1B6ACD6851A376162E6CC0FBEB0EEE5B166ADB7E3`
- 1688 扩展：`Shopeers-1688-Capture-v1.2.1.zip`，`38,205` bytes，SHA-256 `876FD1F13DACD4A8691886622BA0237EB90DF9F89C6DB882A3AB0DDA94885B65`
- ERP Assistant：`v8.0.13`，`37,746` bytes，SHA-256 `691E60376041AD2DD2B20744106CE3FD1C859AD3154E424D8A9282D2CAAE11EF`

## 发布门禁

- [x] UI 与桌面专职提交已合入集成分支。
- [x] 桌面版本、验证脚本与 `release-plan.json` 均为 `0.2.5`。
- [x] 前端测试：59 files / 300 tests。
- [x] 前端生产构建。
- [x] ERP bridge、inbox server 与 result policy 测试。
- [x] Desktop verify 与 inbox 生命周期测试。
- [x] Desktop build。
- [x] Packaged smoke：工作站、ERP、1688、运行时端口注入、ERP inbox v2、工作站读取确认和扩展加载通过。
- [x] `pnpm --dir desktop release:organize`：最新版本与历史版本已分离。
- [x] `pnpm --dir desktop release:check`。
- [x] ERP 无仓库 SKU 排除记录不再扩散到所有仓库证据。
- [x] 1688 MV3 心跳在 Electron 36 中成功回传 `selection/v1/extension-status`。
- [x] 成本核对页默认折叠未映射证据，并提供证据问题与补齐指引，不改变正式成本发布门槛。
- [x] ERP 页面复制成本在 Clipboard API 被拒绝时使用受限回退，不增加桌面权限。

## 权威规则

专职对话和专职 Worktree 只能交付模块提交与预览包。正式版本以本文件、`desktop/release-plan.json`、集成分支 ancestry 和主 Worktree 的发布检查结果为准；对话中的“已完成”不能替代上述门禁。

真实 ERP 登录态、采购页注入、真实分页、SKU/SKC/仓库 SKU 映射、供应商与 1688 链接、`warehouseEvidence` 完整性仍需在用户实际账号环境手工验收。
