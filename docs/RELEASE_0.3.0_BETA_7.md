# 0.3.0-beta.7 · ERP 成本恢复补丁

状态（2026-09-24）：Windows 候选、PR / main CI、公开 Beta 发布、四资产匿名回读和真实更新通道检查均已完成。稳定版仍为 0.2.19；未安装到本机，未改写真实业务数据。

## 修复范围

- Beta.5 旧请求只有 SKC、没有精确 `expectedSkus` 时，按原请求时间之前的同工作区账本销售行重建范围，保留归属与来源校验；后来导入的 SKU 不进入旧请求正式成本。
- Beta.6 保存的完整 v2 成本草稿按原账本与请求恢复到持久化收件箱，正常项再走自动采用。重复恢复保持幂等；旧 TSV、来源不完整或范围不明的输入仍不能升级为正式成本。
- 成本详情在正式成本落盘后实时刷新，明确显示候选价、阻断原因或已生效 ERP 成本。撤回 ERP 批次的墓碑语义、人工更正优先和定稿保护保持原口径。

现场截图显示仓库 SKU `ST260608151900573902683-1` 的三笔采购可得 4.59 元候选价，但未包含收件、请求与采用状态；不能单凭截图断定具体现场阻断分支。恢复契约和限制见 [Beta.7 成本恢复契约](integration/BETA_7_COST_RECOVERY.md)。

## 验收

- 前端 130 个文件 / 876 项测试、生产构建、桌面 verify 全套、Windows packaged smoke 和 `release:check` 通过；[PR #109](https://github.com/love70805/lworkstation/pull/109) 与 [main CI](https://github.com/love70805/lworkstation/actions/runs/35954011041) 的必需检查均通过。
- 隔离 headless Edge 使用旧请求和完整 v2 草稿复现三笔采购（20×4.5、15×4.5、15×4.8），自动入箱并正式采用 4.5900 元。收件状态 `applied`、采用 1 项、旧草稿移除；浅色 1280 宽成本页和深色 1024 宽详情弹窗均显示正式 ERP 成本。截图、种子及结果位于本机 `archive/beta7-ui/`。
- 使用隔离 IndexedDB 与浏览器配置；未连接真实 ERP 账号、未迁移或修改用户数据库。浏览器回放不等同于真实账号采集；桌面封装和收件路径由 packaged smoke 验证。

## 候选资产

- 构建代码提交 `c6f67ab`，分支 `codex/beta6-cost-recovery-fix`。候选位于 `releases/candidates/0.3.0-beta.7-cost-recovery/`；整理到 `releases/prerelease/0.3.0-beta.7/` 的四资产逐项一致，`beta.yml` 只指向 Beta.7。
- 安装包 `Lworkstation-Setup-0.3.0-beta.7.exe`，116774032 字节，SHA-256 `4628981F8BC61CEEE351C36500552CB7EBA3079D8D1DBB4CD604AFE89AF911CA`。
- blockmap SHA-256 `9CC81EDB733046AB743B9790D3CF355F55AB9D5E9243B3D96DA4483ED5C7FEC6`；`beta.yml` SHA-256 `893DC28F9CD37977756BA475A8550FC73A6DB32720FA3A64F8EDA7D9BE94193C`。
- `SHA256.txt` SHA-256 `2FBD882305B43B029889BE536BD713D0E6AC6C40A5DB328DCA838B99EEA7B9B6`；四资产从公开下载地址匿名回读后逐项与本机候选一致。

## 集成与发布

[PR #109](https://github.com/love70805/lworkstation/pull/109) 合入 `main` 的提交为 `38a525da77cb0d775e517877d7f810918fa70bdc`。候选代码提交 `c6f67ab` 是合并提交祖先；`frontend/` 与桌面可执行源码未发生后续改动，发布计划只追加了构建提交引用。[main CI](https://github.com/love70805/lworkstation/actions/runs/35954011041) 全部通过。

[v0.3.0-beta.7](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.7) 于 2026-09-24 12:05:52（UTC+8）公开为 GitHub prerelease，标签指向上述合并提交。Beta.6 的真实 GitHub 更新提供方可发现 Beta.7，Beta.7 显示当前版本；稳定版 0.2.19 仍使用 `latest.yml` 且 GitHub Latest 保持 `v0.2.19`。检查仅读取公开元数据，未下载更新或执行安装。匿名回读及更新通道证据保存在本机 `archive/beta7-ui/`。
