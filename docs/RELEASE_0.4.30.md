# 0.4.30 选品归属与完成状态（已公开稳定 Latest）

预存区只列待建档资料，已建档商品与同 SKC 新增 SKU 从原档案继续维护，已有空草稿继续原记录；摘要、筛选和待补数量一致。助手 8.0.43 根据本机持久资料回执显示补取入口，齐全后收起，具体缺项与成本完成状态分别展示，保留旧任务检查点。

196 文件 / 1563 项前端测试、生产 build、完整发布门禁、17 组 desktop verify 及隐藏原生 ERP 加载/刷新/采集/重连通过。最终安装包资源及同基线组件的 40 组中文浅深色 × 375/768/1024/1440 布局、跨店铺查找、预存筛选、原商品保存重开与助手真实 DOM/CSS 状态通过，无页面溢出或错误；隐藏桌面 smoke 通过，可见窗口为 0。693 个安装文件 / 647 个生产输入逐字节一致。

[PR #225](https://github.com/love70805/lworkstation/pull/225) 已合并，PR 与[软件主线 CI](https://github.com/love70805/lworkstation/actions/runs/38697443680) 两项均通过。软件标签 v0.4.30 固定于 `3c7d0ca60885d724ed1448ad85d69e652cfe9511`，合并后的生产树与验收候选一致。2026-10-15T07:20:37Z 已公开为稳定 Latest（非草稿、非预发布）。公开页面、实际稳定更新入口与四资产均匿名完整回读；字节数、SHA256/GitHub digest 及 EXE SHA512 一致，0.4.29 识别 0.4.30，同版和跨通道保护通过。

本机未安装，无数据库迁移；真实数据库、业务文件、ERP/1688 队列及凭据未改写。人工有效值优先、正常多个供应商/链接及月度定稿保护保持。页面和保存验收使用隔离合成数据；原生 ERP HTTP 为模拟响应，隐藏验证不替代真实账号、可见窗口、托盘或焦点验收。

用户追加的表格内外双重纵向滚动、显示区域过小和页面长空白，以及全软件 UI 复查，已登记下一版本统一整理；本版不改变这组滚动规则。

验收源码 `0213c6b4f87ee80eb14b45d3dce3d682001bc976`，安装包 119724574 字节，SHA256 `9B85FA56EFE5E696030646A84BAA0F361BECDA1B303CBF307CE20EA4F1CCFDFB`。候选 `releases/candidates/0.4.30/`，原始证据 `archive/selection-flow-20261015/`。

[契约与验收](integration/SELECTION_FLOW_0.4.30.md)。

| 公开资产 | 字节数 | SHA256 |
| --- | --- | --- |
| Lworkstation-Setup-0.4.30.exe | 119724574 | `9B85FA56EFE5E696030646A84BAA0F361BECDA1B303CBF307CE20EA4F1CCFDFB` |
| Lworkstation-Setup-0.4.30.exe.blockmap | 126203 | `1CB613DC617023820C957C245122F06F81B59E86FA273C5147AFAAACB9CB14FB` |
| latest.yml | 356 | `B92350E403CF81F8D6D5ABABD398102ACF686EF863B611BDC7F39BA3645C39CE` |
| SHA256.txt | 278 | `D7F536AF51DA34ABE63836C75560511CF4EBBEF51FACD8B6C201E6D68782DFD3` |
