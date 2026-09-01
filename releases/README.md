# Lworkstation 发布文件

- `latest/`：当前正式版本。用户安装软件时只从这里取文件。
- `history/<版本号>/`：历史安装包，仅用于回退和核对。
- `desktop/release/`：Electron Builder 的临时构建缓存，不作为安装入口。

主线发布顺序：

```text
pnpm --dir desktop build
pnpm --dir desktop smoke:packaged
pnpm --dir desktop release:organize
pnpm --dir desktop release:check
```

专职 Worktree 的安装包仍然只是预览包；正式版本必须从集成分支执行上述流程。
