# 换电脑或账户后的 Codex 续接

## 能从 GitHub 恢复的内容

- 全部源代码、测试、数据库迁移和浏览器扩展源码。
- 根目录 `AGENTS.md` 中的项目级开发规则。
- `docs/CODEX_TASK_BOARD.md` 中的当前范围、业务口径和验收标准。
- 历史开发及部署资料；当前本机桌面版恢复无需配置云端服务。

## 不会随 GitHub 自动恢复的内容

- Codex 对话历史、置顶状态和本机 Worktree 路径。
- IndexedDB 业务数据、本机备份、ERP 登录态、浏览器扩展安装状态。
- `.env`、Supabase service key、ERP Cookie、1688 Cookie 等秘密。

## 新设备操作

1. 安装 Git、Node.js 和 pnpm，并登录 GitHub。
2. 克隆仓库并进入目录：

   ```powershell
   git clone https://github.com/love70805/lworkstation.git
   cd lworkstation
   ```

3. 查看只读环境摘要，先核对实际目录、版本和 Git 状态；这一步只需要 Git 与 Node.js：

   ```powershell
   node tools/development-context.mjs
   ```

4. 在 Codex 中把该仓库添加为项目。Codex 会读取根目录 `AGENTS.md`。
5. 阅读 `AGENTS.md` 和 `docs/CODEX_TASK_BOARD.md`，按最新已核对的 `origin/main` 或本批指定提交接续。一个版本保留一个执行对话；已有对话可用时继续使用，只有用户明确要求时创建新对话。
6. 本次任务需要运行实现或开发验收时，再按锁文件安装依赖：

   ```powershell
   pnpm --dir frontend install --frozen-lockfile
   pnpm --dir desktop install --frozen-lockfile
   ```

   验证范围按任务风险选择，默认后台执行；需要真实桌面交互时再使用 `pnpm --dir desktop dev`，只读解释和文档续接不启动应用。
7. 如需恢复业务数据，在软件的“数据安全与备份”中导入本机备份；不要把备份提交到 GitHub。
8. 在 ERP 和 1688 标签重新完成登录；这些会话不会由 GitHub 同步。软件安装使用 [最新稳定版](https://github.com/love70805/lworkstation/releases/latest)，无需启动开发环境。

历史云端实验资料见 [CLOUD_UPLOAD_GUIDE.md](CLOUD_UPLOAD_GUIDE.md)，不作为本机恢复前置步骤，也不代表已授权部署云端服务。

## 继续开发前检查

先读取现行规则和任务看板，再查看只读环境摘要：

```powershell
node tools/development-context.mjs
```

摘要不会联网、更新 Git 索引、改变配置或检查真实数据库。它显示实际根目录、分支/HEAD、缓存的 `origin/main`、未提交入口、源码版本和已登记工作树数量。`remoteVerified: false` 表示远端尚未核对；Git 状态干净也不能推断忽略目录没有本机数据或验收证据。

旧基线没有摘要工具时，用 `git status --short --branch`、提交和源码版本作只读核对；工具或权限错误应明确记录，不能误报为干净状态，也不自动修改 Git 信任配置。

开始新实现前核对实际远端或本批指定提交；有未提交内容时保留并核对，不直接切换或覆盖。只读取本次涉及的实现和测试，不必每次续接都重新跑全套业务门禁。验证按 [开发工作区说明](DEVELOPMENT_WORKSPACE.md) 的任务类型执行，正式发布门禁仍按 [AGENTS.md](../AGENTS.md) 保留。
