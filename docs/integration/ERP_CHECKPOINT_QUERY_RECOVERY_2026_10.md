> 历史阶段记录：保留事实和设计依据，不按旧授权、审批、任务拆分或阶段状态执行。现行要求见 [AGENTS.md](../../AGENTS.md)，当前状态见 [任务看板](../CODEX_TASK_BOARD.md) 与 [发布状态](../RELEASE_STATUS.md)。

# ERP 查询检查点恢复修复（2026-10-06）

基线：933ca99288cbb2a97e7201deed709df49ee38fd7；分支 codex/erp-checkpoint-query-recovery。

已确认代码缺口：同一登记请求已有检查点时，重新核算仍走 save；当前查询不同会触发 ERP_CHECKPOINT_QUERY_CHANGED，旧检查点保留。键顺序及数字/字符串归一化不会造成该误判。现场失败查询仅在页面内存，未取得其具体差异，不能据此认定哪个字段改变。

## 最小契约与影响

仅扩展 content/background 及恢复回归测试。collectionCheckpoint 新增 restart 操作和 previousDeliveryId；list 可显式 includeCompleted。新操作仍校验可信页面、工作区、有效登记请求、完整绑定快照及查询白名单，串行比较旧投递身份；并发或旧身份不符拒绝。新尝试创建新投递身份、清空已读目标，不携带旧回执/提交哈希。旧待送达载荷保持原样，其原绑定重试路径不变。save/restore 继续严格拒绝查询变化；旧采集不能保存到新检查点。

重新核算读取当前任务身份，已有任务或预览时明确确认从零采集；取消不开始采购读取。继续未完成采集保持原查询验证。无账本、正式成本、定稿、迁移或运行时真实数据修改；版本号及发布资产未改。

## 验证与交付边界

通过 node tools/erp-collection-recovery.test.mjs：真实生产 content/bridge/background 的隔离重开、取消、恢复、身份与回执回归，以及变更查询重采集确认/取消、新身份、从首目标重读、旧待投递保留、旧写入及过期重采集拒绝。

通过 node tools/erp-request-binding.regression.test.mjs（11 场景）、node tools/erp-collection-binding.test.mjs 和 node tools/erp-collection-slow-paths.test.mjs。

上述为合成数据隔离验证，不代表现场采集通过。本机已安装 0.3.9 尚未包含此修复；未覆盖安装、打包、合并或发布。archive/release-0.3.9/STOP_PUBLICATION 保留。现场具体查询差异与真实用户采集验收仍待确认。已修复的全零 inbox 不再次重建；不将异常关机证据认定为唯一损坏原因。
