# 0.3.0-beta.10 · 已有报告下载与纯颜色 ERP 灯

状态（2026-09-28）：Windows候选、PR #115及main CI、公开预发布和四资产匿名回读全部通过。本机不安装，真实业务数据不变，稳定 Latest 保持0.2.19。

## 改动

已有报告的当前/历史下载也应用简化表格：只从原始存档OOXML派生副本，移除真正的采购证据页，每商品行保留首个有效核算单号。保留原报告金额、日期、hash、版本、定稿与数据库记录；不查询最新ERP。兼容三代模板、@1同名商品店铺、长号/前导零/单号内部斜线；@3单号不重复分割。下载名标注“简化”，历史按钮为“下载报告”。坏档/未知模板明确反馈。

ERP小灯只显示颜色，不可点击、悬停或键盘展开，没有就绪toast。移除ERP状态popup及IPC，保留真实后台握手、登录等待、45秒失效和恢复；独立版本更新弹窗保留。

## 验收

- 前端136文件/925测试、生产构建、完整本地release:check、桌面verify通过。
- 三代历史writer合成升级前报告，关闭重开隔离浏览器后实际当前/历史下载，两类型共12次；读回XLSX，金额/扣款/代发/非单号单元格一致，前导零/长号/斜线保留。报告/快照/台账/审计/成本记录哈希前后相同。
- 两种新报告实际预览→保存并下载成功，隔离台账正常定稿且仅生成两份报告。
- 实际主壳资源在headless Edge中完成浅深色、980/1024/1440窗口、就绪/登录/过期/断连/恢复30组颜色与鼠标键盘检查，无文字面板。截图人工检查通过。
- 隐藏真实Electron通过MV3加载、MAIN页面、托管收件冷启动通信；保持工作台不访问采购API即可就绪，过期和收件重启撤绿恢复，登录401为等待，重复事件无额外窗口。
- 交叉审查修正@3单号被旧分隔符二次解析的边界，并补回归。

限制：ERP通信使用隔离HTML/API，真实账号未验证。主壳视觉为实际资源的headless Edge；隐藏Electron截帧不作为可见窗口视觉/焦点证据。未安装、不改真实数据库或源Excel。

## 候选、合并与公开发布

实现提交 `594dcb26ca515417649d8b5ef347a32f1727ca02`，候选构建 `11722e5`；[PR #115](https://github.com/love70805/lworkstation/pull/115)合并及标签为 `e534a2fc2a9c94fd67a4071a6668129c5cea40bd`，文件树与候选完全一致。[main CI](https://github.com/love70805/lworkstation/actions/runs/36366387778)通过。真实Windows packaged smoke、release:organize、release:check通过，ERP灯交互后仅一个窗口，独立更新弹窗正常开闭。

[Beta.10公开预发布](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.10)四资产已用Node匿名下载并逐项与候选核对。Windows旧curl的TLS失败不作为回读成功，最终Node记录为准。真实GitHub更新提供方验证Beta.9→Beta.10、Beta.10当前、稳定0.2.19仅latest.yml且无更新；无下载更新或安装。

| 资产 | SHA-256 |
| --- | --- |

| `Lworkstation-Setup-0.3.0-beta.10.exe` | `D537918F9FB9A736706461FB7D3792F9B262B2741D5434B1FCF4A89C8564975B` |
| `Lworkstation-Setup-0.3.0-beta.10.exe.blockmap` | `D36F82CECBAC4FDD301DEC53A3E21608C2377EA08CFB35CD443A567C95A0491C` |
| `beta.yml` | `3E5427E779C1A43755C55FB13D14BFE658A80C9CEE48F11662743552371BFC59` |
| `SHA256.txt` | `B779C4FE2349595643CF8AB12A159FB0EBA91F9672AE0E1B38DDB32DDF8A5E44` |

候选：`releases/candidates/0.3.0-beta.10-export-status/`。原始证据：`archive/beta10/`。持久交接目录：`C:/Users/Administrator/Desktop/Lworkstation/archive/beta10-execution-closeout-20260928/`，候选四资产、脚本/截图/日志/合成XLSX与MANIFEST逐项哈希保留，不包含业务数据/profile。

用户随后要求准备0.3.0正式版时Beta.10已经公开。按每版本独立执行聊天约定，本任务仅收尾交接，正式版由新任务承接；不得将本Beta候选当作正式版候选，也不得跳过稳定更新合同与最终打包验收。
