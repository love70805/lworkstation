# 里程碑 20：本地 PostgreSQL 开发入口

状态：本地 PostgreSQL 可重复启动和迁移入口已建立，真实数据库执行待 Docker Desktop 可用后验证  
审计日期：2026-08-08

## 本次目标

把“可接入 PostgreSQL 的服务适配器”推进为组内可复现的本地数据库开发环境，避免每位开发者手工安装、手工执行迁移或误连生产资源。

## 已完成

- 根目录新增 `docker-compose.postgres.yml`，固定 PostgreSQL 16 Alpine、本机 `55432` 端口和独立数据卷。
- 新增 `tools/postgres-dev.mjs`，提供 `up`、`down`、`migrate`、`check` 四个命令。
- `frontend/package.json` 新增 `db:up`、`db:down`、`db:migrate`、`db:check`。
- `.env.example` 增加本地服务端数据库连接串和后端模式提示，未放入 `VITE_` 变量。
- 迁移命令使用容器内 `psql -v ON_ERROR_STOP=1`，任一 SQL 错误都会中止，不会静默完成半套迁移。
- 工具缺失时返回 `DOCKER_UNAVAILABLE`，不会把模拟环境结果伪装成真实数据库验收。

## 使用方式

在 `frontend` 目录：

```powershell
pnpm db:up
pnpm db:migrate
pnpm db:check
```

该环境只绑定本机地址，不创建 Supabase、Vercel、Cloudflare 或对象存储资源，也不会读取或上传真实工作区数据。

## 当前证据

- 当前机器未检测到 Docker、`psql` 或 `pg_isready`，因此本轮未执行真实 PostgreSQL 集成测试。
- Vitest、构建、同步冒烟、种子检查和静态 schema 合同继续作为本地门禁。
- Docker Desktop 可用后，第一条真实验收链路为：启动容器 → 执行迁移 → `db:check` → 连接 `createPostgresSyncRuntime` → 运行脱敏种子和恢复测试。

## 当前边界

真实 JWT/Auth、RLS 角色矩阵、对象存储、云端托管和生产部署仍未创建。它们涉及外部资源和权限配置，必须在明确批准组织、区域、成员和数据范围后执行。
