# Beta.6 ERP 接收与自动采用契约（M0）

基线：99549ab。所有者：利润与 ERP。执行计划：BETA_6_IMPLEMENTATION_PLAN.md。此契约落实已批准的正常项自动生效，不改变采购计算、人工优先、定稿或 1688 参考口径。

## 边界

- 接收仍使用 receiveErpCostInboxEnvelope({envelope, receivedVia})。受支持来源、版本、CNY、完整完成标记、计数、证据引用、请求/工作区/账本/SKC 封装不合法时拒绝；不能通过部分成功绕开这些校验。
- 只有当前工作区内已登记请求、对应账本月份及 expected SKU 归属经事务内再次确认的 v2 证据可自动采用。无请求/旧版本可保留兼容待查记录，但不得写正式成本；跨工作区不得自动处理。
- 已验证批次内按请求实际查询 SKC 范围逐 SKU 处理。采购异常、缺失、局部证据不完整、映射问题只阻塞有关 SKU。同仓库共享证据的 SKU 一起受影响。无法定位到 SKU/仓库的全局来源失败仍阻塞整批采用；不把全局不完整默认为局部。
- evidenceStatus 是旧的整批聚合字段，不能用它单独判定部分采用资格。v1、全局截断/来源警告仍不可采用；v2 可按可信行及对应仓库证据独立复算。未知日期/超月/旧月份排除规则沿用既有防护。
- 正常项只用账本月份及以前最近三笔有效采购，数量加权、四位截断；页面计算或 previewUnitCost 不能授权写入。非正常项的处置仍要经过既有数据层复算。

## 持久化与状态

不新增表或索引：现有 v15 erpCostInbox/erpCostBatches/erpCostRows/auditEvents 可容纳附加字段，故本轮无需迁移。备份按既有整条记录序列化保留新增字段；旧记录缺少新增字段时按旧状态读取、恢复时重新校验。

- inbox.status 保留 pending/loaded/applied/rejected/voided。部分成功保留 pending 或 loaded，不能提前标 applied。新增 inbox.adoption（version、state、items、summary、processedAt），state 为 pending/partial/applied/protected/blocked。
- adoption.items 按 canonicalPlatformSku 标识：处理状态、原因、costRowId/采用批次关联、证据/处置标识及人工保护店铺。区分 adopted、manual_effective（合格后台 ERP 已保存）、anomaly_pending、evidence_incomplete、missing、ledger_protected、superseded；状态展示与当前有效成本由 UI 分开展示。
- 每个可信源批次关联一个 appliedBatchId；重试只补尚未成功的 SKU，不重复成功行与成功审计。部分成功保留整份原始来源，不能只保存已采用项。
- 人工值不改写；合格 ERP 可保留为后台候选，撤销人工后由既有成本优先级恢复。定稿/锁定只保存收件证据及保护结果，不修改正式成本、台账状态或快照。

## 幂等、顺序与恢复

- deliveryId 与源 batchId 事务内判重，同 ID 不同证据/范围拒绝；首次接收落盘与处理分离，采用事务失败保留原 envelope 并允许重试。
- 成功项幂等键包含源 batchId、workspace/ledger、canonical SKU、证据与处置版本。成功项稳定；异常处置后允许未成功项补齐。同一源批次证据不得原地替换，重新采集使用新 batchId。
- 同 SKU 采用排序优先本机已登记请求 requestedAt/createdAt，再 generatedAt，再源 batchId 确定性打破同时间平局；不按迟到的接收时间或点击时间排序。旧回传/重试不能回退更新来源的成本；撤回记录保留阻止旧批次重放的历史。
- 新导出 processErpCostInboxAdoption({inboxId, resolutions?})，供显式异常重试与接收共用；新导出 recoverErpCostInboxAdoptions({workspaceId, ledgerId?})，扫描当前工作区未完成收件，逐条隔离失败，返回处理结果。不需要打开成本页。
- frontend/src/App.jsx 的 ErpInboxListener 由执行端/桌面专职适配：启动及后续轮询调用恢复入口，单轮防重入；receive 返回后再 ACK。接收已落盘但采用失败时不丢证据，恢复继续；失败不阻塞后续其他收件。
- 旧 pending/loaded 可恢复，旧 applied 不重复发布；rejected/voided 不自动复活。原撤回入口扩展到已有 appliedBatchId 的部分成功收件，撤回其已成功行，保留异常和历史；锁定保护、明确原因及历史报告不可变规则不变。

## 审计与接口依赖

采用事务记录源请求/批次、系统自动或显式异常重试、逐项证据/处置版本、前后 ERP 值、结果与原因；保留成员 actorId 兼容现有同步约束，并用 adoptionMethod/systemSource 明确系统来源。只在处置结果变化或新增成功项时记审计，重复轮询不制造成功事件。

影响文件：domain ERP envelope/inbox/readiness 与新自动采用 helper；profitRepository 及对应测试；本文件。数据库 schema、页面和 desktop 由本提交保持不变。App.jsx/CostMatching UI 为执行端适配依赖；不让页面筛选影响自动采用范围。

## 验收矩阵

1. 不打开页面接收正常成本即生效；正常/异常/缺失混合批次部分成功，异常处置后仅补未成功项。
2. 单项证据不足与全局不完整分开；坏引用/计数/来源/请求/跨工作区/错月拒绝成本写入。
3. 重复投递、不同 delivery 同 batch、并发、同 ID 篡改、采用事务失败、重启恢复：成功行及成功审计不重复。
4. 新旧请求与同请求多批次乱序，旧重试不回退；部分成功撤回后不被恢复任务重新采用。
5. 人工单店/多店、真实零、撤销人工、定稿/锁定及并发变更，1688 不提升正式成本。
6. 旧 pending/loaded/applied/voided、JSON 备份往返、原成本页手动导入/重试与历史查看保持兼容。
