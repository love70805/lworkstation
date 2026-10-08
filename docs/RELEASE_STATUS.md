# Lworkstation 发布状态

更新时间：2026-10-08

## 当前公开稳定 Latest：0.4.8

[v0.4.8](https://github.com/love70805/lworkstation/releases/tag/v0.4.8) 固定 f534e9a，恢复台账自主筛选、默认纳入 POP 签收，导入完成优先引导本月正式成本与利润，预存资料默认收起。1333 测试、完整门禁、隔离原表与开发/生产操作、隐藏 smoke、636 文件/589 输入一致性通过；候选 SHA256 `12BA2191…`，源码 373cdf0。[PR #173](https://github.com/love70805/lworkstation/pull/173) 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/37719306291) 通过，四公开资产匿名完整哈希及生产更新入口通过。ERP Assistant 保持 8.0.36；不自动安装或改写真实业务库，见 [发布记录](RELEASE_0.4.8.md)。

## 历史公开稳定版：0.4.7

[0.4.7](https://github.com/love70805/lworkstation/releases/tag/v0.4.7) 固定 8ee4a5b，ERP Assistant 8.0.36。修复大量历史队列下业务保存仍超过 4 秒、上下文轮询反复重写的问题；复用存储 worker 与证据引用，业务提交允许 60 秒。原安装及原工作区完整 110 SKC/6 批成本/6 批资料任务通过，254 SKU 自动采用，5 个 ERP 空映射保留缺失提示。1326 测试、完整 ERP/桌面门禁、隐藏候选、636 文件/589 输入一致性、PR #171/main CI 通过。四公开资产匿名完整哈希及生产更新入口通过；原数据/会话/安装备份保全，已安装同一候选并恢复正常工作台，见 [记录](RELEASE_0.4.7.md)。

## 历史公开稳定版：0.4.6

[0.4.6](https://github.com/love70805/lworkstation/releases/tag/v0.4.6) 固定 93c8ba5。修复重复后缀应用后的导入禁用及状态/心跳阻塞；当时的单 SKC 真实 ERP 验收未覆盖此次 110 SKC 大队列业务保存，后续由 0.4.7 补修并完整现场验收。历史门禁及发布资产保持，见 [记录](RELEASE_0.4.6.md)。

## 历史公开稳定版：0.4.5

[0.4.5](https://github.com/love70805/lworkstation/releases/tag/v0.4.5) 固定 764a08a，ERP Assistant 8.0.35。导入先进入预存区、逐步补齐所有 SKU 资料，齐全后在任意页面自动进入选品库；显示缺项、支持原子批次与失败重试，保留参考历史。1324 测试、完整 ERP 门禁、开发/生产隔离用户路径与规模样本、浅深色窄屏、隐藏候选、621 文件 / 574 输入一致性、PR #161/main CI 通过。四公开资产匿名完整哈希及生产更新入口回读通过；未自动安装、未改真实数据，见 [记录](RELEASE_0.4.5.md)。

## 历史公开稳定版：0.4.4

[0.4.4](https://github.com/love70805/lworkstation/releases/tag/v0.4.4) 固定 f2a53c9，ERP Assistant 8.0.35。整批后缀选货号、前置导入按钮/折叠明细、原子基础建档与参考页默认隐藏已建档分支。1310 测试、开发/生产隔离 CSV 与规模样本、浅深色窄屏、隐藏候选、621 文件 / 574 输入、PR #159/main CI、四公开资产匿名完整哈希及生产更新入口通过。未自动安装、未改真实数据，见 [记录](RELEASE_0.4.4.md)。

## 历史公开稳定版：0.4.3

[0.4.3](https://github.com/love70805/lworkstation/releases/tag/v0.4.3) 固定 `9d10073`，ERP Assistant 8.0.35。20 SKC 分批采集、成本优先、持久任务与显式恢复；导入多关键词显式选货号与成功记忆。1298 测试、规模/恢复/隔离用户路径、隐藏候选、621 文件 / 574 输入、PR #157/main CI、四资产匿名完整哈希及生产更新入口回读通过。未安装、未改真实数据，见 [记录](RELEASE_0.4.3.md)。

## 历史公开稳定版：0.4.2

[0.4.2](https://github.com/love70805/lworkstation/releases/tag/v0.4.2) 固定 ade5b2f，ERP Assistant 8.0.34。应急延长成本采集至 60 分钟、补充资料至 30 分钟、单请求至 120 秒。1281 测试、超旧时限/取消/恢复回归、headless UI、构建、desktop verify、隐藏候选 smoke、607 文件 / 560 输入一致性及 PR #155/main CI 通过；四公开资产匿名哈希及生产更新入口通过。未安装、未改真实数据，见 [记录](RELEASE_0.4.2.md)。

## 历史公开稳定版：0.4.1

[0.4.1](https://github.com/love70805/lworkstation/releases/tag/v0.4.1) 固定 `5dcb4c6`。恢复导入前货号筛选和记忆、完整月改选原子替换、全局按实际入库数据展示、待办同步及首页/利润 SKC 构成。1281 测试、构建、desktop verify、隔离 UI、隐藏 smoke、594 文件 / 547 输入和 PR #152/#153/main CI 通过；四公开资产匿名完整哈希及生产更新入口通过。本机未安装、真实数据未改、ERP 8.0.33 保留。见 [记录](RELEASE_0.4.1.md)。

## 历史公开稳定版：0.4.0

[0.4.0](https://github.com/love70805/lworkstation/releases/tag/v0.4.0) 固定 eb37f7f。头像本地运营方案统一选品、利润、台账和 ERP 目标；全量事实、人工成本与定稿保护保持。1281 测试、构建、desktop verify、隔离 UI 与进程重启、隐藏 smoke、593 文件/546 输入、PR #149 / 主线 CI 通过。四资产匿名完整哈希与生产更新 provider 真实下载 URL 回读通过。ERP 8.0.33；未自动安装或触发真实核算。见 [记录](RELEASE_0.4.0.md)。

## 历史公开稳定版：0.3.13

[0.3.13](https://github.com/love70805/lworkstation/releases/tag/v0.3.13) 固定 9bd33f9，修复正式请求 SKC 对象被串成 [object Object] 后导致 EMPTY_COST_RESULTS。对象契约生产路径、1270 测试、构建、桌面 verify、隐藏 smoke、593 文件/546 输入一致性、PR #146 / 主线 CI、四公开资产完整哈希回读、实际更新通道及 8.0.33 ZIP 通过。未自动安装、未触发真实核算或清空数据；用户已在决策端确认 0.3.13 修复成功。见 [记录](RELEASE_0.3.13.md)。

## 已撤回旧 Release

2026-10-06 按用户授权删除 0.3.6、0.3.7、0.3.9 草稿、0.3.10、0.3.11、0.3.12 及 24 个附件；标签和提交历史保留。清理当时 0.3.13 为 Latest，资产未变，更新入口有效。见 [清理记录](integration/ERP_RELEASE_CLEANUP_2026_10.md)。下方历史段落记录当时发布事实，旧附件链接已失效。

## 历史公开稳定版：0.3.12（已撤回）

[0.3.12](https://github.com/love70805/lworkstation/releases/tag/v0.3.12) 固定 674432d，修复真实 Chromium 扩展存储重排字段导致相同查询误报变化。真实引擎隔离复现旧错及修复后成功、1270 测试、构建、desktop verify、隐藏 smoke、580 安装文件/533 输入一致性、PR #144 与主线 CI 均通过。四公开资产匿名完整下载、元数据/哈希与实际更新通道、8.0.32 扩展 ZIP 公共哈希通过；本机未安装 0.3.12，用户真实账号采集仍需更新后复验，不清空真实数据。见 [发布记录](RELEASE_0.3.12.md)。

## 历史公开稳定版：0.3.11

[0.3.11](https://github.com/love70805/lworkstation/releases/tag/v0.3.11) 固定合并提交 `952ce6c`，补齐0.3.10遗漏的打开预览自动核算入口。PR #142 的完整1270测试/门禁、构建、桌面verify、隐藏smoke、567安装文件/520生产输入一致性、四公开资产匿名完整哈希回读及稳定更新通道通过。主线push CI延迟出现，最终运行37447847732两项均通过；合并树与通过CI候选树完全一致。本机未安装、真实数据未改、真实账号未复验。现场具体查询字段未取得。见 [发布记录](RELEASE_0.3.11.md)。

旧 Beta 源限制沿用；0.3.9 草稿已按用户授权删除，0.3.10历史记录见 [0.3.10](RELEASE_0.3.10.md)。

## 历史公开稳定版：0.3.4

1108测试、16组桌面verify、真实60秒慢路径、隔离22MiB收件、headless用户路径、隐藏EXE smoke与489文件/442输入一致性通过。[PR #129](https://github.com/love70805/lworkstation/pull/129)及main CI通过；[v0.3.4](https://github.com/love70805/lworkstation/releases/tag/v0.3.4)已于10:23公开，标签固定b399a6a，稳定四资产匿名全量回读及实际更新通道核验通过。旧0.3.0至0.3.3标签/资产保留；Beta仍为0.3.0-beta.10、RC禁用。未安装、未改真实库。见[0.3.4验收](RELEASE_0.3.4.md)。

## 历史公开稳定版 0.3.1

[v0.3.1 GitHub Latest](https://github.com/love70805/lworkstation/releases/tag/v0.3.1)已于2026-09-29公开，tag固定47baf33、非草稿、非预发布。PR #122/#123及对应main CI通过；1004测试、低级别审计、隐藏EXE smoke、461文件/414生产输入比对通过。四资产匿名完整下载哈希、latest.yml与真实更新通道检查通过：稳定0.3.0可发现0.3.1，Beta仍为0.3.0-beta.10，RC禁用。0.3.0原标签和资产保留，未安装、未改真实库。安装包、源码与证据已在主仓库持久保全，见[0.3.1发布与验收](RELEASE_0.3.1.md)。下方保留各版本历史发布阶段记录。

## 历史公开 Beta：v0.3.0-beta.10

已有报告当前/历史简化下载与纯颜色ERP灯已通过925项测试、完整门禁、隔离实际下载与状态链路、Windows候选smoke、PR #115/main CI；[Beta.10](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.10)已公开且四资产匿名哈希与真实更新通道通过。稳定Latest仍0.2.19，本机未安装、真实库未改，真实ERP账号未验。见 [验收与哈希](RELEASE_0.3.0_BETA_10.md)。

用户随后要求准备0.3.0正式版，将由新的版本执行任务承接；本条仅登记已发布Beta.10，不代表正式版已发布。

## 历史 v0.3.0 Beta.9

四项调整已公开，见 [Beta.9](RELEASE_0.3.0_BETA_9.md)。

## 历史 v0.3.0 Beta.8 / Beta.7

Beta.8 的正式成本证据保存 / 旧行只读投影与 Beta.7 成本恢复均已于 2026-09-24 公开预发布并完成四资产与更新通道验收；见 [Beta.8](RELEASE_0.3.0_BETA_8.md)、[Beta.7](RELEASE_0.3.0_BETA_7.md)。

## 历史 v0.3.0 Beta.6

`0.3.0-beta.6` 的自动 ERP 部分采用、导入月份识别、SKU 属性与利润/成本界面调整已通过本机候选验收，并经 PR #107 / main CI 合入。2026-09-24 已[公开预发布](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.6)，四资产匿名回读与真实更新通道检查通过。候选 SHA-256 与验收边界见 [Beta.6 记录](RELEASE_0.3.0_BETA_6.md)。稳定 Latest 保持 0.2.19，本机未安装。

## 历史 v0.3.0 Beta.5

Beta.5 的流程一致性与本机缓存已于 2026-09-22 公开预发布，四资产回读与通道隔离通过；见 [Beta.5 记录](RELEASE_0.3.0_BETA_5.md)。

## 历史 v0.3.0 Beta.4

修复 ERP 扩展预览混用台账之后采购：工作台登记可信台账月份，扩展、缓存恢复、明细和 CSV 均先保留台账当月及以前采购，再选最近三笔数量加权与四位截断。未关联月份明确提示，不用系统时间兜底。完整证据保留，正式成本独立验证和人工/定稿保护不变。

772 测试、完整发布门禁、13 组桌面验证、实际打包扩展月份传递/自动回传及工作台采用、窗口检查和 smoke、PR #101 / main CI 均通过。四资产匿名回读哈希一致，Beta.3 可检测 Beta.4，稳定 Latest 仍为 0.2.19。本机未安装。见 [Beta.4 记录](RELEASE_0.3.0_BETA_4.md)。

## 历史 v0.3.0 Beta.3

成本采用核算当月及以前的采购，排除后续月份；仍按时间取最近三笔，不优先 1688，数量加权、四位截断和人工更正优先不变。该口径取代下方 Beta.2 的“排除核算当月”。旧采用金额保留，选样变化需复核，已定稿报告不自动改写。

补齐切到 ERP／1688 并最小化后返回工作站的显示、重绘与响应恢复；健康页面保留未保存输入，空页面、进程退出和销毁提供重试入口。755 项前端测试、完整发布检查、13 组桌面验证、原生故障注入、最终候选交互和 smoke、PR #98 / main CI、四资产匿名回读及真实更新通道检查通过。用户原机长时间偶发白屏尚未稳定自然复现，仍需实际反馈验证。

2026-09-21 已公开预发布，标签基线 `62e054b`，构建源 `b5de541`。Beta.2 可检测 Beta.3；稳定 Latest 保持 0.2.19。本机未安装，真实数据未改。见 [Beta.3 记录](RELEASE_0.3.0_BETA_3.md)。

## 历史 v0.3.0 Beta.2

临时试验口径：排除核算当月及以后，只取此前最近三笔采购，不优先 1688；b,a,b,b,a,a 采用 b,a,b。实际选样明细同步到核对表、助手 CSV 和利润 Excel。旧金额和冻结报告保留，人工更正仍优先。751 测试、完整发布检查、12 组桌面验证、Windows 候选交互/smoke、PR #94 / main CI、公开四资产回读和真实通道检查通过。Beta.1 可检测新版，稳定 Latest 仍为 0.2.19，本机未安装。见 [Beta.2 记录](RELEASE_0.3.0_BETA_2.md)。

## 历史 v0.3.0 Beta.1

所有账本月份均按当月月末截止采购，包含历史月份、排除后续月份；原已采用金额和冻结报告保留，人工更正仍优先。743 测试、完整本地发布检查、Windows 候选交互与 smoke、PR #92 / main CI、公开四资产回读及通道验证通过。标签 `d57b6aa`，构建源 `507711e`。旧 `0.3.0-beta` 可检测新版，稳定 Latest 仍为 `0.2.19`；本机未安装。见 [Beta.1 记录](RELEASE_0.3.0_BETA_1.md)。

## v0.3.0 Beta 已公开发布

代码版本 `0.3.0-beta`，仅 Windows 桌面版。719 测试、生产构建、12 组桌面验证、Windows 候选交互与 packaged smoke、发布资产合同检查通过。候选源 `03c2fbe`，PR #90 / main CI 通过，标签基线 `d99049e`。2026-09-20 已公开为 GitHub 预发布，四资产匿名回读与更新通道隔离通过；本机未安装，稳定 Latest 保持 `v0.2.19`。见 [Beta 记录](RELEASE_0.3.0_BETA.md)。

## 历史公开稳定版 0.2.19

- 每日/月度销售图、期间店铺构成与 SKC 明细、店铺销量 Top 5、相邻期间和返回状态已交付；利润页专注核算。
- 709 项测试、前端构建、桌面验证、发布合同门禁、十万行浏览器对账和 Windows packaged smoke 通过；PR #88 / main CI 成功。
- [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.19)；四个公开资产匿名下载与哈希回读通过，0.2.18 稳定更新可发现 0.2.19，Beta 不跨通道。
- 本机未安装，无数据库迁移，真实数据未改；验证范围及边界见 [验收记录](RELEASE_0.2.19.md)。

## 历史稳定版 0.2.18 / 0.2.17

见 [0.2.18](RELEASE_0.2.18.md) 和 [0.2.17](RELEASE_0.2.17.md)。

## 历史稳定版 0.2.16

- 每日分店铺图和月份对比、持久化缓存/后台计算、利润按需明细、输入和详情返回、共享 UI 与动效已交付。
- 681 项 CI 测试、构建、发布合同、Windows 候选及公开四资产回读通过，见 [验收记录](RELEASE_0.2.16.md)。
- [GitHub Release](https://github.com/love70805/lworkstation/releases/tag/v0.2.16) / [Windows 安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.16/Lworkstation-Setup-0.2.16.exe)。稳定通道检查通过，旧 Beta feed 限制保持明确隔离。
- 本机未安装；业务数据库仍为 v15，未改真实数据、未执行云端迁移。

## 历史稳定版 0.2.15

- 修复代发件数输入跳焦；压缩利润页重复控件，日明细限高滚动，复用已加载来源以减少读取和聚合。
- 649 项测试、完整发布门禁、Windows 实际输入/候选、12组浏览器布局通过；[验收记录](RELEASE_0.2.15.md)。PR #68 / main CI 通过，标签 `b7e2aa0` 与构建 `b83bda8` 生产文件一致。
- [GitHub v0.2.15](https://github.com/love70805/lworkstation/releases/tag/v0.2.15) 已于 2026-09-14 09:32:37（UTC+8）公开 Latest，四资产匿名回读一致。0.2.14 能发现新版，当前版不重复提示。
- 旧 Beta 已不在 GitHub 最近发布列表，提示“没有同通道版本”；未误取稳定版，本轮没有发布新 Beta。
- [Windows x64 安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.15/Lworkstation-Setup-0.2.15.exe)，116,544,912 字节；SHA-256 `7277B553D2E9C33382E4C06B8AA5A387F30755C1F7B38E26997ADDC653E99047`。
- 本机未安装，真实数据未改，无迁移。候选 `releases/candidates/0.2.15-profit-usability/`，历史稳定包保留。

## 历史稳定版 0.2.14

- 每日商品明细改用 SKC 并支持搜索；活动名称简写、去重，去掉时间和价格等冗长内容。首页与利润页同步生效，计算口径和原始证据保留，无数据库迁移。
- 643 项测试、完整发布检查、桌面 verify / packaged smoke、12 组浏览器布局和实际 Windows 候选验收通过。详见 [0.2.14 验收](RELEASE_0.2.14.md)。
- [GitHub v0.2.14](https://github.com/love70805/lworkstation/releases/tag/v0.2.14) 已于 2026-09-14 05:14:16（UTC+8）公开为 Latest。PR #65 和 main CI 通过；标签 `86913ee` 与候选 `c6d3313` 生产文件一致。
- 四资产匿名回读通过，稳定版 0.2.13 能发现新版，当前版不重复提示、Beta 不接收稳定包。
- [Windows x64 安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.14/Lworkstation-Setup-0.2.14.exe)，116,544,500 字节；SHA-256 `3BBC5BD786CBE8597B381F60B497236DACDC08FC96E6644F9752563B1DAE46F0`。
- 本机未安装。候选 `releases/candidates/0.2.14-daily-details/`，旧稳定版归档，真实业务数据不变。

## 历史稳定版 0.2.13

- SKC 复制、批量导入简化与 UI、每日销售明细 / 店铺筛选及切店重复概览修复已在本机主线集成。
- 99 文件 / 640 测试、生产构建、12 组 Edge 布局与交互、desktop verify 及实际 Windows 新包验收通过；详见 [0.2.13 验收](RELEASE_0.2.13.md)。
- 候选构建基线 `25b43cf`，目录 `releases/candidates/0.2.13-daily-sales/`，安装包 116,544,308 字节，SHA-256 `08BCF45777DB4F13943CD795EB241C3132141D310FC4AA99F242AC0C32C9F44A`。
- [GitHub v0.2.13](https://github.com/love70805/lworkstation/releases/tag/v0.2.13) 已于 2026-09-14 04:22:52（UTC+8）公开为 Latest；PR #62 合并与标签基线 `bff1f8a`，生产文件与候选构建 `25b43cf` 相同，PR / main CI 均通过。
- 四资产匿名完整下载与 SHA-256 回读通过。0.2.12 稳定通道可发现 0.2.13，0.2.13 不重复提示，Beta 保持隔离；没有运行本机安装或实际更新替换。
- [Windows x64 安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.13/Lworkstation-Setup-0.2.13.exe)。本机 `releases/latest/` 已更新，0.2.12 归档到 history，旧候选与真实业务数据保留，无迁移。

## 历史稳定版 0.2.12

- [GitHub v0.2.12](https://github.com/love70805/lworkstation/releases/tag/v0.2.12) 于2026-09-13 07:55:42（UTC+8）公开为Latest；发布标签基线6cd8b1b，候选构建基线4b08da3，两者生产文件一致。
- 完整交付主题/启动/托盘、首页账本与每日趋势、利润内成本核对、代发/独立扣款、两阶段Excel及本机v15报告留存和备份恢复。详见 [验收记录](RELEASE_0.2.12.md)。
- PR #57/#59集成、#58合入main；主分支CI、612测试、12组桌面验证、实际候选报表/托盘/更新检查通过。四个公开资产匿名下载回读一致，0.2.11稳定通道可发现新版，0.2.12不重复提示，Beta不接收稳定包。
- [Windows x64安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.12/Lworkstation-Setup-0.2.12.exe)：116540543字节；SHA256 `55E54E5583C05238681F43C9308952D391918050E8B575F1B3E09AF9620CB717`。
- 本机候选为releases/candidates/0.2.12-complete-local-update，已公开包同字节。本机按用户要求不安装，现有0.2.9及业务数据保留；纯本机，不新增或执行云SQL。真实ERP账号采集现场保留用户复验边界。

## 历史稳定版 0.2.11

- 原经营概览已恢复，利润页独立，保留 0.2.10 成本与 ERP 修复。582测试、CI、三尺寸页面、打包运行及真实更新下载通过。
- [GitHub v0.2.11](https://github.com/love70805/lworkstation/releases/tag/v0.2.11) 已公开 Latest，四资产匿名回读一致；候选 candidates/0.2.11-restore-overview。见 [验收记录](RELEASE_0.2.11.md)。
- 本机仍保留 0.2.9，不安装、不执行云端迁移。

## 历史稳定版 0.2.10

- 仓库版号为 `0.2.10`，PR #47/#48 已合入集成及 main，581 项测试、CI、生产构建、打包运行和真实更新下载校验通过。
- 公开包与本机 `releases/candidates/0.2.10-local-desktop/` 候选相同；详见 [验收记录](RELEASE_0.2.10.md)。本轮不追加或执行云端数据库迁移。
- 用户选择暂不安装；本机正式版为 `0.2.9`，业务数据未改动。[GitHub v0.2.10](https://github.com/love70805/lworkstation/releases/tag/v0.2.10) 已于 2026-09-10 03:13:02（UTC+8）公开 Latest；四资产匿名下载回读校验通过。0.2.9 稳定通道可发现新版，Beta 不接受该包。

## 历史稳定版状态（0.2.9）

- 产品名称：Lworkstation
- 历史正式版号：`0.2.9`；仓库及公开版本已更新为 `0.2.10`
- 状态：已公开为 GitHub Latest 稳定版，四个资产下载回读校验通过；本机旧产物已归档 `releases/history/0.2.9/`，`releases/latest/` 当前保存已公开的 0.2.10 构建
- 稳定更新通道：`desktop/update-config.json` 默认开启；严格同通道升级，用户确认下载与安装
- Windows 安装身份、内部协议与本机数据库名保持不变，以便覆盖安装保留数据
- 本机正式安装仍为 `0.2.9`，公开新版为 `0.2.10`；本轮未执行安装。历史稳定版与 Beta 保留

## 历史稳定版 0.2.9

- [v0.2.9](https://github.com/love70805/lworkstation/releases/tag/v0.2.9)，2026-09-09 11:52:44（UTC+8）公开为GitHub Latest，四个资产匿名下载回读通过。
- 修复ERP收件并发写入和Windows短暂拒绝替换的恢复缺口；失败保留原文件，后续回传保持幂等。
- [Windows x64安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.9/Lworkstation-Setup-0.2.9.exe)：116,376,621 bytes；SHA-256 `739524B980EE295D27B5E7544FD9D611123D2A2DC4DFA130E27A962F198F04B0`。
- 552项测试、完整门禁、打包smoke、打包服务并发/原生Windows拒绝复测及实际NSIS下载校验通过。0.2.8可发现新版，异常电脑升级后的真实回传结果待用户验收。详见 [0.2.9验收](RELEASE_0.2.9.md)。
- 开发测试依赖Vitest已补到4.1.11；不改变利润规则、数据库和安装身份，未执行云端迁移。

## 历史稳定版 0.2.8

- [v0.2.8](https://github.com/love70805/lworkstation/releases/tag/v0.2.8)，2026-09-09 01:00:17（UTC+8）公开为 GitHub Latest，四个资产匿名下载回读通过。
- 构建标签 `8591b5191e5489d87e7d12f4892f29f9f397e2b1`；利润精度、ERP 异常搜索/四位显示、窗口化按钮与单实例修复已交付。
- [Windows x64 安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.8/Lworkstation-Setup-0.2.8.exe)：116,376,271 bytes；SHA-256 `59E8AFBB96A9492FE59A2B0D8596124F634BB071A64E212B6CF4CFF7966C7877`。
- 552 项测试及发布门禁通过。本机使用公开包覆盖原 0.2.7，404 个载荷哈希一致，849 个数据文件在安装过程中未变；启动/重启、业务表指纹、重复启动与快捷方式验收通过。详见 [0.2.8 验收](RELEASE_0.2.8.md)。
- 默认检查稳定更新，0.2.7 可发现新版；Beta 不接收该包。Windows 未签名，0011 云端精度迁移尚未线上执行。

## 历史稳定版 0.2.7

- [v0.2.7](https://github.com/love70805/lworkstation/releases/tag/v0.2.7)，发布于 2026-09-08 20:55:26（UTC+8），非草稿、非预发布，GitHub Latest。
- 发布基线 `b223fb7a82b742c687ede0abd2dc1bad0c1878fe`。默认开启稳定检查；新 Beta 构建严格 beta 通道。禁止跨通道和降级，不自动下载、不退出即装。
- [Windows x64 安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.7/Lworkstation-Setup-0.2.7.exe)：116,374,384 bytes；SHA-256 `94B8DC67893F233A9E80374A54F822ACA2BBB6697331B6238EFB26E59E6FC810`。
- 四个公开资产下载回读一致，匿名下载通过。532 测试、桌面 smoke、实际稳定下载与隔离安装数据保留、GitHub CI 通过，详见 [0.2.7 验收](RELEASE_0.2.7.md)。
- 旧稳定版 0.2.6 需手工安装新版一次；旧 beta.7 未获得本修复，本轮未发布新 Beta，后续需手工迁移到包含修复的同通道版本。用户正式安装未被自动覆盖。Windows 仍未签名。

## 历史稳定版 0.2.6

- [v0.2.6](https://github.com/love70805/lworkstation/releases/tag/v0.2.6)，发布于 2026-09-08 16:39:57（UTC+8），历史稳定版，原资产未变。
- 发布标签：`e0c1e682456a54fd58edb5f1cd6d67e11a5ba27b`；安全、依赖、名称和同月多店铺批量台账导入已集成。
- [Windows x64 安装包](https://github.com/love70805/lworkstation/releases/download/v0.2.6/Lworkstation-Setup-0.2.6.exe)：116,372,923 bytes；SHA-256 `0895FB70CE440911057380E5F371E50AD14E8C1C7B79D3CC86B4B9ADFDB24F33`。
- EXE、blockmap、latest.yml、SHA256.txt 已上传并下载回读，文件名、大小、哈希一致；匿名公开下载校验清单通过。
- 稳定更新通道关闭，退出应用后手工安装；Windows 代码签名尚未配置。完整测试、产物与真实环境验收边界见 [0.2.6 发布验收](RELEASE_0.2.6.md)。

## 已发布公开 Beta

- 公开仓库：love70805/lworkstation
- v0.2.6-beta.1：引导版，需手工安装一次；安装包 88,726,534 bytes，SHA-256 1FA2C36A64AB9D9EB05C96BB113A8F19229CC93A3FE414040E2274B4B6C8D7D0。
- v0.2.6-beta.2：软件内自动更新验收版；安装包 88,726,544 bytes，SHA-256 0EA54ACAE4A29102A1DF32350C7414A1635C12A12587C255A1174CD09A4B891F。
- v0.2.6-beta.3：公开仓库基线与更新时间安全修复；安装包 88,726,721 bytes，SHA-256 787EDBD10582719303E163A96E0A0C740BE976180047D39E1E52843223D83E14。
- v0.2.6-beta.4：公开更新链验证版；安装包 88,726,356 bytes，SHA-256 6FBFC490EC41538BE211A62FEFFD7EDCEF0CB75D1207A17C9798F6BAAD3898A6。
- v0.2.6-beta.6：数据保留与安全传输集成版；安装包 88,798,962 bytes，SHA-256 6F0C6F802DBFE640AF75AF0DC91D1A6115E6CDDE4A9F406CF6DD19FFE9EC6CBA；blockmap SHA-256 4F584BFEBB9E0DDCB66D96107263CAB381C687AC4E6E7CC8178E5A5FA0C2A8AD；beta.yml SHA-256 4E83F8F7C0881FA903986A9A99BCD93394AC0F06A019A5D11C77B326BD1889C3。
- v0.2.6-beta.7：beta 更新源引导版；安装包 88,799,017 bytes，SHA-256 753A8C876C77D021AA633F8EF3076E7B93D50511A27AAC5D11D4EBAFB1E85560；blockmap SHA-256 C1442CCACD36032859CE4FD72F30E779EE3EA0BB01214C6FE1A64885FB3C233B；beta.yml SHA-256 34A597E9AFFE7A9C4EBE6C40BBBE6ADB5610C606468E8345913E322E2E6272B6。
- 七个版本均为 GitHub prerelease，完整上传 EXE、blockmap、beta.yml 和 SHA256.txt。
- 自动下载和退出即装保持关闭，更新必须由用户确认下载并显式重启安装。
- Windows 代码签名尚未配置，首次安装可能显示“未知发布者”。

## 历史 v0.2.6 Beta.7

- 版本：`0.2.6-beta.7`
- 集成分支：`codex/selection-profit-erp-sync`
- 发布提交：`40e4da8`
- 安装包：`Lworkstation-Setup-0.2.6-beta.7.exe`
- 文件大小：`88,799,017` bytes
- SHA-256：`753A8C876C77D021AA633F8EF3076E7B93D50511A27AAC5D11D4EBAFB1E85560`
- blockmap：`94,042` bytes，SHA-256 `C1442CCACD36032859CE4FD72F30E779EE3EA0BB01214C6FE1A64885FB3C233B`
- beta.yml：`373` bytes，SHA-256 `34A597E9AFFE7A9C4EBE6C40BBBE6ADB5610C606468E8345913E322E2E6272B6`
- 更新路径：`0.2.6-beta.6 (手工安装一次) -> 0.2.6-beta.7 -> 后续 beta (软件内更新)`
- GitHub Release：`v0.2.6-beta.7`，已于 2026-09-05 03:14（UTC+8）发布为 prerelease。

## 历史本机安全候选与 Beta 更新边界

- 安全代码已通过 PR 合入集成分支及 `main`。本机安全 QA 使用独立身份 `com.shopeers.workstation.securityqa`、名称 `Lworkstation Security QA` 和测试版本 `0.2.6-beta.8`，未公开发布且更新关闭。已补“Lworkstation QA beta.8（仅测试）”桌面快捷方式；当前正式发布为 0.2.7。
- 本机安全 QA 包已归档至 `releases/candidates/0.2.6-beta.8-security-qa/`：`Lworkstation-Security-QA-0.2.6-beta.8.exe`，116,143,571 bytes，SHA-256 `4DFE7B2FD97DFF7759017E01ED73FD5022196946623D45C6C38EB26BC4FC9D86`。本机目录包含校验清单、说明和隔离启动入口；修复、测试、GitHub 集成与安装验收详见 [安全修复与验收](SECURITY_HARDENING_2026-09.md)。
- [版本清单](../releases/README.md) 同时列明当前公开稳定版、历史 Beta 与本机候选。beta.8 QA 从未上传；其安全修复现已纳入正式 0.2.6，但独立 QA 安装验收不能替代正式用户环境验收。
- 下一公开 beta 必须基于 beta.7 的受控 beta 更新配置继续验证真实软件内更新，并按正式发布流程另行推进元数据和构建；本机隔离安装不代替公开更新链验收。
- beta.6 的线上资产已有下载，不能替换或原地修复；需要手工安装 beta.7 一次。

## 历史 0.2.6 与 Beta 发布门禁（当前 0.2.7 见独立验收记录）

- [x] 公开仓库基线、更新时间安全修复和预发布发布工具已合入集成分支。
- [x] 桌面版本与 `release-plan.json` 曾推进到 `0.2.6-beta.7`；历史更新夹具继续固定为 beta.4 回归链。
- [x] 仓库正式版号与对外产品名已切换为 `0.2.6` / Lworkstation；内部 `appId`、协议与数据库名未改。
- [x] `0.2.6` 稳定安装包构建、`release:organize` 与 `release:check`。
- [x] GitHub 稳定 Release 上传 `Lworkstation-Setup-0.2.6.exe`、blockmap、`latest.yml`、`SHA256.txt`，下载回读并确认 Latest 状态。
- [x] 前端生产构建。
- [x] Desktop verify、update smoke 与发布产物契约测试。
- [x] beta.7 安装包构建、`release:organize` 与 `release:check`。
- [x] EXE、blockmap 与 beta.yml 的 SHA-256 写入并回读。
- [x] GitHub Release 资产回读：beta.7 标签、prerelease 状态、文件名、大小、SHA-256 与 beta.yml 均匹配。
- [ ] 真实公开更新：从手工安装的 beta.7 发现、下载并显式安装后续 beta；未完成前不作通过声明。

## 权威规则

专职对话和专职 Worktree 只能交付模块提交与预览包。正式版本以本文件、`desktop/release-plan.json`、集成分支 ancestry 和主 Worktree 的发布检查结果为准；对话中的“已完成”不能替代上述门禁。

真实 ERP 登录态、采购页注入、真实分页、SKU/SKC/仓库 SKU 映射、供应商与 1688 链接、`warehouseEvidence` 完整性仍需在用户实际账号环境手工验收。
