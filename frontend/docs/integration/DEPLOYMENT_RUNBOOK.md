# Shopeers 部署与云端协作运行手册

状态：本地基线已准备，外部资源尚未创建  
审计日期：2026-08-07

## 1. 本地开发

```powershell
pnpm install
pnpm dev --host 127.0.0.1
```

默认运行地址为 `http://127.0.0.1:5173`。本机模式使用浏览器 IndexedDB，不会因为启动开发服务器而上传业务数据。

需要验证真实 SQL 时，在工作区根目录执行 `pnpm --dir frontend db:up`、`pnpm --dir frontend db:migrate` 和 `pnpm --dir frontend db:check`。该环境只绑定本机 `55432` 端口，不创建或连接外部云资源。

生产构建和本地预览：

```powershell
pnpm test
pnpm build
pnpm preview --host 127.0.0.1
```

## 2. 环境变量

从 `.env.example` 复制为环境专用文件。开发环境保持：

```text
VITE_SYNC_PROVIDER=local
```

只有在 API、Supabase Auth、权限和数据库迁移均完成后，才允许设置 `api` 或 `supabase`。两种模式都使用当前 Supabase 会话的 JWT `sub` 作为同步 actor；只有端点而没有 URL/anon key 的 `api` 配置无效。`VITE_` 变量会进入浏览器构建产物，不能放置服务端密钥、数据库密码或扩展连接密钥。

两种云端模式都必须配置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`；`supabase` 另需 `VITE_SYNC_API_BASE_URL`，`api` 需独立同步端点。独立 `api` 仅向同步服务发送 Bearer JWT，不发送 Supabase `apikey`，以保持仓库 Node 服务的 CORS 合同。配置不完整时应用启动页阻断业务子树；配置完整但未登录时显示独立登录表单。取得真实 `user.id/sub` 后，应用先卸载或保持阻断所有 listeners/routes，等待 active member context 写入成功，再共同挂载 ERP/选品 listener、同步任务和业务路由；账号切换重复同一顺序，写入失败不得放行。明确 `local` 模式同样先初始化 `local-user/admin` context，再启动本机 listeners。

## 3. SPA 托管

仓库中的 `vercel.json` 已为 React Router 增加所有路径回写到 `index.html` 的规则。部署平台需要：

- 构建命令：`pnpm build`
- 输出目录：`dist`
- Node.js：使用平台当前受支持的 LTS 版本
- Preview、Staging、Production 使用独立环境变量和独立数据库

## 4. 数据迁移顺序

1. 用户在本机数据安全页导出完整 JSON 备份。
2. 在开发数据库执行版本化 SQL 迁移和约束测试。
3. 仅导入脱敏测试工作区，验证平台 SKU 唯一索引、账本唯一索引和 RLS。
4. 验证 ERP 成本批次、1688 兜底审批、定稿和审计导出。
5. 完成恢复演练后，才迁移生产工作区；生产数据不得自动复制到开发环境。

## 5. 本地 outbox 合同

v7 起，`auditEvents` 同时承担本地 outbox：

- `pending`：待上传。
- `in_flight`：已领取，等待 API 确认。
- `synced`：已获得云端版本确认。
- `failed`：失败，保留错误信息和尝试次数，可重试。

`src/domain/syncEnvelope.js` 的 envelope 版本为 `1`。每条新事件使用全局 UUID `eventId`；旧版数值事件 ID 仅保留兼容读取。同步服务必须先校验 `format`、`formatVersion`、工作区归属和事件 ID 唯一性，再执行幂等写入。同步状态字段不会进入业务 envelope。

## 6. 外部操作审批门

以下动作未在本里程碑执行：

- 初始化或推送 GitHub 私有仓库。
- 创建 Supabase/其他 PostgreSQL 项目、对象存储或 Auth。
- 创建 Vercel/Cloudflare 项目并绑定域名。
- 上传任何现有工作区数据或密钥。

执行这些动作前必须明确确认组织、仓库名、数据库区域、成员权限、环境数量和数据迁移范围。

## 7. 云端种子包迁移

开发服务提供以下仅用于受控环境的接口：

- `POST /sync/v1/cloud-seeds/preflight`：校验格式、工作区、引用、唯一约束并返回冲突报告，不写入。
- `POST /sync/v1/cloud-seeds/import`：仅接受同一份预检结果，执行整批事务导入；预检过期或有冲突时整批拒绝。

客户端必须遵循：本机 JSON 校验 → 云端预检 → 用户确认 → 云端导入。不得在选择文件或预检阶段自动提交导入。

服务端开发合同已覆盖：

- 工作区授权和跨工作区隔离；
- 平台 SKU 全局唯一、账本月份唯一；
- ERP 成本请求以平台 SKC 为查询单位；
- 正式利润仅允许 ERP 或已审批的 1688 兜底成本；
- 相同种子包幂等；
- 主键、平台 SKU、账本月份和引用冲突报告；
- 提交阶段失败时不产生部分写入。

真实云端部署前仍需把开发内存存储替换为 PostgreSQL 事务，并执行 JWT、成员角色和 RLS 集成测试。

里程碑 19 已提供 `src/domain/syncServiceRuntime.js`：生产宿主需要注入 PostgreSQL `pool`、JWT 成员授权器、`postgresRecoveryRepository` 和 `postgresSeedRepository`。连接池请求必须使用 `pool.connect()` 获取专用客户端，不能使用会跨连接的 `pool.query()` 包裹事务。

## 9. 新设备恢复

开发服务提供只读恢复接口：

```text
GET /sync/v1/workspaces/{workspaceId}/recovery
```

恢复顺序固定为：成员读权限校验 → 下载完整种子基线与后续增量事件 → 本机引用和唯一性校验 → 下载覆盖前回滚备份 → 用户输入确认文字 → 单个 IndexedDB 事务恢复 → 写入恢复审计。未配置云端 API 时，页面入口保持禁用，不会发起请求。

当前恢复模式面向空白设备或整工作区替换。多设备同时编辑后的逐字段冲突合并仍需在真实 PostgreSQL 业务写入器中实现，不能用本机覆盖恢复代替。

## 8. 开发服务权限

开发服务可用以下环境变量模拟最小授权边界：

```text
SHOPEERS_SYNC_TOKEN=仅开发环境令牌
SHOPEERS_SYNC_ROLE=admin|selection|operations|finance|viewer
SHOPEERS_SYNC_WORKSPACES=workspace-default,workspace-test
```

云端种子预检和导入要求 `admin`；审计 outbox 的业务动作会按事件动作映射到角色矩阵。该环境变量方案只用于开发验证，不能替代生产 JWT、成员表和 PostgreSQL RLS。
