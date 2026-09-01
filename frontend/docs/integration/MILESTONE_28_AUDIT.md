# 里程碑 28：收件历史与同步健康检查审计

## 目标

让组内操作员可以判断 ERP 请求为什么没有自动匹配，也让部署人员能在不上传业务数据的前提下验证云端同步服务是否真实可用。

## 已完成

### ERP 本机收件

- `registered` 请求超过 TTL 后会被落成 `expired`，记录 `expiredAt`。
- 默认 TTL 为 2 小时，可用 `SHOPEERS_ERP_REQUEST_TTL_MS` 配置，最短 60 秒。
- `GET /erp/v1/requests` 只返回仍可匹配的请求。
- `GET /erp/v1/requests?includeHistory=true` 返回登记、使用和过期历史，便于诊断误关联或漏收件。
- 原有按 `requestId` 优先、平台 SKU 唯一集合匹配、多候选拒绝的策略保持不变。

### 云端同步健康检查

- `createLocalSyncProvider().health()` 明确返回本机模式状态。
- HTTP/Supabase 同步提供方新增 `GET /health` 检查。
- 健康结果会校验 HTTP 状态、服务标识和 `status: ok`，异常统一转为结构化 `SyncProviderError`。
- 系统诊断页新增“检查服务”操作，显示服务正常、已配置、未配置或不可用。
- 健康检查不提交业务事件，不改变本机 outbox 状态。

## 验证证据

```text
pnpm erp:inbox:test   通过
pnpm test             42 个测试文件，143 项通过
pnpm build            1767 个模块构建成功
pnpm deploy:check     通过
pnpm schema:check     通过
```

## 未完成边界

- 外部 Supabase/PostgreSQL、Auth、对象存储和 Vercel 资源尚未创建。
- 前端仍默认使用 IndexedDB；云端同步必须在真实 JWT、成员表和 RLS 验收后开启。
- 本机 ERP 收件服务仍只绑定 `127.0.0.1`，不作为公网服务。
- 真实卓麟 ERP 登录态的完整样本运行仍需在用户环境中执行。

