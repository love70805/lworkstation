# 云端同步 API 合同（草案）

状态：**本地合同、业务投影和重放测试已实现；尚未部署外部服务**  
适用版本：`shopeers-sync-envelope v1`

这份合同只描述本机 outbox 如何把审计事件交给服务端。它不等于业务数据已经完成云端存储，也不允许在没有身份、角色和数据库迁移的情况下打开云端同步。

## 1. 接口

```text
POST /sync/v1/audit-events
Content-Type: application/json
Authorization: Bearer <short-lived access token>
```

服务端必须从令牌得到用户身份，并按 `workspaceId` 检查成员关系和角色。浏览器提交的 `actorId` 只作为审计上下文，不能用来冒充登录用户。

生产运行时应注入异步 JWT 校验器和工作区成员解析器：先验证 Bearer Token 签名、发行方、受众和过期时间，再以令牌 `sub` 查询 `workspace_members` 的 active 角色。授权完成前不得开启业务事务；审计写入包中的每一条事件都必须提供 `actorId`，并逐条与令牌 `sub` 完全一致，混合事件中任一缺失或冒用身份即整包拒绝。开发环境的静态 `SHOPEERS_SYNC_TOKEN` 仅用于冒烟测试。

云端模式下，利润、ERP 和成本核对的人工作业及自动 ERP 收件审计都使用当前 active member 的 `memberId` 作为 `actorId`。`erp-assistant-v8` 只记录在 `receivedVia` 或来源字段中，不能作为同步身份；没有真实 active member 时，API 与 Supabase 都必须停留在启动登录 gate。认证成功后仍须先原子写入当前成员上下文，只有写入完成才可共同挂载业务路由、ERP/选品 listener 与同步任务；账号切换时先卸载这些子树，再写入新 context，写入失败保持阻断。不得在任一窗口写入 `local-user` 或旧账号身份的实时云端事件。本地模式仍可使用 `local-user`，但也必须先完成本地成员上下文初始化再启动 listeners。

`VITE_SYNC_PROVIDER=api` 与 `supabase` 都必须从当前 Supabase Auth 会话取得 Bearer JWT 和 `user.id/sub`；`api` 只改变同步服务地址，不改变身份来源。独立 `api` 请求只发送 `Authorization: Bearer ...`，不发送 Supabase `apikey`；`apikey` 仅用于 Supabase endpoint。只有 HTTP 端点而没有 Supabase URL/anon key 的配置视为无效，应用启动时必须阻断业务子树和同步，不能退化为本机模式，也不能从本地 settings 或公开 `VITE_` actor 字段推断身份。

## 2. 请求包

```json
{
  "format": "shopeers-sync-envelope",
  "formatVersion": 1,
  "workspaceId": "workspace-default",
  "generatedAt": "2026-08-07T08:00:00.000Z",
  "cursor": "12",
  "events": [
    {
      "eventId": "12",
      "workspaceId": "workspace-default",
      "objectType": "product",
      "objectId": "PROD-1",
      "action": "product_created",
      "actorId": "local-user",
      "createdAt": "2026-08-07T07:59:00.000Z",
      "before": null,
      "after": {
        "platformSkuCount": 3,
        "snapshot": {
          "product": { "id": "PROD-1", "workspaceId": "workspace-default" },
          "platformSkus": [],
          "supplierOffers": []
        }
      }
    }
  ]
}
```

服务端在事务开始前拒绝以下情况：包格式/版本不支持、工作区为空、事件为空或跨工作区、事件 ID 重复、事件字段缺失、事件数量超过服务端 500 条硬上限。`before` 和 `after` 是审计快照，不能携带 Cookie、Token、密码或原始文件内容。

`voided` 与 `reopened_for_cost_recalculation` 是同一 finalized 账本纠错生命周期的二事件原子组。客户端可以把普通领取 `limit` 视为软目标：`limit=1` 遇到完整配对时允许领取 2 条；在 500 条边界无法容纳完整配对时，必须把整个配对留到下一包，任何请求都不得生成 501 条。失败重试仍按组领取，不能让前一条长期占据队首、使后一条永久饥饿。

所有 `upsert` 类业务事件必须在 `after.snapshot` 中携带可独立重放的完整业务事实。复合操作同时保存主记录和关联明细，例如商品与平台 SKU/供应商报价、销售导入批次与销售行/月度账本、ERP 成本批次与成本行/月度账本、利润定稿账本与实际持久化利润行。`deleted` 是唯一不要求快照的业务事件。

## 3. 幂等与事务

幂等键固定为：

```text
(workspace_id, event_id)
```

服务端按以下顺序处理一批事件：

1. 校验访问令牌、工作区成员关系和角色。
2. 校验 envelope 与事件的工作区一致性。
3. 在 `audit_events` 上按幂等键插入；已存在且内容摘要相同的事件视为重复成功。
4. 已存在但内容摘要不同，返回冲突，不得静默覆盖。
5. 按事件类型调用对应的业务写入器；业务写入和审计插入处于同一数据库事务。
6. 事务全部提交后生成回执。

事件处理器必须是可重放的。不能只写审计表而不写对应实体，也不能在业务写入失败时返回部分成功。

ERP 作废/重开事件在 envelope v1 内有两种受控表示：

- 新格式：两条事件都提供相同的 `transitionId` 和 `voidedBatchId`，并严格匹配 ledger、batch、actor、reason、createdAt 以及 batch/inbox 双侧作废元数据。
- 兼容旧格式：两条事件都不包含 identity 字段，且必须相邻并在上述业务字段上无歧义一致。服务端只在运行时推导 identity，不改写事件、不改变幂等内容摘要。

服务端必须先按 `(workspace_id, event_id)` 查询远端已存在事件，再对仍待执行的事件应用配对校验。这样，已成功落库但客户端丢失回执的旧格式事件可以按原哈希幂等确认；历史事件不能与本次新事件拼成作废/重开授权。只携带部分新 identity、旧配对字段不一致或顺序不完整时返回不可重试的 `INVALID_ERP_VOID_REOPEN_PAIR`。客户端将该组标为终态失败以释放队列；只有用户显式执行“重试失败同步”后才重新进入自动领取。

## 4. 成功回执

```json
{
  "format": "shopeers-sync-ack",
  "formatVersion": 1,
  "workspaceId": "workspace-default",
  "eventIds": ["12"],
  "cursor": "12",
  "syncVersion": "2026-08-07T08:00:01.000Z"
}
```

回执必须包含本次请求的全部 `eventId`，不能只返回已处理的子集。`workspaceId` 必须与请求一致。客户端只有在格式、版本、工作区和完整事件集合均通过校验后，才把本地记录从 `in_flight` 改为 `synced`。

## 5. 失败回执

统一使用结构化错误，便于本地 outbox 重试：

```json
{
  "error": {
    "code": "EVENT_CONFLICT",
    "message": "事件内容与已存在版本不一致",
    "retryable": false,
    "eventIds": ["12"]
  }
}
```

建议错误码：

| 错误码 | HTTP | 是否重试 | 说明 |
| --- | ---: | --- | --- |
| `AUTH_REQUIRED` | 401 | 否 | 令牌缺失或过期，先重新登录 |
| `WORKSPACE_FORBIDDEN` | 403 | 否 | 用户不是该工作区成员或角色不足 |
| `INVALID_ENVELOPE` | 400 | 否 | 包结构、版本或字段不合法 |
| `EVENT_CONFLICT` | 409 | 否 | 同一幂等键对应不同内容 |
| `INVALID_ERP_VOID_REOPEN_PAIR` | 409 | 否 | ERP 作废/重开事件 identity、顺序或审计字段无法安全配对 |
| `RATE_LIMITED` | 429 | 是 | 按 `Retry-After` 延迟 |
| `SERVER_UNAVAILABLE` | 503 | 是 | 服务暂时不可用 |
| `INTERNAL_ERROR` | 500 | 谨慎 | 服务端记录 request id 后再重试 |

客户端重试分类以结构化 `retryable: true` 为最高优先级，不能因通用 4xx 判断把它终态化。未显式声明时，HTTP 408、429 和 5xx 默认保留为可重试；400、409 默认进入不可重试终态。`AUTH_REQUIRED` 和 `WORKSPACE_FORBIDDEN` 不计为永久业务失败，客户端释放领取状态并等待身份或权限恢复。

不可重试错误若携带非空 `error.eventIds`，客户端只隔离本次 envelope 中被明确点名的事件，同一事务回滚后其余已领取事件必须释放回 `pending`。未携带或携带空 `eventIds` 的整包合同错误，才可把整包标为终态；服务端点名不属于本 envelope 的 ID 时不能误伤本地事件。

## 6. 业务事件最小集合

第一版只接入已在本机审计中的事件：

- 商品和平台 SKU：`product_created`、`product_updated`、`capture_confirmed`。
- 销售台账：`created`、`imported`、`deleted`。
- ERP 成本：`skcs_copied`、`published`。
- 成本决策：`approved_1688_fallback`、`revoked`。
- 利润：`finalized`。
- 安全审计：`backup_exported`、`backup_restored`、`workspace_reset`。

原始 CSV/XLSX、商品图片和备份文件走对象存储上传合同，不混入审计事件接口。

## 7. 验收测试

云端适配器进入实现前，必须用脱敏夹具验证：

- 同一事件重复提交返回同一成功版本，不产生重复业务行。
- 同一事件 ID 携带不同内容返回 `EVENT_CONFLICT`。
- 跨工作区事件整批拒绝。
- 一批事件中任意业务写入失败时整批回滚，不返回部分成功回执。
- 过期令牌、无权限角色和超过批量上限均有明确错误码。
- 客户端收到缺事件回执、错误工作区回执或非法版本时保留 `failed` 状态。

## 8. 工作区恢复

```text
GET /sync/v1/workspaces/{workspaceId}/recovery
Authorization: Bearer <short-lived access token>
```

服务端只向当前工作区成员返回恢复包。恢复包采用 `shopeers-sync-recovery v1`，由以下两部分组成：

- `baseline`：首次管理员迁移并完成预检的完整云端种子基线。
- `events`：基线之后、带全局 UUID `eventId` 的完整业务增量事件。

客户端必须先校验格式、工作区、CNY 币种、平台 SKU 唯一性和全部引用关系，再允许用户确认覆盖。覆盖前必须生成本机回滚备份。恢复时对 ERP 作废/重开复用请求写入的严格配对合同：新格式缺少 identity 或 ledger/batch/actor/reason/time 任一不一致即拒绝；旧格式只接受无歧义相邻配对。旧版摘要型事件如果已经包含在基线审计表中，不再作为增量事件重复执行。

恢复写入 Dexie 时，`baseline.auditEvents` 和增量 `events` 都必须显式标记为 `synced`，并写入 `syncedAt`、`syncVersion`、清空 claim/error/terminal 字段。恢复数据不能经过 creating hook 再次进入 outbox。

v12 只执行 schema 前向迁移，不清空 ERP 请求、收件、正式成本、账本、利润结果或审计数据；业务数据保留是升级合同的一部分。显式测试数据重置必须走受控的独立流程。v13 修复尚未同步的 `system-migration`/旧技术 actor 审计，也覆盖 `7af79e5` 曾把旧成员写入 actor 的坏行。后者只按固定 workspace/object/action、`release=0.2.6-beta.1`、数量摘要和未同步状态精确识别，普通成员业务事件不能命中。v14 对已经运行旧 v13 的数据库前向补正：可证明原本已同步却被旧 v13 标成不确定投递的记录恢复为 synced，其远端事件内容不变；其他既有终态的 error/code/time 一律保留，只能由人工 retry 显式清除。已 `synced` 事件在所有 migration、uncertainty 与 actor repair 判断前永久短路；无论 attempts、claim 或技术 actor 是否残留，任何字段与内容哈希均不得改写。其余只有能证明从未发送（`syncAttempts=0` 且无 claim、状态非 failed/in-flight）的行可以自动修复：纯本地模式将其改为 `local-user` 与 `local-migration-baseline-v13`，云端无认证成员时以 `SYNC_ACTOR_REPAIR_REQUIRED` 隔离，登录后再改为 JWT `sub/memberId` 并释放为 pending。任何已领取、failed 或 in-flight 的旧行都存在远端提交不确定性；迁移只能用不参与同步 payload/hash 的元数据标记 `SYNC_ACTOR_REPAIR_UNCERTAIN`，必须完整保留 actor、before、after 和 eventId，等待原账号按原内容重试或显式人工处置。账号切换不得改写这类事件，也不得改写其他 `syncAttempts>0` 的 pending/failed 事件，避免远端已提交但回执丢失时制造 `EVENT_CONFLICT`。事件若已因 `EVENT_CONFLICT`、`INVALID_ERP_VOID_REOPEN_PAIR` 等合同错误终态，云端或本地自动 repair 同样不得清错或复活。
