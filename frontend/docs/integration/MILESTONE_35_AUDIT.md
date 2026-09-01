# 里程碑 35：ERP Assistant v8.0 桥接生成验收

日期：2026-08-08  
状态：**桥接生成器已完成本机真实扩展验收，真实登录态端到端仍待执行**

## 本次验收

使用本机已有的 ERP Assistant v8.0 Chrome 扩展目录运行：

```text
node tools/build-erpa-shopeers-bridge.mjs <v8.0扩展目录> <输出目录>
```

生成结果已验证：

- 扩展版本升级为 `8.0.1`。
- 注入 `src/shopeers-bridge.js` 到原有 content script。
- 增加 `http://127.0.0.1:8790/*` 本机收件权限。
- 在原 v8.0 成本计算完成位置发出 `shopeers:erp-v8-cost-result` 事件。
- 桥接脚本将成本结果投递到 `/erp/v1/cost-results`。

## 自动回归

- 新增 `pnpm erp:bridge:test`，使用最小扩展夹具验证复制、事件注入、manifest 修改和收件端点。
- `erp:bridge:test` 已纳入本地发布候选验收和部署门禁。
- GitHub `Shopeers quality` 已通过。

## 仍需真实条件

- 尚未在用户自己的 Chrome 登录态中执行完整链路：复制平台 SKC → ERP Assistant 查询 → 成本投递 → Shopeers 收件 → 成本发布 → 利润定稿。
- 桥接扩展仍只投递本机收件服务，不上传 ERP Cookie、Token 或登录凭据。
- 真实云端资源和正式成员账号仍未配置。

因此本里程碑证明的是：**桥接构建可复现、协议可自动验证**，不等同于真实 ERP 登录态已经完成生产验收。

