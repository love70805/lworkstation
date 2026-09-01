# Milestone 4 审计：云端同步合同开发联调

审计日期：2026-08-07  
结论：**客户端 outbox、手动同步入口和本地合同参考服务通过；生产云端资源与业务实体同步仍未创建。**

## 1. 本里程碑目标

- 让本地审计 outbox 可以被人工触发并获得完整回执。
- 提供不依赖外部账号的 HTTP 合同参考服务。
- 验证工作区隔离、幂等重试、事件冲突和整批不写入语义。

## 2. 已实现

| 文件/能力 | 证据 |
| --- | --- |
| `src/pages/Diagnostics.jsx` | 云端端点配置后显示“立即同步”，无端点时保持本机模式并阻断网络请求 |
| `src/domain/syncServerContract.js` | envelope v1 校验、批量上限、工作区授权、`(workspaceId,eventId)` 幂等和冲突拒绝 |
| `src/domain/syncBusinessProjection.js` | 将商品、采集、账本、ERP 成本批次、审批和利润定稿事件映射为可重放实体；旧摘要事件标记为不完整投影 |
| `src/data/database.js` | 关键业务审计事件增加 `after.snapshot`，保留正式成本、审批和定稿结果的云端迁移边界 |
| `tools/sync-dev-server.mjs` | `GET /health` 与 `POST /sync/v1/audit-events` 本地 HTTP 参考服务 |
| `docs/integration/DEV_SYNC_SERVER.md` | 启动方式、环境变量和生产边界 |

## 3. 验证结果

```text
Vitest：22 个测试文件，71 项测试通过
Vite production build：1757 个模块转换成功
HTTP 联调：health 200；审计批次返回完整 sync ack，eventIds/cursor/syncVersion 均存在
```

## 4. 当前边界

- 开发服务只保存进程内事件，不是生产数据库。
- 当前客户端 outbox 同步的是审计事件；本地参考服务已能投影带快照的业务事件，但正式云端仍需按事件处理器接入 PostgreSQL/Supabase。
- 尚未创建 GitHub、Supabase、Vercel、对象存储或生产密钥。
- ERP v8.0 仍通过既有人工复制/批次导入流程接入，正式扩展桥接尚未联调。

## 5. 下一里程碑入口

1. 按 `POSTGRES_RLS_DESIGN.md` 建立云端 schema、成员角色和 RLS 集成测试。
2. 将商品、采集、台账、成本批次和利润定稿事件映射到云端业务实体，保持幂等事务。
3. 在获得明确批准后，使用脱敏数据执行只读预览部署，再规划正式迁移。
