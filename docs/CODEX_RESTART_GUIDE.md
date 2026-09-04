# 换电脑或账户后的 Codex 续接

## 能从 GitHub 恢复的内容

- 全部源代码、测试、数据库迁移和浏览器扩展源码。
- 根目录 `AGENTS.md` 中的项目级开发规则。
- `docs/CODEX_TASK_BOARD.md` 中的任务拆分、业务口径和验收标准。
- `frontend/.env.example`、部署工作流和云端上传说明。

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

3. 安装依赖并启动前端：

   ```powershell
   pnpm --dir frontend install
   pnpm --dir frontend dev
   ```

4. 在 Codex 中把该仓库添加为项目。Codex 会读取根目录 `AGENTS.md`。
5. 根据 `docs/CODEX_TASK_BOARD.md` 重新创建“选品工作台”“利润核算与 ERP”“全局 UI 与导航”三个任务对话。
6. 如需恢复业务数据，在软件的“数据安全与备份”中导入本机备份；不要把备份提交到 GitHub。
7. 如需云端协作，复制 `frontend/.env.example` 为本机环境文件，并按 `docs/CLOUD_UPLOAD_GUIDE.md` 配置公开变量和服务端 Secret。

## 继续开发前检查

```powershell
git status
pnpm --dir frontend test
pnpm --dir frontend build
```

