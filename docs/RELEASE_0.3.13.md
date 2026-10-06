# 0.3.13 ERP 核算目标对象解析修复

正式 ERP 请求的 SKC 列表是标识对象。0.3.12 将对象直接变成 `[object Object]` 查询，导致所有订单为空并报 EMPTY_COST_RESULTS。修复提取原始 platformSkc 字符串并保留大小写，兼容旧字符串；空证据保护及业务成本口径保持。

原因、契约和修复前后回归见 [诊断](integration/ERP_OBJECT_QUERY_TARGETS_2026_10.md)。扩展 8.0.33 保留 8.0.29–8.0.32 有效任务。发布检查、候选、集成和公开回读分别登记；本机不自动安装，真实账号采集尚待复验。

## 候选验收

161 文件 / 1270 前端测试、生产构建、desktop verify、release check、桥接生成及 ZIP/下载入口、请求/采集绑定、CSV、慢路径和恢复回归通过。生产 content/bridge/background 路径使用对象目标与不同大小写，2 个订单及 2 个成本结果成功投递。隐藏候选 smoke 可见窗口为 0。

安装包 593 文件与 unpacked 逐字节一致，546 项生产输入与源码/构建资源一致。候选 releases/candidates/0.3.13/；EXE 118329885 字节，SHA256：239263105EA368D5259BBDC3D2CE170451F505FBDA25BB011BBD352839317A60。验收证据 archive/release-0.3.13/。本机未安装、未触发真实核算、未改真实数据。
