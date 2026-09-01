# Milestone 2 审计：本地 outbox 与云端部署基线

审计日期：2026-08-07  
结论：**通过，可进入 API/数据库设计；外部资源创建仍需单独批准。**

## 1. 本里程碑目标

- 在不连接外部服务的前提下，为业务审计事件建立可恢复的本地同步队列。
- 固定跨端传输的版本化 envelope，避免云端接入时重新解释本地数据。
- 提供无密钥、默认本机的部署配置，防止把本地数据或秘密误带到云端。

## 2. 已实现

| 文件/能力 | 证据 |
| --- | --- |
| `src/domain/syncEnvelope.js` | envelope v1、工作区隔离、事件 ID 唯一性和控制字段隔离 |
| `src/data/syncOutbox.js` | 领取批次、成功确认、失败重试、超时释放和状态统计 |
| `src/data/syncProvider.js`、`src/data/syncProvider.test.js`、`src/data/syncRunner.js` | 本机离线提供方、HTTP 提供方、完整回执校验及失败重试契约测试 |
| `src/data/database.js` v6 | 审计事件 `syncState` 索引及既有记录迁移；新事件自动初始化为 `pending` |
| `src/config/runtimeConfig.js` | local/api/supabase 提供方解析，缺失端点时拒绝进入云端状态 |
| `.env.example`、`.gitignore`、`vercel.json` | 环境变量边界、本地数据忽略和 SPA 路由部署规则 |
| 系统诊断页 | 显示当前提供方、云端配置状态和待上传审计数量；端点配置后可手动触发一次 outbox 同步并反馈完整回执结果 |

## 3. 验证结果

```text
Vitest: 18 个测试文件，56 项测试通过
Vite production build: 1753 个模块转换成功
内置浏览器 5173：v6 迁移后原有账本数据可读，诊断页显示 8 条待上传审计，控制台无错误
```

## 4. 尚未完成

- 尚无真正的 API、Supabase 客户端、Auth、RLS 或对象存储实现。
- outbox 当前只保存审计事件，不代表业务实体已经完成云端写入；API 接入时必须按事件幂等键读取/写入对应实体快照。当前已提供手动触发入口，但默认本机模式不会发起网络请求。
- 尚未执行真实恢复覆盖路径和移动视口最终验收。

## 5. 下一里程碑入口

1. 评审 `POSTGRES_RLS_DESIGN.md` 中的 PostgreSQL 表结构、RLS 和角色权限矩阵。
2. 评审 `CLOUD_API_CONTRACT.md` 中的 outbox 接收、幂等、冲突和回执协议。
3. 使用脱敏夹具实现云端适配器和集成测试。
4. 获得用户批准后，再创建 GitHub、数据库和托管项目并执行只读预览部署。
