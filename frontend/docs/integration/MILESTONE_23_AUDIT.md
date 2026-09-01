# 里程碑 23：云端部署配置基线

状态：部署配置与门禁已补齐；真实云资源、JWT 提供方和 PostgreSQL 连接仍待批准后接入
审计日期：2026-08-08

## 本次完成

- 将 Supabase 项目/Auth 地址与同步 API 地址拆分：
  - `VITE_SUPABASE_URL`：项目与 Auth 地址；
  - `VITE_SYNC_API_BASE_URL`：已部署 Edge Function 或独立 API 的同步端点。
- `supabase` 提供方不再把项目 URL 误当成同步接口，缺少同步端点时保持未配置状态。
- 云端种子迁移和审计同步共用同一同步 API 端点解析规则。
- `api` 与 `supabase` 两种提供方均支持 `VITE_SYNC_API_BASE_URL`，避免配置检查通过但运行时仍读取空旧变量。
- 修正部署文档中的本地 Vite 默认端口为 `5173`。
- 新增 `pnpm deploy:check`，检查部署文件、SPA 回写、环境变量安全边界、同步端点拆分和必需门禁脚本。

## 验收证据

- `pnpm test`：39 个测试文件、135 项通过；
- `pnpm build`：1764 个模块构建成功；
- `pnpm sync:check`：通过；
- `pnpm seed:check`：通过；
- `pnpm schema:check`：通过；
- `pnpm deploy:check`：通过；
- `pnpm db:check`：本机无 Docker，保持明确的 `DOCKER_UNAVAILABLE` 结果，未伪造数据库连通性。

## 上云前仍需批准与验证

- 创建 Supabase/GitHub/Vercel 或独立 API 资源；
- 接入真实 JWT 验签、成员表和 PostgreSQL 连接池；
- 部署并验证同步 API 与 Edge Function 路由；
- 使用脱敏种子包执行预检、导入、恢复和 RLS 矩阵验收；
- 不上传真实工作区数据、ERP/1688 Cookie、Token 或密码。

当前阶段仍为：**本机真实数据 Beta，已具备可部署配置基线，但不是云端生产版。**
