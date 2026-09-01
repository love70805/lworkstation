# 里程碑 12：本地审计 Outbox 到 HTTP 同步闭环

状态：本地同步链路已完成真实 HTTP 闭环验证，生产云端仍未连接  
审计日期：2026-08-07

## 已完成

- 新增真实 IndexedDB + HTTP 集成测试：[syncEndToEnd.integration.test.js](../../src/data/syncEndToEnd.integration.test.js)。
- 测试直接调用本地数据库、`syncOutbox`、`syncRunner` 和 HTTP provider，并启动临时 HTTP 服务模拟同步 API。
- 已验证：
  - 本地审计事件从 pending 被领取并标记 in-flight；
  - 服务端完整回执后标记 synced；
  - 同步服务端按事件 ID 幂等接收；
  - 错误令牌导致事件进入 failed 且保留错误信息；
  - 失败事件可重置为 pending 并再次同步成功；
  - 服务端工作区隔离和事件投影数量一致。

## 验证

- 本里程碑集成测试：1 项通过。
- `pnpm sync:check`：开发服务合同自检通过。

## 尚未完成

- 当前服务端存储仍是内存实现，重启后不保留事件；生产环境必须替换为 PostgreSQL 事务存储。
- 尚未接入真实 JWT、成员角色和 RLS 执行环境。
- 尚未执行跨设备并发冲突演练和网络中断长时间重试演练。
