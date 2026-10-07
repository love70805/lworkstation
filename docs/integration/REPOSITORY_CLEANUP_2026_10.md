# 仓库恢复与主页整理

2026-10-07。用户取消源码私有／分发仓库拆分，要求先恢复现状并整理仓库、更新主页。此要求覆盖先前批准的迁移方向。

## 恢复结果

- 原 `love70805/lworkstation` 未改名、未转私有，开发 remote 和客户端更新地址保持。
- `lworkstation-source` 未创建；已撤回 #163 引入的迁移规则及契约，迁移工作流已取消。
- 原仓库 v0.4.5 及历史 45 个 Release、180 个附件保留，本次不创建软件版本，不执行安装或操作真实业务数据。
- README 改为当前产品首页，更新下载与版本入口、主要功能、使用步骤、验证命令及仓库导航。旧 README 中重复桌面开发段落、过时 Beta 描述和把旧计划当作下一版入口的内容不再作为主页说明；原文仍可由 Git 历史追溯。
- 清除 Dependabot 三处旧集成分支固定目标，改为跟随仓库默认 `main`；旧目标已落后主线约 230 个提交。[GitHub 默认目标说明](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference#target-branch)。不删除该旧分支或关闭其他任务的依赖 PR。
- 续接指南改为 Electron 开发入口，取消强制创建三个长期对话及将云端配置作为本机恢复步骤的旧要求。PRD 顶部明确为历史原型，当前规则指向 AGENTS 和任务看板，历史正文保留。
- 已删除本任务及已交付 v0.4.3 的三个远端分支：`codex/private-source-update-channel`、`codex/v043-batch-keywords`、`codex/v043-release-record`。删除前核对已合并 PR、提交及工作树占用，并保存分支清单和源码 bundle；相关提交、标签和 PR 历史保留。

## 临时迁移产物

`lworkstation-updates-stage` 为本次新建的临时仓库。当前 GitHub 凭据缺少 `delete_repo` scope，整库删除被 GitHub 拒绝。已关闭 Actions 并设为私有；按清单删除 42 个本次复制的 Release、167 个附件及对应标签，原仓库 45 个 Release、180 个附件的 ID、长度和摘要均核对未变。临时仓库当前文件仅保留 README 取消说明并私有归档，没有为整库删除扩大凭据权限。

迁移前的源码 bundle、仓库／发布清单、取消及整理证据保存在本机 `archive/repository-channel-2026-10-07/`，不提交到仓库。

## 本机可重建缓存

已核对以下绝对路径、来源和保全依据，总大小约 972 MB。自动审批策略拒绝递归删除命令，未提供更具体原因，因此本轮实际保留这些目录，未宣称已释放空间：

- 本任务托管树的 `archive/release-0.4.3/package-check-ready/`：安装包验收解包副本，校验报告和安装包原件保留。
- 同一托管树的 `desktop/release/`：旧 v0.4.3 构建输出；与主工作区候选原件 SHA256 一致，原件及公开回读证据保留。
- 同一托管树的 `frontend/dist/`：可由源码重建的旧前端输出。
- 主工作区 `archive/repository-channel-2026-10-07/distribution/`：本次临时迁移克隆，已生成并验证独立 bundle。

托管树为 `C:/Users/Administrator/.codex/worktrees/v041-import-scope/Lworkstation`；主工作区为 `C:/Users/Administrator/Desktop/Lworkstation`。目标清单、大小和哈希保存在本机 `cleanup-targets.json`，不删除其他工作树、唯一备份、故障证据或用户未提交文件。

## 验证

本轮只调整文档及仓库维护事项，不启动桌面候选或安装。差异格式检查通过，修改文档的 38 个本地链接均存在；AGENTS 已恢复为拆分前版本，客户端更新配置没有改动。临时仓库清理和原发布资产核对通过。必要 CI、合并及公开主页回读由本轮 PR 完成，结果保存在上述本机证据目录。
