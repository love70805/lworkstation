# Milestone 5 审计：PostgreSQL/Supabase 数据层迁移草案

审计日期：2026-08-07  
结论：**云端核心 schema、RLS、不可变事实和关键索引已形成可审查迁移草案；真实数据库迁移和 JWT 矩阵测试尚未执行。**

## 1. 本里程碑目标

- 将统一领域模型落成可执行 SQL 迁移。
- 固化工作区隔离、平台 SKU 唯一性、CNY 金额和账本唯一性。
- 防止 ERP 成本事实、利润定稿和审计事件被原地修改。
- 为 Supabase Auth/RLS 和后续业务实体同步提供明确表边界。

## 2. 已实现

| 文件/能力 | 证据 |
| --- | --- |
| `supabase/migrations/0001_shopeers_core.sql` | 工作区、成员、商品/SKC/SKU、供应商、采集、账本、台账、ERP 成本、审批、利润和审计表 |
| 复合唯一键 | `workspace_id + canonical_platform_sku`、`workspace_id + period + type`、`workspace_id + event_id` |
| 金额约束 | 正式成本、审批和利润使用 `numeric(18,6)`，正式币种固定 CNY |
| 事实保护 | ERP 成本行、利润行、审计事件 immutable trigger；定稿/锁定账本写入触发器阻断 |
| RLS | 所有业务表启用并强制 RLS；成员函数固定 `search_path`，角色策略按业务域分开 |
| `postgresSchemaContract` | 静态检查表清单、workspace 隔离、RLS、不可变触发器和禁止模式 |

## 3. 验证结果

```text
Vitest：23 个测试文件，72 项测试通过
schema:check：PostgreSQL migration contract valid
Vite production build：1757 个模块转换成功
```

## 4. 当前边界

- 本轮只验证 SQL 合同结构，没有连接 PostgreSQL/Supabase 执行迁移。
- 尚未使用真实 JWT 做成员、角色和跨工作区读写矩阵测试。
- 本机 IndexedDB 到云端表的迁移脚本尚未执行，原始文件仍需对象存储合同。
- 外部数据库、Auth、RLS 项目和生产密钥仍未创建。

## 5. 下一里程碑入口

1. 用户批准云端项目、区域、成员角色和环境隔离方案。
2. 在独立 development 数据库执行迁移并修正真实 PostgreSQL 语法/权限差异。
3. 用脱敏快照回放商品、成本批次、审批和定稿事件，验证业务事务与 RLS。
4. 再进入 staging、对象存储和前端 `api`/`supabase` 提供方接入。
