# Milestone 3 审计：ERP v8.0 成本批次与利润核算衔接

审计日期：2026-08-07  
结论：**成本批次合同与本地导入链路通过；真实 ERP 扩展联调和云端业务写入仍未完成。**

## 1. 本里程碑目标

- 固定 ERP Assistant v8.0.0 的正式成本基线。
- 将 ERP 按平台 SKC 查询得到的多仓库 SKU 成本封装为可校验批次包。
- 在利润面板发布正式成本时保留核算证据，并让选品/参考成本读取同一份结果。
- 明确 TSV/CSV 兼容通道与 JSON 批次通道的边界。

## 2. 已实现

| 文件/能力 | 证据 |
| --- | --- |
| `src/domain/erpCostBatchEnvelope.js` | `shopeers-erp-cost-batch v1`；校验工作区、账本、请求 ID、平台 SKC 查询单位、完整状态、行数、仓库 SKU 数、映射兜底数、CNY 与正成本 |
| `src/lib/erpCostImport.js` | 自动识别 JSON 批次；兼容 v8.0 TSV/CSV；保留产品名、核算次数、日期范围、采购量/价、选中记录和映射兜底证据 |
| `src/pages/CostMatching.jsx` | JSON 批次先校验再预览；发布时保存批次合同、v8.0 基线、输入哈希和核算证据；发布后回到利润面板 |
| `src/domain/erpCosts.js`、`src/data/database.js` | ERP 成本行与发布批次保存核算证据；不改变 ERP 优先、1688 审批兜底规则 |
| 成本查询阻断提示 | 台账缺少平台 SKC 时禁止生成“0 个 SKC”空请求；供方货号仅用于兼容分组，绝不替代 ERP 查询单位，并引导检查导入映射 |
| ERP 查询范围统一 | `collectErpPlatformSkcs` 统一成本页与利润页的 SKC 收集逻辑，避免把供方货号或平台 SKU 误复制到 ERP |

## 3. 验证结果

```text
Vitest：20 个测试文件，64 项测试通过
Vite production build：1754 个模块转换成功
浏览器回归：/workspace、/profit、/cost-matching 可加载；中文文案、CNY 格式、成本缺失状态正常
```

## 4. 当前边界与未完成项

- 当前演示账本的 3 条销售明细没有平台 SKC，因此不能生成 ERP v8.0 查询请求；这属于导入映射数据缺失，不代表 ERP 没有成本。
- 尚未把 v8.0 扩展直接桥接到 Shopeers；后续桥接只能传输 v8.0 已计算结果，不得重写 ERP 成本选择算法。
- 尚无真实 API、Auth、PostgreSQL/RLS、对象存储和多成员同步；云端文档目前只是部署与接口设计。
- 尚未完成真实 ERP 扩展联调、云端集成测试和生产数据迁移。

## 5. 下一里程碑入口

1. 用正式台账重新映射“平台 SKC”列，验证复制 SKC → ERP v8.0 → JSON 批次导入 → 发布利润的闭环。
2. 基于 v8.0 输出开发只传输桥接，不在 Shopeers 中复制 ERP 算法。
3. 获得明确批准后，按 `CLOUD_API_CONTRACT.md` 与 `POSTGRES_RLS_DESIGN.md` 创建云端资源并做小范围只读部署。
