# Lworkstation 0.2.15

状态：2026-09-14 已公开 GitHub Latest；四资产匿名回读及稳定通道验证通过，本机未安装。

- 修复代发件数等弹窗输入一位就跳焦关闭按钮，支持连续输入与小数，保留 Escape / 忙碌保护及关闭恢复焦点。
- 利润视图按钮相邻，重复店铺筛选收敛，核算说明默认折叠，减少顶部留白。
- 每日商品明细固定高度内滚动、表头固定，保留分页和全部数据访问，不再拉长整页。
- 复用利润快照与每日销售来源，点击日期不重复读取整月数据，跳过趋势不需要的整月单价/活动统计。

沿用本机 v15，无新增数据库迁移，销售、利润、人工更正、定稿保护及稳定/Beta通道口径不变。

详见任务看板，证据 `archive/update-0.2.15/` 与 `archive/release-0.2.15/`；候选目录 `releases/candidates/0.2.15-profit-usability/`。实际公开回读后更新发布状态。

## 验收与公开发布

- 实现 `a075e53`（Modal）和 `f363c6c`（布局/读取）经审查集成；构建基线 `b83bda82877ca93b91fd3e75499c6cc6dffb810b`，PR #68 合并与标签 `v0.2.15` 为 `b7e2aa0db15614ae2557e61986d31bb747b2dd15`，生产文件无差异。
- 101 文件 / 649 项测试、完整 frontend release:check、desktop verify、desktop release:check、packaged smoke 均通过；PR CI `34795969945`、main CI `34796138621` 通过。
- 实际 Windows 候选逐字输入 `11111.25`，每次键入焦点保持，关闭恢复“登记代发”按钮；首页/利润、全部/单店、精确合计、SKC/活动、导入一次确认、主题、托盘和第二实例唤起通过。334 个打包资源及更新配置/收件代码与源构建相同。
- 独立 Edge 10 万行合成数据重验：每日趋势聚合约 769ms → 345ms，利润页就绪约 4.6s，已加载利润页的日期明细约 178ms；首页含导航/初次读取到明细约 5.4s。仅本机合成场景，非真实账本性能承诺。两入口 × 浅深色 × 1280/1024/390 共12组限高/分页/无横向溢出通过。初轮工作树字体路径被开发服务器拦截，改用同基线主目录服务器完整重验，未修改产品文件。
- [GitHub v0.2.15](https://github.com/love70805/lworkstation/releases/tag/v0.2.15) 于 2026-09-14 09:32:37（UTC+8）公开 Latest；安装包 116,544,912 字节，SHA-256 `7277B553D2E9C33382E4C06B8AA5A387F30755C1F7B38E26997ADDC653E99047`。
- installer / blockmap / latest.yml / SHA256.txt 全部匿名完整下载并核对哈希，使用原候选字节。0.2.14 稳定通道发现新版，0.2.15 不重复提示，无自动下载或退出安装。
- Beta 验收限制：旧 0.2.6-beta.7 已不在 GitHub 最近发布 Atom 列表内，当前返回“更新源没有同通道版本”；未访问稳定元数据、未选择稳定包。记录为明确错误而非正常检查成功，本轮未修改旧 Beta 或发布新 Beta。
- `releases/latest/` 更新为 0.2.15，旧 0.2.14 归档且原哈希核验一致。真实数据、本机安装不变，无数据库迁移。使用隔离合成数据，未运行安装器、真实更新替换或真实 ERP 采集。
- 证据：`archive/update-0.2.15/browser-result.json`；`archive/release-0.2.15/` 下的构建/QA/检查日志、qa/result.json、packaged-resources.json、upload-manifest.json、public-readback.json、channel-verification.json 和 CI 记录。
