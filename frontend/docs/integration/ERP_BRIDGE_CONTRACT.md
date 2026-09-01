# ERP Assistant v8.0 桥接合同

状态：安全本机桥接 contract 已实现；桌面 capability 注入待宿主阶段接入
审计日期：2026-08-29

## 业务边界

- 平台 SKC 是 ERP 查询单位。
- ERP 仓库 SKU 是平台 SKC 与平台 SKU 的映射桥梁。
- 同一仓库 SKU 可映射多个平台 SKU/SKC，并由这些映射共享一份 `warehouseEvidence` 采购历史。
- 平台 SKU 在工作区内全局唯一，用于利润面板和选品参考成本关联。
- 默认币种为 CNY。
- ERP 成本是正式成本；1688 成本只能作为参考，正式兜底必须经过人工确认。

## 请求包

页面保留“复制平台 SKC”的人工流程，同时可导出 `shopeers-erp-v8-request` JSON 请求包。请求包固定包含：

- 工作区 ID、账本 ID、请求 ID、请求人和请求时间；
- `query.unit = platform_skc`；
- 去重后的平台 SKC 及规范化值；
- CNY；
- ERP Assistant v8.0.0 基线和 `erp-v8.0-compatible@1` 算法版本。

真实 v8.0 扩展仍输出 4 列剪贴板 TSV 或 10 列 CSV。Shopeers 不要求扩展伪造 JSON；导入时会使用当前账本中已存在的平台 SKU → 平台 SKC 关系，把原始文本包装为本地可审计批次。

## 回传包

现有 `shopeers-erp-cost-batch` 回传格式继续兼容。导入时会校验：

- 工作区、账本、请求 ID 必须与当前页面一致；
- 查询 SKC 集合必须与请求包一致；
- 批次必须完整完成，且声明 ERP Assistant v8.0.0 权威基线；
- 成本必须为正数且币种为 CNY；
- 输出行数、仓库 SKU 数和查询 SKC 数必须与汇总一致。

v2 回传行必须包含 `ledgerScopeRole`：

- `expected`：平台 SKU 位于当前账本请求的 `expectedSkus`，且 ERP 返回的平台 SKC 与请求快照一致；参与成本核对和正式发布。
- `auxiliary`：平台 SKU、平台 SKC、仓库 SKU 完整，SKC 位于完整查询范围，但平台 SKU 未在当前账本产生销售；作为“同查询 SKC 下、本账本未使用的额外变体”保留预览和审计。
- 角色由本机收件服务依据已登记请求独立重算。辅助行不参与平台 SKU 或仓库 SKU 兜底，不写正式成本，也不能把范围提示传播到共享仓库证据或 expected 行。
- 缺平台身份、查询范围外 SKC、expected SKU/SKC 不一致、映射接口失败、明细失败或 expected 证据缺失仍按 fail-closed 处理。

如果原始文本中没有平台 SKC，系统不会从商品名称、供应商货号或平台 SKU 猜测 SKC；只能使用当前账本的已确认 SKU/SKC 映射。没有请求包或最近一次请求记录时，文本可以预览，但不能发布正式成本。

平台 SKU 仍按直接匹配优先，仓库 SKU 作为人工复核的兼容兜底。未绑定当前请求的成本不会进入利润定稿。

成本核对页会在打开账本时恢复最近一次 ERP 请求；如果当前账本从未建立请求关联，发布按钮不会把成本写入正式成本批次。这样可以避免“只粘贴一份成本表但无法说明查询范围”的不可追溯记录。

该规则同时在数据层事务中强制执行：即使绕过页面直接调用发布 API，没有与当前工作区和账本匹配的已记录请求，也不能写入 ERP 正式成本事实。

## 本机传输安全边界

- `tools/erp-inbox-server.mjs` 启动时必须通过 `SHOPEERS_ERP_INBOX_CAPABILITY` 获得至少 32 字符的随机 capability；所有 ERP、选品、状态、ACK 与健康探针路由都要求同一 `Authorization: Bearer`，失败统一返回 401。
- 服务不发送 wildcard CORS 或 Private Network Access 响应头。网页和 renderer 不得直接访问 localhost；生产 renderer 只调用 `window.shopeersDesktopRuntime.requestInbox({ route, method, query, body })`，token 与 base URL 仅由桌面 main/preload 持有。
- ERP 扩展的 MAIN world 只观察采购查询 URL，并发出最小查询信号。核算、证据组装和 runtime messaging 位于 isolated world；localhost 请求、请求上下文恢复、稳定 delivery 缓存与重试位于 background。
- 页面事件、DOM dataset、localStorage 和消息 payload 不能指定 endpoint、capability、workspaceId、ledgerId、requestId、expectedSkus 或 `ledgerScopeRole`。background 会剥离这些字段，本机服务还会依据已登记请求再次恢复身份并重算角色。
- `window.postMessage` 与 `BroadcastChannel` 不再作为可信 ERP inbox transport。手工导入仍经过 CostMatching 与 repository 的完整 v2 fail-closed 校验。

## 桌面阶段 2 接口

- capability 生成：桌面每次启动使用密码学随机源生成至少 32 字节，建议 `crypto.randomBytes(32).toString("base64url")`。
- child env：`SHOPEERS_ERP_INBOX_CAPABILITY`；不得写入日志、spool、renderer 或诊断响应。
- preload IPC：`requestInbox({ route, method, query, body }) -> Promise<{ status, body }>`；main 负责固定 loopback base URL、附加 bearer、限制 `/erp/v1/*` 与 `/selection/v1/*` 路由及 GET/POST 方法。
- extension runtime 配置：`chrome.storage.local` 中的 `shopeersErpInboxBaseUrl`、`shopeersErpInboxCapability` 与 `shopeersErpWorkspaceId`，由桌面宿主作为一个原子配置写入；页面与 MAIN world 不可读写。任一字段缺失或 base URL 不是明确的 loopback HTTP origin 时，background 返回 `ERP_INBOX_NOT_CONFIGURED` 且不发起网络请求。
- 请求 hydration：background 查询 `/erp/v1/requests` 时必须携带受控 `workspaceId`，候选请求、缓存上下文和最终 `/erp/v1/cost-results` 都必须精确匹配该工作区；相同 SKC 的其他工作区请求不可见、不可投递。
- pending 归属：background 在首次保存结果缓存前固化当前可信 `workspaceId`。缺少该快照或运行时切换到其他工作区时，不查询、不投递、不重绑，也不消耗补发次数；切回原工作区后才可继续恢复。
- direct 幂等：`/erp/v1/cost-batches` 对原始完整 JSON 使用稳定对象键序列化生成输入哈希，不经过证据 sanitizer。只有 outer/inner/context/query/row/evidence/version 和所有声明字段完全相同的 deliveryId + batchId 重放才返回幂等成功。
- 桌面健康探针、ERP/选品轮询、ACK 和 extension-status 都必须走同一鉴权通道。1688 扩展也需在桌面阶段迁移到 background capability transport，才能与已加固的 selection 路由互通。

## 当前未做

- capability 只保护本机 transport，不替代 ERP 登录态；ERP Cookie/会话仍留在受控 ERP session 中。
- 没有自动上传外部服务。
- 没有把 1688 参考成本自动写成正式成本。
