# v0.3.0 Beta.2

状态：2026-09-21 12:29:14（UTC+8）已公开 GitHub Beta 预发布并完成匿名下载、更新通道验证。仅 Windows 桌面 Beta，不升级稳定通道，不自动安装。

## 本次调整

成本只采用核算月之前的采购，核算当月及以后不参与。按时间取最近三笔，不区分 1688 与普通采购单，例如 b,a,b,b,a,a 采用 b,a,b。数量加权、四位截断、异常处置与人工更正优先不变。

核对表、助手 CSV 和利润 Excel 同步展示实际选样；新利润报告新增核算采购明细。旧采用金额保留，月份或选样不符合新规则时待复核；已定稿报告不静默改变。内置助手 v8.0.19 保留完整证据，其预览待工作台按账本筛月。

该口径是用户授权的临时试验，不等同稳定业务规则。详见 [实施契约](integration/ERP_PRIOR_MONTH_BETA.md)。

## 验证与发布

112 个测试文件 / 751 项测试及完整前端发布检查通过，12 组桌面验证通过。交叉审查补齐旧证据取消状态归一化、明确不完整证据拒绝、旧选样明细导出；对应回归通过。现有构建体积与 SheetJS 分包提示仍在，不影响构建结果。

隔离 Windows Electron 候选验收通过：六月采用五月的 b,a,b，数量加权成本 5.3333；五月仅采用四月采购；当月及未来无记录时不可采用；旧 1688 优先成本保留 7 并进入待复核，人工更正 2 正常保存。浅深色 × 1280/1024 窗口截图复核及控制台检查通过，packaged smoke 通过。Browser plugin not available，按桌面边界使用 Playwright `_electron`，未开发或验收独立浏览器产品。

PR #94 与合并后主线的 `release-check` / `desktop-verify` 均成功。四个公开资产匿名完整下载，大小和 SHA-256 与候选一致；Beta.1 检测到 Beta.2，Beta.2 不重复提示，稳定 0.2.19 不跨通道。期间 GitHub 网络短暂失败，重试后全部完成；没有以上传结果代替公开回读。

## 基线与资产

- 构建源：`95f89ad033cde79afeefd764bac9e598754bcfc9`。
- PR #94 合并与标签 `v0.3.0-beta.2`：`8bf7671a138822021188daceb99e5e24c5e14e53`；构建树与合并树完全一致。
- [GitHub Beta.2](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.2)。
- 安装包：`Lworkstation-Setup-0.3.0-beta.2.exe`，116,578,096 字节。
- SHA-256：`67BBD4E448BCC485A5CC3EF6AB787E819EF0BC0F1A70E6BAADC4C79E977AD132`。
- 发布四资产：安装包、`.exe.blockmap`、`beta.yml`、`SHA256.txt`。稳定 Latest 仍为 `v0.2.19`。
- 本机归档：`releases/candidates/0.3.0-beta.2-prior-month/`、`releases/prerelease/0.3.0-beta.2/`；原始证据在 `archive/release-0.3.0-beta.2/`。

真实业务数据、真实 ERP 登录、云端数据库及本机安装均未改动。此试验口径是否适用于实际业务仍需人工判断；新证据与旧定稿报告不会自动替换。
