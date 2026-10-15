# 0.4.27 ERP 采购核价与自动采用（已公开稳定 Latest）

成本详情可直接逐笔核价或确认本 SKU 的多笔真实采购价；确认持久保存，异常全部解决后自动复算并采用合格 ERP 成本，恢复此前已确认草稿。助手 8.0.42 补齐历史价格偏离提示，明确仓库/平台/店铺 SKU 与采购记录计数范围，提供版本展示、键盘证据入口和可读采购记录。

基线：实际联网核对 origin/main `cf401a24ef0c9b1b596e6ac415334f063a145b9a` / 0.4.26；[契约与验收](integration/ERP_PRICE_CONFIRMATION_0.4.27.md)。

193 文件 / 1535 项前端测试、生产 build 和完整发布门禁通过；最后调整的 116 项定向补验、17 组 desktop verify 及原生 ERP 启动/刷新/采集/断线重连通过。40 组中文浅深色 × 375/768/1024/1440 布局通过，逐笔确认后刷新续接、自动采用、待处理数量更新和另一批草稿保留通过。最终隐藏桌面 smoke 通过，可见窗口为 0。680 个安装文件 / 634 个生产输入逐字节一致。

验收源码 `dfa65a3904724133c1f06650efc78d0a6f120f81`，安装包 119554805 字节，SHA256 `AB3B1D1F1E27376334EB3A7156B0B1C143EF8EB4E772FE0B36F689CE7B2E637B`。候选 `releases/candidates/0.4.27/`，原始证据 `archive/erp-cost-review-20261015/`。

[PR #219](https://github.com/love70805/lworkstation/pull/219) 已合并，PR 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/38680063153) 两项均通过。软件标签 v0.4.27 固定于 `a3915f57146ca4e95f20b8869a35f9fd60a0dcb4`，合并后的生产树与验收候选一致。2026-10-15T04:16:11Z 已公开为稳定 Latest（非草稿、非预发布）。公开页面、实际稳定更新入口和四资产匿名完整回读，字节数、SHA256/GitHub digest 与 EXE SHA512 均一致；0.4.26 识别 0.4.27，同版及跨通道保护通过。

本机未安装，无表结构迁移，真实数据库、业务文件、ERP/1688 队列及凭据未改写。人工有效值优先、真实零值和微小人工成本、来源顺序及月度定稿保护保持。全部使用隔离合成数据；隐藏窗口和模拟 ERP HTTP 响应不替代真实账号、可见窗口、托盘或焦点验收。

| 公开资产 | 字节数 | SHA256 |
| --- | --- | --- |
| Lworkstation-Setup-0.4.27.exe | 119554805 | `AB3B1D1F1E27376334EB3A7156B0B1C143EF8EB4E772FE0B36F689CE7B2E637B` |
| Lworkstation-Setup-0.4.27.exe.blockmap | 125966 | `7A7635CF6C05F01D2DCA261EFB4DDC0FDC6AA979E3F5E7C0F95EA14BDCA9BB0E` |
| latest.yml | 356 | `D90CC55FB00532D698BF9A6F2AB59FAD32827EF84320D099BF02F5ABC38D2C1B` |
| SHA256.txt | 278 | `E24CD4103C81CAEAAD61318BD2140CAF9EE3905CD0F96BB55B1364F1719E5AF8` |
