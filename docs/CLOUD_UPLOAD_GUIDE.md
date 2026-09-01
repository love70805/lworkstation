# Shopeers 上云与协作手册

这份手册只描述可复现的上传流程。当前工作区没有自动创建 GitHub、Supabase 或 Vercel 资源；执行外部写入前，必须先确认仓库名称、可见性、组织、数据库区域和数据迁移范围。

## 1. 上传前检查

在工作区根目录执行：

```powershell
gh auth status
pnpm --dir frontend cloud:check
pnpm --dir frontend release:check
```

`cloud:check` 默认只做本机静态检查。切换到云端变量后，再执行：

```powershell
pnpm --dir frontend cloud:check -- --strict --ping
```

## 2. 初始化并推送 GitHub

先检查待提交文件，确认没有 `.env`、Excel、备份和本机数据：

```powershell
git init
git branch -M main
git add .
git diff --cached --name-only
```

确认清单无敏感文件后再提交：

```powershell
git commit -m "chore: initial Shopeers workstation"
gh repo create <owner>/<repository> --private --source . --remote origin --push
```

`<owner>/<repository>` 必须替换成已经确认的 GitHub 组织和仓库名。公开仓库不适合当前项目。

## 3. 部署前端

在 Vercel 创建项目并绑定 GitHub 仓库，项目根目录选择 `frontend`：

- 构建命令：`pnpm build`
- 输出目录：`dist`
- 安装命令：`pnpm install --frozen-lockfile`

开发、预览、生产环境使用不同的环境变量和同步 API，不共用生产数据库。

仓库还提供了手动触发的 GitHub Actions 发布工作流：`.github/workflows/deploy-cloud.yml`。它会先执行完整发布门禁，再根据 GitHub Secrets 发布 Vercel 前端，并可触发同步 API 部署；普通代码推送不会直接触发生产发布。

## 4. 配置 Supabase 与同步 API

Supabase 负责 Auth 和 PostgreSQL；同步 API 使用仓库中的 `Dockerfile.sync` 与 `tools/sync-production-server.mjs`。生产环境至少需要服务端变量：

```text
SHOPEERS_DATABASE_URL
SHOPEERS_JWKS_URL
SHOPEERS_JWT_ISSUER
SHOPEERS_JWT_AUDIENCE
SHOPEERS_SYNC_CORS_ORIGINS
```

前端只配置公开变量：

```text
VITE_SYNC_PROVIDER=supabase
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
VITE_SYNC_API_BASE_URL=https://<sync-api-domain>
```

数据库迁移必须按文件顺序执行，并先完成 Schema、RLS、成员权限和恢复演练。数据库密码、service role key、ERP Cookie、ERP Token 和 1688 Cookie 不能放入任何 `VITE_` 变量。

同步 API 的 Render Blueprint 位于根目录 `render.yaml`。在 Render 导入该 Blueprint 后，在服务设置中填写数据库连接、Supabase JWKS、JWT issuer/audience 和允许的 Vercel 来源；这些变量由 Render Secret 管理，不进入 Git。

GitHub Actions 发布所需 Secrets：

```text
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
RENDER_DEPLOY_HOOK
VITE_SYNC_PROVIDER
VITE_SYNC_API_BASE_URL 或 VITE_API_BASE_URL（二选一）
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

当手动发布选择前端时，工作流会要求 `VITE_SYNC_PROVIDER` 为 `api` 或 `supabase`，并要求两个端点变量任选其一。两种模式都必须配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`：`api` 只表示同步服务部署在独立地址，浏览器身份仍来自当前 Supabase Auth 会话，服务端验证同一 JWT `sub`。工作流随后用 `vercel env add --force` 写入 Production 环境，避免缺少可信身份时误开启云同步。

## 5. 数据迁移边界

代码上传与业务数据上传分开处理。正式数据迁移顺序为：

1. 本机数据安全页导出完整备份。
2. 云端执行种子包预检。
3. 检查唯一约束、工作区权限和冲突报告。
4. 明确确认后再执行种子导入。
5. 完成新设备恢复演练后开放正式写入。

`680店.xlsx` 等原始台账文件属于业务数据，默认不会进入 Git 仓库，也不会随代码自动上传。
