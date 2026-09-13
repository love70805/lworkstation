# Lworkstation 0.2.13

状态：2026-09-14 已公开为 GitHub Latest，四资产匿名下载回读与稳定 / Beta 更新通道检查通过；本机未安装。

## 更新内容

- 修复成本核对中“复制平台 SKC”未写入剪贴板的问题；已定稿账本仍可复制，成本修改继续受定稿保护。
- 简化多店铺台账导入：店铺归属可直接修改，统一预览后确认导入，取消逐文件重复勾选和重复确认弹窗；保留混店、覆盖和定稿检查。
- 优化导入页面的文件卡片、按钮和小窗口布局。
- 每日销售保留销售额 / 销量切换，悬停或键盘聚焦同时查看两项数据，点击日期查看当天商品明细。
- 每日销售支持全部店铺和单店铺查看，与首页、利润页已有店铺范围同步；切换范围清除旧明细。
- 商品明细支持查找、排序和分页；活动内容默认收起，需要时展开原文。
- 区分已知零值与日期待查，负数绘制在零线下方。
- 修复连续切换店铺后旧利润概览残留、重复显示的问题。

## 兼容与数据

沿用本机数据库 v15、既有利润计算和人工更正规则，无新增数据库迁移。已有账本、定稿报告和业务数据不因更新自动改写。安装身份及稳定 / Beta 更新通道保持现行策略。

## 验收与交付记录

实施范围见 [0.2.13 合同](integration/NEXT_UPDATE_0.2.13.md)。利润实现 `70e20f9`、首页适配 `c6175e5` 已独立审查并集成；主线实际浏览器发现兄弟组件 key 冲突，造成店铺切换后旧概览残留，退回专职修订 `8fda4bc` 后集成。失败截图与计数保存在 `archive/update-0.2.13/before-sibling-fix/`，作为回归来源。

主线最终回归：99 个文件 / 640 项测试通过，生产构建通过。此前完整 `frontend release:check` 的 ERP 桥接、收件、同步合同、种子 / Schema / 部署检查全部通过；本次仅组件 key 与测试的修订后重跑全量前端测试和 build。desktop verify 的 12 组验证通过。既有 xlsx 混合导入及大 chunk 构建提示仍在，不阻断构建。

独立 Edge 验收：首页和利润入口，浅 / 深色 × 1280 / 1024 / 390，共 12 组布局无页面横向溢出；当天按店聚合、搜索不改合计、翻页、切换月份、键盘 Enter / Escape、负数 / 已知零 / 日期待查及旧响应隔离相关测试通过。补修后利润概览实际 DOM 计数为 1，失败来源与修复后结果分别保留。

Windows 候选从 `codex/selection-profit-erp-sync@25b43cf4296c65acea7cf7c14d31789d6e7c7709` 构建，38 个 requiredCommits 祖先检查通过。新 EXE 在独立 profile 中实际运行，确认版本 0.2.13 和 packaged 状态；两入口全部 / 单店日明细、精确合计、排除其他日期、唯一概览、首页双向筛选、真实 Windows SKC 剪贴板、两份 CSV 一次确认导入、主题一致、关闭托盘和第二实例唤起均通过。剪贴板原文字与原格式存在性恢复检查通过。

安装包：`Lworkstation Setup 0.2.13.exe`，116,544,308 字节。
SHA-256：`08BCF45777DB4F13943CD795EB241C3132141D310FC4AA99F242AC0C32C9F44A`。
候选 EXE SHA-256：`43FBE8FD817D20A957649690E9DE59510205E99BF56F7389CDAF3D6EEA487764`。
`app.asar` SHA-256：`5ABA5EC795EADEAAC98961A13C1003FA96284B2B3E26A05CF30211A8F01A44EE`。

候选根目录保留原构建输出和 `win-unpacked`，其 `artifacts/` 子目录的 installer / blockmap / latest.yml / SHA256.txt 通过 `validateLatestArtifacts`，installer SHA-512 与 metadata size 一致。主线独立核验三个资产的原输出和发布副本、EXE / asar 以及 36 份桌面证据哈希。旧 `desktop/release`、`releases/latest` 和 0.2.12 候选共 427 文件构建 / 验收前后哈希相同。

验收边界：使用合成数据和隔离网络；按钮为可信原生鼠标事件，选择 / 输入为 DOM 事件，CSV 使用 File / DataTransfer，托盘恢复通过同 profile 第二实例。未运行安装器、实际升级或真实 ERP，不把网络阻断环境中的 ERP 登记提示作为真实通道验收。第一次桌面 QA 仅脚本选择器引号错误，修正脚本后使用全新 profile 完整重跑；候选程序未改，前次错误单独留档。

最终候选证据：`archive/update-0.2.13/desktop/REPORT.md`、`candidate-manifest.json`、`qa/result.json`、`qa/clipboard-guard.json` 和主线 `main-final-verification.json`。集成临时工作树已移除，相关提交与必要验收证据保留。

## 公开发布

- 用户明确批准发布后，[PR #62](https://github.com/love70805/lworkstation/pull/62) 合入 main，合并提交 / 发布标签 `bff1f8ae80bf9de18aa3defad624d7c9966880be`。与已验收构建 `25b43cf` 的 frontend / desktop / integrations / tools / workflows 无差异；使用原候选字节，没有重打包。
- PR 和 main CI 均通过，运行编号分别为 `34780382287`、`34780465081`，包含前端发布检查、依赖审计与 Windows 桌面检查。
- [GitHub v0.2.13](https://github.com/love70805/lworkstation/releases/tag/v0.2.13) 于 2026-09-14 04:22:52（UTC+8）公开为 Latest，非 Beta、非草稿。
- 四个公开文件为 `Lworkstation-Setup-0.2.13.exe`、同名 blockmap、`latest.yml` 和 `SHA256.txt`；全部匿名完整下载，大小及 SHA-256 与上传清单一致，installer 与候选同字节。公开 SHA256 清单使用实际公开文件名。
- 生产更新 provider / runtime 配合匿名真实 GitHub 请求验证：0.2.12 稳定通道发现 0.2.13，0.2.13 不重复提示；0.2.6-beta.7 仅访问 Beta 元数据，未选中稳定版。没有自动下载或退出安装。此检查不是实际安装替换验收。
- 本机 `releases/latest/` 已整理为 0.2.13，0.2.12 保存于 `releases/history/0.2.12/`，旧候选保留；本机按用户要求未安装，未修改真实业务数据。
- 发布证据位于 `archive/release-0.2.13/`：上传清单、公开 Release 元数据、`public-readback.json`、`channel-verification.json`、标签与 CI 记录。通道检查初次使用的验证适配器漏传 Accept header，修正验证脚本并完整重跑后通过；未修改产品代码或已发布资产。

候选登记目录：`releases/candidates/0.2.13-daily-sales/`。
原始证据目录：`archive/update-0.2.13/`。
公开发布状态以 GitHub Release 资产上传并回读后的记录为准。
