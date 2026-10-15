## 0.4.29 属性顺序与多供应商保留（已公开稳定 Latest）

描述属性与短代码仅前后调换时按相同属性处理，保留原文，无须人工确认；实际内容变化仍保留差异证据。供应商及商品页、店铺页链接并列保留并直接打开，取消唯一来源选择；补齐新资料合并、同名供应商身份区分和全部 SKU/采购单关联的保存恢复。

194 文件 / 1554 项前端测试、生产 build、完整发布门禁、17 组 desktop verify 通过，97 项定向测试覆盖顺序等价、真实变化、同名供应商、保存重开、备份恢复、延迟回传及人工报价保护。归档原始属性只读复核通过，实际数据库未改写。最终包内 24 组中文浅深色 × 375/768/1024/1440 布局通过，无页面溢出或错误；两供应商五链接在不选唯一常用链接时保存重开，SKU 关联、报价、ERP 成本及利润记录一致。隐藏桌面 smoke 通过，可见窗口为 0；680 个安装文件 / 634 个生产输入逐字节一致。

[PR #223](https://github.com/love70805/lworkstation/pull/223) 已合并，PR 与[软件主线 CI](https://github.com/love70805/lworkstation/actions/runs/38690095992) 两项均通过。软件标签 v0.4.29 固定于 `fe4167d021c0fe7c55e89663da52bc2e7e0ee5b5`，合并后的生产树与验收候选一致。2026-10-15T06:08:56Z 已公开为稳定 Latest（非草稿、非预发布）。公开页面、实际稳定更新入口及四资产匿名完整回读，字节数、SHA256/GitHub digest 与 EXE SHA512 一致；0.4.28 识别 0.4.29，同版及跨通道保护通过。

本机未安装，无表结构迁移；真实数据库、业务文件、ERP/1688 队列及凭据未改写。人工有效值优先与月度定稿保护保持。页面和保存验证使用隔离合成数据；原生 ERP、可见窗口、托盘及焦点逻辑未改，隐藏验证不替代真实账号或可见交互验收。

验收源码 `40428e5791e2ba736f1b5ce151226c5ec0f85903`，安装包 119557018 字节，SHA256 `3D01A3D4FBFD12B87FE6B2D5AA8C6152A318EC608974978C6138A3CE305AC9A9`。候选 `releases/candidates/0.4.29/`，原始证据 `archive/catalog-order-20261015/`。见 [发布记录](../docs/RELEASE_0.4.29.md)。

## 0.4.28 ERP 档案来源核对（历史公开稳定版）

商品编辑器按 SKU 合并相同 ERP 回传，保留不同资料与全部来源；采购按供应商、仓库、SKU 和规格归组，订单按需展开。供应商卡片可预览并选择商品/店铺链接，保存重开后保留；属性确认与保存状态明确，不再重复警告。

194 文件 / 1541 项前端测试、生产 build、完整发布门禁、17 组 desktop verify 通过；最终组件调整的 44 项定向补验通过。最终包内 24 组中文浅深色 × 375/768/1024/1440 布局、键盘展开、连续链接选择及保存重开通过，无页面横向溢出和页面错误。保存前后报价、ERP 成本及利润记录一致，审计正常。隐藏桌面 smoke 通过，可见窗口为 0；680 个安装文件 / 634 个生产输入逐字节一致。

[PR #221](https://github.com/love70805/lworkstation/pull/221) 已合并，PR 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/38683511126) 两项均通过。软件标签 v0.4.28 固定于 `73c6876087daeca23eaf9a96f5571e6cff8d0f10`，合并后的生产树与验收候选一致。2026-10-15T04:56:06Z 已公开为稳定 Latest（非草稿、非预发布）。公开页面、实际稳定更新入口及四资产匿名完整回读，字节数、SHA256/GitHub digest 与 EXE SHA512 一致；0.4.27 识别 0.4.28，同版和跨通道保护通过。

本机未安装，无数据库迁移；真实数据库、业务文件、ERP/1688 队列及凭据未改写。人工有效值优先和月度定稿保护保持。本批使用隔离合成数据；原生 ERP、可见窗口、托盘与焦点逻辑未改，隐藏验证不替代真实账号或可见交互验收。

验收源码 `0049369fab7be97998bdc088c26637556658b853`，安装包 119556746 字节，SHA256 `8DBFD010AEF76F1D05B8EE09E43EF9F79820E9E19580D69C80518BCAFE658608`。候选 `releases/candidates/0.4.28/`，原始证据 `archive/catalog-evidence-20261015/`。见 [发布记录](../docs/RELEASE_0.4.28.md)。

## 0.4.27 ERP 采购核价与自动采用（历史公开稳定版）

成本详情可直接逐笔核价或确认本 SKU 的多笔真实采购价；确认持久保存，异常全部解决后自动复算并采用合格 ERP 成本，恢复此前已确认草稿。助手 8.0.42 补齐历史价格偏离提示，明确仓库/平台/店铺 SKU 与采购记录计数范围，提供版本展示、键盘证据入口和可读采购记录。

193 文件 / 1535 项前端测试、生产 build 和完整发布门禁通过；最后调整的 116 项定向补验、17 组 desktop verify 及原生 ERP 启动/刷新/采集/断线重连通过。40 组中文浅深色 × 375/768/1024/1440 布局通过，逐笔确认后刷新续接、自动采用、待处理数量更新和另一批草稿保留通过。最终隐藏桌面 smoke 通过，可见窗口为 0。680 个安装文件 / 634 个生产输入逐字节一致。

[PR #219](https://github.com/love70805/lworkstation/pull/219) 已合并，PR 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/38680063153) 两项均通过。软件标签 v0.4.27 固定于 `a3915f57146ca4e95f20b8869a35f9fd60a0dcb4`，合并后的生产树与验收候选一致。2026-10-15T04:16:11Z 已公开为稳定 Latest（非草稿、非预发布）。公开页面、实际稳定更新入口和四资产匿名完整回读，字节数、SHA256/GitHub digest 与 EXE SHA512 均一致；0.4.26 识别 0.4.27，同版及跨通道保护通过。

本机未安装，无表结构迁移，真实数据库、业务文件、ERP/1688 队列及凭据未改写。人工有效值优先、真实零值和微小人工成本、来源顺序及月度定稿保护保持。全部使用隔离合成数据；隐藏窗口和模拟 ERP HTTP 响应不替代真实账号、可见窗口、托盘或焦点验收。

验收源码 `dfa65a3904724133c1f06650efc78d0a6f120f81`，安装包 119554805 字节，SHA256 `AB3B1D1F1E27376334EB3A7156B0B1C143EF8EB4E772FE0B36F689CE7B2E637B`。候选 `releases/candidates/0.4.27/`，原始证据 `archive/erp-cost-review-20261015/`。见 [发布记录](../docs/RELEASE_0.4.27.md)。

## 0.4.26 工作台精简与 1688 扩展退役（历史公开稳定版）

候选已验收：192 文件 / 1513 前端测试、生产 build 和完整发布门禁、17 组 desktop verify 及原生 ERP 采集/刷新/重连通过；PR 与软件主线 CI 两项均成功。最终候选 88 组中文浅深色 × 375/768/1024/1440 布局无页面横向溢出，核心筛选、编辑返回、历史资料、人工零值/微小成本、零代发、定稿保护和月报下载通过。隐藏桌面 smoke 与真实候选的历史收件恢复/回执通过，可见窗口为 0；旧写入和标签拒绝。667 安装文件 / 621 生产输入逐字节一致，候选不包含 1688 扩展资源。

验收源码 `dd208ba3c599dccb53c71288d783e9e46e61d91e`，安装包 119388721 字节，SHA256 `6875C7A328F1A6112D8BCCA89570ECB57ACB45B364805FDE8E140EDB9C97005D`。本机候选 `releases/candidates/0.4.26/`；唯一证据保留在 `archive/workspace-simplify-20261015/`。

代码已合并：[PR #217](https://github.com/love70805/lworkstation/pull/217)，[主线 CI](https://github.com/love70805/lworkstation/actions/runs/38627502927) 通过。公开发布：[PR #217](https://github.com/love70805/lworkstation/pull/217) 已合并，[主线 CI](https://github.com/love70805/lworkstation/actions/runs/38627502927) 通过。软件标签 v0.4.26 固定于 `dc7feb7388b05f24dcdc3839cd20d2413c1c35eb`，主线生产代码与验收候选一致。2026-10-14T20:04:26Z 公开为稳定 Latest（非草稿/非预发布）。公开页面、实际更新入口与四资产匿名完整回读，字节数、SHA256/GitHub digest 及 EXE SHA512 均一致；0.4.25 识别 0.4.26，同版与跨通道保护通过。

本机未安装，无数据库迁移，真实数据库、业务文件、ERP/1688 历史队列和凭据未改写。商品、供应商来源链接、参考成本、ERP 采购证据和冻结报告保留。全部使用隔离合成数据；隐藏窗口结果不替代真实账号、可见窗口/托盘/焦点验收。旧缓存和扩展存储不加载也不删除，不操作外部浏览器配置。 见 [发布记录](../docs/RELEASE_0.4.26.md)。

## 0.4.25 界面、布局与操作体验（历史公开稳定版）

最终 PR 与主线 CI 均为 192 文件 / 1512 项前端测试、生产构建及完整发布门禁通过；本地完整门禁、最后补改的 30 项窄回归和报告定位专项、17 组 desktop verify 通过。最终 Windows 隐藏 smoke 通过（可见窗口为 0）；包内 64 组中文浅深色 × 375/768/1024/1440 布局无页面横向溢出，主题实际不同，选中/成功/警告文字组合对比度最低 4.53:1，无页面错误。折叠筛选、逐项移除、列视图/分页编辑返回、键盘滚动与跨页签报告定位通过；16 条店铺 SKU 人工成本含零和微小值、零代发、报告定稿下载及定稿后只读通过。706 安装文件 / 660 生产输入逐字节一致。

[PR #215](https://github.com/love70805/lworkstation/pull/215) 已合并，PR 与 [主线 CI](https://github.com/love70805/lworkstation/actions/runs/38613291330) 通过。稳定标签 v0.4.25 固定于 `6b0a1d65fd3a200fb6166dd74a2799a6f7e152ff`，合并后的生产代码树与验收候选一致。2026-10-14T18:23:54Z 已公开非草稿、非预发布的稳定 Latest。公开页面、实际更新入口和四资产均匿名 HTTPS 回读；完整字节数、SHA256/GitHub digest 与 EXE SHA512 一致。从 0.4.24 识别 0.4.25，同版与跨通道保护通过。

构建源码 `fcf90f45d7ec2805629e77398f51357f2168bd38`，安装包 119580897 字节，SHA256 `A2BA4945AC8B87566D82F99C74B2057B148C1288763181C68EEC3D2327DE7627`。候选在 `releases/candidates/0.4.25/`，原始证据在 `archive/ui-experience-20261015/`。 本机未安装，无业务数据库迁移，真实数据库、业务文件及 ERP/1688 队列未改写。原生窗口、托盘与 ERP 扩展逻辑未改；隐藏 smoke 不计作真实可见窗口、托盘或焦点交互验收。页内验证使用包内生产资源与隔离合成数据。 见 [发布记录](../docs/RELEASE_0.4.25.md)。

## 0.4.24 正式使用可靠性优化（历史公开稳定版）

192 文件 / 1510 项前端测试、完整发布门禁及生产构建、17 组 desktop verify、最终隐藏 Windows 候选均通过。包内 CSV 导入、返回/刷新保护、人工零值/微小值、零代发、报告定稿下载、读取故障重试和真实文件备份恢复通过，恢复前后销售明细及定稿报告一致。30 组中文浅深色 × 1280/900/390 布局无横向溢出，新增持续提示正文对比度最低 14.84:1，无页面错误。704 安装文件 / 658 生产输入逐字节一致。

[PR #213](https://github.com/love70805/lworkstation/pull/213) 已合并，PR 与 [主线 CI](https://github.com/love70805/lworkstation/actions/runs/38551042635) 通过。稳定标签 v0.4.24 固定于 `812f5ed0747247eb1babcd40ff3cb919f3574cc1`，合并后的生产代码树与验收候选一致。2026-10-14T10:49:29Z 已公开非草稿、非预发布的稳定 Latest。公开页面、四个资产均匿名完整下载回读；字节数、SHA256/GitHub digest 与 EXE SHA512 一致。实际稳定更新入口从 0.4.23 识别 0.4.24，同版与跨通道保护通过。

候选 `candidates/0.4.24/`，原始证据 `archive/formal-readiness/`。构建源码 `0fa23cabcb5c87643b8c85bff338b38e2691984c`，安装包 119578311 字节，SHA256 `7D6BAA3A1EC5B6232B962F3F902BF7F6938B8E7B11466D7733DE600DA0AAD138`。无数据库迁移，本机未安装，真实数据和队列未改写，见 [发布记录](../docs/RELEASE_0.4.24.md)。

## 0.4.23 常用货号组与筛选流程（历史公开稳定版）

候选 `candidates/0.4.23/`，证据 `archive/practical-supplier-flow/`。最终 PR/主线 CI：189 文件 / 1494 项前端测试通过。本机完整发布门禁、生产构建、17 组 desktop verify 通过；新增空关键词边界后，受影响的 49 项导入/常用组/共享范围补验通过。最终隐藏 Windows 候选及包内资源实际 CSV 导入、逐店例外、组管理、成功使用偏好、成员失败重试与共享范围路径通过；18 组中文浅深色 × 1280/900/390 布局通过，调色板实际不同，无页面错误。704 安装文件 / 658 生产输入逐字节一致，源码 `259bab6527ac76877ea5c06cc28a263d4fe73b71`，安装包 119577149 字节，SHA256 `1F4B00398227CC24D25F8E9E8CCFBEA3C3A1EE368B2D98F960989E3E37B1F61C`。

[PR #211](https://github.com/love70805/lworkstation/pull/211) 已合并，PR 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/38528373106) 通过。稳定标签 v0.4.23 固定 `e0a81e07b609c270f21dff096aa9eaf71298a06c`，合并后的生产代码树与验收候选一致。2026-10-14T07:38:16Z 已公开非草稿、非预发布的稳定 Latest。四资产匿名完整下载回读，字节数、SHA256/GitHub digest 与 EXE SHA512 均一致；实际稳定更新入口从 0.4.22 识别 0.4.23，同版与跨通道保护通过。 匿名 REST 元数据限流，发行元数据通过现有 GitHub CLI 只读核验；公开页面、更新入口和所有下载均为匿名验证。 无数据库迁移，本机未安装，真实数据与队列未改写。正式成本、人工优先及定稿保护保持，Beta 与账号云端不推进。页内路径使用最终包内资源和隔离合成数据；隐藏 smoke 不作为真实可见窗口、托盘或焦点验收，原生窗口及 ERP 扩展逻辑未改。 候选原件与证据已保留在原项目；见 [发布记录](../docs/RELEASE_0.4.23.md)。

## 0.4.22 商品资料与主流程实用性（历史公开稳定版）

候选 `candidates/0.4.22/`；证据 `archive/catalog-usability/`。186 文件 / 1483 前端测试、生产构建、完整 ERP/同步/部署门禁、17 组 desktop verify 通过。最终包内资源隔离验证五种仅顺序不同的属性自动建档、真实差异显式选择及保存返回、参考利润与定稿历史分离、筛选及实际 Excel 导出、当前账本下一步。18 组中文浅深色 × 1280/900/390 布局无溢出；最终隐藏候选 smoke 通过。704 个安装文件 / 658 个生产输入逐字节一致，构建源码 `c2cb9ad62575f806ecc4e8fe810d9543d2fa0495`，安装包 119576230 字节，SHA256 `1E1E3155F1D1F8D935D15F7F34077D9062FC4C16016296392A208755641FDBC6`。

[PR #207](https://github.com/love70805/lworkstation/pull/207) 已合并，PR 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/38456495528) 通过。稳定标签 v0.4.22 固定 `a1c05a8bbed29c609543317f9446e34ff4230d48`，合并后的生产代码树与验收候选一致。2026-10-13T19:58:13Z 已公开非草稿、非预发布的稳定 Latest；四资产匿名完整回读，字节数、SHA256/GitHub digest 与 EXE SHA512 均一致。实际稳定更新入口从 0.4.21 识别 0.4.22，同版与跨通道保护通过。 原生 ERP 资源与桌面运行逻辑未改。页面路径使用最终包内资源的隔离浏览器验收；隐藏 smoke 不记作可见窗口、托盘或焦点交互验收。无业务数据库迁移，本机未安装，真实数据库与队列未改写。账号云端方案暂停并取消，既有 Beta 不进入本批。 见[发布记录](../docs/RELEASE_0.4.22.md)。本机候选已保存至原项目 `releases/candidates/0.4.22/`，原始证据与公开回读副本留在 `archive/catalog-usability/`。

## 0.4.21 ERP 回传总览与待处理 SKU（历史公开稳定版）

候选 `candidates/0.4.21/`；证据 `archive/erp-sku-isolation/`。184 文件 / 1462 前端测试、生产构建、完整 ERP/同步/部署门禁、17 组 desktop verify与交叉审查通过。本机只读副本及最终包内资源验证六批/七条异常（五个一元采购、两个历史降价）、总览/批次/SKU详情往返、人工零值/撤销与定稿只读。18 组中文浅深色 × 1280/900/390 布局、隐藏候选 smoke通过；704 个安装文件 / 658 个生产输入逐字节一致，构建源码 `640877e2d99bb9de7dbb19daffcd39eee36b0733`，安装包 119574225 字节，SHA256 `B5844100B14831BA2DD3DBA03AE7A0BE2F0AB5B5138958AA919C45524691488F`。原生资源未改；隐藏验收不记作可见窗口/焦点验收。

[PR #205](https://github.com/love70805/lworkstation/pull/205) 已合并，PR 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/38438179724) 通过。稳定标签 v0.4.21 固定 `c385e9ba07a205ac4d8d98b471e6e30a5c3d63f0`，生产输入与验收候选逐字节相同。2026-10-13T17:27:57Z 已公开非草稿、非预发布的稳定 Latest；四资产匿名完整回读，字节数、SHA256/GitHub digest 与 EXE SHA512 一致。实际稳定更新入口从 0.4.20 识别 0.4.21，同版与跨通道保护通过。本机未安装，真实数据库/队列未改写。 见[发布记录](../docs/RELEASE_0.4.21.md)。

## 0.4.20 货号筛选工作台（历史公开稳定版）

候选 `candidates/0.4.20/`，证据 `archive/supplier-filter-workbench/`。182 文件 / 1440 项前端测试、生产构建、完整 ERP/同步门禁、17 组 desktop verify、最终隐藏候选 smoke、包内用户路径与 16 组中文浅深色窗口布局通过。704 个安装文件与 658 个生产输入逐字节一致；源码 `be6d02fdfe53576b4229428e3af86f2c105ee6b4`，安装包 119568904 字节，SHA256 `1425DF0267ED650DFBDC0416D3E59626915B8B69CFFE4457E77273769D73212E`。

[PR #202](https://github.com/love70805/lworkstation/pull/202)、[收尾 PR #203](https://github.com/love70805/lworkstation/pull/203) 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/38360472063)通过。稳定标签 v0.4.20 固定 `2bc007f76e307b8290bb57694d3e00e00b1b27d1`，与验收候选代码树一致。2026-10-13T07:16:49Z 已公开非草稿、非预发布的稳定 Latest。公开页面、四附件和实际稳定更新入口匿名完整回读通过，字节数、SHA256/GitHub digest 与 EXE SHA512 均一致；发布元数据通过已连接 GitHub 只读核验，匿名 REST 当时限流。同版与跨通道保护通过，本机不安装、真实数据/队列不改写。 见 [0.4.20](../docs/RELEASE_0.4.20.md)。

## 0.4.19 核算与备份可靠性修复（历史公开稳定版）

候选 candidates/0.4.19/，证据 archive/reliability-fixes/。181 文件 / 1428 前端测试、生产构建、完整 ERP/同步门禁、17 组 desktop verify、交叉审查、包内用户路径和 18 组中文浅深色布局、隐藏 smoke 与原生 ERP 扩展通过。五项修复覆盖 SKU/SKC 归属冲突、恢复与后台写入交错、损坏备份、货号组备份和跨月份待办。701 文件 / 655 生产输入逐字节相同；构建源码 `32e4bfb`，119559514 字节，SHA256 `21DAEB5A5FD9EE9C49493DD4266EDDC7F72DA8C7B0188CCBC52673E861043849`。[PR #198](https://github.com/love70805/lworkstation/pull/198) 已合并，PR 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/38201219483) 通过。稳定标签 v0.4.19 固定 `bbc6f7c2055fd22cf02d4846ab0a1a86be057226`，生产输入与验收候选逐字节相同。2026-10-12T03:54:35Z 已公开非草稿、非预发布的稳定 Latest；四公开资产匿名完整流式回读，字节数、SHA256 与 GitHub digest 一致，EXE SHA512 与 latest.yml 一致。生产更新入口从 0.4.18 识别 0.4.19，同版与跨通道保护通过。本机未安装，真实数据库与队列未改写。本机不安装，不改写真实数据库或队列，见 [0.4.19](../docs/RELEASE_0.4.19.md)。

## 0.4.18 货号组与 ERP 异常原因（历史公开稳定版）

候选 candidates/0.4.18/，证据 archive/supplier-groups-erp-feedback/。1383 前端测试、完整 ERP/同步门禁、desktop verify 和无头生产用户路径通过。货号组支持 LBYY/LBY 明确别名、三种匹配、成功后记忆逐店例外与未选核对；ERP Assistant 8.0.41 显示原因、证据与需核对筛选，成本列固定在右侧。全自动采集仅保留为 Beta 目标；[PR #195](https://github.com/love70805/lworkstation/pull/195) 和测试等待修复 [PR #196](https://github.com/love70805/lworkstation/pull/196) 已合并，PR 与[最终主线 CI](https://github.com/love70805/lworkstation/actions/runs/37978451288) 通过，稳定标签 v0.4.18 固定 `31a537370c7fcc93cdbf9e109d90475058d77e28`，生产输入与验收候选逐字节相同。2026-10-09T19:17:52Z 已公开非草稿、非预发布的稳定 Latest；四公开资产匿名完整流式回读，字节数、SHA256 与 GitHub digest 一致，EXE SHA512 与 latest.yml 一致。生产更新入口从 0.4.17 识别 0.4.18，同版与跨通道保护通过。本机未安装，真实数据库与队列未改写。 安装包 119555539 字节，SHA256 B299D51ED58C76A1B118FE60C4D876BFFAE9169AB98FEC56C1135AD16D8E4591；701 文件 / 655 输入一致性通过。本机不安装、不改写真实库，见 [0.4.18](../docs/RELEASE_0.4.18.md)。

## 0.4.17 缺成本直接更正（已公开稳定 Latest）

候选 candidates/0.4.17/，证据 archive/cost-correction-shortcuts/。1374 测试、完整门禁、desktop verify、实际连续更正/七条审计/重开/撤销/范围隔离、12 组中文浅深色窗口、隐藏 smoke 与 688 安装文件 / 642 生产输入一致性通过。构建源码 00b2998，安装包 119391236 字节，SHA256 6C1BEEFDE4D95B6656D440DE4CF3EA95D6B29A19A48750C8CB497E7C66D57C42。[PR #192](https://github.com/love70805/lworkstation/pull/192) 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/37919903134) 通过，稳定标签 v0.4.17 固定 `f959468cd4b5f02110cd54e9842eb2f28db5aa2c`，生产输入与验收候选逐字节相同。2026-10-09T10:53:12Z 已公开非草稿、非预发布的稳定 Latest；四公开资产匿名完整流式回读，字节数、SHA256 与 GitHub digest 均一致，安装包 SHA512 与 latest.yml 一致。生产更新入口从 0.4.16 识别 0.4.17，同版与跨通道保护通过。本机未自动安装，真实数据库与队列未改写。 见 [0.4.17](../docs/RELEASE_0.4.17.md)。不自动安装、不改写真实库。

## 0.4.16 ERP 维护恢复与整批采集反馈（已公开稳定 Latest）

候选 candidates/0.4.16/，证据 archive/erp-collection-resilience/。174 文件 / 1369 前端测试、完整门禁、desktop verify、最终候选隐藏 smoke、包内原生维护/重启/继续/失败重读、18 组浅深色窗口、688 安装文件/642 输入一致性通过。构建源码 `7e692a1`，119390491 字节，SHA256 `86B9A4FBE26627E748D91E246ECC1088B391751E322A91CE2FC82AE9F2ABFE0B`。ERP Assistant 8.0.40；[PR #189](https://github.com/love70805/lworkstation/pull/189) 与 [QA PR #190](https://github.com/love70805/lworkstation/pull/190) 已合并，PR 与 [主线 CI](https://github.com/love70805/lworkstation/actions/runs/37898370804) 通过。稳定标签 v0.4.16 固定 `a2e837f2dbee556be9eaf7690e5427c0f14c8686`，代码树与 QA PR 验收基线一致；生产输入与候选仍逐字节相同。2026-10-09T07:28:25Z 已公开非草稿、非预发布的稳定 Latest。四公开资产匿名完整流式回读，字节数、SHA256 与 GitHub digest 均一致，EXE SHA512 与 latest.yml 一致；生产更新入口从 0.4.15 识别 0.4.16，同版与跨通道保护通过。未向用户客户端下载或安装软件。本机不安装、真实库/队列不改写，见 [记录](../docs/RELEASE_0.4.16.md)。

## 0.4.15 启动后空闲内存增长修复（历史公开稳定版）

候选 candidates/0.4.15/，证据 archive/startup-memory-growth/。174 文件 / 1367 前端测试、完整门禁、desktop verify、候选隐藏 smoke/包内原生扩展后台与重连、三页浅深色窗口和 675 安装文件/629 生产输入一致性通过。真实数据只读副本候选约 189 秒，完整进程树含收件服务空闲 530.6–541.2 MiB；业务计数、采用状态、证据大小和来源版本未变，七条价格异常保留，未强制 GC。源码 `3529163`，119231627 字节，SHA256 `91CC59733F9604D3F70FEE525D556205BCAC13371E5C40DB95144EB398E2284E`。[PR #187](https://github.com/love70805/lworkstation/pull/187) 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/37882974226) 通过，标签固定 `7f61c85`，四公开资产完整回读及更新入口通过，2026-10-09 12:20:22 已公开稳定 Latest。本机未安装、真实库/队列未改写，见 [记录](../docs/RELEASE_0.4.15.md)。

## 0.4.14 已送达 ERP 成本接收修复（历史公开稳定版）

候选 candidates/0.4.14/，证据 archive/erp-cost-adoption/。174 文件 / 1364 前端测试、完整门禁、desktop verify、生产默认轮询/正常采用/价格异常/错误恢复/跨页及浅深色窄屏、最终候选隐藏 smoke/原生扩展后台与重连、675 安装文件 / 629 生产输入一致性通过。历史六批原始回传隔离重放全部接收，367 自动采用、7 价格异常，未确认真实队列。源码 `0066558`，安装包 119231343 字节，SHA256 `F3169B6215052E79687488D35298F5E4EBAA478A675681C293BFC22700937022`。[PR #185](https://github.com/love70805/lworkstation/pull/185) 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/37878655429) 通过，标签固定 `5eaae4c`，四公开资产完整哈希及更新入口通过，2026-10-09 11:24:54 已公开稳定 Latest。本机未安装、真实数据未改写，ERP Assistant 8.0.39，见 [记录](../docs/RELEASE_0.4.14.md)。

## 0.4.13 ERP 后台提示、并发与采集界面（历史公开稳定版）

候选 candidates/0.4.13/，证据 archive/erp-background-status/。1359 前端测试、完整门禁、desktop verify、实际 2/5 目标并发/截止/取消、生产跨页面状态与中文浅深色窄屏、最终候选隐藏 smoke/原生扩展后台与重连、675 文件/629 输入一致性通过。构建源码 d707782，最终验证 d120825 只调整测试时钟；安装包 119231074 字节，SHA256 `5D8DEEB3C77D6D78D19E3AD9D46BF095755B8618570C7C99A636C12FC556C6A3`。[PR #183](https://github.com/love70805/lworkstation/pull/183) 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/37872439021) 通过，稳定标签固定 617aa88，四公开资产匿名完整哈希及生产更新入口通过，2026-10-09 10:05:54 已公开稳定 Latest。本机未安装、真实数据未改写；ERP Assistant 8.0.39，见 [发布记录](../docs/RELEASE_0.4.13.md)。

## 0.4.12 启动与空闲内存优化（历史公开稳定版）

候选 candidates/0.4.12/，证据 archive/memory-performance/。1346 前端测试、完整门禁、desktop verify、实际候选冷启动/草稿/配置/错误重试/隐藏 smoke、候选原生扩展后台采集/重连、662 文件/616 输入一致性通过。相同隔离环境启动私有内存中位数 527.8 → 354.1 MiB（降低 32.9%），空闲 491.1 → 340.0 MiB（降低 30.8%），渲染进程 6 → 2。构建源码 1f5ccfe，安装包 119075144 字节，SHA256 `EC26199013C23F7307EEBD17BE34FFDAE44DE9E8C04FC6BCA15D0F73C2D8B83A`。[PR #181](https://github.com/love70805/lworkstation/pull/181) 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/37764299207) 通过，稳定标签固定 4d5afb4，四公开资产匿名完整哈希及生产更新入口通过，2026-10-08 18:40:06 已公开稳定 Latest。本机未安装、真实数据未改写；见 [发布记录](../docs/RELEASE_0.4.12.md)。

## 0.4.11 平台 SKC/SKU 精确范围（历史公开稳定版）

候选 candidates/0.4.11/，证据 archive/erp-exact-scope/。1346 测试、完整门禁、最终候选精确范围/原生扩展/无头用户路径/隐藏 smoke、662 文件/615 输入一致性通过。源码 6685d23，安装包 119073307 字节，SHA256 `A3001BCB8E218A1277B0B5FC4463E8E6748D2913C54892C171659332F56BDA4C`。[PR #179](https://github.com/love70805/lworkstation/pull/179) 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/37756944645) 通过，标签固定 cea783c，四公开资产匿名完整哈希与生产更新入口通过，2026-10-08 17:35:09 已公开稳定 Latest。本机未安装；见 [发布记录](../docs/RELEASE_0.4.11.md)。

## 0.4.10 ERP 真实进度与批次原因（已公开稳定 Latest）

候选 `candidates/0.4.10/`，证据 `archive/erp-progress/`。1342 前端测试、完整 ERP 与桌面门禁、实际响应与并发进度、开发/候选扩展用户路径、浅深色窄屏、隐藏 smoke、649 安装文件/602 生产输入一致性通过。构建源码 e46094e；安装包 118924372 字节，SHA256 `5D3FCF3989077C7DEB868876D1E3E7380834911135B192284EDFC33986C555AF`。[PR #177](https://github.com/love70805/lworkstation/pull/177) 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/37739497593) 通过，标签固定 5931979，四公开资产匿名完整哈希及生产更新入口通过，2026-10-08 14:51 已公开稳定 Latest。本机未安装、真实业务库未改写，见 [发布记录](../docs/RELEASE_0.4.10.md)。

## 0.4.9 清空本机核算历史（已公开）

候选 `candidates/0.4.9/`，证据 `archive/local-reset-history/`。1340 测试、完整前端/ERP 与桌面门禁、开发/生产实际清空及重启/同月 CSV 重导入、隐藏 smoke、636 安装文件/589 生产输入一致性通过。构建源码 f1ec19c；安装包 118775892 字节，SHA256 `0EA5F2632116A2D1B9F56994DB1F394F9768EB1F4547A36E31DCB53BBBC450CE`。[PR #175](https://github.com/love70805/lworkstation/pull/175) 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/37724384103) 通过，稳定标签固定 ce5047a，四公开资产匿名完整哈希及生产更新入口通过，已公开稳定 Latest。本机未安装、真实数据未改写，见 [发布记录](../docs/RELEASE_0.4.9.md)。

## 0.4.8 自主筛选与利润引导（已公开）

候选 `candidates/0.4.8/`，证据 `archive/ledger-movement-flow/`。1333 测试、完整前端/ERP 与桌面门禁、实际隔离台账/自主筛选/成本导航、生产 UI、隐藏 smoke、636 安装文件/589 生产输入一致性通过。构建源码 373cdf0；安装包 118774638 字节，SHA256 `12BA2191E39CA19EAB813A5BA55ABC34C075EBF48D7ECCCDFDDB9D46C75D6E76`。[PR #173](https://github.com/love70805/lworkstation/pull/173) 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/37719306291) 通过，稳定标签固定 f534e9a，四公开资产匿名完整哈希及生产更新入口通过，已公开稳定 Latest。本机未安装，见 [发布记录](../docs/RELEASE_0.4.8.md)。

## 0.4.5 预存区分阶段建档（已公开）

candidates/0.4.5/ 已验收：1324 测试、构建、完整 ERP 门禁、桌面 verify、实际隔离导入/补齐/后台回传、6000 SKU 规模样本、隐藏 smoke 与 621 文件 / 574 输入一致性通过。软件源码 4bec063，稳定标签固定 764a08a；安装包 SHA256 6A76DA8E58A80289FCC864C43F8E9EB827B50E148880FD87AA494230B3DA00EE。PR #161 / 主线 CI、四公开资产匿名完整回读与生产更新入口通过，已公开稳定 Latest，见 [记录](../docs/RELEASE_0.4.5.md)。候选原件、源码标签与证据保存在本机 releases/candidates/0.4.5/、archive/release-0.4.5/；不自动安装或操作真实业务库。

> 2026-10-06 用户确认 0.3.13 修复成功。六个错误旧 GitHub Release 及附件已撤回；本机候选和历史保留，标签与提交保留。见 [清理记录](../docs/integration/ERP_RELEASE_CLEANUP_2026_10.md)。以下旧版条目为历史验收记录。

## 0.3.13 ERP 目标对象解析已公开（2026-10-06）

候选 candidates/0.3.13/ 已验收，1270 测试、构建、桌面 verify、隐藏 smoke、593 安装文件/546 输入一致性通过。见 [记录](../docs/RELEASE_0.3.13.md)，PR #146 / 主线 CI、四公开资产匿名完整回读和更新通道通过，标签固定 9bd33f9。本机不自动安装，用户已确认修复成功。

## 0.3.12 检查点字段顺序修复已公开（2026-10-06）

原件 releases/candidates/0.3.12/，证据 archive/release-0.3.12/。实际 Chromium 扩展存储复现旧错误与修复后成功，1270 测试、生产构建、desktop verify、隐藏 smoke、580 安装文件/533 生产输入一致性通过。PR #144 / 主线 CI、四公开资产匿名完整回读及实际稳定更新通道通过，v0.3.12 固定 674432d；不自动安装。SHA256：7F3FB1F6F605E64AED49A21458910DD53E0D97FE2DBE36FA236241D0436E3DBA。见 [记录](../docs/RELEASE_0.3.12.md)。

## 0.3.11 自动核算入口补修已公开（2026-10-06）

原件 releases/candidates/0.3.11/，证据 archive/release-0.3.11/。扩展定向回归、桌面 verify、构建、隐藏 smoke 和安装包逐字节一致性、PR #142必需CI、四公开资产匿名完整回读及稳定更新通道通过；v0.3.11固定952ce6c，主线push CI未触发但合并树与CI候选树一致。未本机安装。SHA256：9B52761BA5C77EF75B7F3574519052E6C1BA69424CA59532F9DFD0E966A831A5。见 [记录](../docs/RELEASE_0.3.11.md)。

## 0.3.10 ERP 检查点恢复已公开（2026-10-06）

原件：releases/candidates/0.3.10/，证据：archive/release-0.3.10/。1270 测试、构建、桌面 verify、隐藏 smoke 和包内一致性通过；PR #140/main CI、四公开资产匿名全量回读及稳定更新通道通过，v0.3.10 固定 68cf49d；未本机安装。安装包 SHA256：C1D8C4336E3C7F8E904A64CFE6344E7C899E35F904C90CA4903F5555F571D0D3。见 [发布记录](../docs/RELEASE_0.3.10.md)。

# Lworkstation 发布文件


- `candidates/<版本与用途>/`：仅供本机验收的候选包与校验清单，不接入公开更新源。
- `prerelease/<版本号>/`：经检查并整理的 Beta 产物，使用 `Lworkstation-Setup-<版本>.exe` 与 `beta.yml`。
- `latest/`：当前稳定版产物，使用 `Lworkstation Setup <版本>.exe` 与 `latest.yml`。
- `history/<版本号>/`：历史稳定版产物，用于回退和核对。
- 仓库根目录下的 `desktop/release/`、`desktop/release-test/`：临时构建产物与更新测试夹具，不作为已发布状态依据。

当前公开稳定版为 [0.4.21](https://github.com/love70805/lworkstation/releases/tag/v0.4.21)，Beta 为 [0.3.0-beta.10](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.10)。以下旧版本条目仅作历史记录。

## v0.4.4 已公开稳定 Latest（2026-10-07）

整批后缀选择、前置导入按钮与折叠明细、原子基础建档与参考列表默认隐藏已建档分支。候选 candidates/0.4.4/，证据 archive/release-0.4.4/。1310 测试、构建、桌面 verify、开发/生产实际隔离 CSV、6000 SKU 规模样本与窄屏浅深色、隐藏 packaged smoke、621 文件 / 574 生产输入一致性通过。安装包 118622928 字节，SHA256 9BBFC177952D47BA8C60412A8E9DD628A25D2D2ADE77BABF92091C05E4E86CF4。PR #159/main CI、四公开资产及生产更新入口匿名完整回读通过，标签固定 f2a53c9；未自动安装、未改真实数据。见 [记录](../docs/RELEASE_0.4.4.md)。

## v0.4.3 已公开稳定 Latest（2026-10-07）

分批 ERP 采集、重启后显式恢复与导入关键词选货号。候选 `candidates/0.4.3/`，证据 `archive/release-0.4.3/`。1298 测试、隐藏候选、621 文件 / 574 输入、PR/main CI、四资产和更新入口回读通过。安装包 118620223 字节，SHA256 `85818178ED36E0B4893AAC8BEC7F6B889FB0CA6A6C075CB2C0E95C817FD19875`。未自动安装、未改写真实数据，见 [发布记录](../docs/RELEASE_0.4.3.md)。

## v0.4.2 已公开稳定 Latest（2026-10-07）

成本采集 60 分钟、资料 30 分钟、单请求 120 秒。候选 releases/candidates/0.4.2/，证据 archive/release-0.4.2/。取消及不完整证据保护保留，内置 ERP Assistant 8.0.34，旧有效任务兼容。本机不自动安装。1281 测试、候选及 PR/main CI、四资产与更新入口回读通过。安装包 118465788 字节，SHA256 `BED644AA9D5917F44E58BEEBAC47883FB7CF5F0BD2054796E546480F532A928F`。见 [发布记录](../docs/RELEASE_0.4.2.md)。

## v0.4.1 历史公开稳定版（2026-10-07）

导入前货号筛选与 SKC 图表明细。候选 `releases/candidates/0.4.1/`，证据 `archive/release-0.4.1/`；标签 `5dcb4c6`。1281 测试、完整门禁、隔离实际路径、594 文件 / 547 输入一致性、隐藏 smoke、PR/main CI、四资产匿名完整哈希及生产更新入口通过。EXE 118334266 字节，SHA256 `6E63AD0D36B9EE781E7CC0A070FE32C70C065E6FB5E0C3B89A43BBA1270445D8`。本机不自动安装。见 [发布记录](../docs/RELEASE_0.4.1.md)。

## v0.4.0 历史公开稳定版（2026-10-07）

本地运营负责范围：候选目录 `releases/candidates/0.4.0/`，证据 `archive/release-0.4.0/`。1281 测试、候选、593 文件/546 输入一致性、隐藏 smoke、PR/main CI、四公开资产匿名完整哈希及生产更新通道真实下载通过。固定 eb37f7f；本机不安装。见 [验收与发布](../docs/RELEASE_0.4.0.md)。

## 版本清单

核对日期：2026-10-03（UTC+8）。0.3.7 已公开为非预发布的 GitHub Latest，四资产匿名全量下载、真实更新通道及主仓库持久复制回读通过；更早版本原标签与资产保留，Beta 最新仍为0.3.0-beta.10。本机按用户要求暂不安装。

| 版本 | 状态 | 入口 |
| --- | --- | --- |
| `0.3.9` 采集、映射与双面板范围修正 | 候选验收通过；1270 测试、16 组桌面、五店 130842 行实际路径、隐藏 EXE、541 文件/494 输入及 PR CI 通过；EXE 80A7AF05…；集成和公开回读待执行，未安装 | `candidates/0.3.9/`；[验收](../docs/RELEASE_0.3.9.md) |
| `0.3.8` 鲜明图表与清晰图标 | 本机候选；1230 测试、16 组桌面、隐藏 EXE 通过，公开发布受构建依赖安全审计阻塞，未发布 | `candidates/0.3.8/`；[验收](../docs/RELEASE_0.3.8.md) |
| `0.3.7` 导入性能与连续建档 | 已公开稳定Latest；PR #135/main CI、1230测试、16组桌面、隐藏EXE/包内ERP、528文件/481输入及四资产匿名回读通过；EXE 6FD1FFB9…；未安装 | `candidates/0.3.7/`；[发布进度](../docs/RELEASE_0.3.7.md)；[候选边界](../docs/RELEASE_0.3.7_CANDIDATE.md) |
| `0.3.6` 完整台账、选品与销售分析 | 历史公开稳定版；PR #133/main CI、1176测试、隐藏EXE与生产UI、516安装文件/469输入、四资产匿名回读通过；EXE D009CBD7…；未安装 | `candidates/0.3.6/`；[发布与验收记录](../docs/RELEASE_0.3.6.md) |
| `0.3.5` 选品与 ERP 修复 | 历史公开稳定版；PR #131/main CI、四资产匿名全量回读及真实更新通道通过；ERP8.0.26，1141测试、16组桌面、502文件/455输入；EXE FA750D5D…；未安装、未改真实库 | `candidates/0.3.5/`（含`public/`公开原件）；`archive/release-0.3.5/publication/`；[发布记录](../docs/RELEASE_0.3.5.md) |
| `0.3.4` 采集恢复 | 历史公开稳定版，原标签与资产保留；PR #129/main CI、四资产匿名回读及更新通道通过；1108测试、16组桌面验证、真实慢路径、隐藏EXE、489文件/442输入；ERP 8.0.25，未安装 | `candidates/0.3.4/`（含`public/`匿名原件）；`archive/release-0.3.4/`；[验收与哈希](../docs/RELEASE_0.3.4.md) |
| `0.3.3` 选品建档与销量标签 | 历史公开稳定版，原标签及资产保留；PR #127/main CI、1107 测试、16 组桌面验证、隐藏 EXE smoke、476 文件/429 输入、四资产匿名回读、真实更新通道及持久复制通过；含 ERP 8.0.24，未安装 | 主仓库 `candidates/0.3.3/` 及其中 `public/`；`archive/release-0.3.3/`；[验收与哈希](../docs/RELEASE_0.3.3.md) |
| `0.3.2` 共享1688单号 | 历史公开稳定版，原标签及资产保留；PR #125/main CI、1015 测试、隐藏 EXE smoke、461 文件/414 输入哈希、四资产匿名回读和真实更新通道及持久复制通过；未安装 | 主仓库 `candidates/0.3.2/`、其中 `public/` 匿名下载原件及 `archive/release-0.3.2/`；[验收与升级操作](../docs/RELEASE_0.3.2.md) |
| `0.3.1` 导入简化 | 历史公开稳定版，原标签及资产保留；PR #122/#123及main CI通过，1004测试、低级别审计、隐藏EXE smoke、461文件/414输入比对、四资产匿名完整回读与真实更新通道通过；未安装 | 主仓库 `candidates/0.3.1/`、`candidates/0.3.1-public/`；`archive/release-0.3.1/`；[发布验收及哈希](../docs/RELEASE_0.3.1.md) |
| `0.3.0` 正式版 | 历史公开稳定版，原标签及资产保留；PR #119/#120及main CI通过，984测试、隐藏EXE smoke、包体/资源哈希和四资产匿名回读通过；未安装 | 主仓库 `releases/candidates/0.3.0-public/`；原候选 `releases/candidates/0.3.0/`；[验收及哈希](../docs/RELEASE_0.3.0.md) |
| `0.3.0-rc.2` ERP自动采用修复 | 历史验收记录；应用归档后原安装包未寻获，源码已恢复至正式候选；未公开或安装 | [验收记录](../docs/RELEASE_0.3.0_RC_2.md) |
| `0.3.0-rc.1` ERP商品档案 | 历史验收记录；应用归档后原安装包未寻获；未公开、未安装 | [验收与限制](../docs/RELEASE_0.3.0_RC_1.md) |
| `0.3.0-beta.10` saved report / color lamp | 已公开预发布；925测试、Windows候选smoke、PR #115/main CI、四资产匿名回读与通道检查通过，本机未安装 | `candidates/0.3.0-beta.10-export-status/`；[验收](../docs/RELEASE_0.3.0_BETA_10.md) |
| `0.3.0-beta.9` cost rows / identity / ERP lamp / Excel | 已公开 GitHub 预发布；920 测试、桌面 verify、packaged smoke、隔离浏览器 / Electron 通信与两类 XLSX 读回、PR #113 / main CI、四资产匿名回读及通道检查通过，本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.9)；`candidates/0.3.0-beta.9-cost-identity-status-export/`；[验收](../docs/RELEASE_0.3.0_BETA_9.md) |
| `0.3.0-beta.8` published ERP evidence | 已公开 GitHub 预发布；878 测试、桌面 verify、packaged smoke、隔离 11 条采购与旧行只读恢复、PR #111 / main CI、四资产匿名回读及通道检查通过，本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.8)；`candidates/0.3.0-beta.8-evidence-reference/`；[验收](../docs/RELEASE_0.3.0_BETA_8.md) |
| `0.3.0-beta.7` cost recovery | 已公开 GitHub 预发布；876 测试、桌面 verify、packaged smoke、隔离旧草稿 4.59 元业务路径、PR #109 / main CI、四资产匿名回读及通道检查通过，本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.7)；`candidates/0.3.0-beta.7-cost-recovery/`；[验收](../docs/RELEASE_0.3.0_BETA_7.md) |
| `0.3.0-beta.6` automatic ERP adoption | 已公开 GitHub 预发布；865 测试、桌面 verify、packaged smoke、隔离业务路径、PR #107 / main CI、四资产匿名回读及通道检查通过，本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.6)；`candidates/0.3.0-beta.6-auto-erp-profit/`；[验收](../docs/RELEASE_0.3.0_BETA_6.md) |
| `0.3.0-beta.5` workflow consistency | 已公开 GitHub 预发布；837 测试、缓存实测、Windows 候选、PR #103 / main CI、四资产回读及通道隔离通过，本机未安装 | `candidates/0.3.0-beta.5-workflow-consistency/`；[验收](../docs/RELEASE_0.3.0_BETA_5.md) |
| `0.3.0-beta.4` ledger preview | 已公开 GitHub 预发布；772 测试、实际扩展月份传递/自动回传、PR #101 / main CI、四资产回读和更新通道检查通过；本机未安装 | `candidates/0.3.0-beta.4-ledger-preview/`；[验收](../docs/RELEASE_0.3.0_BETA_4.md) |
| `0.3.0-beta.3` cost/recovery | 已公开 GitHub 预发布；755 测试、13 组桌面验证、原生恢复和最终候选交互、PR #98 / main CI、四资产回读与更新检测通过，本机未安装 | `candidates/0.3.0-beta.3-cost-recovery/`；[验收](../docs/RELEASE_0.3.0_BETA_3.md) |
| `0.3.0-beta.2` prior-month latest-three | 已公开 GitHub 预发布；751 测试、PR #94 / main CI、12 组桌面验证、b,a,b 跨月选样/人工更正交互、smoke、四资产回读和更新检测通过；临时试验规则，本机未安装 | `candidates/0.3.0-beta.2-prior-month/`；`prerelease/0.3.0-beta.2/`；[验收](../docs/RELEASE_0.3.0_BETA_2.md) |
| `0.3.0-beta.1` ledger cutoff | 已公开 GitHub 预发布；743 测试、PR #92 / main CI、12 组桌面验证、跨月成本与人工更正 Electron 交互、smoke、四资产回读及通道隔离通过；本机未安装 | `candidates/0.3.0-beta.1-ledger-cutoff/`；[验收](../docs/RELEASE_0.3.0_BETA_1.md) |
| `0.3.0-beta` human first | 历史 GitHub 预发布；719 测试、CI、12 组桌面验证、实际 Electron 交互、packaged smoke、四资产回读及通道隔离通过；本机未安装 | `candidates/0.3.0-beta-human-first/`；`prerelease/0.3.0-beta/`；[验收](../docs/RELEASE_0.3.0_BETA.md) |
| `0.2.19` sales detail | 历史稳定版；709 测试、CI、Windows packaged smoke、四资产回读/稳定通道通过；本机未安装 | `candidates/0.2.19-sales-detail/`；[验收](../docs/RELEASE_0.2.19.md) |
| `0.2.18` stacked sales | 历史稳定版 | [验收](../docs/RELEASE_0.2.18.md) |
| `0.2.17` grouped sales | 历史稳定版 | [验收](../docs/RELEASE_0.2.17.md) |
| `0.2.16` UI/cache | 已公开 GitHub Latest；681测试、CI、Windows候选、四资产回读及稳定通道通过；本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.16)；`candidates/0.2.16-ui-cache/`；[验收](../docs/RELEASE_0.2.16.md) |
| `0.2.15` profit usability | 历史稳定版；649测试、CI、Windows候选、四资产回读/稳定更新通过；本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.15)；`candidates/0.2.15-profit-usability/`；[验收](../docs/RELEASE_0.2.15.md) |
| `0.2.14` daily details | 历史稳定版；643 测试、CI、Windows 候选及四资产回读 / 更新通道通过；本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.14)；本机 `candidates/0.2.14-daily-details/`；[验收](../docs/RELEASE_0.2.14.md) |
| `0.2.13` daily sales | 历史稳定版；640测试、CI、12组浏览器布局/交互、Windows实际候选、四资产匿名回读与通道隔离通过；本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.13)；本机 `candidates/0.2.13-daily-sales/`；[更新与验收](../docs/RELEASE_0.2.13.md) |
| `0.2.12` complete local update | 历史稳定版；612测试、完整候选操作、CI、四资产回读与通道隔离通过；本机未安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.12)；本机 `candidates/0.2.12-complete-local-update/`；[验收](../docs/RELEASE_0.2.12.md) |
| `0.2.11` restore overview | 历史稳定版；582测试/CI/页面/打包/下载与四资产回读通过，本机不安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.11)；本机 candidates/0.2.11-restore-overview；[验收记录](../docs/RELEASE_0.2.11.md) |
| `0.2.10` local desktop | 历史稳定版，581测试/CI/打包运行/更新下载与四资产回读通过；本机暂不安装 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.10)；本机 `candidates/0.2.10-local-desktop/`；[验收记录](../docs/RELEASE_0.2.10.md) |
| `0.2.9` | 历史稳定版，本机当前安装版；ERP写入修复 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.9)；[验收记录](../docs/RELEASE_0.2.9.md) |
| `0.2.9` ERP inbox recovery | 候选验收、代码合并和公开资产回读已完成 | 本机 `candidates/0.2.9-erp-inbox-recovery/` |
| `0.2.8` | 历史稳定版；本机升级与重启验收通过 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.8)；[验收记录](../docs/RELEASE_0.2.8.md) |
| `0.2.8` stable acceptance | 已完成本机候选验收、代码集成和公开发布，候选与公开包相同 | 本机 `candidates/0.2.8-stable-acceptance/` |
| `0.2.7` | 历史稳定版；可通过稳定更新源发现 0.2.8 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.7) |
| `0.2.6` | 历史稳定版；原资产保留 | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.6)；该旧包更新关闭 |
| `0.2.6-beta.7` | 历史公开 Beta | [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.6-beta.7)，本机 `prerelease/0.2.6-beta.7/` |
| `0.2.6-beta.8` Security QA | 本机隔离安装、覆盖升级与重启验收通过；未公开发布 | 本机 `candidates/0.2.6-beta.8-security-qa/`，详见 [安全验收记录](../docs/SECURITY_HARDENING_2026-09.md) |

QA 包使用独立应用身份，不能作为正式应用的更新包上传。GitHub Releases 只列出实际创建的发布条目；合并代码和更新本清单不会自动创建 Release。安装包、运行日志及数据库不提交 Git，本机目录仅在归档机器上存在。

本机 beta.8 QA 已补“Lworkstation QA beta.8（仅测试）”桌面快捷方式，使用隔离启动器且公开更新关闭。0.2.7 临时安装验收应用已卸载，只保留证据。旧公开 beta.7 没有严格通道修复，继续 Beta 建议手工下载当前 `0.3.0-beta`；不假定旧安装包可自动升级。

0.3.1使用 `candidateOnly:true` 和 `release:build` 构建稳定配置候选，验收原件位于 `candidates/0.3.1/`，公开副本位于 `candidates/0.3.1-public/`；EXE/blockmap/元数据保持同字节，公开校验清单使用规范文件名。GitHub Latest已切到0.3.1，本机 `latest/` 目录未改动，不能以该历史目录判断公开版本。0.3.0原候选和公开副本保留。

## 公开 Beta 构建与归档

Beta 候选验证与整理顺序（在仓库根目录执行）：

```powershell
pnpm --dir desktop verify
pnpm --dir desktop release:build
pnpm --dir desktop smoke:packaged
pnpm --dir desktop release:organize
pnpm --dir desktop release:check
```

`release:build` 打入受控 beta 更新配置，将候选暂存于 `desktop/release-test/<版本>/`；`release:organize` 再将其整理至 `releases/prerelease/<版本>/`。稳定版构建使用 `pnpm --dir desktop build`，其余验证与整理步骤相同，由 `release-plan.json` 中的版本决定归档路径和更新元数据。

专职 Worktree 的安装包仍然只是预览包；正式交付必须从集成分支执行对应流程。公开上传与真实安装验收见 [更新测试清单](../desktop/UPDATE_RELEASE_CHECKLIST.md)。

## 0.2.17 分组销售图
位置：releases/candidates/0.2.17-grouped-sales/。纯本机 Windows，候选已验收并公开稳定版；本机未安装。详见 docs/RELEASE_0.2.17.md。

## 0.2.18 堆叠销售
位置：releases/candidates/0.2.18-stacked-sales/。Windows候选已通过并公开发布，本机未安装。详见 docs/RELEASE_0.2.18.md。

## 0.4.6 导入与内置 ERP 可用性修复（已公开）

candidates/0.4.6/：导入/ERP 修复验收通过，1326 前端测试、构建、完整 ERP/桌面门禁、实际 CSV/XLSX、69 MB 并发队列、真实 ERP 隔离只读 1 SKC/5 SKU、原生候选扩展及隐藏 smoke、623 安装文件/576 输入一致性通过。PR #169 / 主线 CI 通过，稳定标签固定 93c8ba5；四公开资产匿名完整哈希与生产更新入口通过。SHA256：0755605D96C3C99C460806275EDBBC07FB1FF62C89B0D1F80AC20C934869319B。见 [发布记录](../docs/RELEASE_0.4.6.md)。已公开稳定 Latest，不自动安装。

## 0.4.7 真实大队列持久回传（已公开并安装复核）

候选 `candidates/0.4.7/`；软件提交 d365a56；证据 `archive/erp-real-timeout/`。1326 前端测试、构建、完整 ERP 门禁、16 组桌面 verify、隐藏 smoke、636 安装文件/589 生产输入及 PR #171/main CI 通过。61.6 MB/110 SKC 真实副本复现并修复 4 秒业务保存超时，28 份原始证据哈希保持；真实 ERP 分批回传与重启续读通过。安装包 118773220 字节，SHA256 `17C08A29042D62E67964D14F445E4B1879B3C6A5E66A081FDA7E248EB2C3912A`。原数据/会话/安装备份后已安装同一候选，原工作区全新 110 SKC/6 批成本/6 批资料任务完成并自动采用 254 SKU；5 个 ERP 空映射仍显式保留。v0.4.7 固定 8ee4a5b，已公开稳定 Latest；四公开资产匿名完整哈希及生产更新入口通过，正常工作台已恢复，见 [记录](../docs/RELEASE_0.4.7.md)。
