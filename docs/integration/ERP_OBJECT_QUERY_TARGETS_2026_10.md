# ERP EMPTY_COST_RESULTS：请求标识对象被直接用于查询

2026-10-06 用户安装 0.3.12 后报告 `EMPTY_COST_RESULTS`。只读核对安装与运行扩展均为 8.0.32，脚本与 v0.3.12 一致。ERP 原查询显示 288 条采购记录；缓存中 25 个目标全部完成，但订单、明细、成本及排除证据均为 0。

只读 WAL 确认 `meta.querySkcs` 的 25 项是 `{ platformSkc, canonicalPlatformSkc }` 对象。后台 previewContext 原样返回正式请求范围，content.runCalculation 将对象传入 completeHistoryFilters，再经 String 转为 `[object Object]`。历史合成测试仅使用字符串目标，未覆盖正式 inbox 标识对象契约。

修复提取对象的原始 platformSkc 字符串，兼容旧字符串；保留原始大小写，canonical 字段仅用于范围绑定。无有效字符串时明确拒绝，不能静默删除目标或扩大范围。完整历史、店铺约束、请求/月份绑定、人工成本、定稿保护及 EMPTY_COST_RESULTS 空证据拒绝均不变。

生产 content/bridge/background 回归使用正式对象结构，修复前失败，修复后按原始 SKC 查询，得到 2 个订单和 2 个成本结果并完成投递。覆盖原始小写与 canonical 大写分离、旧字符串请求、恢复/重启、变更查询拒绝及 8.0.32 检查点兼容。隔离验证不能代替用户真实账号采集复验。

修复提交 cedf374；发布目标 0.3.13 / 8.0.33，旧有效任务保留，继续时重新读取证据。本轮未触发真实核算、未安装、未清空检查点、收件队列或修改真实业务数据。只读派生统计与回归证据存于 archive/erp-empty-cost-20261006/ 和 archive/release-0.3.13/。
