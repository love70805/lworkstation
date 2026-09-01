# 里程碑 34：云端部署入口与发布门禁

日期：2026-08-08  
状态：**本地与 GitHub 发布链路已完成，真实云端资源尚未配置**

## 已完成

- 根目录新增 `render.yaml`，描述同步 API 的 Render Docker Web Service、健康检查和生产 Secret 变量。
- 新增 `.github/workflows/deploy-cloud.yml`，仅支持手动触发生产发布。
- 发布工作流会先执行完整 `release:check`，再按输入选择发布 Vercel 前端或触发 Render Deploy Hook。
- 前端发布前校验并写入以下 Vercel Production 变量：
  - `VITE_SYNC_PROVIDER`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_SYNC_API_BASE_URL`
- `docs/CLOUD_UPLOAD_GUIDE.md` 已补充 Render、Vercel 和 GitHub Secrets 配置说明。
- 部署门禁已检查工作流手动触发约束、Render Blueprint、前端 SPA 回写和敏感变量隔离。

## 验收证据

```text
45 个测试文件，163 项测试通过
Vite 生产构建通过
ERP 收件协议通过
同步服务冒烟通过
云端种子合同通过
PostgreSQL Schema 合同通过
同步部署门禁通过
前端部署门禁通过
GitHub Shopeers quality 通过
```

最新提交：`4ceffe3 ci: configure vercel production environment`

## 尚未具备的外部条件

- 尚未创建或连接 Supabase 项目、Auth 和生产 PostgreSQL。
- 尚未创建或连接 Vercel 项目、Render 服务和 Deploy Hook。
- 尚未配置 GitHub Actions Secrets。
- 严格云端预检当前返回 `provider=local`，因为同步端点尚未配置。
- 尚未在真实 ERP 登录态完成扩展到收件箱的生产端到端验收。

因此当前项目阶段仍为：**本机真实数据 Beta，可供组内试用；云端部署入口已就绪，但尚未达到生产上线条件。**

