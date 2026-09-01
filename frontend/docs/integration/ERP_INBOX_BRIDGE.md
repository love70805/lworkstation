# ERP 成本安全本机桥接说明

ERP 与选品本机收件服务是桌面宿主控制的 capability transport，不是网页 API。renderer、ERP 页面脚本和普通浏览器页面都不能获得 localhost endpoint 或 bearer capability。

## Renderer 接口

桌面 preload 暴露固定 schema：

```js
const result = await window.shopeersDesktopRuntime.requestInbox({
  route: "/erp/v1/cost-batches",
  method: "GET",
  query: { workspaceId, ledgerId, limit: 20 },
  body: null,
});
// result: { status, body }
```

约束：

- `route` 只能位于 `/erp/v1/*` 或 `/selection/v1/*`；
- `method` 只能是 `GET` 或 `POST`；
- renderer 只传 `route/method/query/body`，不能传完整 URL、header、token 或 cookie；
- 浏览器环境没有该 runtime 时 fail-closed，不回退到匿名 localhost fetch；测试只能显式安装 `setInboxTransportForTests()` seam。

## 服务 capability

启动 `tools/erp-inbox-server.mjs` 必须设置：

```text
SHOPEERS_ERP_INBOX_CAPABILITY=<至少 32 字符的随机 capability>
```

所有 GET、POST、ACK、status、extension-status 和 OPTIONS 都要求 `Authorization: Bearer <capability>`。缺失或错误统一返回 401。响应不包含 wildcard CORS 或 `Access-Control-Allow-Private-Network`，token 不进入 spool、日志、响应、错误、inbox envelope 或 `sourceMeta`。

## ERP 扩展信任边界

扩展拆为三层：

1. MAIN world 的 `query-hook.js` 只观察 ERP 采购列表查询，并发送包含查询 URL 的最小信号。
2. isolated world 的 `content.js` 读取 ERP 数据、计算本地预览并组装原始证据；`shopeers-bridge.js` 只向 extension background 发送 runtime message。
3. `background.js` 从 `chrome.storage.local` 原子读取固定 `shopeersErpInboxBaseUrl`、`shopeersErpInboxCapability` 与 `shopeersErpWorkspaceId`，附加 bearer，只在配置工作区内恢复已登记请求上下文，持久化有限重试并投递。pending 首次保存即快照该工作区；缺失或切换工作区时保留缓存但不查询、不投递、不重绑。任一配置无效时 fail-closed，不回退默认端口。

页面不能选择 endpoint、capability、workspaceId、ledgerId、requestId、expectedSkus 或 `ledgerScopeRole`。background 会剥离不可信控制字段；server 还会依据已登记请求的 workspace、请求范围与完整 SKC 集合独立恢复身份并重算 expected/auxiliary。任意 `CustomEvent`、`window.postMessage` 或 `BroadcastChannel` 都不能直接形成可信 batch。

## 生成桥接扩展

```powershell
node tools/build-erpa-shopeers-bridge.mjs `
  "C:\path\to\erpa-v8.0-unpacked" `
  "C:\path\to\erpa-v8.0-shopeers-bridge"
```

构建器复制已审计的 canonical MAIN/isolated/background 模块并重写 manifest，不再向第三方 `content.js` 注入页面事件投递。原有本地预览、复制和 CSV 导出保留；扩展始终不决定正式成本。

## 桌面承接

桌面阶段必须完成：密码学随机 capability 生成；child env 注入；preload IPC 路由与方法 allowlist；把 ERP 的 base URL、capability、workspace ID 原子写入 extension background storage；所有健康探针和 ACK 鉴权。选品工作台另行把 1688 background/popup 改为 storage base URL + capability、Bearer Authorization 且无默认回退，桌面层只负责注入其运行时配置。桌面接入完成前，受保护的服务会拒绝旧 1688 扩展及任何匿名 localhost 调用。
