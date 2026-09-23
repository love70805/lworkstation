# 0.3.0-beta.6 · ERP 自动采用与利润核对

状态（2026-09-24）：Windows 候选、PR / main CI、公开 Beta 发布、四资产匿名回读和真实更新源检查均已完成。稳定版仍为 0.2.19，本机未安装，也未改写真实业务数据。

## 使用变化

- ERP v2 回传接收后由数据层独立核验并自动采用合格 SKU，打开成本页不再是生效前提。可信批次里的零价异常、证据缺失和未取得成本按 SKU 留待处理；来源整体不可信时整批阻断。人工更正保持最高优先级，已定稿或锁定账本不自动改变。
- 成本页显示实际持久化的自动采用、人工有效和剩余异常状态，按原因给出处理入口。店铺与搜索筛选只影响查看，完整账本继续作为 ERP 请求和采用范围。旧手动完整批次路径及撤回入口保留。
- 新建台账按有效“添加时间”识别单月并填入；混月、缺失或无效日期要求明确选月，已有账本始终沿用原月份。成本表从已导入明细展示 SKU 属性与来源，不要求重导。
- 利润页合并主标题、月份、店铺与“利润明细 / 成本核对”页签；精简重复入口，旧账本导出与报告历史下载保留。侧栏名称改为“系统检查”。

## 验证与边界

- 前端 130 个文件 / 865 项测试、生产构建、桌面 verify 全套、Windows packaged smoke 和 `release:check` 通过；打包前端 335 个文件与构建输出逐项哈希一致。
- 隔离 Edge 在 1024/1280/1440 宽度及浅深色检查；隔离账本中 4.59 元正常项自动生效、零价异常保留，利润与成本页一致。导入页实测单月自动填入及混月手动选择。截图与构造脚本保存在本机 `archive/beta6-ui/`，恢复记录见 [M1 草稿恢复](../archive/beta6-profit/RECOVERY.md)。
- 没有连接真实 ERP 账号，也没有在用户本机安装候选或执行真实数据库迁移。前台浏览器验收不等同于真实账号采集；桌面收件与扩展已由隔离打包 smoke 验证。草稿恢复依据原任务记录重建，不能证明与丢失的未提交文件逐字节一致。

## 候选

- 构建提交：`1a9c131`，分支 `codex/beta6-implementation`。
- 安装包 `Lworkstation-Setup-0.3.0-beta.6.exe`，116772980 字节，SHA-256 `3F9452C47E83B29DE424954FB1AE416AD9E07718F4FD41072407AC630E7163FA`。
- 本机候选 `releases/candidates/0.3.0-beta.6-auto-erp-profit/` 与公开发布所用的 `releases/prerelease/0.3.0-beta.6/` 四资产逐项一致；`beta.yml` 指向 Beta.6，不触及稳定 `latest.yml`。

## 集成与公开发布

- [PR #107](https://github.com/love70805/lworkstation/pull/107) 保留原提交合入 `main`，合并提交 `5e67ad25e7fcad4b427ecd0fd41f4763d13af086`。候选构建提交是合并提交祖先，`frontend/` 与 `desktop/` 相比构建基线无差异。PR CI `35903661114` 和 [main CI `35903952647`](https://github.com/love70805/lworkstation/actions/runs/35903952647) 的发布检查、桌面验证均通过。
- [v0.3.0-beta.6](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.6) 于 2026-09-24 02:43:56（UTC+8）公开为 GitHub prerelease；标签指向上述合并提交。四资产匿名下载与本机候选逐项 SHA-256 一致：安装包 `3F9452C47E83B29DE424954FB1AE416AD9E07718F4FD41072407AC630E7163FA`，blockmap `0B42079C1660F97C545DB84141BAB4BFF336BE94C1EAE9EAD78F85A49F13C795`，`beta.yml` `6B304D141DCC3737A427D6FF1F35DC8B9E27D1A862BA6D8669AB593DAF484790`，`SHA256.txt` `0867B7273665F9DA687469BFBE7CB532A441BF4C71F11287C4FBEF77C8E294E5`。
- 真实 GitHub 更新提供方检查：Beta.5 可发现 Beta.6，Beta.6 显示当前版本，稳定版 0.2.19 使用 `latest.yml` 且不跨入 Beta；GitHub Latest 仍为 v0.2.19。检查仅读取公开元数据，未下载更新或安装。匿名回读和更新源证据保存在本机 `archive/beta6-ui/`。
