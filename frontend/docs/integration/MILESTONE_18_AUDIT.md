# 里程碑 18：PostgreSQL 同步事务计划

状态：本地 Beta 已具备可交给服务端 PostgreSQL 客户端执行的同步事务合同  
审计日期：2026-08-07

## 本次目标

把里程碑 17 的内存事件存储映射为参数化 PostgreSQL 事务，确保审计事件与核心业务数据要么同时提交，要么整批回滚。

## 幂等与冲突

- 每批同步先锁定 `workspaces` 中对应工作区行，使同一工作区的事件按一致顺序串行落库。
- 在业务写入前锁定并读取 `(workspace_id, event_id)` 对应的现有审计事件。
- 相同事件 ID、相同内容哈希视为幂等重试，不重复执行业务 SQL。
- 相同事件 ID、不同内容哈希返回 `EVENT_CONFLICT`，整批回滚。
- 新事件在业务写入全部成功后批量插入 `audit_events`；审计插入失败同样回滚业务数据。
- 所有值使用 PostgreSQL 参数或 `jsonb_to_recordset`，不拼接用户数据。

## 业务事务映射

- 采集：按事件快照 upsert `captures`。
- 商品：upsert 商品后，按工作区和商品 ID 原子替换平台 SKU 与 1688 供应商报价。
- 销售导入：upsert 月度账本和导入批次，按 `group_key` 删除被替换分组，再批量写入销售明细。
- ERP 成本请求：按平台 SKC 查询请求快照 upsert。
- ERP 成本发布：更新账本覆盖状态，追加成本批次和 ERP 正式成本行。
- 1688 兜底：写入审批或撤销状态；ERP 成本仍是正式权威来源。
- 利润定稿：先锁定并检查账本，再写不可变利润行，最后把账本更新为 `finalized`。
- 账本删除：只允许删除未定稿账本，关联销售、ERP 成本、审批和利润数据由外键级联清理。

## 表结构校正

- `ledgers` 增加 `cost_summary`，保留正式成本覆盖状态。
- `sales_rows` 增加 `group_key`、`sku_key` 和 `source_payload`，支持旧利润工具的分组替换与来源追踪。
- `erp_cost_rows` 增加 `canonical_platform_skc`，保留 ERP 查询链路。
- 未定稿账本允许整体级联删除；ERP 成本和利润事实行仍禁止单独更新或删除。
- `ledgers_delete_guard` 在数据库层禁止删除已定稿或已锁定账本。
- 云端种子导入与实时同步共用同一事件内容哈希算法，避免种子恢复后相同事件被误判为冲突。
- 云端种子按“工作区 → 初始成员 → 业务表”的外键顺序写入；本地自增明细 ID 不再写入共享数据库，由 PostgreSQL 生成。

## 代码位置

- `src/domain/syncPostgresPlan.js`：事务计划生成、权限前置、幂等检查、业务执行和回滚。
- `src/domain/syncEventHash.js`：稳定事件序列化和内容哈希。
- `src/domain/syncPostgresPlan.test.js`：核心事件、提交、回滚、重复事件、冲突和工作区隔离测试。
- `supabase/migrations/0001_shopeers_core.sql`：同步所需字段、索引、级联与不可变保护。

## 门禁

- Vitest：35 个测试文件、118 项测试通过。
- `pnpm build`：1764 个模块构建成功。
- `pnpm seed:check`：通过。
- `pnpm schema:check`：通过。
- `pnpm sync:check`：通过。

## 当前边界

- 尚未创建或连接生产 PostgreSQL/Supabase，事务测试使用可控的 PostgreSQL 客户端替身验证 SQL 顺序与回滚行为。
- 本地开发同步服务仍使用内存事件存储；下一阶段需要把该执行器接入真实服务端连接池和 JWT/RLS 身份上下文。
- 尚未进行真实 PostgreSQL 上的约束、触发器、并发锁和执行计划集成测试。
- 未上传真实工作区数据，也未处理或上传 ERP/1688 Cookie、Token、密码或登录凭据。
