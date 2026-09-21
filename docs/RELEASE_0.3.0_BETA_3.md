# v0.3.0 Beta.3

状态：2026-09-21T11:50:46Z 已公开 GitHub Beta 预发布，四资产匿名回读与更新通道验证完成。仅 Windows 桌面 Beta；稳定版保持 0.2.19，本机不安装。

成本改为采用核算当月及以前的采购，排除后续月份；保持按时间最近三笔、数量加权与四位截断。旧采用金额保留，选样改变需重新核对，人工更正优先，已定稿报告不自动改写。内置 ERP 助手 8.0.20 同步说明与下载包。详见 [成本契约](integration/ERP_CURRENT_MONTH_BETA_3.md)。

修复切到 ERP／1688 并最小化后返回工作站的恢复路径：显式显示和重绘、前台响应检查、迟到回复无损恢复，以及空页面／进程异常的重试入口。正常返回不会重新加载或清空表单。详见 [桌面恢复契约](integration/WORKSPACE_RECOVERY_BETA_3.md)。

112 个前端文件 / 755 项测试、完整发布检查、13 组桌面验证及隔离 Windows Electron 恢复测试通过。交叉审查修复了超时后再次切页无法无损恢复、被阻止外部导航留下加载遮罩的问题；实际进程销毁测试补齐失效 WebContents 的处理。自然发生的长时间白屏尚未稳定复现，不将注入测试表述为唯一根因证明。

原始日志与截图：`archive/release-0.3.0-beta.3/`。候选包登记位置：`releases/candidates/0.3.0-beta.3-cost-recovery/`。

真实业务数据、云端数据库与本机安装均未修改。

最终 Windows 候选实际交互通过：八月采用八月与七月采购，选样 current-late/current/previous，数量加权单价 8.6666；九月证据被排除，只有未来采购的 SKU 不可采用。合成有效批次经 UI 采用后读取本机数据库确认实际保存。浅深色 × 1280/1024 布局及真实安装包内 ERP／1688 + 最小化返回保留未保存 React 弹窗草稿通过。现有托盘、二次启动、后台收件、网络失败重试、30 秒启动超时及退出路径回归通过。

候选安装包：`Lworkstation-Setup-0.3.0-beta.3.exe`，116,656,267 字节，SHA-256 `9B0B1C90E6A35F12E0B654ECAD1B2F07CCBB159D94151E510C2D8917AFD56B46`。

## 发布记录

- 构建源：`b5de54122ffb6b3f8c952e58114ffa7008f2ce8d`；安装包内全部桌面文件和前端资源与源构建逐字节一致。
- PR #98 与主线 CI 均通过；合并和标签 `v0.3.0-beta.3`：`62e054b99f65d9724f8c915ecb960fcc4755c22e`，合并树与候选源树一致。
- [GitHub Beta.3](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.3)。安装包、blockmap、beta.yml、SHA256.txt 已匿名完整下载，大小和 SHA-256 均与验收候选一致。
- 真实更新 Provider：Beta.2 检测到 Beta.3，Beta.3 不重复提示；稳定 0.2.19 保持 Latest，不跨通道。
- 本机归档：`releases/candidates/0.3.0-beta.3-cost-recovery/`、`releases/prerelease/0.3.0-beta.3/`；证据 `archive/release-0.3.0-beta.3/`。
