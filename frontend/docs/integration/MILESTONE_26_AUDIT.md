# 里程碑 26：ERP v8.0 本机成本收件桥接

状态：本机 ERP 成本收件协议与幂等收件箱已完成；真实 ERP Assistant 扩展尚未接入生产投递
审计日期：2026-08-08

## 本次完成

- 新增 `shopeers-erp-cost-inbox` v1 收件协议，严格复用 ERP Assistant v8.0.0 权威发布基线。
- 收件前校验：
  - 消息来源必须为 `erp-assistant-v8`；
  - 批次必须完整完成；
  - 工作区、账本、成本请求和平台 SKC 查询范围保持一致；
  - 币种保持 CNY，成本算法保持 `erp-v8.0-compatible@1`。
- 新增本机 IndexedDB `erpCostInbox` 收件箱：
  - 按投递 ID 幂等；
  - 按批次 ID 防止重复入队；
  - 记录传输方式、收到时间、批次摘要和审计事件；
  - 发布正式成本后标记为 `applied`，不会修改历史正式账本。
- Shopeers 全局监听两种本机投递方式：
  - `window.postMessage`；
  - `BroadcastChannel("shopeers-erp-cost")`。
- 新增可选本机 HTTP 收件服务 `pnpm erp:inbox`：
  - 监听 `http://127.0.0.1:8790/erp/v1/cost-batches`；
  - 以本机 spool JSON 文件持久化待收件批次；
  - 按投递 ID / 批次 ID 幂等；
  - Shopeers 每 5 秒轮询并在成功写入 IndexedDB 后确认收件。
- 新增可重复构建脚本 `tools/build-erpa-shopeers-bridge.mjs`：
  - 以审计过的 v8.0 ZIP 解压目录为输入；
  - 只在核算完成点增加事件投递，不改变 ERP 采购记录筛选和加权成本算法；
  - 自动增加本机 HTTP 权限和 Shopeers 适配脚本；
  - 已生成 `C:\Users\a1823\Desktop\ERP Assistant\8.0\Chrome扩展\dist\ERP-Assistant-v8.0.1-shopeers-bridge.zip`。
- 成本核对页会自动发现当前账本的待处理批次，并载入 JSON 批次预览；TSV/CSV 仍保留为兼容降级入口。

## 扩展投递约定

ERP Assistant v8.0 成功完成全量核算后，后续桥接代码应发送完整收件包：

```js
window.postMessage({
  type: "shopeers.erp.cost.batch",
  source: "erp-assistant-v8",
  format: "shopeers-erp-cost-inbox",
  formatVersion: 1,
  deliveryId: "ERP-DELIVERY-<uuid>",
  sentAt: new Date().toISOString(),
  transport: "browser-message",
  baseline: {
    application: "ERP Assistant",
    version: "8.0.0",
    releaseSha256: "199561b86755b93000f3fc0197e8cd4ed5e699072a76d11d48e00c18f8e4a0ed"
  },
  batch: erpCostBatchEnvelope
}, "*");
```

桥接只投递成本批次，不投递 ERP Cookie、Token、登录态或其他凭据。若自动投递不可用，继续使用当前请求包 + TSV/CSV/JSON 导入链路。

若 ERP 扩展无法与 Shopeers 共用页面上下文，直接向本机 HTTP 收件服务发送同一消息 JSON：

```js
await fetch("http://127.0.0.1:8790/erp/v1/cost-batches", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(message),
});
```

## 自动化验收

- `pnpm test`：42 个测试文件、142 项通过；
- `pnpm build`：1766 个模块构建成功；
- `pnpm deploy:check`：通过。
- `node --check tools/erp-inbox-server.mjs`：通过。
- `node tests/core-logic.test.cjs`（ERP Assistant）：4 项通过；
- 本机 HTTP 端到端：请求登记 -> 原始成本结果投递 -> v8.0 批次包装 -> GET 待收件，平台 SKC 和单件成本校验通过。

## 当前限制

- 已生成独立的 `v8.0.1-shopeers-bridge.zip`，原始 `v8.0.0.zip` 未覆盖；
- 尚未连接真实 ERP、Supabase、PostgreSQL 或 Vercel 生产环境；
- 浏览器消息桥接目前只负责可靠收件，正式成本仍需在成本核对页完成预览和发布，符合“ERP 成本优先、人工确认兜底”的规则。
