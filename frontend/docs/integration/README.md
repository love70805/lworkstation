# Lworkstation 集成开发文档

桌面版的业务口径与开发决策见[项目约束](../../../AGENTS.md)。现行实体关系见[领域模型](DOMAIN_MODEL.md)，模块入口、验证与发布见[开发指南](../../../docs/DEVELOPMENT_WORKSPACE.md)。

## 历史集成资料

下列规格、基线和里程碑按原阶段归档，供定位旧字段、协议和迁移背景。

1. [`PRODUCT_SPEC.md`](PRODUCT_SPEC.md)：初次集成时的产品范围和业务规则。
2. [`BASELINES.md`](BASELINES.md)：初次集成采用的两个来源版本及其哈希。
3. [`LEGACY_COMPATIBILITY.md`](LEGACY_COMPATIBILITY.md)：原有 ERP 与利润工具的兼容约定。
4. [原阶段领域模型](https://github.com/love70805/lworkstation/blob/b481149e05f0747e24624f70ebe66ce4d0354477/frontend/docs/integration/DOMAIN_MODEL.md)：当时的模型与持久化背景。
5. [`CLOUD_ARCHITECTURE.md`](CLOUD_ARCHITECTURE.md)：团队协作、数据库、权限和部署路线。
6. [`MILESTONE_1_AUDIT.md`](MILESTONE_1_AUDIT.md)：第一阶段完成情况与剩余风险。
7. [`MILESTONE_2_AUDIT.md`](MILESTONE_2_AUDIT.md)：本地 outbox 与云端部署基线。
8. [`MILESTONE_3_AUDIT.md`](MILESTONE_3_AUDIT.md)：ERP v8.0 成本批次与利润核算衔接。
9. [`MILESTONE_4_AUDIT.md`](MILESTONE_4_AUDIT.md)：云端同步合同开发联调。
10. [`MILESTONE_5_AUDIT.md`](MILESTONE_5_AUDIT.md)：PostgreSQL/Supabase 数据层迁移草案。
11. [`DEV_SYNC_SERVER.md`](../../../docs/integration/DEV_SYNC_SERVER.md)：本地同步服务启动和联调说明。
12. [`MILESTONE_9_AUDIT.md`](MILESTONE_9_AUDIT.md)：ERP Assistant 桥接合同与成本请求可追溯性。
13. [`MILESTONE_10_AUDIT.md`](MILESTONE_10_AUDIT.md)：ERP v8.0 批次输入和成本证据链。
14. [`MILESTONE_11_AUDIT.md`](MILESTONE_11_AUDIT.md)：云端种子包、部署门禁和审计边界。
15. [`MILESTONE_12_AUDIT.md`](MILESTONE_12_AUDIT.md)：本地审计 Outbox 到 HTTP 同步闭环。
16. [`MILESTONE_13_AUDIT.md`](MILESTONE_13_AUDIT.md)：工作区首页导航与重复入口修复。
17. [`MILESTONE_14_AUDIT.md`](MILESTONE_14_AUDIT.md)：响应式、核心入口和 ERP 主链路浏览器验收。
18. [`MILESTONE_15_AUDIT.md`](MILESTONE_15_AUDIT.md)：采集入库、ERP 成本、利润定稿和选品回流验收。
19. [`MILESTONE_16_AUDIT.md`](MILESTONE_16_AUDIT.md)：审计事件完整快照与云端业务数据重放验收。
20. [`MILESTONE_17_AUDIT.md`](MILESTONE_17_AUDIT.md)：全局事件身份、种子基线和新设备恢复验收。
21. [`MILESTONE_18_AUDIT.md`](MILESTONE_18_AUDIT.md)：PostgreSQL 幂等同步事务、回滚和工作区隔离验收。
22. [`MILESTONE_19_AUDIT.md`](MILESTONE_19_AUDIT.md)：同步服务运行时与 PostgreSQL 恢复/种子适配。
23. [`MILESTONE_20_AUDIT.md`](MILESTONE_20_AUDIT.md)：本地 PostgreSQL Compose、迁移和健康检查入口。
24. [`MILESTONE_21_AUDIT.md`](MILESTONE_21_AUDIT.md)：JWT claims、工作区成员角色和异步授权边界。
25. [`DEPLOYMENT_GUIDE.md`](../DEPLOYMENT_GUIDE.md)：本地开发、同步服务和用户批准后的上云步骤。
26. [`MILESTONE_27_AUDIT.md`](MILESTONE_27_AUDIT.md)：ERP 收件请求关联增强、歧义拒绝和过期请求。
27. [`MILESTONE_28_AUDIT.md`](MILESTONE_28_AUDIT.md)：ERP 收件历史与同步服务健康检查。
28. [`MILESTONE_29_AUDIT.md`](MILESTONE_29_AUDIT.md)：Supabase 会话、认证请求头与后台自动同步。
29. [`MILESTONE_30_AUDIT.md`](MILESTONE_30_AUDIT.md)：本地发布候选验收流水线与当前交付边界。
30. [`MILESTONE_31_AUDIT.md`](MILESTONE_31_AUDIT.md)：多平台 SKU / 单平台 SKC ERP 主链路验收。
31. [`MILESTONE_32_AUDIT.md`](MILESTONE_32_AUDIT.md)：标准台账报表识别与供方货号多选。

根目录 `PRD.md` 是前端原型阶段的历史文档，不再作为当前开发优先级依据。
