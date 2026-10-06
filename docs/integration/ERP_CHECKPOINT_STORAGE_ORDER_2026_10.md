# ERP 检查点持久化字段顺序修复

2026-10-06，用户在 Lworkstation 内置 ERP 点击核算后仍直接收到 `ERP_CHECKPOINT_QUERY_CHANGED：查询条件已变化，旧检查点不可覆盖。`，没有重新核算确认提示。本机安装目录与运行目录的 content/background 均为 8.0.31、与 v0.3.11 一致。只读读取真实扩展 WAL，已有 pending 检查点包含 `createTimePeriod`、`createdBy`；不记录原始 SKU、账号、请求标识或凭据。

后台按 localeCompare 排列输入字段，直接将其 JSON 字符串与存储读回对象比较。输入顺序为 createdBy → createTimePeriod，Chromium 字典持久化后为 createTimePeriod → createdBy，因此值完全相同也会在第一次进度保存时报错。此前 structuredClone 存储替身保留字段顺序，遗漏了真实持久化行为；0.3.10/0.3.11 入口修复没有覆盖该原因。

契约：保存与恢复时对两侧查询都经过现有白名单、类型与字段排序归一化；字段插入顺序不构成范围变化。保留空条件，真实字段、值或范围变化仍拒绝旧任务；request snapshot、workspace、月份、投递身份、旧 ACK 及人工/定稿成本保护不变。8.0.32 兼容保留 8.0.29–8.0.31 的有效本机检查点及待送达结果，不清空真实存储或 inbox，不追加数据迁移。

验收信号：存储替身递归重排字段；相同查询连续保存及带当前查询恢复均成功、投递身份不变；createdBy/createTimePeriod 真值变化继续拒绝。隔离的 Electron 44.2.0 / Chromium 152 实际 chrome.storage.local 已复现旧生产代码的完全相同错误，修复后的同一流程通过且可见窗口为 0，证据 `archive/release-0.3.12/actual-chromium-storage.json`。该验证使用合成数据，不等同于用户真实账号采集成功；不自动安装。
