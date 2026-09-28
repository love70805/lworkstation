# 0.3.0 正式发布与验收

2026-09-28：用户在候选验收后明确“发布吧”，已将同一候选公开为 [GitHub 0.3.0 稳定版 Latest](https://github.com/love70805/lworkstation/releases/tag/v0.3.0)。发布时间为2026-09-28 18:02:47（UTC+8），draft=false、prerelease=false；未重新构建、未安装、未改真实业务库，保留聊天与工作树。

标签 `v0.3.0` 指向 `9e332a4673e98a0ed14c20c62cef0479bc3376e3`，发布前主线 [CI 36405863304](https://github.com/love70805/lworkstation/actions/runs/36405863304)通过。该提交经PR #120补齐候选文档，软件目录与构建提交f2811dd完全一致。

## 公开资产

四个资产均已匿名完整下载，文件长度、SHA256与上传前副本及GitHub资产digest逐一一致。EXE、blockmap和latest.yml均保持候选原字节；公开文件名统一连字符，SHA256.txt仅同步实际下载文件名。

| 公开文件 | 字节 | SHA256 |
| --- | ---: | --- |
| Lworkstation-Setup-0.3.0.exe | 116980840 | `60F71121A4F709915FF87930367F880A9BF69C990645D2B4F8D00A72B622668A` |
| Lworkstation-Setup-0.3.0.exe.blockmap | 123027 | `CA48471A84C13C1AA2698614D92C98499CFF750C9F313D1183698FF2ECA6207D` |
| latest.yml | 353 | `1AE848335DFF974D9A394A7DB222D4BC755E28CFF1B78655D3211AB806F6FB9F` |
| SHA256.txt | 276 | `43CD0E3D6A26BF55DC9B3621C20BABCACC20B87AD8FCEAD3F447EC067BFA5836` |

`latest.yml`的path/files.url均为公开EXE名，size为116980840，SHA512为 `ZpWF+d9l3SacI/SRIHLfEvK6qqmrGHTTP6FwR/ayWynN4CysbgS/5mEMQilzjXbdHiq0vxbiJSEogl2+b4TCfg==`，与匿名下载的EXE一致；同名blockmap已单独下载核对。

公开上传副本持久目录：`C:/Users/Administrator/Desktop/Lworkstation/releases/candidates/0.3.0-public/`。发布说明、GitHub公开响应、匿名下载原件及校验、实际生产更新provider联网结果保存在 `C:/Users/Administrator/Desktop/Lworkstation/archive/release-0.3.0-public/`；原候选目录与准备阶段证据继续保留。

## 公开更新通道实测

使用已安装的electron-updater及生产AppUpdater、ChannelGitHubProvider和update-runtime，HTTP执行器访问真实公开端点，不使用fixture或认证令牌。仅检查发现结果和下载URL，不调用安装器或应用更新下载。

| 当前版本 | 真实检查结果 |
| --- | --- |
| 0.2.19稳定版 | available，目标0.3.0，解析到本次公开EXE URL |
| 0.3.0稳定版 | current，无更高版本 |
| 0.3.0-beta.9 | available，目标0.3.0-beta.10 |
| 0.3.0-beta.10 | current，不转入稳定版 |
| 0.3.0-rc.1 / rc.2 | disabled，无网络请求，不会自动发现正式版 |

全部场景autoDownload=false、autoInstallOnAppQuit=false，应用下载及安装调用均为0。Beta转正式版、RC转正式版需用户手工下载并运行正式安装包；本次未代用户执行安装或覆盖升级。原RC安装包缺失，RC结果是生产更新运行时在对应版本配置下的检查，不能视为原RC二进制重测。证据为`public-update-channels.json`及`verify-public.mjs`。

## 源码与范围

恢复RC.2源码提交 `d758375`；导入导出与正式候选准备 `c26a748`；稳定安装包命名校验 `f2811dd2218183388aa695915b7502d42775fb96`。软件由后者构建，[PR #119](https://github.com/love70805/lworkstation/pull/119)合入 `8c49f76c2cc661e4a2ed0a9a490d7b6f3dd21d53`，两个提交文件树一致。

保留ERP助手8.0.23的商品档案预填及本机默认成员下的自动采用恢复。新增登记人完整匹配代发、供方货号扣款归集、连续行标识来源、合法等额分摊与跨文件核对。新/旧报告下载均为10列利润模板和两位向零截断金额，旧存档及内部精度不变。详见[导入导出契约](integration/STABLE_0_3_0_SUPPLEMENT_EXPORT.md)。

## 候选与持久位置

四资产已从54cb工作树复制至主仓库持久目录，逐文件回读哈希一致，目标此前不存在，未覆盖旧候选：

`C:/Users/Administrator/Desktop/Lworkstation/releases/candidates/0.3.0/`

| 文件 | SHA256 |
| --- | --- |
| Lworkstation Setup 0.3.0.exe | `60F71121A4F709915FF87930367F880A9BF69C990645D2B4F8D00A72B622668A` |
| Lworkstation Setup 0.3.0.exe.blockmap | `CA48471A84C13C1AA2698614D92C98499CFF750C9F313D1183698FF2ECA6207D` |
| latest.yml | `1AE848335DFF974D9A394A7DB222D4BC755E28CFF1B78655D3211AB806F6FB9F` |

EXE 116,980,840字节，未数字签名；另有SHA256.txt。latest.yml的版本、SHA512及size核对通过，Builder URL使用既有连字符规范化名称。`candidateOnly:true`只整理到candidates，不写releases/latest，不公开上传。包内使用既有稳定更新配置，原应用身份不变。

源码ZIP、889文件源码清单、构建/验收日志、合成报表和截图持久保存在：

`C:/Users/Administrator/Desktop/Lworkstation/archive/release-0.3.0-preparation/`

`source-8c49f76.zip`对应已合入软件文件树；`source-manifest.json`记录源码哈希，`durable-copy-check.json`记录39项初次复制回读。验收归档不包含真实业务明细和原生真实库。原RC.1/RC.2忽略资产未在应用自动归档快照中保留，本次仍未寻获；原RC文档中的哈希仅是历史交付记录，不代表当前原件可用。

## 验证及实际边界

| 验证 | 结果 |
| --- | --- |
| PR及main CI | [主线运行36404949538](https://github.com/love70805/lworkstation/actions/runs/36404949538)通过：142文件/984前端测试、完整release:check、前后端依赖审计及16组桌面检查 |
| Headless Edge合成业务 | 实际生产组件导入CSV→姓名选择→预览→采用→未扣款下载→扣款等额分摊→财务下载→关闭重开通过；浅深色1440/980/390布局通过；无pageerror。使用隔离浏览器库，不是原生真实业务库 |
| Windows实际EXE | 隔离userData下hidden packaged smoke通过，version0.3.0、ERP助手与loopback收件、桌面工作区、更新测试通过；visibleWindowCount=0、安装调用0。未宣称托盘/焦点等可见窗口检查通过 |
| 安装包与已测程序 | 7-Zip只读解包，461文件与已测win-unpacked哈希一致；413项桌面源码、前端生产资源和扩展/收件资源与构建输入一致 |
| XLSX读回与布局 | 标识符文本及21位前导零完整；金额为numeric、0.00且向零截断；汇总先完整精度相加。表头居中，小计与商品总计分开。Artifact渲染器会把纯数字文本转数值，渲染副本用文字前缀恢复标识，截图可见前缀不在原XLSX中；标识正确性以原XLSX读回为准 |
| 用户文件只读 | CSV哈希未变；第二份全部6个姓名可完整解析。第一份21个订单数量空缺，按来源行提示核对。扣款89表保留84有效表、84,324行，20,001条同业务键多行被保留；“全部记录”诊断另发现1条缺金额/货号行，不当作零。未向真实库导入 |

首次正式构建在末尾命名校验遇到空格/连字符差异，已修复并重新构建，失败日志保留。上述隐藏EXE smoke与浏览器业务流程是不同验证层，通过包内生产资源哈希关联；未声称在实际EXE中逐一重跑全部业务页面，也未进行真实ERP账号重采。

公开发布结果以本文顶部记录为准；下方所引用RC及候选阶段的暂停/未发布说明保留为历史阶段记录。本次未进行真实ERP账号重采或真实业务库升级验收。
