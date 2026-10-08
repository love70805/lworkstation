# 0.4.12 启动与空闲内存优化

2026-10-08 18:40:06（UTC+8）：Windows 稳定版已公开为 [GitHub Latest](https://github.com/love70805/lworkstation/releases/tag/v0.4.12)，四公开资产匿名完整回读及生产更新入口通过。本机未安装，真实业务数据没有改写。

启动时只加载工作台，ERP 与 1688 页面及扩展在首次进入时才加载。空队列不再为空数组常驻存储线程；首次回传与外部文件变化照常校验落盘。已经打开的页面继续保留登录态、草稿与后台采集；首次加载/失败显示中文提示，可直接重试。配置与工作区切换串行，防止迟到的初始化使用旧工作区或夺走当前标签。

同机三轮 Windows 测量，使用真实生产前端、新 profile、空队列及固定隔离外部 HTML，统计所有 Electron 进程和独立收件进程的私有内存，单位 MiB：

| 中位数 | 0.4.11 基线 | 最终 0.4.12 候选 | 降幅 |
| --- | --- | --- | --- |
| 启动 | 527.8 | 354.1 | 32.9% |
| 空闲 | 491.1 | 340.0 | 30.8% |
| 渲染进程数 | 6 | 2 | 减少 4 个 |

候选启动三轮 357.0 / 353.1 / 354.1 MiB，空闲 345.2 / 339.3 / 340.0 MiB。没有强制 GC、清用户数据或禁用 GPU；首次打开外部页面后仍保留其进程与任务。该值不等同于用户真实登录 ERP/1688 或真实大收件队列的绝对占用，也没有承诺打开所有页面后继续节省同等比例。

171 个前端文件 / 1346 项测试、生产构建、完整 release:check 与 desktop verify 通过。缺失文件、首次写入、外部创建/替换、既有证据引用、存储 Worker 恢复、大队列并发通过。最终候选实际壳层冷启动、重复打开、迟到完成、工作区配置、12 次切换的 renderer/草稿保留、后台定时器、远程崩溃后的中文错误及实际重试、浅深色 1000/1440px 壳层、隐藏 packaged smoke 通过。原生扩展源码及最终候选资源均通过冷启动/刷新、100 秒后台、采集回传/落盘、收件重启、iframe 与登录失效；候选后台心跳最大间隔 14969 ms、状态最大耗时 35 ms。

全部窗口隐藏，不将其记作真实托盘/最小化/焦点验收。采购 HTTP 数据为隔离夹具，原生扩展 API、renderer、后台消息、收件进程及磁盘落盘均真实；没有连接真实 ERP 账号或采集真实数据。无业务数据库迁移，正式成本、人工优先及定稿保护保持。

实现 `9e52198`，构建源码 `1f5ccfe6f66faccd4efe16a3a29e423b56241e09`，基线 main `9a1131e` / 0.4.11。安装包解包的 662 个文件与被测 win-unpacked 逐字节一致，616 项生产输入与构建工作树一致；整理与发布契约通过。

安装包 119075144 字节，SHA256 `EC26199013C23F7307EEBD17BE34FFDAE44DE9E8C04FC6BCA15D0F73C2D8B83A`。候选 `releases/candidates/0.4.12/`；原始证据 `archive/memory-performance/`，源版原生扩展证据保全到其中的 `native-source/`。详细测量方法与契约见 [内存优化](integration/MEMORY_PERFORMANCE_0.4.12.md)。

[实现 PR #181](https://github.com/love70805/lworkstation/pull/181) 已合并；[PR CI](https://github.com/love70805/lworkstation/actions/runs/37763831359) 与[主线 CI](https://github.com/love70805/lworkstation/actions/runs/37764299207) 的 release-check / desktop-verify 均通过。稳定标签 `v0.4.12` 固定合并提交 `4d5afb4f646db162ea1592752233314d3e3b25e5`，与构建源码的生产输入一致；没有重打包或安装。

公开非草稿、非预发布的四资产完整流式下载，字节数、SHA256、GitHub digest 与本机候选一致；EXE 的 SHA512 与生产 `latest.yml` 一致：

| 公开资产 | 字节数 | SHA256 |
| --- | --- | --- |
| Lworkstation-Setup-0.4.12.exe | 119075144 | `EC26199013C23F7307EEBD17BE34FFDAE44DE9E8C04FC6BCA15D0F73C2D8B83A` |
| Lworkstation-Setup-0.4.12.exe.blockmap | 125170 | `5A2B219F23C8E604CF49DB7F4ED74B86D7F9241FB3C980822C17B0B3A21F137E` |
| latest.yml | 356 | `0A11D18C89101C4FAEFA5316201F21E9581FC6CD93C53A66C8D5612EB54EDEE9` |
| SHA256.txt | 278 | `43FDBF4C8188AE520DA27241BE789E0A9FA9BC6755E302B04C6AB14B54C45484` |

使用实际 electron-updater 与生产 feed 匿名检查，0.4.11 识别 0.4.12 可更新并解析到上述已完整回读的 EXE；同版无更新，现有策略的 Beta/RC 跨稳定通道保护通过。未自动下载到客户端或触发安装。公开证据为 `archive/memory-performance/public-readback.json`；候选、日志、测量、原生扩展及发布证据另复制并逐文件核对到主仓库的同名 archive / candidates 目录，保留旧工作区未提交内容。
