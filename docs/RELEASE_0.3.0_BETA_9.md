# 0.3.0-beta.9 · 成本行、台账身份、ERP 小灯与利润导出

状态（2026-09-27）：Windows 候选、PR / main CI、公开 Beta 发布、四资产匿名回读与真实更新通道检查完成。本机未安装，未改写真实业务数据。稳定 Latest 保持 0.2.19。

## 本次变化

- 成本核对按共同 SKU / 店铺行对齐。正常成本先查看紧凑详情，人工更正由明确操作进入；零值、撤销、ERP 自动采用和定稿保护保持。
- 成本与利润参考从同工作区有效台账只读补充缺失的显式 SKC / 属性。人工档案优先，冲突列出来源，不把仓库 SKU 或供方回退标识当成 SKC，不回填真实库。
- 桌面现有左上角小灯自动展示真实 ERP 助手握手与登录状态。常态仅小灯，悬停 / 聚焦一行说明，点击紧凑恢复详情；首次真实就绪提示一次，失效撤绿。成本页重复桌面检查入口移除，浏览器安装保留。助手版本 8.0.22。
- 新未扣款 / 财务对账 Excel 不再生成“核算采购”工作表。汇总与店铺每行只显示实际核算采购按原顺序首个有效单号，同笔优先 1688 号，否则采购单号 / ID；空号留空，文本保留前导零和长号。三笔加权成本、完整内部证据和金额不变，已有定稿文件不重写。模板更新为 `profit-zebra@3-single-order`，公式版本不变。

契约与原表只读核验见 [Beta.9 集成说明](integration/BETA_9_REFERENCE_AND_STARTUP.md)。

## 已完成验收

- 前端 135 文件 / 920 测试、生产构建、桌面 verify 全套、ERP 收件协议、同步 / 数据库 / 部署契约通过。
- 隔离 headless Edge 完成 12 组浅深色 / 1024–1440 窗口 / 125% 缩放成本行检查；验证详情键盘入口、真实零值与撤销、锁定只读、触控目标、台账身份分组及来源展开对齐。11 条采购自动采用 4.5900 元，Beta.7 旧证据行只读恢复保持。
- 隐藏真实 Electron 主进程、MV3 扩展加载、MAIN 页面状态与管理收件链路在隔离 ERP HTML / API 中通过冷启动、留在工作台就绪、一次提示、过期与收件重启撤绿恢复、登录 401 和键盘详情。浅深色 / 980–1440 小灯及详情视觉由独立 headless Edge 加载实际资源验证；隐藏 Electron 截图缺帧，不作为视觉通过依据。未验证真实账号登录或可见窗口焦点。
- 两种合成 XLSX 由 openpyxl 只读回验：无采购工作表、汇总与店铺单号一致、文本格式、前导零 / 长号 / 内部斜线和空号保持。金额、采购证据与旧定稿文件兼容测试通过。

原始验收目录：`archive/beta9/`、`archive/beta9-ui/`、`archive/beta9-erp-startup/`、`archive/beta9-report-export/`。其中原表只保留读取摘要与哈希，不保存业务 Excel 或数据库。

## 候选、集成与发布

Windows 候选构建提交 `1401c8444672ee8f441ceb046f9867a844283d76`；[PR #113](https://github.com/love70805/lworkstation/pull/113) 合并提交 `67b8b06223eed4e2c17d317bc963227eb227613e`，标签 `v0.3.0-beta.9` 指向该合并提交。构建后唯一差异是未打包的 `desktop/verify.mjs` 中旧 smoke 尺寸断言，所有安装包输入内容保持相同。PR 两项必需检查及 [main CI](https://github.com/love70805/lworkstation/actions/runs/36314439438) 均通过；Windows packaged smoke、`release:organize` 与 `release:check` 通过。

候选位于 `releases/candidates/0.3.0-beta.9-cost-identity-status-export/`，公开源位于 `releases/prerelease/0.3.0-beta.9/`。[GitHub Beta.9](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.9) 为公开预发布，GitHub Latest 仍为 `v0.2.19`。四项已从匿名公开地址逐项回读，并与候选哈希一致：

| 资产 | SHA-256 |
| --- | --- |
| `Lworkstation-Setup-0.3.0-beta.9.exe` | `D4014821A686CE9AD9ED97D1035404715CA6C8C993EEB6B2FEDC364102DFE71C` |
| `Lworkstation-Setup-0.3.0-beta.9.exe.blockmap` | `7C1EB4A3B0F4F92A8798F6A52CF3326E07AFC72908700493063C632DEAE13832` |
| `beta.yml` | `9FD1A4AE369A654BD2B8353662049AC2B12B1A994AF6681B8EF83A0049BB09EE` |
| `SHA256.txt` | `54F5895C2A76ADE6816F7F822924B414EDBE00CB211A4640515A3306D685486E` |

真实 GitHub 更新提供方：Beta.8 发现 Beta.9，Beta.9 为当前版本，稳定版 0.2.19 只读取 `latest.yml`；无更新下载或安装。

执行交接将验收脚本、截图、日志、公开回读文件、候选四资产及哈希清单保存在 `C:/Users/Administrator/Desktop/Lworkstation/archive/beta9-execution-closeout-20260927/`，以 `MANIFEST.json` 逐项回读校验。业务 Excel、数据库、凭据及临时 profile 不归档。本执行聊天交接后归档，不承接下一版本。
