# ERP 用户链路隔离验收

基线：`30836d0`。本任务只增加桌面测试，不修改生产逻辑、数据 contract、版本或安装包。

## 运行

先在本分支启动前端预览（默认 `http://127.0.0.1:5188`），然后：

```powershell
node desktop/erp-ui-smoke.cjs
```

可用环境变量：`WORKSPACE_SMOKE_ORIGIN`（仅 loopback）、`DESKTOP_EXPERIENCE_ELECTRON`（Electron 可执行文件）、`PLAYWRIGHT_PATH`（Playwright 模块目录）。脚本输出独立临时证据目录。仅归档其中的 PNG、JSON、哈希；不要归档 `profile/`。

`erp-ui-smoke-app.cjs` 仅在测试进程中加载当前 `main.cjs`，追加测试接口，不加入打包白名单。真实窗口、workspace preload、受控 IPC、本机 inbox 服务和 React 页面均保留。所有非 loopback HTTP 请求阻断。

## 覆盖

- 只初始化合成月度账本与销售行；不直接写入 request、inbox、正式成本或发布记录。
- 页面确定工作区、月份、甲店和 SKC 后自动登记；脚本从未点击“复制 SKC”。扩展发送成功验证服务端已经收到该关联。
- 手动输入非空时，真实 bridge/background 通过 HTTP 回传；真实页面通过 IPC 收件，草稿不被覆盖。
- 队列载入提示中保留草稿；清空 textarea 后从已存回传载入。扩展实际复制函数生成的完整 JSON 经真实手动导入解析。
- 粘贴已收件批次会释放已载入 inbox 身份。发布前从队列重新载入，遵守现有收件状态保护。
- 完整送达后退出整个 Electron 进程，销毁真正执行 bridge 的 VM 及 workspace renderer；同隔离 profile 重启后只从持久 inbox/草稿恢复，不再次向页面注入 payload/envelope，再点击发布。断言成功提示、自动进入利润明细以及只读正式快照 `0.009 × 1000 = 9`。
- 当前页切换合成工作区，旧账本 URL 明确拒绝；进入新账本后重送旧扩展结果，旧 SKU/成本不进入新工作区。
- 1280 CSS 宽度操作及截图，无页面横向溢出。

## 边界

- 采购数据是合成 fixture；真实扩展 bridge/background 在 VM adapter 中执行。没有真实 ERP 登录、网络抓取、浏览器扩展弹层或实体采购页关闭验收。整个源进程退出后恢复发布用于验证证据持久性，不能代替现场 ERP 采集验收。
- 复制函数使用内存剪贴板，并把其原始输出填入真实 textarea；不覆盖系统剪贴板权限与键盘粘贴。
- 成员切换通过现有公共 context API 加 SPA 导航模拟。本机模式整页重新加载会按设计恢复默认成员，不把这种重载当成多工作区切换。
- 人工更正优先、真实零/微小值、撤销和定稿保护由现有 `manualCostOverride.integration.test.js` 验证；本脚本不重复实现人工更正流程。
- 本脚本当前验证源码运行。完整报表集成及候选包验收仍由主线在最终基线上重跑/适配；不声称已经验证候选安装包。

附加定向验证：在 `frontend/` 运行 `node node_modules/vitest/vitest.mjs run src/data/manualCostOverride.integration.test.js src/hooks/useLedgerIdentity.test.jsx --maxWorkers=2`，2 文件共 12 项通过。`desktop/package.json` 中 `verify` 的全部 12 组检查通过。
