# 本地同步服务

这是用于开发和联调的合同参考服务，不是生产云端部署，也不会自动读取或上传本机业务数据库。

## 启动

在 `frontend` 目录执行：

```text
pnpm sync:dev
```

默认监听 `http://127.0.0.1:8787`。该进程内服务没有可验证的浏览器成员会话，默认用于自动测试、curl 或直接构造 `createHttpSyncProvider` 的合同联调；不能仅靠下面两个变量把正式前端切到 `api`：

```text
VITE_SYNC_PROVIDER=api
VITE_API_BASE_URL=http://127.0.0.1:8787
```

浏览器运行时的 `api` 模式还必须配置 Supabase URL/anon key，并使用当前 Supabase 会话 JWT；请求只携带 Bearer Authorization，不携带 Supabase `apikey`，与开发/生产 Node 服务允许的 CORS headers 一致。缺少可信身份时 App 启动 gate 会显示登录表单并 fail-closed；登录或账号切换后，必须先完成 active member context 写入，再共同挂载业务路由、采集 listener 与同步任务。上下文初始化失败不放行，也不领取或本地基线化历史技术 actor 事件。

如需验证 Bearer 令牌：

```text
SHOPEERS_SYNC_TOKEN=local-dev-token pnpm sync:dev
```

## 合同行为

- `POST /sync/v1/audit-events`：校验 envelope v1、工作区、批量上限和非空事件。
- `(workspaceId, eventId)` 相同且内容相同：幂等成功。
- 相同事件 ID 但内容不同：返回 `EVENT_CONFLICT`，整批不写入。
- 未授权工作区：返回 `WORKSPACE_FORBIDDEN`。
- `GET /health`：返回服务状态和已接收事件数量。

该服务只保存进程内数据，用于验证客户端 outbox、错误回执和重试流程。正式环境仍需按 `POSTGRES_RLS_DESIGN.md` 实现认证、事务数据库、RLS 和业务实体写入。
