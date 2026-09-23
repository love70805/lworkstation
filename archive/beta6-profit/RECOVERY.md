# Beta.6 M1 草稿恢复记录

2026-09-24。利润专职归档后，应用管理的 `f861` 工作树被移除；该工作树有 5 个未提交 M1 文件。恢复以该任务的完整工具记录和交接清单为依据，在 `codex/beta6-implementation` 的 `99549ab` 后续分支重建，未触碰用户数据库。

| 文件 | 恢复依据 |
| --- | --- |
| `frontend/src/domain/erpAutomaticAdoption.js` | 原任务写入文件的 here-string 命令全文 |
| `frontend/src/data/repositories/profitRepository.js` | 原任务插入 processor、替换 receive、修改发布/撤回/拒绝路径的命令全文 |
| `frontend/src/domain/erpCostBatchEnvelope.js` | 原任务文件变更记录中的完整单行差异 |
| `frontend/src/data/erpAutomaticAdoption.integration.test.js` | 原任务首次写入与追加 4 用例的命令全文 |
| `frontend/src/data/profitRepository.erpCost.integration.test.js` | 原任务文件变更记录及命令全文 |

恢复后 `profitRepository.js` 差异为 201 行（交接时 200 行）；多出的 1 行是对已定位故障的修复：缺失 SKU 没有仓库 SKU 时，先判断字段存在再调用 `canonicalWarehouseSku`。其余两个已跟踪文件的差异统计与交接时相同（12 行、1 行）。新文件的原始字节哈希未在交接记录中保存，因此无法证明逐字节相同；已按原命令和全部 5 文件范围核对逻辑，并保留这个限制。

恢复版本验证：`node node_modules/vitest/vitest.mjs run src/data/erpAutomaticAdoption.integration.test.js src/data/profitRepository.erpCost.integration.test.js src/data/erpManualAdoption.integration.test.js src/data/erpInbox.integration.test.js src/domain/erpCostBatchEnvelope.test.js src/App.erpInbox.test.jsx --maxWorkers=2`，6 文件 93 项通过；`git diff --check` 通过。此提交是继续 M1 审查的可追溯基线，尚不是 Beta.6 发布候选。来源排序、审计、恢复与真实页面状态仍需补验。
