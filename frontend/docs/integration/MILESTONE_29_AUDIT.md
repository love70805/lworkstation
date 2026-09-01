# 里程碑 29：云端会话与自动同步审计

## 目标

让云端协作从“有同步接口”推进到“有用户会话、可安全上传、可在后台自动发送审计 outbox”，同时不改变本机默认模式。

## 已完成

- 引入 `@supabase/supabase-js` `2.112.2`，封装在 [cloudAuth.js](../../src/data/cloudAuth.js)。
- 配置 Supabase 项目地址、匿名公钥和同步端点后，账户菜单提供登录/退出入口。
- 会话由 Supabase 客户端持久化和自动刷新；密码不进入 Shopeers 数据库、审计事件或构建变量。
- Supabase 同步请求自动带 `apikey` 和当前短期 access token；未登录时在客户端以 `AUTH_REQUIRED` 阻断，不发送业务事件。
- `VITE_SYNC_AUTO=true` 时，已登录的 Supabase 工作区每 30 秒尝试上传一次本地审计 outbox；本机模式不启动调度器。
- 未登录造成的阻断会把领取中的事件释放回 `pending`，不会伪装成永久失败。
- 同步状态仍以服务端完整回执为准，事件内容和工作区校验规则保持不变。

## 验证结果

```text
pnpm test   43 个测试文件，150 项通过
pnpm build  1813 个模块构建成功
```

覆盖内容：

- Supabase 配置识别、会话读取、登录、退出。
- 未登录和已登录时同步请求头。
- 未登录同步阻断和 outbox 回退。
- 既有 HTTP 同步、ERP 桥接、业务集成测试。

## 当前边界

- 尚未连接真实 Supabase 项目，未执行真实邮箱登录和 JWT/RLS 联调。
- 生产端点仍需由独立同步 API/Edge Function 校验 JWT 和成员角色。
- 多设备同时编辑的字段级冲突合并仍未实现；当前恢复策略是管理员确认后的整工作区恢复。
- API provider 模式仍保留手动同步入口，未假设其认证方式。
- Supabase SDK 通过 Vite `manualChunks` 单独拆包，避免把认证依赖全部压入主入口。
- 新增根目录 `Dockerfile.sync` 和 `pnpm sync:deploy:check`，可独立构建同步 API 镜像；数据库/JWKS/JWT/CORS 必须通过运行时环境注入，缺失时服务拒绝启动。
