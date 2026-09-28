# 0.3.0-rc.1 本机测试候选

2026-09-28。状态：本机Windows候选制作与验收完成，未公开发布、未安装。用户要求“制作0.3.0rc版本测试包”，正式及RC公开发布和真实数据改写继续暂停。

基线 `ed73899ab6b0964e6545cb2fa6694a5325e868ee`，分支 `codex/release-0-3-0-stable`，现有54cb工作区。保留本轮未提交ERP商品档案预填、原生采购详情字段及8.0.23扩展；版本统一 `0.3.0-rc.1`。本地已知候选/暂存目录、远端标签与Release未发现同版本占用。

RC无公共升级通道，包内更新禁用。构建始终 `--publish never`，候选使用 `rc.yml` 和 `releases/candidates/0.3.0-rc.1/`；已发布稳定/Beta配置、用户偏好与安装身份保持原样。

已核对上一阶段105项证据/源码；99项保持一致，6项仅版本及文档调整，详见归档 `evidence-reuse.json`。业务代码未变的141文件/957测试与ERP桥接/收件、headless六组浅深色布局按逐项哈希复用。RC适配后的16组desktop verify、sync/seed/schema/deploy门禁、生产构建、Windows打包、packaged smoke、release:organize和release:check通过。

实际候选EXE使用生产资源与隔离合成数据库，14场景通过：ERP建档保存、关闭重开（两SKU/两仓库/四采购明细/零报价/正式成本一行5元）；三模板×两报告类型×当前/历史12份下载逐单元格读回；ERP纯颜色灯检查。下载和建档未改变财务记录。离线解包安装包的461个文件逐字节匹配已验收程序；另413项包内源文件/构建资源匹配，版本为0.3.0-rc.1，ERP扩展8.0.23，更新配置disabled/rc。

安装包：[Lworkstation-Setup-0.3.0-rc.1.exe](../releases/candidates/0.3.0-rc.1/Lworkstation-Setup-0.3.0-rc.1.exe)，116,977,953字节。SHA256：

`FB6FC705C3D14BDB96774AF32FEDADA922CD122A71558F685847B2A2D4C49047`

同目录含blockmap、rc.yml和SHA256.txt，rc.yml的size与两处SHA512匹配安装包；安装包无Authenticode数字签名。源码仍为基线之上的未提交改动，归档 `source-manifest.json`、`source-changes.patch` 和 `source-snapshot/` 保留逐文件SHA256、Git基线及完整受版本控制/未忽略源码快照，不含真实业务库或凭据。未创建PR、标签或Release，未推送，未触发远端发布CI；公开稳定/Beta状态未改。

验收失败与修复：早期QA脚本在Electron evaluate下载回调中调用不可用的require，引发原生主进程错误弹窗并超时；已仅结束本任务候选进程，保留真实安装工作台。改用注入参数与字符串路径后12次下载通过；复验同名文件引发interrupted，进一步改为每轮独立下载目录。均为测试脚本修改，产品源码和安装包未因此改变。最终受影响14场景补验退出0、stderr为空；Win32 EnumWindows/IsWindowVisible按候选PID的51次采样未发现可见原生窗口。不得将结果描述为整个验收过程从未弹窗。详见归档失败说明及 `native-window-audit.json`。

输出与证据分别位于 `releases/candidates/0.3.0-rc.1/`、`archive/release-0.3.0-rc.1/`。最终记录提供安装包绝对路径、SHA256、包内版本及可复现源码清单。

限制：更新后ERP扩展尚未连接真实账号重新采集。隐藏验收不代表原生窗口焦点、托盘恢复或更新浮窗可见性通过；本机不安装，不修改真实业务库。
