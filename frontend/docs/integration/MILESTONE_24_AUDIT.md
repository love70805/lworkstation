# 里程碑 24：生产同步入口验证

状态：生产同步服务入口已完成本地合同验证；真实 PostgreSQL、JWT 和云端资源仍待批准后接入
审计日期：2026-08-08

## 本次完成

- 新增并验证 `tools/sync-production-server.mjs`：
  - PostgreSQL 连接池；
  - JWT JWKS 验签；
  - 工作区成员角色解析；
  - CORS 来源白名单；
  - 请求体大小限制；
  - `/health`、审计事件、云端种子预检和导入接口。
- 修复仓库级服务脚本无法解析 `frontend/node_modules` 中 `pg`/`jose` 的问题，改为显式锚定前端工作区依赖。
- `--help` 在缺少数据库和 JWT 配置时可正常运行，便于部署平台探活和配置检查。
- 生产环境缺少数据库、JWKS、issuer 或 CORS 配置时 fail closed，不启动服务。
- 对带有未允许 `Origin` 的请求在执行同步操作前拒绝，避免仅在响应阶段拦截。
- 增强 `pnpm deploy:check`：增加生产入口帮助命令、依赖桥接和生产配置缺失拒绝检查。

## 验收证据

- `pnpm sync:postgres -- --help`：通过；
- `pnpm test`：39 个测试文件、135 项通过；
- `pnpm build`：1764 个模块构建成功；
- `pnpm sync:check`：通过；
- `pnpm seed:check`：通过；
- `pnpm schema:check`：通过；
- `pnpm deploy:check`：通过，包含依赖桥接与生产配置 fail-closed 检查。

## 尚未执行

- 未连接真实 Supabase、PostgreSQL、Vercel、GitHub 或其他云资源；
- 未上传真实工作区、ERP 或 1688 数据；
- 未进行真实 JWT、RLS、跨域和恢复演练。

当前阶段仍为：**本机真实数据 Beta，已具备可部署的前端与 PostgreSQL 同步入口，但不是云端生产版。**
