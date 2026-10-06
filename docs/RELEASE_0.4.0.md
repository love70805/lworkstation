# v0.4.0 本地运营负责范围

头像菜单新增“我的负责商品”。按店铺与供方货号搜索、多选或批量粘贴，保存具名方案并在本机切换；关闭重开后保留。“我的商品 / 全部商品”统一影响选品、利润明细、月度账本摘要和本次 ERP 采集目标，销售趋势也按负责范围展示。工作区概况保留全量标注。

范围是本机筛选，不是账号隔离。完整历史、正式 ERP 成本、人工更正优先及定稿快照保持；空范围不会扩为全量。我的商品下整月报表、重开、费率与删除操作需切回全部商品，防止误把整月操作当作局部操作。未改数据库结构、真实数据、ERP 检查点或收件队列。本机不自动安装。ERP Assistant 保持 8.0.33。

## 实现与验证

实现 fb2cde3，主线文档清理 6a208dc 已同步。契约见 [运营范围](integration/OPERATOR_SCOPE_0.4.0.md)。最终前端 164 文件 / 1281 测试通过（含缺失定稿快照保护）。desktop verify 通过。隔离浏览器通过批量粘贴、同货号跨店隔离、方案/空范围切换、刷新保留、利润与台账全量保留、ERP 范围、浅深色、1366/1100/620 宽度和弹窗键盘验收。证据：archive/release-0.4.0/。

## 候选、集成与发布

最终实现 cade86b，候选生产构建、release check 与隐藏 smoke 通过，可见窗口 0；解包 593 文件与 unpacked 逐字节相同，546 生产输入与源码/构建资源一致。真实隔离 Chromium 进程关闭再启动后恢复两个运营方案和选择。

候选 releases/candidates/0.4.0/；安装包 118334212 字节，SHA256：FA59BEFC135CC35BE663EDB0DD299867AA8DACC78CD8D3866478AFEB0DCA496E。主仓库同路径持久副本哈希相同；证据保存在主仓库 archive/release-0.4.0/。没有安装或触发真实核算。

[PR #149](https://github.com/love70805/lworkstation/pull/149) CI 37494546004 通过，合并 eb37f7fb1185f9ce48fa0edfd012abb72bd5c885；主线 CI 37495002906 两项成功，合并树与候选代码树完全一致。

[v0.4.0 稳定 Latest](https://github.com/love70805/lworkstation/releases/tag/v0.4.0) 已公开，标签固定 eb37f7fb1185f9ce48fa0edfd012abb72bd5c885。四资产匿名完整下载的大小与 SHA256 同候选及服务端 digest 一致，latest.yml 的 SHA512/大小通过。公开安装包与 blockmap 采用 Lworkstation-Setup-0.4.0 规范名，与更新元数据一致。

生产更新 provider 读取实际稳定源，0.3.13 可发现 0.4.0；解析后的真实安装包 URL 再次完整下载哈希通过。0.4.0 为 current，Beta 不跨通道，RC 禁用。上传曾重试并恢复草稿；仅最终资产完整回读后登记为发布完成。证据 anonymous-verification.json、public-update-channels.json、public-final-verify.log。

本机未自动安装，未修改真实业务数据、扩展存储或 ERP 队列。
