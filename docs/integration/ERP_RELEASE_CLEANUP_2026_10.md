# 已修复 ERP 故障版本的 GitHub Release 清理

2026-10-06 用户在决策端确认 v0.3.13 已修复 SKC 对象转 `[object Object]` 查询故障，并明确要求删除重复错误的 GitHub 版本。此次清理仅处理 v0.3.6、v0.3.7、v0.3.9（草稿）、v0.3.10、v0.3.11、v0.3.12 六个 Release 及 24 个附件；v0.4.0 功能另行安排。

删除前核对六项均非 Latest，归档完整发布元数据、正文、资产名/大小/SHA256 digest 与标签目标。公开发布元数据快照见 [归档](../archive/ERP_RELEASES_REMOVED_2026_10_06.json)，本机原始回执 archive/erp-release-cleanup-20261006/。此归档不包含安装包本体；本机已有候选、故障证据和备份保留。

删除仅调用 Release 删除，不使用 cleanup-tag。删除后六个发布 ID 均返回 404，六个标签目标与归档一致；其他 Release 列表保持，v0.3.13 仍为 Latest，其四资产 ID、大小和 digest 未变。

生产更新器按 Latest 读取 0.3.13 的元数据和安装包。旧 blockmap 是可选差分来源，缺失时 electron-updater 的 AppUpdater.differentialDownloadInstaller 返回完整下载回退，NsisUpdater 使用当前版本安装包；删除旧资产不阻断更新，但旧客户端可能改为完整下载。

清理后以实际生产 AppUpdater / ChannelGitHubProvider 进行只读网络检查：0.3.6、0.3.7、0.3.10、0.3.11、0.3.12 均发现 0.3.13，0.3.13 为 current；最新元数据 SHA256 与发布候选一致，公开 EXE HEAD 200 / 118329885 字节。未调用更新下载或安装。

本轮仅更新清理和用户确认记录，无软件代码、配置、数据库或定稿报告变更；不重跑业务回归、不启动桌面候选、不安装、不创建软件版本。历史发布记录保持当时事实，六项记录新增撤回说明，旧发布附件链接已失效，源码仍可通过保留标签追溯。
