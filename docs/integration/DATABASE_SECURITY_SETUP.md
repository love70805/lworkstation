# 数据库安全配置与上线顺序

本次修复追加 `0010_security_authorization_and_audit_privacy.sql`，不改写历史审计事件、哈希或月度利润。先在预发布数据库执行迁移及角色验收，再部署同步 API，最后发布前端与桌面候选版本。新 API 依赖迁移中的安全函数，不能提前切流。

## 本地 PostgreSQL

在仓库根目录复制 `.env.example` 为 `.env`，为 `SHOPEERS_POSTGRES_PASSWORD` 设置独立随机密码。`.env` 被 Git 忽略；不要把密码写进命令历史或 `VITE_` 变量。

```powershell
Copy-Item -LiteralPath .env.example -Destination .env
notepad .env
pnpm --dir frontend db:up
```

服务只绑定 `127.0.0.1:55432`。同步 API 的 `SHOPEERS_DATABASE_URL` 单独配置为本机 PostgreSQL 连接串，密码需进行 URL 编码；示例文件不再提供可用默认凭据。

已有数据卷不会因为 `.env` 变更而重置密码。如果旧实例使用公开示例密码，应先在本机 `psql` 会话执行 `\password shopeers`，交互输入新密码，再同步 `.env` 和服务端连接串。保留数据卷，禁止用删除数据卷的方法轮换密码。

## 生产 TLS

`NODE_ENV=production` 或非本机数据库默认强制验证 TLS 证书及主机名。`SHOPEERS_DATABASE_SSL=require` 与 `verify-full` 都执行严格校验。数据库使用自有 CA 时，在宿主机或平台 secret file 挂载其 PEM 根证书，将 `SHOPEERS_DATABASE_CA_FILE` 指向文件；公开 CA 无需额外配置。

兼容连接串中的 `sslmode=require/verify-ca/verify-full`，在交给驱动前移除该参数并应用严格校验。拒绝 `sslmode=disable/prefer/no-verify`、连接串证书覆盖和全局 `NODE_TLS_REJECT_UNAUTHORIZED=0`。参见 [node-postgres SSL 配置](https://node-postgres.com/features/ssl)。

## 验收与回退

1. 对真实目标数据库建立可恢复备份，记录迁移基线和恢复点，不把备份提交到仓库。
2. 用数据库管理账号按版本执行新增迁移；同步 API 的数据库角色须是受信服务角色，拥有安全函数执行权限。普通 `authenticated` 客户端不能直接插入审计事件。
3. 验证 viewer 无法删除／合并商品或写成本；selection 可操作共享及自己私有的商品，无法操作他人私有和其他工作区的对象；只有 admin 可修改选品状态定义。
4. 分别从同步恢复接口和直接 RLS 查询验证私有商品历史快照不可见；admin/operations/finance 的既有核算访问保留。审计数量、内容哈希及定稿利润不变。
5. 在真实托管数据库上验证证书连接、角色与恢复接口，部署 API 后再切客户端；监测权限错误、积压 outbox 和恢复失败。
6. 出现回归时停止客户端切换，保留数据及安全迁移，修复候选 API 后重验。旧 API 缺少同等权限检查，不能将回退旧二进制视为安全回退。

仓库自动测试使用独立内存 PostgreSQL 执行全部迁移和越权请求，并通过本机真实 TLS 握手测试证书。这些测试不替代目标数据库、真实 ERP 登录态或 NSIS 覆盖安装后的上线验收。
