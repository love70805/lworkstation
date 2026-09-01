# 1688 采集安全 Transport Contract

## 桌面注入配置

桌面工作站通过一次原子写入向 Chrome 扩展的 `chrome.storage.local` 注入固定三元组：

```js
{
  shopeersErpInboxBaseUrl: "http://127.0.0.1:<动态端口>",
  shopeersErpInboxCapability: "<至少 32 个字符的本机能力值>",
  shopeersErpWorkspaceId: "<非空工作区标识>"
}
```

这三个字段与桌面 `extensionStorageConfig()` 的输出形状一致，不得另行包装成选品专用对象。`baseUrl` 是本机服务根地址，扩展会补上 `/selection/v1`；origin 只能是 `http://127.0.0.1` 或 `http://localhost`。禁止 HTTPS、非 loopback 主机、凭据、query、fragment 或其他路径。任一字段缺失、非法、工作区为空或 capability 少于 32 个字符时，扩展 fail-closed，不能发出任何请求。

扩展后台每次请求前重新读取这三个顶层键，因此桌面轮换或清除 capability 后，旧 capability 不会继续使用；桌面必须重新原子注入完整三元组才能恢复。capability 不进入采集 envelope、页面 DOM、日志、错误详情或 `localStorage`。

## 请求边界

后台负责 `/selection/v1/status`、`context`、`extension-status`、`captures` 和 `captures/ack` 的网络请求，并统一发送：

```http
Authorization: Bearer <capability>
```

内容脚本/MAIN world 只提交最小 1688 商品证据（商品名、来源链接、图片、SKU、数量、价格和采集警告）；不能提供 endpoint、token、workspace、member、owner、visibility 或 ACK 控制。工作区、成员和可见性仍由 Shopeers active context 与服务端 contract 决定。

选品页面 transport 不直接读取 endpoint 或 capability，也不执行浏览器 `fetch`；它只通过桌面 preload 暴露的 `requestInbox` 受控 seam 发送固定 `/selection/v1/*` 路由。无桌面 transport 时请求失败并保持 fail-closed。Bearer capability 只在后台/桌面受控边界注入，页面侧不会看到。

业务口径保持不变：`source=1688`，1688 成本只作选品参考，ERP 正式成本与月度利润不受采集 transport 改写。
