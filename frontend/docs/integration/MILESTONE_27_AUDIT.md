# 里程碑 27：ERP 收件关联增强审计

## 本次目标

降低 ERP Assistant v8.0 成本结果在多账本、多人并行操作时误关联的风险，并为真实 ERP 验收保留可复现的测试入口。

## 已完成

- `tools/erp-inbox-server.mjs`
  - 显式携带 `requestId` 时优先按请求 ID 关联。
  - 未携带 `requestId` 时，按成本结果中的平台 SKU 集合匹配未完成请求。
  - 只有一个候选请求时才自动关联。
  - 多个候选请求无法唯一确定时返回 `ERP_REQUEST_AMBIGUOUS`，要求 ERP 请求包携带明确请求 ID。
  - 请求默认 2 小时有效，过期请求不会进入待匹配队列。可通过 `SHOPEERS_ERP_REQUEST_TTL_MS` 调整，最短 60 秒。
  - 服务读取收件箱时会把过期的 `registered` 请求落成 `expired`，并保留 `expiredAt`；`GET /erp/v1/requests?includeHistory=true` 可用于审计查询。
  - 原有本机 HTTP、幂等批次和确认接口保持兼容。

- `tools/erp-inbox-server.test.mjs`
  - 覆盖请求登记幂等。
  - 覆盖错误平台 SKU 拒绝。
  - 覆盖按平台 SKU 唯一关联。
  - 覆盖多请求歧义拒绝。
  - 覆盖收件确认重复提交。
  - 覆盖过期请求落状态和历史查询。

## 验证结果

```text
pnpm erp:inbox:test   通过
pnpm test             42 个测试文件，142 项通过
```

## 当前边界

- 自动关联依据是 ERP 结果中的平台 SKU 集合；如果 ERP 页面只导出仓库 SKU、没有可映射的平台 SKU，服务会拒绝自动关联，必须使用带明确 `requestId` 的请求包或人工导入。
- 服务仍只绑定 `127.0.0.1`，适合本机桥接，不是云端生产服务。
- CORS 和本机服务令牌尚未作为生产安全边界启用。
- 尚未在用户已登录的真实卓麟 ERP 页面中完成一次完整核算验收。

## 真实验收步骤

1. 启动 `pnpm erp:inbox`。
2. 启动 Shopeers 开发服务并打开对应月度账本的“ERP 成本核对”。
3. 点击“复制平台 SKC”，确认请求已登记。
4. 在用户自己的 Chrome 登录态中加载 `ERP-Assistant-v8.0.1-shopeers-bridge.zip`，执行一次真实核算。
5. 返回 Shopeers，确认自动收件批次的工作区、账本、请求 ID、平台 SKC 集合和 CNY 币种均一致。
6. 解析并核对，发布 ERP 正式成本，再进入利润面板完成精确核算。
