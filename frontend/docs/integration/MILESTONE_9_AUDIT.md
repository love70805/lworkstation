# 里程碑 9：ERP Assistant 桥接与成本请求可追溯性

状态：本机请求/回传合同与 v8.0 文本适配已完成，真实 ERP 扩展自动连接尚未执行
审计日期：2026-08-07

## 已完成

- 新增 `erpBridgeContract.js`，将已有 `buildErpCostRequest` 包装为版本化 `shopeers-erp-v8-request` 请求包。
- 请求包固定声明：工作区、账本、请求人、请求时间、平台 SKC 查询单位、去重查询集合、CNY、ERP Assistant v8.0.0 基线和算法版本。
- 回传包继续使用 `shopeers-erp-cost-batch`，并增加请求范围集合绑定校验。
- `erpCostBatchEnvelope` 保留平台 SKC 证据字段，支持一个 SKC 回传多个平台 SKU。
- 成本核对页支持导出 ERP 请求包，同时保留复制平台 SKC 的人工降级流程。
- 兼容真实 v8.0 的 4 列 TSV/10 列 CSV 输出：导入时用当前账本已确认的 SKU → SKC 映射包装为审计批次，不要求修改旧扩展。
- 成本页打开已有账本时恢复最近一次 ERP 请求；没有请求关联时禁止发布成本批次。
- 发布的 ERP 成本事实保存平台 SKC、平台 SKU、仓库 SKU、来源批次和权威基线摘要，供利润和选品参考共同使用。

## 验证

- 新增桥接适配回归后，Vitest：30 个测试文件、94 项测试通过。
- Vite production build：1761 个模块转换成功。
- 本地成本核对空状态页面渲染正常，未发现应用运行时错误。

## 尚未完成

- 尚未把真实 ERP Assistant Chrome 扩展自动连接到本机请求包或本地服务。
- 尚未在真实 ERP 登录态、分页失败、映射失败场景下做端到端浏览器验收。
- 尚未创建或连接 PostgreSQL、Supabase、Vercel、对象存储等外部资源。
- 权威 v8.0 独立利润工具回归脚本依赖其目录中的 Playwright；当前依赖缺失，未擅自安装或修改旧项目。
