# 0.2.12 完整月度核算与桌面体验

状态：2026-09-13 07:55:42（UTC+8）已公开为 [GitHub Latest稳定版](https://github.com/love70805/lworkstation/releases/tag/v0.2.12)。完整操作、打包运行、更新下载、主分支CI及四项公开资产匿名回读通过；本机按用户要求未安装。完整范围及逐项验收见 [实施合同](integration/FULL_UPDATE_CONTRACT.md)、[验收清单](integration/FULL_UPDATE_ACCEPTANCE.md)。

## 版本内容

- 优化日夜主题切换，增加启动反馈、系统托盘及关闭窗口进入托盘；后台ERP收件继续运行，可明确退出。
- 保留经营概览，首页增加月度账本入口和每日销售趋势。利润页融合成本核对，支持全部SKC/SKU、销售单价范围和已有活动信息。
- 导入代发与独立扣款，按姓名或供方货号选取来源。先扣全部销售件数的仓储成本，全月代发金额只加一次，独立扣款按实际店铺归集。
- 分别生成未扣款与财务对账Excel，采用左右布局、浅色斑马纹和红色扣款金额。未扣款报告保存后冻结基础；后补扣款沿用同一明细，主动重开产生新修订，历史文件保留。
- 追加本机v15四张报告/补充数据表并适配完整备份恢复；旧数据不重算。人工更正优先、撤销、真实零和微小成本规则保留，金额精确累计后最终向零截断。

## 已完成的集成检查

- 桌面体验9174805、利润分析f33a390、首页8c07dec/a957992、ERP用户链路b488a33、利润报告59beb33已由主线审查并承接。
- 59beb33组合基线：主线frontend release:check通过，包含96文件612项测试、生产构建、ERP bridge/inbox及本机合同门禁；desktop verify全部12组通过。日志位于archive/full-update-regression-2026-09-13/。
- ERP隔离用户链路通过自动登记、非空草稿收件、复制解析、整个进程关闭后恢复证据与发布；只用合成ERP数据，不声称已覆盖用户真实ERP登录采集。
- 专职报告30项合成文件/截图/JSON证据已逐项哈希归档至archive/profit-frozen-reports-2026-09-13/specialist/。最终源码外壳报表操作及24项证据通过，主线独立读取四份实际下载验证金额、文本长单号、动态页签及旧文件字节不变。
- 4b08da3主工作区构建0.2.12，packaged smoke及资产检查通过；实际NsisUpdater下载116540543字节并验证哈希，未触发安装。新隔离更新夹具的取消/重试/稍后安装/退出检查通过。
- 15c9b75候选测试由主线独立复跑：实际shopeers://workstation打包前端完成CSV本人选取、未扣款冻结、正负扣款财务、重开r2和旧r1原字节重下载。关窗入托盘、第二实例唤回原窗口、主题内外一致及quit偏好重启退出通过。9项主线证据存于archive/packaged-report-ui-0.2.12-2026-09-13/main-integration；EXE/asar测试前后哈希不变。

## GitHub集成与公开回读

- PR #57承接完整实现，#59对齐main历史合并关系（文件树不变），#58合入main。发布标签v0.2.12指向6cd8b1beacd28855d448d750cfef784fb9e958d4；主分支CI运行34726603785两项通过。与候选构建4b08da3相比仅测试和文档变化，生产文件一致。
- 四资产公开匿名下载回读通过，文件名、大小和SHA256与上传暂存一致；SHA256.txt使用公开的连字符文件名，可直接核验。证据见archive/full-update-regression-2026-09-13/public-readback.json。
- 实际GitHub更新provider：0.2.11/latest发现0.2.12；0.2.12/latest为最新；0.2.12-beta.1只读取Beta源，不接收稳定包。证据live-provider.json；不触发安装。

| 公开资产 | 字节 | SHA256 |
| --- | ---: | --- |
| Lworkstation-Setup-0.2.12.exe | 116540543 | 55E54E5583C05238681F43C9308952D391918050E8B575F1B3E09AF9620CB717 |
| Lworkstation-Setup-0.2.12.exe.blockmap | 122409 | 0F939190EB7B74D267710A4E8C9A547CA6A5FFE2879DE340E5B8C2653A8F3B6B |
| latest.yml | 356 | 49CB74F08E23D34AC0F34239EBF2E8EB85EEC335EE29A60B1DF96848EFC0FBB9 |
| SHA256.txt | 281 | F314CA59A12B12D5BDA9AFEA9D4BF44A1E3D1DD5DD98316810CDEB7202C5595F |

## 候选记录

- 本机目录：releases/candidates/0.2.12-complete-local-update/。
- 安装包：Lworkstation Setup 0.2.12.exe，116540543字节。
- SHA256：55E54E5583C05238681F43C9308952D391918050E8B575F1B3E09AF9620CB717。
- 候选、blockmap、latest.yml及SHA256.txt已逐一复制校验。releases/latest为该公开稳定构建；本机候选安装包名称带空格，公开资产使用连字符，二者安装包字节一致。

## 交付边界

纯本机版本，不新增或执行云SQL，不安装到本机现有应用。候选完成、代码合并和公开发布已分别登记，公开资产回读成功后更新为已发布。真实ERP登录采集现场未操作；系统结束为事件模拟，未关闭Windows；主题压力测试未做旧版同机性能对照，不承诺固定帧率。
