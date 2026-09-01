# PostgreSQL 与 RLS 设计草案

状态：**迁移草案与权限合同已静态验证，未创建数据库、未执行迁移**

## 1. 核心原则

- 每张业务表都带 `workspace_id`，数据库负责租户隔离。
- 平台 SKU 是工作区内全局唯一标识：`unique(workspace_id, canonical_platform_sku)`。
- 平台 SKC 是 ERP 查询单位，可关联多个平台 SKU，不设全局唯一约束。
- 金额使用 `numeric(18, 6)`，币种默认 `CNY`；不能用浮点保存正式成本或利润。
- ERP 成本是正式成本来源；1688 只写入参考成本，经过人工审批后才允许进入某一本未定稿账本的正式成本决策。
- 已定稿利润行是不可变快照；修订必须产生新版本或解锁审计事件。

## 2. 表分层

### 租户与权限

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `workspaces` | `id`, `name`, `default_currency`, `timezone` | 工作区根记录 |
| `workspace_members` | `workspace_id`, `user_id`, `role`, `status` | 成员与角色；唯一键为工作区 + 用户 |

角色建议：`admin`、`selection`、`operations`、`finance`、`viewer`。

### 商品与选品

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `products` | `workspace_id`, `name`, `platform_skc`, `status` | 商品主档 |
| `platform_skus` | `workspace_id`, `product_id`, `platform_skc`, `canonical_platform_sku`, `status` | 平台 SKU 及其 SKC 归属 |
| `supplier_offers` | `workspace_id`, `product_id`, `platform_sku_id`, `source`, `landed_unit_cost`, `currency` | 1688 供应商与参考落地成本 |
| `captures` | `workspace_id`, `request_id`, `status`, `draft`, `validation` | 采集待确认队列 |

### 月度利润

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `ledgers` | `workspace_id`, `period`, `type`, `status`, `currency`, `warehouse_rate` | 月度账本；工作区 + 月份 + 类型唯一 |
| `import_batches` | `workspace_id`, `ledger_id`, `file_hash`, `mapping`, `status` | 台账导入批次 |
| `sales_rows` | `workspace_id`, `ledger_id`, `platform_skc`, `platform_sku`, `quantity`, `revenue` | 原始销售行；按账本保留 |
| `erp_cost_requests` | `workspace_id`, `ledger_id`, `platform_skcs`, `status` | 复制到 ERP 的 SKC 请求 |
| `erp_cost_batches` | `workspace_id`, `ledger_id`, `input_hash`, `status`, `published_at` | ERP 成本发布批次 |
| `erp_cost_rows` | `workspace_id`, `ledger_id`, `platform_sku`, `warehouse_sku`, `unit_cost`, `published_at` | ERP 成本事实；同一账本取最新发布批次 |
| `cost_approvals` | `workspace_id`, `ledger_id`, `platform_sku`, `approved_amount`, `status` | 1688 兜底审批，仅本账本生效 |
| `profit_lines` | `workspace_id`, `ledger_id`, `platform_sku`, `formal_cost_source`, `formal_unit_cost`, `finalized_at` | 精确利润定稿快照 |

### 审计与同步

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `audit_events` | `workspace_id`, `event_id`, `object_type`, `object_id`, `content_hash` | 云端幂等审计事实 |
| `sync_receipts` | `workspace_id`, `event_id`, `sync_version`, `received_at` | 可选的同步回执索引；也可并入 `audit_events` |

## 3. 必须存在的约束与索引

```sql
-- 平台 SKU 工作区全局唯一
unique (workspace_id, canonical_platform_sku)

-- 月度账本唯一
unique (workspace_id, period, type)

-- 审计同步幂等
unique (workspace_id, event_id)

-- 常用查询和 RLS 辅助索引
index platform_skus_workspace_skc on platform_skus (workspace_id, canonical_platform_skc);
index sales_rows_ledger_skc on sales_rows (workspace_id, ledger_id, canonical_platform_skc);
index erp_cost_rows_ledger_sku on erp_cost_rows (workspace_id, ledger_id, canonical_platform_sku, published_at desc);
index cost_approvals_ledger_sku on cost_approvals (workspace_id, ledger_id, canonical_platform_sku, status);
index audit_events_workspace_created on audit_events (workspace_id, created_at desc);
index workspace_members_user_workspace on workspace_members (user_id, workspace_id, status);
```

所有外键列都要单独有索引，避免成员删除、账本查询和级联检查触发全表扫描。正式迁移不能使用不存在的 `ADD CONSTRAINT IF NOT EXISTS`，应在迁移中显式检查约束或保证迁移只执行一次。

## 4. RLS 边界

每张包含 `workspace_id` 的表都执行：

```sql
alter table public.<table_name> enable row level security;
alter table public.<table_name> force row level security;
```

成员判断使用安全定义函数，函数固定 `search_path`，策略中的身份函数用 `select` 包裹以避免逐行重复计算：

```sql
create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
  );
$$;
```

读策略示意：

```sql
create policy products_read on public.products
for select to authenticated
using ((select public.is_workspace_member(workspace_id)));
```

写策略按角色拆分，不能只依赖前端隐藏按钮：

- `selection`：商品、平台 SKU、供应商报价、采集确认。
- `operations`：销售导入、ERP 请求、账本草稿。
- `finance`：成本审批、利润复核、定稿。
- `admin`：成员、工作区策略、锁定账本、全量导出。
- `viewer`：只读已授权数据。

服务端同步接口使用受控的服务角色完成事务，但必须先校验令牌中的用户、工作区成员关系和事件动作权限；不能把 service role 暴露给浏览器。

## 5. 成本与利润一致性

1. `erp_cost_rows` 是 ERP 事实表，不能被 1688 参考记录覆盖。
2. `cost_approvals` 只能引用 1688 参考成本，且必须带审批人、原因、时间和输入快照。
3. 生成 `profit_lines` 时，把最终来源、单件成本、币种、公式版本和成本批次 ID 写入快照。
4. `ledgers.status = 'finalized'` 后禁止修改销售行、成本决策和利润行；更正通过新账本版本或显式解锁流程完成。
5. 选品参考查询可以读取 ERP 最新成本和已定稿利润，但不能反向改写历史定稿账本。

## 6. 迁移与验收顺序

1. 先在脱敏数据库执行租户、成员、商品和 SKU 表迁移。
2. 用唯一约束测试平台 SKU 重复、跨工作区相同 SKU 和多个 SKU 归属同一 SKC。
3. 再迁移月度账本、销售行、ERP 成本批次和审批表。
4. 用事务测试验证“ERP 优先、1688 需审批、缺成本不能定稿”。
5. 最后启用 RLS，并用不同角色的真实 JWT 做读写矩阵测试。
6. 完成恢复演练和审计回放后，才允许接入前端 `api`/`supabase` 提供方。

## 7. 当前实现映射

- `src/domain/cloudPermissions.js`：前端与开发服务共用的角色操作矩阵。
- `src/domain/cloudAuthorization.js`：开发服务令牌、角色、工作区白名单和审计动作授权。
- `src/domain/cloudSeedPostgresPlan.js`：将云端种子包转换为固定表顺序、参数化 SQL 的事务计划。
- `importCloudSeedWithPostgresClient(seed, { client, workspaceMember })`：生产服务提供带 `query` 方法的 PostgreSQL 客户端和当前管理员成员上下文。
- 导入事务会先幂等 upsert `workspace_members`，再写入业务表，避免 RLS 下出现“数据已写入但无人可访问”的工作区。

这些模块不会在浏览器中携带数据库凭据，也不会自动执行迁移。
