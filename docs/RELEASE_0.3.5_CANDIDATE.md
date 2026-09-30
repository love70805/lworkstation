# 0.3.5 本机候选验收记录

状态：**隔离候选已构建，业务验收未通过；未公开、未安装、未改真实业务数据。** 基线 `aa1e970`，工作分支 `codex/release-0-3-5`。本批将原 ERP 收件竞态草稿和选品补资料修复一起审查、实现；无数据库迁移。

## 已验证

- 真实 ERP 只读：目标 SKC 正向得到三个仓库商品，三个平台 SKU 反向及“映射关系”均指向目标 SKC 和各自仓库 SKU；共用仓库的其他 SKC 被排除。[字段证据](integration/ERP_UNIT_EVIDENCE_2026_09_30.md)。
- 生产扩展结果策略及后台行生成，经可信资料收件、持久化、选品编辑、保存与重开隔离测试通过；未售 SKU 带入属性和图片，不生成销量、正式成本或虚构 1:1 换算。已有明确 `erp_platform_mapping` 来源的换算可贯通；真实样本没有此字段。
- 标题的两种保暖手套规格、有效封面与多标题候选解耦、关联台账净销量选图、晚到资料、供应商来源、覆盖状态、新旧资料与单店七天标签均有回归。ERP 收件中间状态不自动载入旧草稿，旧快照遇已采用结果不误报红错；真实失败仍显示。
- 独立交叉审查发现并修复编辑中新增 SKU 丢失、封面错用其他月份账本两项。`pnpm --dir frontend release:check`：151文件/1127项、前端构建、ERP Assistant 公共目录及 ZIP 一致性、收件与同步合同等门禁通过；`desktop verify` 通过。重建后的 0.3.5 隐藏窗口 packaged smoke 返回 `ok:true`、`visibleWindowCount:0`；候选 `release:build`、`release:organize`、`release:check` 通过。

## 尚未通过

真实 ERP 的 `proportionOfGoodsPurchased1688=1-1` 只表示采购规格比例，映射明细没有仓库单位与平台销售单品的数量关系，`platformSkuCost` 是金额。不能据此确认三平台 SKU 的参考单件成本。已向决策端按三个 SKU 请求实际换算口径；此前三分支的真实参考成本、带成本的现场建档及最终候选业务验收均未通过。此次候选不得发布或覆盖安装。真实 ERP 页面未写入；本机 smoke 使用隔离临时用户数据，未接入真实业务库。

## 候选原件

目录：`releases/candidates/0.3.5/`。安装包 `Lworkstation Setup 0.3.5.exe`，117231369 字节，SHA256 `A9BFFFAB818C3816AB1A17EC49FC88658B2C74C9EC6DD4957E01FA6EA3C3247E`。同目录含 `.blockmap`、`latest.yml` 与 `SHA256.txt`；这是稳定配置的本机候选，不代表公开 Latest。四个文件已复制到主工作区同名持久目录，安装包 SHA256 回读一致。先前候选已分别保存在 `archive/release-0.3.5/candidate-before-ui-copy-20260930/` 和 `archive/release-0.3.5/candidate-before-extension-sync-20260930/`，不可与本原件混用。
