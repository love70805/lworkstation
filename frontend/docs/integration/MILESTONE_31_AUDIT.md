# 里程碑 31：多平台 SKU / 单平台 SKC ERP 主链路验收

日期：2026-08-08  
状态：**已完成本机端到端验收；真实 ERP 登录态与云端环境仍待验收**

## 目标

验证业务实际使用的标识关系：一个平台 SKC 下包含多个平台 SKU；ERP 以平台 SKC 查询，返回同一仓库 SKU 对应的多个平台 SKU 成本；成本发布后，利润面板按平台 SKU 精确核算，并把定稿结果回流选品参考。

## 已完成

- 新增 [erpMultiSku.integration.test.js](../../src/data/erpMultiSku.integration.test.js)：覆盖商品建档、同 SKC 双 SKU 销售导入、ERP 请求、自动收件、成本发布、精确利润定稿、收件确认和选品参考回流。
- 扩展 [erp-inbox-server.test.mjs](../../../tools/erp-inbox-server.test.mjs)：覆盖 HTTP 收件服务按完整平台 SKU 集合关联同一 SKC 请求，并验证返回批次中保留两个平台 SKU 映射。
- 验证 ERP 成本仍是正式成本来源，选品参考行的 `authoritativeSource` 为 `erp`，币种为 CNY。

## 验证结果

```text
44 个测试文件，152 项测试通过
Vite 生产构建通过（1813 个模块）
ERP 收件服务测试通过（含多 SKU / 单 SKC）
同步、种子、Schema 和部署门禁全部通过
```

## 当前边界

- 尚未在用户自己的 Chrome 登录态完成真实链路：复制平台 SKC → ERP Assistant v8.0.1 核算 → 自动投递 → Shopeers 收件 → 成本发布 → 利润定稿。
- 尚未创建或连接 Supabase/PostgreSQL/Auth/托管资源，也没有上传真实数据。
- 多设备字段级冲突合并仍未实现，当前恢复模式是管理员确认后的整工作区恢复。

因此，项目仍处于：**本机真实数据 Beta，可供组内试用和业务验收；尚未达到云端生产发布条件。**
