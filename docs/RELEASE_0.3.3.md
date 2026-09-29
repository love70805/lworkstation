# 0.3.3 发布与验收

2026-09-29 19:03:45（UTC+8），[0.3.3](https://github.com/love70805/lworkstation/releases/tag/v0.3.3) 已公开为稳定 GitHub Latest，四资产匿名完整回读及实际更新通道通过。统一交付 ERP Assistant 8.0.24。本机不覆盖安装，不改真实业务数据库或已定稿报告。基线为 main `d34e1f75d08ac251c5645eb25fabd74ece1a7789`，实现分支 `codex/release-0-3-3`，复用应用工作区 d308。

## 交付行为

- ERP 按已确认 SKC 查询商品档案全分页，再按完整成对 SKC/SKU 映射补齐未售 SKU。共享仓库的其他 SKC 不纳入；人员和 ERP 销量字段不参与归属或销量判断。
- 商品目录、映射、图片、供应商和采购证据分别记录完整性。独立资料请求关联本机原始请求或已有商品、工作区和明确月份；失败只影响相应资料，持久成功后确认收到。
- 未售 SKU 只在采购证据完整且单位换算明确时生成 ERP 采购参考，不新增销量或正式成本。保留零及微小正数，缺失不能显示为零；原商品档案价格不能冒充采购成本。
- 台账/ERP 预填商品有中文名称、SKC、明确 SKU 关系即可一次保存；可选资料后补。已有档案直接打开，关系冲突需显式定位或排除。人工改名及主动清空字段保留。
- 编辑页使用基本信息、全宽 SKU 和供应商来源三部分。商品状态合为一个用户字段，保留旧阶段、自定义状态和旧矛盾信息，技术生命周期分开。单保存和批量上架共用最低门槛。
- 销量标签只由台账产生，取各店铺最新共同完整月份的末七天。四档为爆款 ≥700、高销 ≥100、一般 ≥10、低销 0–9。来源完整性与行日期质量分别验证，旧未知范围、缺日期及无历史不会冒充完整或零销量。
- 完整店铺月份替换需显式选择来源范围及确认预览，追加及部分来源保持原语义。替换/恢复避免重复归集，手工标签不变。
- 元数据保存不重算或替代旧报价，隐藏的费用和单位保留；首次给待关联报价分配 SKU 保留原报价值。0.3.2 CSV 连续共享 1688 单号、XLSX 有界合并、空数量跳过和原利润导出/定稿口径继续保留。

## 契约与验证

目录请求/返回使用独立 `catalog` 分支，原正式成本仍执行其 published/request、人工优先和定稿保护。目录记录存在已有本机 settings 表，不追加或执行真实数据库迁移。可信原成本收件的目录可以独立展示，但不绕过正式成本采用。

受信原请求、工作区、月份、来源商品及已确认 SKU 身份必须闭合。返回范围扩大、跨工作区、不同证据复用批次 ID、已替代请求的迟到返回会被拒绝；旧证据保持不可变。

已完成独立交叉审查、工作区及权限隔离、并发幂等、最小保存门槛、旧报价/人工清空及来源完整性回归。选品和导入页面使用 Windows Edge headless、隔离合成 IndexedDB，覆盖浅深色和 1440/1000/390 宽度，包括实际保存、资料保留、完整来源替换及另一店铺不受影响。

候选登记于 [发布清单](../releases/README.md)。候选四资产、930 项源码清单、源码 ZIP 和脱敏验收证据已复制并回读到主仓库持久目录；候选原件为 `releases/candidates/0.3.3/`，公开下载原件在其 `public/` 子目录，证据为 `archive/release-0.3.3/`。

## 候选验收

软件构建提交 `1ff0782d9a767c87ab835314a65c6cb805b17cb2`。完整前端 `release:check`（151 文件 / 1107 测试、生产构建及适用部署契约门禁）、16 组桌面 `verify`、前端/桌面低级别依赖审计全部通过。ERP 生产采集代码使用合成 205 商品 / 3 页和 128 条完整映射响应验证分页、共享仓库隔离、故障恢复及原成本证据保留。

Windows `release:build`、`release:organize`、`release:check` 和隐藏 `smoke:packaged` 通过；隔离运行记录为零可见窗口，收件、回传确认及运行时扩展正常。离线解包 476 文件与 `win-unpacked` 逐字节一致，429 项桌面源码及 extraResources 输入一致，包含新目录契约运行时和 ERP 8.0.24。安装包 117114898 字节。

| 候选文件 | SHA256 |
| --- | --- |
| `Lworkstation Setup 0.3.3.exe` | `1BFAFD8A56BE42441269D800DBBDC577991FEBEE067E98AB734EA3A7EA8464A8` |
| `Lworkstation Setup 0.3.3.exe.blockmap` | `200D5B58F8109BE8A54C02DA46489781C8CA8934457533B4601827C2A62A7AC5` |
| `latest.yml` | `128CC4D8877DA818B850AF06AA7AE7EA8C1F20D2770A61E4171107F6D9E718E2` |

ERP 扩展 ZIP SHA256：`062B792B0C8D275C9888AEBE6548ECFD190A6474E9A197F354AD7815ADC7D17F`。[PR #127](https://github.com/love70805/lworkstation/pull/127) 最终提交 `59a1a75` 的 [CI](https://github.com/love70805/lworkstation/actions/runs/36558446939) 通过，合入 main `966b2aa63874d2a421e7deb8dbe93c727e22a192`；该主线 [CI](https://github.com/love70805/lworkstation/actions/runs/36558817589) 通过。主线与构建提交仅相差三份验收文档，所有生产目录树一致；同一 EXE 用于发布，未重新构建。

## 公开发布与保全

`v0.3.3` 标签固定 `966b2aa63874d2a421e7deb8dbe93c727e22a192`，匿名标签回读一致。草稿四资产大小、GitHub digest 及稳定通道核对通过后公开，`draft=false`、`prerelease=false`，Latest 为 0.3.3。

| 公开文件 | 字节数 | SHA256 |
| --- | --- | --- |
| `Lworkstation-Setup-0.3.3.exe` | 117114898 | `1BFAFD8A56BE42441269D800DBBDC577991FEBEE067E98AB734EA3A7EA8464A8` |
| `Lworkstation-Setup-0.3.3.exe.blockmap` | 123019 | `200D5B58F8109BE8A54C02DA46489781C8CA8934457533B4601827C2A62A7AC5` |
| `latest.yml` | 353 | `128CC4D8877DA818B850AF06AA7AE7EA8C1F20D2770A61E4171107F6D9E718E2` |
| `SHA256.txt` | 276 | `68D25B946C4FE3908F8DE70961DA5B4B94AD8F4F3C7161B91DFAEA74CFE9A2B4` |

四资产通过不带认证的 HTTP 完整下载，大小、SHA256 与 GitHub digest 一致，`latest.yml` 文件名、EXE SHA512 及大小正确。公开 EXE、blockmap 和 metadata 与候选逐字节相同；公开 SHA256 清单只随文件名规范化更新。下载原件已持久复制并逐项回读。

真实生产 `AppUpdater`、`ChannelGitHubProvider` 和更新 runtime 使用匿名 HTTP：0.2.19 / 0.3.0 / 0.3.1 / 0.3.2 指向 0.3.3，0.3.3 为 current；Beta.9 指向 Beta.10，Beta.10 为 current；RC.1 / RC.2 禁用且零请求。验证的 updater 下载及安装调用为零。原 0.3.0 / 0.3.1 / 0.3.2 的公开标签及资产名/大小/digest、主仓库原候选 EXE 哈希均未变，Beta 最新保持 0.3.0-beta.10。

保留构建/候选文档提交的源码清单与 `source-59a1a75.zip`，以及 `source-main-966b2aa.zip`、生产目录树一致性和 PR/main CI 记录。`anonymous-verification.json`、`public-update-channels.json`、`historical-releases-check.json`、`anonymous-tag-check.json`、`durable-public-check.json` 记录实际回读，不以仅上传成功代替公开验收。不归档聊天或工作区。

## 使用与验收边界

已有利润采集能力继续复用。ERP Assistant 8.0.24 新增商品档案及资料补取：工作台先登记资料请求，再在 ERP 助手点击“补充资料”；正常成本操作也同步补充目录。只读 ERP，回传现有本机 loopback 收件服务。

稳定桌面版可使用检查更新或下载 [0.3.3 安装包](https://github.com/love70805/lworkstation/releases/download/v0.3.3/Lworkstation-Setup-0.3.3.exe)。桌面包内含新助手；独立浏览器继续使用工作台 ERP 助手配置入口提供的 8.0.24 扩展。此次交付没有替用户执行安装。

真实 ERP 商品接口形状已由决策端只读核对，真实样本未跨商品分页；新采集链路使用生产代码和合成响应验证，未重采真实 ERP 登录账号。未验证方向的采购比例只保留证据，不推定平台单位换算。完整采购证据但没有明确换算的 SKU 仍显示对应缺项。

隐藏桌面候选验证不等于真实托盘/焦点交互验收；本批不改这些原生交互。最终报告只标记实际完成的检查及公开状态。

规格：[完整方案](integration/SELECTION_PRODUCT_BETA_UPGRADE_SPEC.md)、[需求记录](integration/SELECTION_PRODUCT_BETA_PLAN.md)、[只读接口核验](integration/ERP_CATALOG_READONLY_VALIDATION_0_3_3.md)。
