# 0.3.10 ERP 查询变化后重新采集

> 2026-10-06：本版本 GitHub Release 及附件已按用户授权撤回，标签和提交历史保留。以下为当时交付记录；旧发布附件链接已失效。元数据、正文及资产哈希见 [清理归档](integration/ERP_RELEASE_CLEANUP_2026_10.md)。

基于 933ca99，修复提交 e0ab631。ERP Assistant 8.0.30 的重新核算在已有任务时明确确认，按当前查询从零重读并创建新投递身份；旧待送达载荷保留，继续原任务仍严格检查查询与绑定。兼容保留 8.0.29 有效检查点，拒绝旧写入和过期的重采集请求。

四组扩展定向回归、生产按钮确认/取消路径与旧检查点升级兼容检查通过。桌面 verify 全部通过；前端 161 文件 / 1270 测试及生产构建通过。实际候选隐藏启动 smoke 通过（visibleWindowCount=0）；554 个安装文件与 unpacked、507 项生产输入与源码/构建资源逐字节一致。安装包 SHA256：C1D8C4336E3C7F8E904A64CFE6344E7C899E35F904C90CA4903F5555F571D0D3（117938726 字节）。PR #140 已合并为 68cf49dc31cc8c5bf6d5c8fd020b15bec4bef2c1；最终 PR CI 37444358158 与 main CI 37444694147 两项均成功。v0.3.10 固定该合并提交，候选源码与合并树一致，未重建安装包。2026-10-06 已公开为 [稳定 Latest](https://github.com/love70805/lworkstation/releases/tag/v0.3.10)：四资产上传后服务端大小/digest 校验及匿名完整下载 SHA256 回读通过，latest.yml 的 SHA512/大小/文件名一致，独立 8.0.30 扩展 ZIP 公共下载哈希一致。稳定 0.2.19、0.3.0–0.3.9 均检测到 0.3.10，0.3.10 为 current，RC 保持禁用；没有 updater 下载或安装调用。旧 Beta 探测返回“更新源没有同通道版本”，不声明 Beta 通道通过，本次未修改 Beta 发布或扩展该范围。

本轮仅包含检查点恢复修复及发布版本/扩展下载适配；不新增数据迁移，不更改人工成本与定稿口径。0.3.9 既有导入、筛选、中文布局及真实台账只读验收证据复用；不重复真实采集页面操作。未取得现场具体变化字段，隔离采集回放不代表真实账号验收。用户已于 2026-10-06 授权快速稳定发布，解除故障暂停；v0.3.9 标签及 draft 保留，旧 STOP_PUBLICATION 不启动或解除其旧 finalizer。新版本发布后不自动安装本机。

公开资产：Lworkstation-Setup-0.3.10.exe、同名 blockmap、latest.yml、SHA256.txt。资产回读及实际 provider 记录分别保存在 archive/release-0.3.10/anonymous-verification.json、public-update-channels.json、public-extension.json。v0.3.9 标签 933ca99 与四 draft 资产保持原样。代码交付及公开发布完成，本机安装仍未执行。
