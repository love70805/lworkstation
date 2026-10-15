# 0.4.28 ERP 档案来源核对（已公开稳定 Latest）

商品编辑器按 SKU 合并相同 ERP 回传，保留不同资料与全部来源；采购按供应商、仓库、SKU 和规格归组，订单按需展开。供应商卡片可预览并选择商品/店铺链接，保存重开后保留；属性确认与保存状态明确，不再重复警告。

基线：已联网核对远端 main `76692669e8eacbe3cfa5ae5d5456f5a5ff6fc4d1`；[契约与验收](integration/CATALOG_EVIDENCE_0.4.28.md)。

194 文件 / 1541 项前端测试、生产 build、完整发布门禁、17 组 desktop verify 通过；最终组件调整的 44 项定向补验通过。最终包内 24 组中文浅深色 × 375/768/1024/1440 布局、键盘展开、连续链接选择及保存重开通过，无页面横向溢出和页面错误。保存前后报价、ERP 成本及利润记录一致，审计正常。隐藏桌面 smoke 通过，可见窗口为 0；680 个安装文件 / 634 个生产输入逐字节一致。

验收源码 `0049369fab7be97998bdc088c26637556658b853`，安装包 119556746 字节，SHA256 `8DBFD010AEF76F1D05B8EE09E43EF9F79820E9E19580D69C80518BCAFE658608`。候选 `releases/candidates/0.4.28/`，原始证据 `archive/catalog-evidence-20261015/`。

[PR #221](https://github.com/love70805/lworkstation/pull/221) 已合并，PR 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/38683511126) 两项均通过。软件标签 v0.4.28 固定于 `73c6876087daeca23eaf9a96f5571e6cff8d0f10`，合并后的生产树与验收候选一致。2026-10-15T04:56:06Z 已公开为稳定 Latest（非草稿、非预发布）。公开页面、实际稳定更新入口及四资产匿名完整回读，字节数、SHA256/GitHub digest 与 EXE SHA512 一致；0.4.27 识别 0.4.28，同版和跨通道保护通过。

本机未安装，无数据库迁移；真实数据库、业务文件、ERP/1688 队列及凭据未改写。人工有效值优先和月度定稿保护保持。本批使用隔离合成数据；原生 ERP、可见窗口、托盘与焦点逻辑未改，隐藏验证不替代真实账号或可见交互验收。

| 公开资产 | 字节数 | SHA256 |
| --- | --- | --- |
| Lworkstation-Setup-0.4.28.exe | 119556746 | `8DBFD010AEF76F1D05B8EE09E43EF9F79820E9E19580D69C80518BCAFE658608` |
| Lworkstation-Setup-0.4.28.exe.blockmap | 125806 | `CC811B8EA13CFEB20487FC4DAFF782FB07CE936101186C6162001A2C7386F8D1` |
| latest.yml | 356 | `B17DF6B15229890B9E52E12C39AD24454B91F85387DA3A34CCFB925C98101181` |
| SHA256.txt | 278 | `6828756B02BB97D1F941CB30CD278F10E29B4015F1414D096258E49C3D58F998` |
