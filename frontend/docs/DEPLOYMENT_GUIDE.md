# Shopeers 开发与部署指南

当前版本默认是本机 IndexedDB 模式。未配置云端变量时，应用不会上传业务数据；`sync:dev` 只提供本机开发合同服务。

首次上传代码和配置 GitHub/Vercel/Supabase 时，参见工作区根目录的 `docs/CLOUD_UPLOAD_GUIDE.md`。

## 1. 本地开发

在 `frontend` 目录执行：

```powershell
$env:Path = "C:\Users\a1823\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;" + $env:Path
pnpm install
pnpm dev
```

默认地址：`http://127.0.0.1:5173/`

## 2. 同步开发服务

同步服务只接收审计事件和云端种子迁移请求，不保存 ERP/1688 登录凭据：

```powershell
$env:SHOPEERS_SYNC_TOKEN = "开发专用令牌"
$env:SHOPEERS_SYNC_ROLE = "admin"
$env:SHOPEERS_SYNC_WORKSPACES = "workspace-default"
pnpm sync:dev
```

启动后可访问 `/health`。服务支持：

- `POST /sync/v1/audit-events`
- `POST /sync/v1/cloud-seeds/preflight`
- `POST /sync/v1/cloud-seeds/import`

本机协议自检：

```powershell
pnpm sync:check
```

自检覆盖健康检查、审计事件上传、重复事件幂等、错误令牌拒绝、恢复包下载与读权限、种子包预检、种子包导入、重复导入幂等和带种子基线恢复。

## 2.1 本地 PostgreSQL 开发环境

仓库提供独立的 PostgreSQL 16 Compose 环境，不会连接外部云端：

```powershell
pnpm db:up
pnpm db:migrate
pnpm db:check
```

默认连接地址为 `127.0.0.1:55432`，数据库为 `shopeers`，账号和密码仅用于本地开发。停止容器但保留数据卷：

```powershell
pnpm db:down
```

如果本机没有 Docker Desktop，命令会明确返回 `DOCKER_UNAVAILABLE`；这不影响 IndexedDB 模式和内存同步冒烟。

`pnpm db:migrate` 会按 `frontend/supabase/migrations/` 中的文件名顺序执行全部迁移，并在
`public._shopeers_schema_migrations` 记录已执行版本。重复执行会跳过已完成迁移；当前迁移同时包含
平台 SKU 售价/图片字段，以及商品与采集记录的账号归属、私有可见范围和子表 RLS 继承规则。

## 3. 生产云端变量

生产环境不使用 `SHOPEERS_SYNC_TOKEN` 作为长期鉴权。前端仅设置公开端点和公开客户端标识，服务端负责 JWT、成员角色和工作区白名单：

```dotenv
VITE_SYNC_PROVIDER=api
VITE_API_BASE_URL=https://<your-api-domain>
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
```

如果采用 Supabase 适配层：

```dotenv
VITE_SYNC_PROVIDER=supabase
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
VITE_SYNC_API_BASE_URL=https://<project>.supabase.co/functions/v1/shopeers-sync
```

`VITE_SUPABASE_URL` 是 Supabase 项目/Auth 地址，不能直接替代同步 API 地址。`VITE_SYNC_API_BASE_URL` 必须指向已部署并受 JWT/成员权限保护的同步服务；如果使用独立 Node API，则将 `VITE_SYNC_PROVIDER` 设为 `api` 并填写 `VITE_API_BASE_URL`，但仍必须配置 Supabase URL/anon key，让客户端从当前认证会话取得 Bearer JWT 与可信 `memberId/sub`。只有端点、没有认证上下文的 `api` 配置会 fail-closed 为无效。

独立同步 API 可直接使用仓库根目录的 `Dockerfile.sync` 构建。镜像只运行 `tools/sync-production-server.mjs`，数据库连接、JWKS、JWT issuer/audience 和允许的浏览器来源必须通过运行时环境变量注入：

```powershell
docker build -f Dockerfile.sync -t shopeers-sync:local .
docker run --rm -p 8787:8787 --env-file .env.sync shopeers-sync:local
```

构建前可执行 `pnpm sync:deploy:check`，检查镜像入口、服务端依赖和 fail-closed 环境变量门禁。

禁止把数据库 service role key、ERP Cookie、ERP Token、1688 Cookie 或其他服务端密钥放进 `VITE_` 变量。

## 4. 部署前门禁

也可以直接运行本地发布候选验收流水线，它会按顺序执行测试、构建、ERP 收件协议、同步冒烟、种子合同、Schema 合同和部署门禁：

```powershell
pnpm release:check
```

上线前可先运行只读云端预检：

```powershell
pnpm cloud:check
pnpm cloud:check -- --strict --ping
```

默认本机模式只检查部署文件；切换 `api` 或 `supabase` 后，严格模式都会要求同步端点与 Supabase Auth 变量齐全，并在启用 `--ping` 时验证同步服务 `/health`。该命令不会创建云资源、上传业务数据或输出密钥。

该命令只使用本机代码和临时测试资源，不连接外部 Supabase、ERP 或生产数据库。

每次预览或发布前，在 `frontend` 目录执行：

```powershell
pnpm test
pnpm build
pnpm seed:check
pnpm schema:check
pnpm sync:check
```

只有这些检查全部通过，才允许把构建产物交给托管平台。云端数据库迁移必须先通过 PostgreSQL 合同检查，再在开发环境执行。

## 5. 推荐上云顺序

1. 将当前目录提交到私有 Git 仓库。
2. 创建独立的开发数据库和 API，不导入生产数据。
3. 部署 API 和数据库迁移，先用 `pnpm sync:check` 做协议验收。
4. 部署只读预览前端，验证登录、工作区隔离和审计回执。
5. 导入脱敏云端种子包，完成恢复演练后再开放写入。
6. 最后配置生产域名、成员权限、对象存储和备份策略。

## 5.1 GitHub 自动验收

仓库内的 `.github/workflows/quality.yml` 会在 `main`、`master`、`develop` 分支推送和 Pull Request 时自动执行 `frontend/pnpm release:check`。该任务只使用测试数据，不读取 Supabase、ERP 或生产密钥；云端部署前仍需通过本地真实数据验收和生产环境配置检查。

销售账号登录后只读取自己的私有商品、工作区共享商品和全部月度利润账本；管理员、运营和财务账号可读取完整选品资料。云端恢复接口也会按同一规则过滤私有商品及其 SKU、供应商报价和采集记录。

创建 GitHub、Supabase、Vercel 或对象存储资源，以及上传任何真实数据，都必须在明确确认组织、项目、区域和权限后执行。
