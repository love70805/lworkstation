# Lworkstation 0.2.6 发布验收

状态：用户于 2026-09-08 授权打包发布；发布准备中，尚未标记公开发布。

## 范围

- 以集成分支为正式构建源，发布版本 0.2.6；不使用独立应用身份的旧 Security QA 包。
- 纳入安全修复、已验证依赖升级、Lworkstation 对外名称统一、同月多店铺批量台账导入。
- 保留 shopeers-desktop、com.shopeers.workstation、协议、数据库与会话分区等兼容身份。
- 稳定更新通道保持关闭；本轮作为手工下载安装的稳定版发布，不宣称 beta 软件内升级到稳定版已验收。
- 保留现有历史 Beta Release 和资产，不覆盖同名已发布安装包。

## 发布门禁

- [x] 业务代码已合入集成分支与 main；主线 77 文件 / 532 测试、生产构建、桌面 verify、真实合成台账浏览器验收以及合并后 CI 通过。
- [x] release-plan 增加本次四组功能必需提交，避免从旧代码构建。
- [ ] 从集成主 Worktree 构建 Windows NSIS 安装包。
- [ ] packaged smoke 与包内版本、身份、更新配置、前端和扩展资源检查。
- [ ] release:organize、release:check、SHA-256 清单。
- [ ] GitHub Release 上传、文件名/大小/哈希回读，确认稳定版及 latest 状态。
- [ ] 更新 README、发布清单、RELEASE_STATUS 和本记录的实际产物数据。

## 验收边界

本次自动化验收使用隔离目录和合成数据。真实 ERP/1688 账号操作与真实业务账本仍需用户环境验证；不以合成 smoke 冒充真实账号或线上升级验收。Windows 代码签名尚未配置，安装时可能显示未知发布者。
