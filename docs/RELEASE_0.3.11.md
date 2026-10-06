# 0.3.11 成本预览自动入口检查点修复

用户在已安装 0.3.10 后反馈点击核算仍出现 ERP_CHECKPOINT_QUERY_CHANGED。只读核对安装和 runtime 扩展均为 8.0.30 且源码一致，不能归因于旧包。

确认代码缺口：openPanel 自动核算未经过重新核算的新尝试入口；默认 list 隐藏 completed 检查点，异步刷新返回前也可能认为无任务。生产 content/bridge/background 隔离回放在旧已完成任务与改变查询时复现同一错误。合成 queryRange 差异不冒充现场字段；现场最新查询仅在页面内存，未取得其具体变化。

修复提交 a1b736d：打开预览先查询包含完成状态的原任务，已有任务明确提示继续或重新核算；继续时携带原投递身份，首次 fresh 保存拒绝并发误覆盖。沿用同一入口已取得的请求上下文，防止二次读取改变绑定。8.0.31 保留 8.0.29/8.0.30 有效检查点与旧待送达载荷；不改真实数据、迁移、人工成本或定稿。

## 候选验收

完成/未完成检查点、延迟 list、fresh 保存竞争、确认取消与显式重采集、旧身份保护、请求绑定、采集绑定、慢请求及扩展 public 目录/ZIP 回归通过。桌面 verify、生产构建、实际候选隐藏 smoke（无可见窗口）通过；520 项生产输入与源码/构建资源一致，567 个安装文件与 unpacked 一致。前端业务代码未变，复用 0.3.10 的 1270 本机测试；PR #142 完整 CI 37446943188（release-check / desktop-verify）成功，其中1270项测试全部通过。

安装包 SHA256：9B52761BA5C77EF75B7F3574519052E6C1BA69424CA59532F9DFD0E966A831A5。原件 releases/candidates/0.3.11/；证据 archive/release-0.3.11/（含旧入口失败、修复后通过的回放及已安装扩展只读哈希）。PR #142 合并至 952ce6c9c434d43efb27b277760985c712ee8f67，v0.3.11 固定该提交；合并树和已通过 CI 的候选树完全一致。GitHub 主线 push CI 延迟出现，最终运行37447847732的release-check / desktop-verify均成功；此前等待时的未出现观察和精确树一致性证据保存在main-checks-observed.json / ci-source-equivalence.json，最终结果以该主线运行成功为准。2026-10-06 已公开为 [稳定 Latest](https://github.com/love70805/lworkstation/releases/tag/v0.3.11)：四资产匿名完整下载、大小/SHA256/服务端 digest 回读，latest.yml SHA512 和文件名/大小一致性通过；8.0.31 独立扩展 ZIP 公共下载哈希通过。稳定0.2.19、0.3.0–0.3.10检测到0.3.11，0.3.11为current，RC维持禁用；未调用下载或安装。旧Beta限制沿用0.3.10记录，不扩大范围。本机不安装，真实账号现场采集未复验。v0.3.9 / v0.3.10 标签及资产不覆盖。

公开资产为 Lworkstation-Setup-0.3.11.exe、同名 blockmap、latest.yml、SHA256.txt。发布回执分别为 archive/release-0.3.11/anonymous-verification.json、public-update-channels.json、public-extension.json。旧版本标签和资产不覆盖。
