# 已退役的云部署模板

当前交付以纯本机 Windows 桌面版为准，账号云端方案已取消。这三个模板由1.0 RC仓库整理从原部署入口原样移入归档，不能由 GitHub Actions、Render 或 Vercel 自动发现和执行。

- `github-workflow.yml`：原 `.github/workflows/deploy-cloud.yml`。
- `render.yaml`：原根目录 Render 模板。
- `vercel.json`：原前端 Vercel 模板。

仅保留历史协议、SQL迁移与旧备份兼容证据；不包含真实部署凭据，也不恢复云功能。当前源码以 `frontend/`、`desktop/`、`integrations/` 和本机收件工具为准。
