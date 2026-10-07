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

3. 安装依赖并启动桌面开发环境：

   ```powershell
   pnpm --dir frontend install
   pnpm --dir desktop install
   pnpm --dir desktop dev
   ```

4. 在 Codex 中把该仓库添加为项目。Codex 会读取根目录 `AGENTS.md`。
5. 阅读 `AGENTS.md` 和 `docs/CODEX_TASK_BOARD.md`，按最新已核对的 `origin/main` 或本批指定提交接续。一个版本保留一个执行对话；已有对话可用时继续使用，只有用户明确要求时创建新对话。
6. 如需恢复业务数据，在软件的“数据安全与备份”中导入本机备份；不要把备份提交到 GitHub。
7. 在 ERP 和 1688 标签重新完成登录；这些会话不会由 GitHub 同步。软件安装使用 [最新稳定版](https://github.com/love70805/lworkstation/releases/latest)，无需启动开发环境。

历史云端实验资料见 [CLOUD_UPLOAD_GUIDE.md](CLOUD_UPLOAD_GUIDE.md)，不作为本机恢复前置步骤，也不代表已授权部署云端服务。

## 继续开发前检查

```powershell
git status
pnpm --dir frontend test
pnpm --dir frontend build
pnpm --dir desktop verify
```

