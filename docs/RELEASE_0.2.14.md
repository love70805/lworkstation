# Lworkstation 0.2.14

状态：2026-09-14 已公开为 GitHub Latest，四资产匿名回读与更新通道验证通过；本机未安装。

## 更新内容

- 每日销售的商品明细显示平台 SKC，保留店铺和属性，支持按 SKC 搜索；缺失时明确显示待补充。
- 活动详情只保留简短名称，同一活动的不同客单时间记录合并显示，去掉冗长时间、价格和来源行号。
- 首页与利润核算页面同步生效；销量、销售额、均价及原有店铺 / SKU 属性明细口径不变。

沿用本机数据库 v15，不追加迁移，不改变真实业务数据、人工更正和利润定稿规则。原始活动证据保留。

## 验收记录

实现提交 `f34c53b`。100 个测试文件 / 643 项测试和前端生产构建通过；独立 Edge 合成数据验证首页与利润页浅深色 × 1280 / 1024 / 390 共 12 组布局、SKC 显示搜索与活动简写去重。证据 `archive/daily-details-skc/`。

本版本同时同步已获用户批准的项目工作规则精简，不改变软件运行权限。候选目录 `releases/candidates/0.2.14-daily-details/`，发布证据 `archive/release-0.2.14/`。只有公开资产上传并回读后才标记已发布。

## Windows 候选与公开发布

- 构建基线 `c6d3313be299f97ab76b6eaf7a756b90295a4beb`；[PR #65](https://github.com/love70805/lworkstation/pull/65) 合并和标签 `v0.2.14` 指向 `86913eefb910df77be7b9584562924a256db6b55`。两者生产文件无差异，发布使用已验收原候选字节。
- 完整 frontend release:check、desktop verify、desktop release:check 和 packaged smoke 通过。PR CI `34782946085`、main CI `34783135026` 均通过。
- 实际 Windows 隔离候选确认版本和 packaged 状态；首页 / 利润页、全部 / 单店 SKC 和活动简写、精确合计、单次确认导入、主题一致、关闭托盘和第二实例唤起通过。334 个打包资源及更新配置、ERP 收件代码与源构建哈希一致。
- [GitHub v0.2.14](https://github.com/love70805/lworkstation/releases/tag/v0.2.14) 于 2026-09-14 05:14:16（UTC+8）公开为最新稳定版，非草稿、非预发布。
- 安装包 `Lworkstation-Setup-0.2.14.exe`，116,544,500 字节，SHA-256 `3BBC5BD786CBE8597B381F60B497236DACDC08FC96E6644F9752563B1DAE46F0`。
- installer、blockmap、latest.yml、SHA256.txt 四资产匿名完整下载与清单一致。生产更新 provider/runtime 通过真实 GitHub 请求确认：0.2.13 发现 0.2.14，0.2.14 不重复提示，Beta 不选择稳定版；没有自动下载或退出安装。
- 本机 `releases/latest/` 更新为 0.2.14，0.2.13 归档到 `releases/history/0.2.13/` 并核验旧哈希，旧候选保留。
- 验收边界：使用隔离 profile 和合成数据，实际按钮鼠标事件，选择 / 输入使用 DOM 事件。未执行安装器、真实更新替换、真实 ERP 登录采集或业务数据变更。本次显示修补不重复写入系统剪贴板。
- 原始证据 `archive/release-0.2.14/`：构建 / 检查日志、qa/result.json 和截图、packaged-resources.json、upload-manifest.json、public-readback.json、channel-verification.json 及 CI 记录。
