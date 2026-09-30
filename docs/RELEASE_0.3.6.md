# 0.3.6 发布与验收记录

## 发布内容

- 台账多文件自动识别明细页、全商品校验、正常一次导入；完整北京时间、后台计算与可取消的整批原子写入。
- ERP Assistant 8.0.27按完整已登记SKC采集，取消10页/500单限制，已完成目标与有效分页可在同请求中续用；正式成本与可选资料分阶段。
- 最新正常售价、来源店独立月末七天标签、旧来源显式确认；未售规格与明确引流规格可排除和恢复，人工字段保持优先。
- 首页月总览/十店对比、3/6/12月范围、三层明细、五行分页和全范围搜索，返回保留上下文。

[实施契约与实测限制](integration/RELEASE_0_3_6_IMPLEMENTATION.md)。不改变财务精度、正式成本优先级或定稿保护；本机不安装，不修改真实数据。

## 交付状态

已公开为[稳定 Latest v0.3.6](https://github.com/love70805/lworkstation/releases/tag/v0.3.6)，发布时间 2026-09-30T11:38:01Z。生产源码f460945经[PR #133](https://github.com/love70805/lworkstation/pull/133)受保护合并，标签固定主线 `6cab4e8ae6bec46e2eb71ebe4a04c28a25ce034f`；[最终PR CI](https://github.com/love70805/lworkstation/actions/runs/36708389133)与[主线CI](https://github.com/love70805/lworkstation/actions/runs/36708696572)通过。候选验收、合并、公开资产回读已分别完成。`candidateOnly:true`仅用于候选路径，不表示未公开。

## 候选验收（2026-09-30）

- 生产基线 `f460945`，154个测试文件/1176项通过，前端完整release:check通过；本地16组desktop verify与前后端低级别审计零告警。
- PR #133最终远端release-check、desktop-verify及合并后main CI通过；分支保护未变。
- Windows候选117489334字节，EXE SHA256 `D009CBD7E64BC4F5DA3819D8E4416C8CC80C24336E8B2A7E3CA42842ABADDB85`。候选安装器解出516文件与win-unpacked逐一相同，469生产输入（asar/extraResources）与源码/构建资源一致；无台账样本、数据库或本机验收脚本。
- 隐藏实际EXE smoke通过：0.3.6、ERP8.0.27、hiddenMode=true、visibleWindowCount=0，实际收件与更新夹具路径通过；未安装。
- ERP可选资料真实60秒期限补验通过：正式成本16ms完成，可选资料60021ms结束，不拖死成本阶段。完整目标与续取另有生产代码合成回放，未把其声称为真实账号采集。
- 四公开资产由同候选原件复制，公开EXE名规范化为 `Lworkstation-Setup-0.3.6.exe`，内容未重建。blockmap SHA256 `C990CF5941109A41BC3C93F21E02A773BAC7FB3CF91FA13C74C221985DDDED5E`，latest.yml `42D524AE1474DA4C124D332681B03624C5ED0DD5B3331EBD7D28B3FC386D34BA`，SHA256.txt `745D506B55C7540D153EDE07A50AEE97B56093AFEB7F23C3762C8F14FCDE643B`。

- 首轮包内UI发现完成页月份被释放源文件的effect清空；`f460945`修复并补自动识别月份成功回归，1176测试再次通过。首候选AF2834…归档，未上传。新候选通过严格包内用户路径：两份多sheet一次导入34行/2批/306件/4590元，重复无新增，关闭浏览器进程并重开保持；月总览→两店→每店17商品、5行分页、第17条缺SKC可搜索且合计保持。应用主题按钮切换800浅色/320深色三层及月账本，无横溢出、pageerror或外网请求；浏览器为headless Microsoft Edge，资源仅来自候选resources/frontend，无dev源码导入。

## 公开回读与保全

- 非草稿、非预发布的GitHub Latest0.3.6；四资产匿名完整下载，大小、SHA256、API digest、元数据SHA512与校验清单一致。使用本机已有loopback代理进行独立请求，未修改系统网络配置。
- 生产AppUpdater/ChannelGitHubProvider经真实匿名HTTP验证：0.2.19及0.3.0–0.3.5发现0.3.6；当前0.3.6不重复升级；Beta仍0.3.0-beta.10，RC禁用。无更新器下载安装调用。
- ERP8.0.23–8.0.27从v0.3.6公开标签匿名下载并与原件一致；旧0.3.0–0.3.5原标签及资产摘要保持。
- 主目录 `releases/candidates/0.3.6/` 保留候选，`public/`保存匿名公开原件；`archive/release-0.3.6/`保留源码ZIP、CI、哈希与验收证据，持久复制后逐项回读。首候选仅在任务归档保留，不作为公开包。

没有覆盖安装、本机真实库或已定稿报告改写。现场ERP新采集与云端整店替换投影仍未验收，具体限制见实施记录。
