# 里程碑 8：云端持久化适配层与角色权限矩阵

状态：持久化端口、参数化 SQL 计划和开发授权已完成，真实数据库仍未连接
审计日期：2026-08-07

## 已实现

- 新增 `cloudPermissions.js`，统一定义 `admin`、`selection`、`operations`、`finance`、`viewer` 五类角色的表级操作矩阵。
- 新增 `cloudAuthorization.js`：
  - 开发令牌校验；
  - 工作区白名单；
  - 审计动作到业务表/操作的映射；
  - 云端种子预检和导入仅允许管理员。
- 同步开发服务读取：
  - `SHOPEERS_SYNC_TOKEN`
  - `SHOPEERS_SYNC_ROLE`
  - `SHOPEERS_SYNC_WORKSPACES`
- 新增 `cloudSeedPostgresPlan.js`：
  - camelCase → PostgreSQL snake_case 映射；
  - 固定外键顺序；
  - 参数化 SQL 和 JSONB 值；
  - 审计事件内容哈希；
  - 导入事务内幂等初始化当前管理员 `workspace_members` 关系；
  - `begin → insert → commit`，失败执行 `rollback`。
- 静态 PostgreSQL 迁移检查增加角色策略片段验证。

## 验证结果

- 权限矩阵测试：selection、operations、finance、viewer、admin 核心读写边界通过。
- SQL 计划测试：父表顺序、参数化值和失败回滚通过。
- PostgreSQL 迁移合同：表、工作区列、RLS、不可变事实、角色策略全部通过。

## 尚未实现

- 真实 JWT claims 到 `cloudAuthorization` 的服务端适配。
- 真实 PostgreSQL 连接池、迁移执行和数据库事务集成测试。
- Supabase Auth、成员邀请、角色变更和 RLS 的真实环境验收。
- 生产级导入指纹持久化和云端审计回执索引。

本里程碑没有创建或连接任何外部云资源，也没有上传工作区数据。
