# 0.3.13 ERP 核算目标对象解析修复

正式 ERP 请求的 SKC 列表是标识对象。0.3.12 将对象直接变成 `[object Object]` 查询，导致所有订单为空并报 EMPTY_COST_RESULTS。修复提取原始 platformSkc 字符串并保留大小写，兼容旧字符串；空证据保护及业务成本口径保持。

原因、契约和修复前后回归见 [诊断](integration/ERP_OBJECT_QUERY_TARGETS_2026_10.md)。扩展 8.0.33 保留 8.0.29–8.0.32 有效任务。发布检查、候选、集成和公开回读分别登记；本机不自动安装，真实账号采集尚待复验。

## 候选验收

161 文件 / 1270 前端测试、生产构建、desktop verify、release check、桥接生成及 ZIP/下载入口、请求/采集绑定、CSV、慢路径和恢复回归通过。生产 content/bridge/background 路径使用对象目标与不同大小写，2 个订单及 2 个成本结果成功投递。隐藏候选 smoke 可见窗口为 0。

安装包 593 文件与 unpacked 逐字节一致，546 项生产输入与源码/构建资源一致。候选 releases/candidates/0.3.13/；EXE 118329885 字节，SHA256：239263105EA368D5259BBDC3D2CE170451F505FBDA25BB011BBD352839317A60。验收证据 archive/release-0.3.13/。本机未安装、未触发真实核算、未改真实数据。

## 集成与公开发布

[PR #146](https://github.com/love70805/lworkstation/pull/146) 必需 CI 37485206788 通过，合并 9bd33f9db630df7e8329f08dd680be3dcc030050；主线 CI 37485516198 两项成功，合并树与候选一致。v0.3.13 固定该软件提交。

[0.3.13 稳定 Latest](https://github.com/love70805/lworkstation/releases/tag/v0.3.13) 已公开。四资产匿名完整下载与候选大小/SHA256、服务端 digest 及 latest.yml SHA512/大小一致；生产更新 provider 确认 0.3.12 等旧稳定版可发现 0.3.13，当前 0.3.13 为 current，RC 仍禁用。独立 8.0.33 扩展 ZIP 公共哈希通过。回执 archive/release-0.3.13/anonymous-verification.json、public-update-channels.json、public-extension.json。

本轮未安装或触发真实核算，未清空真实数据或旧任务；用户真实账号仍需更新后点“继续未完成采集”或“重新核算”复验。公开资产核对完成不代表真实账号采集已成功。

## 用户确认与旧 Release 清理

2026-10-06 用户在决策端确认本版修复成功；按明确授权删除六个错误旧 Release 及 24 个附件，标签、历史和本版全部资产保留。清理后 Latest、元数据哈希、公开安装包入口及生产更新 provider 均通过，见 [清理记录](integration/ERP_RELEASE_CLEANUP_2026_10.md)。本轮无安装或新软件版本。
