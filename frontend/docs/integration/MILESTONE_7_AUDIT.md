# 里程碑 7：云端种子包预检与事务导入合同

状态：开发服务和前端迁移边界已完成，真实云端尚未连接
审计日期：2026-08-07

## 已实现

- 新增云端种子包导入合同：`cloudSeedImportContract.js`。
- 预检阶段不写入，返回工作区版本、种子指纹、待新增数、已存在数和冲突明细。
- 导入阶段要求同一 `preflightId`、同一种子指纹和未过期工作区版本。
- 事务写入采用 staged state；提交前任意异常都会丢弃整批暂存数据。
- 同一业务内容重复导入返回幂等回执，不重复写入。
- 检查主键冲突、平台 SKU 冲突、账本月份冲突、断裂引用、CNY、ERP 查询单位和精确利润成本来源。
- `sync-dev-server.mjs` 新增：
  - `POST /sync/v1/cloud-seeds/preflight`
  - `POST /sync/v1/cloud-seeds/import`
  - CORS 及错误冲突详情
  - `/health` 中的种子工作区和导入计数
- 前端新增 `cloudSeedProvider.js`，数据安全页增加“选择并校验种子包 → 发送云端预检 → 确认导入”流程。
- 本机记录 `cloud_seed_imported`，与导出和本机恢复分开审计。

## 验证结果

- Vitest：26 个测试文件，81 项测试通过。
- `pnpm seed:check`：通过，覆盖预检、事务导入、幂等和冲突。
- Vite production build：1760 个模块转换成功。
- HTTP 集成验证（独立 `8788` 端口）：
  - 首次预检通过；
  - 首次导入新增 2 条记录；
  - 重复导入返回 `idempotent: true`；
  - 冲突种子包返回 1 项冲突且 `canImport: false`；
  - 健康检查返回 1 个种子工作区、1 个已导入种子。

## 尚未实现

- 真实 PostgreSQL/Supabase 事务写入、JWT 和 RLS 集成测试。
- 服务端持久化种子指纹、预检记录和导入审计。
- 对象存储、原始台账和图片文件迁移。
- ERP Assistant v8.0.0 的在线桥接。

本里程碑没有创建、连接或上传到任何外部云资源。
