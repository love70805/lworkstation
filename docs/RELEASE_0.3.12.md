# 0.3.12 ERP 检查点字段顺序修复

> 2026-10-06：本版本 GitHub Release 及附件已按用户授权撤回，标签和提交历史保留。以下为当时交付记录；旧发布附件链接已失效。元数据、正文及资产哈希见 [清理归档](integration/ERP_RELEASE_CLEANUP_2026_10.md)。

修复相同采购查询经 Chromium 本机扩展存储重排字段后，被误判为查询变化的问题。生产后台保存、恢复均统一归一化比较两侧查询；真实变化继续拒绝。修复提交 bcb498f，扩展 8.0.32 兼容保留 8.0.29–8.0.31 有效任务，不清空本机存储、收件队列或业务数据。

真实引擎隔离验证复现旧代码在第二次保存的相同错误；修复后同一查询保存/恢复通过，真实查询变化继续拒绝，窗口可见数为 0。完整原因与契约见 [诊断](integration/ERP_CHECKPOINT_STORAGE_ORDER_2026_10.md)。候选验收、集成和公开回读分别记录如下；用户真实账号采集仍未复验。证据保存在 archive/release-0.3.12/，候选登记 releases/candidates/0.3.12/。本机不自动安装。

## 候选验收

本机 161 文件 / 1270 前端测试、生产构建、desktop verify、桥接生成及 ZIP/下载入口、请求与采集绑定、慢路径、CSV、重启恢复和真实条件变化回归通过。实际 chrome.storage.local 使用 8.0.32 配置再次验证通过；候选隐藏 smoke 可见窗口为 0。安装包 580 文件与 unpacked 逐字节一致，533 项生产输入与源码/构建资源一致。

候选原件 releases/candidates/0.3.12/；EXE 118200577 字节，SHA256：7F3FB1F6F605E64AED49A21458910DD53E0D97FE2DBE36FA236241D0436E3DBA。软件准备提交 f1add58；原 v0.3.9 草稿停止标记、v0.3.10/v0.3.11 标签和资产保留。

## 集成与公开发布

[PR #144](https://github.com/love70805/lworkstation/pull/144) 必需 CI 37451534085（release-check / desktop-verify）通过，2026-10-06 合并为 674432dcb813bf20412562d16fcd8cac33525363；候选与合并提交树一致。v0.3.12 固定该提交，主线 CI 37451869149 两项均成功。

[0.3.12 稳定 Latest](https://github.com/love70805/lworkstation/releases/tag/v0.3.12) 已公开。四资产匿名完整下载，大小/SHA256 与候选及服务端 digest 相符；latest.yml 的文件名、大小和 SHA512 相符，独立 8.0.32 扩展 ZIP 公共下载哈希通过。实际生产 AppUpdater/通道 provider 验证 0.3.11 等旧稳定版可发现 0.3.12，0.3.12 为 current，RC 仍禁用；没有调用更新下载或安装。旧 Beta 限制沿用之前记录，不扩大范围。

公开资产：Lworkstation-Setup-0.3.12.exe、同名 blockmap、latest.yml、SHA256.txt。回执：archive/release-0.3.12/anonymous-verification.json、public-update-channels.json、public-extension.json。真实数据和旧资产未改，本机未安装 0.3.12；用户真实账号采集成功仍需更新后复验。
