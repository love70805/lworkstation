# 里程碑 21：JWT Claims 与工作区角色授权

状态：异步身份授权边界已实现，真实 JWT 提供商和成员表集成待数据库环境可用后验证  
审计日期：2026-08-08

## 本次目标

把开发服务的静态令牌授权推进为可接入生产身份提供商的服务端合同，确保数据库事务只在身份、工作区和动作权限均确认后开启。

## 已完成

- `cloudJwtAuthorization.js` 新增 Bearer Token 提取、可注入 JWT 校验器、可注入成员解析器和角色动作授权。
- 默认要求 `claims.sub` 与工作区 active 成员记录，不允许只凭浏览器提交的 `actorId` 获得权限。
- 支持 Supabase 常见 claims 结构，但签名验证仍由宿主注入的 `verifyToken` 完成，不在前端或本模块伪造验证。
- `syncPostgresPlan`、`syncPostgresSeed` 和 PostgreSQL 恢复运行时均支持异步授权器。
- 授权失败发生在 `begin` 之前；异步校验异常统一视为拒绝，不写入数据库。
- 成员查询固定使用 `workspace_id = $1` 与 `user_id = $2` 参数，不接受动态 SQL 表名或客户端角色覆盖。

## 代码位置

- `src/domain/cloudJwtAuthorization.js`
- `src/domain/syncServiceRuntime.js`
- `src/domain/syncPostgresPlan.js`
- `src/domain/syncPostgresSeed.js`

## 验收证据

- JWT 提取、claims 校验、成员角色、动作矩阵、停用成员和 actor 不一致测试通过。
- PostgreSQL 增量事务异步授权测试确认授权完成前不会执行数据库事务。
- 全量 Vitest、构建、同步冒烟、种子检查和 schema 合同继续通过。

## 当前边界

- 尚未选择或连接真实 Supabase Auth、OIDC 或其他 JWT 提供商。
- 尚未在真实数据库中执行不同角色的 RLS 矩阵测试。
- 生产部署仍需由宿主注入经过签名验证的 `verifyToken`、成员查询和受控数据库连接；开发静态令牌不能用于生产。
