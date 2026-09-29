# 0.3.1 发布与验收

2026-09-29，最终候选已验收并持久保全，软件已合入main，公开发布与资产回读尚待执行。基线main `1506dc0e166d180b7c2350133876c68e7baa6168`，分支`codex/release-0-3-1`。[业务与交互契约](integration/RELEASE_0_3_1_IMPORT_PLAN.md)。

数量空白的代发记录跳过核算并保存定位，真实0保留；负数、小数、非数值和扣款空金额仍明确报错。统一登记人搜索筛选、自动预览、一次导入；高级字段按需展开；已有来源与筛选新增量清楚分开，跨文件真实冲突就地处理。CSV表格记录行与物理行双定位，旧去重身份不变。

候选、源码和脱敏证据持久保存在主仓库`releases/candidates/0.3.1/`及`archive/release-0.3.1/`。未安装、未改真实库、真实CSV只读；0.3.0资产和标签保留。候选通过、PR合并与公开资产回读分别补记，未验收候选不发布。

## 实现验收

- 全量142文件/1004前端测试通过；前端生产构建、16组desktop verify通过。最终可访问名称小修已随headless真实控件路径补验，强制CI仍须通过。
- Headless Edge合成库实测筛选/自动预览/数量空白跳过/合法零/物理与记录行/同文件和已采用源去重/跨文件排除/追加与替换/实际导入/重开/报告定稿保护/扣款空金额拒绝/合法等额负扣款/导出和重开通过。浅深色1440/980/390布局无页面或弹窗溢出，减少动态效果，无pageerror。
- 第一份真实CSV只读：5181有效行、143758件、21条无数量跳过，7个匿名登记人；第二份1602行、9582件、无数量跳过0条，6个匿名登记人。有效行坐标/数量与旧解析逐行一致，所有登记人筛选与整体分组一致，原SHA256未变。物理288/289对应表格285/286，340/341对应337/338。
- 跳过ignored信息随来源批次持久化、重开和备份恢复通过。parser@2旧批次与定稿报告可读，无schema迁移。CSV物理sourceRow继续作为去重身份，recordRow只作展示。

证据：`source-readonly-audit.json`、`browser-qa.json`、六张布局截图和合成导出位于上述主仓库持久目录。真实姓名、订单或原CSV明细没有写入证据或提交。

## CI 审计补强

首轮PR CI的桌面审计发现[nodejs/undici GHSA-3wwx-pv8p-q78v](https://github.com/advisories/GHSA-3wwx-pv8p-q78v)。仅将构建链node-gyp的传递undici从6.28.0升为6.28.1，仍在父级`^6.25.0`范围内；锁文件变化仅包版本、官方npm完整性和依赖快照，未修改运行依赖、工作区配置或审计门禁。`pnpm --dir desktop install --frozen-lockfile`和`audit --audit-level=low`通过，重新构建候选并补验桌面与包体。首轮安装包未发布，最终候选以之后登记哈希为准。

## 最终候选与代码集成

导入修复 `bb384f0daf30e9e647be8f0c5ab68d23df8539b9`；构建依赖修复 `d2d0cc49c362940e516d10871f1bae5fd946748a`；候选构建提交 `3c2eaa570fe865674a315580b524616e2a798c03`。 [PR #122](https://github.com/love70805/lworkstation/pull/122)合入main `00a1a75aa1c2cc59ea5876b6c5a9c566604a22b1`，软件文件树与候选一致。PR [CI 36513542124](https://github.com/love70805/lworkstation/actions/runs/36513542124)全部通过，包含142文件/1004前端测试、完整release:check、前后端低级别依赖审计和16组桌面检查。主线CI仍须通过才公开发布。

最终稳定配置候选四资产已复制至主仓库 `C:/Users/Administrator/Desktop/Lworkstation/releases/candidates/0.3.1/` 并逐文件回读一致，不覆盖0.3.0。安装包116982552字节，未数字签名。

| 候选文件 | SHA256 |
| --- | --- |
| Lworkstation Setup 0.3.1.exe | `708F89A6369DA1501E86DA5A9E7D6284872C757D7947F70D3AD7249DA29663BA` |
| Lworkstation Setup 0.3.1.exe.blockmap | `B83D1701D8847854C5C10E97EA93BA1D07F6635B8879AF13727921B4E5FE6E0A` |
| latest.yml | `46088F2AE5B0B04E60C3A2F9FBE45DD0E39E6E695507AEA2763A86698BE1E011` |
| SHA256.txt | `189AB0EFA350B97D1F9814DA330A5E3A90C374DC10F62676497143E620289DE3` |

Windows实际EXE在隔离userData下隐藏smoke通过，version0.3.1、visibleWindowCount=0，ERP助手/loopback收件、桌面工作区和更新fixture正常；安装调用0。7-Zip只读解包的461文件与已测win-unpacked逐项哈希一致，414项桌面源码、生产前端、集成及收件资源与构建输入一致。latest.yml为0.3.1、仅引用同名公开规范EXE，SHA512/size与候选一致；release:organize及release:check通过。

891文件源码清单、`source-3c2eaa5.zip`、原始构建/桌面/CI日志、安装包与生产输入比对、脱敏真实源聚合、合成浏览器/导出证据均持久在主仓库 `C:/Users/Administrator/Desktop/Lworkstation/archive/release-0.3.1/`。`durable-copy-check.json`记录复制、源码及0.3.0原件未变。候选与证据无需依赖54cb工作区保留。

## 实际边界

浏览器业务路径使用生产组件及隔离IndexedDB，实际EXE用于隐藏宿主smoke，两层通过生产输入哈希关联；没有在EXE逐项重演全部业务页面。隐藏模式跳过托盘/焦点/原生弹窗可见行为，不声称这些场景已通过。本次未安装、未做真实ERP账号重采、未导入真实业务库；真实CSV只读且哈希未变。公开发布与稳定更新仅在回读后另行补记，0.3.0标签与公开资产保留。
