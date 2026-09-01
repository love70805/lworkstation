# Shopeers 权威基线

状态：已冻结  
冻结日期：2026-08-06

## 1. 用途

本文件固定 Shopeers 集成开发必须兼容的两个既有产品版本。后续实现可以改进交互、存储和传输方式，但不得静默改变本文列出的业务行为。

## 2. 权威来源

### 2.1 ERP 成本与利润核算

权威版本是 ERP Assistant `v8.0.0` 的正式发布物，不是同目录中未完成的 8.1 工作区。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `C:\Users\a1823\Desktop\ERP Assistant\8.0\Chrome扩展\dist\ERP-Assistant-v8.0.0.zip` | 15068 | `199561b86755b93000f3fc0197e8cd4ed5e699072a76d11d48e00c18f8e4a0ed` |
| `C:\Users\a1823\Desktop\ERP Assistant\8.0\利润工具\利润.html` | 80161 | `34ee0414613e983b280ef8a0ce791f98894773ec0ecab740ac6c39cd3af7810b` |
| `C:\Users\a1823\Desktop\ERP Assistant\8.0\Chrome扩展\tests\core-logic.test.cjs` | 2967 | `b0ba4b793af082404052498d56768fbb2aa27aec0c3c9dbc8ecbc62fc418ae2d` |
| `C:\Users\a1823\Desktop\ERP Assistant\8.0\利润工具\tests\profit-runtime.test.cjs` | 8654 | `be2e0830875c78d751b875856cec508274fc8604e16e4b4a02bf31c90f8841ef` |
| `C:\Users\a1823\Desktop\ERP Assistant\8.0\交接文档.md` | 17096 | `e4d04bd9b65dbcc09fbd3ca5b8f25aad0a1825fefab4bf1e96ae16dff3619efb` |

### 2.2 选品工作台

权威版本是桌面端 `0.0.1-beta.2`、Chrome 扩展 `1.1.2`、本机 API `v1` 和 `CaptureEnvelope v1`。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `C:\Users\a1823\Desktop\love7\docs\CODEX_HANDOFF_v0.0.1-beta.2.md` | 12089 | `cfc8b209259eb5e714f1052a415215087b691b507c180d3401c83a1885ad7f03` |
| `C:\Users\a1823\Desktop\love7\version.json` | 1011 | `726ad146d1306e9bbe03c8265926c7be4945467e545c0d904af29f5e935407be` |
| `C:\Users\a1823\Desktop\love7\src\capture-envelope-v1.schema.json` | 3618 | `3adb3c3e8606460114ce8eedb2af366efa8f1da374773ad981a7fab3723fa2c2` |
| `C:\Users\a1823\Desktop\love7\src\chrome-extension\capture.js` | 53461 | `0365f0b89a5c60bc44c5723e896eab40cfb3b15b4f084b05de1fdb5a71de763c` |

## 3. 已验证状态

- ERP v8.0 采购成本核心回归：4 组行为检查通过。
- ERP v8.0 利润运行时回归：重复导入替换、IndexedDB 恢复、清空同步和 localStorage 容量降级通过。
- 选品工作台 `dev-check -All`：前端、扩展、后端 32 项测试、版本契约和路径安全检查通过。

这些结果证明旧版本在冻结时可运行，不代表 Shopeers 当前原型已经具备相同能力。

## 4. 不可破坏的兼容边界

1. ERP 成本抓取必须继续以用户在 ERP 中真实执行的查询为上下文，不自行猜测筛选条件。
2. 存在真实 1688 采购记录时，只使用最近最多 3 条真实 1688 记录；不足 3 条时不得用普通采购补足。
3. 没有真实 1688 记录时，才使用最近最多 3 条普通采购记录。
4. 单号与成本必须来自同一批入选采购记录。
5. 仓库 SKU 可以映射多个平台 SKU；正式利润成本最终按平台 SKU 匹配。
6. 月度台账一级分组保持“店铺 + SKC（缺失时供方货号）+ 供方货号”，二级分组保持“平台 SKU + 属性”。
7. 批量复制并输入 ERP 的查询标识是平台 SKC。
8. 利润公式保持“销售金额 - 采购成本 - 仓储成本 - 扣款”。
9. `CaptureEnvelope v1`、待确认再入库、重复检测顺序、连接密钥隔离和安全写盘规则必须保留兼容路径。

## 5. 变更控制

- 修改任何兼容边界前，必须新增或更新回归测试，并在变更记录中说明与旧版本的差异。
- 原始冻结文件只作为审计来源，不直接复制进产品构建产物。
- 若来源文件哈希发生变化，应先查明原因，再新增基线版本；不得覆盖本表中的旧哈希。
- Excel、CSV 和剪贴板 TSV 属于外部交换格式。内部模块应通过统一数据库和版本化数据合同交换数据。
