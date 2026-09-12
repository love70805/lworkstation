# 报表用户链路隔离验收

正式基线 `4b08da3`（生产报表 `59beb33`，桌面版本 `0.2.12`）。只增加 `desktop/` 测试与说明，不修改业务、四新表结构或打包白名单。

## 运行

先在同一代码基线启动 loopback 前端预览，默认端口 5188，再运行：

```powershell
node desktop/report-ui-smoke.cjs
# 上一命令输出独立临时目录，将其传给只读文件检查：
python desktop/report-files-verify.py <smoke输出目录>
```

本机 Python 使用 Codex bundled runtime；读取器仅依赖 Python 标准库。可设置 `WORKSPACE_SMOKE_ORIGIN`、`DESKTOP_EXPERIENCE_ELECTRON`、`PLAYWRIGHT_PATH`。复用已有 `erp-ui-smoke-app.cjs` 测试入口，实际 Electron main、workspace preload 和 React 页面运行。非 loopback HTTP 阻断，下载接管至本轮临时目录，不出现系统保存对话框。

## 实际候选模式

```powershell
$env:REPORT_SMOKE_EXECUTABLE='C:/Users/Administrator/Desktop/Lworkstation/desktop/release/win-unpacked/Lworkstation.exe'
node desktop/report-ui-smoke.cjs
python desktop/report-files-verify.py <smoke输出目录>
```

此模式直接启动真实 `0.2.12` 候选 EXE，无入口脚本参数，显式移除 `DEV_URL` 与自动烟测开关，不启动 Vite。通过 Electron `webContents.getAllWebContents()` 定位实际 `shopeers://workstation/` 页面，通过 BrowserWindow 的 shell 页面定位外壳。测试驱动临时保存这些句柄，候选没有测试接口依赖；不会改写 EXE、asar、preload 或生产源文件，运行前后比对 EXE/asar 哈希。

`report-native-idb.cjs` 只使用候选已建立的原生 IndexedDB。写事务仅含 `ledgers`、`salesRows`、`costApprovals` 三张初始夹具表；补充数据与报告仍经实际 UI 操作。后续状态读取为只读事务，不导入 `/src/` 模块，不调用打包前 repository。

候选复用未扣款→正负扣款→财务→显式重开→新修订→旧文件原字节下载路径，以及 CSV 本人筛选。候选不重复源码六组尺寸矩阵。保存三份报告后实际关闭主窗口，断言隐藏仍可读取已存报告；启动同隔离 profile 第二实例，验证真实单实例路径恢复原窗口，再从历史按钮重下载。此为关窗入托盘与第二实例恢复组合，不声称操作了系统任务栏托盘图标。导出仅临时目录、原文件字节及哈希检查继续有效。

候选还检查正常启动到 ready、页面按钮切换明暗后外壳/工作区一致。随后完整退出，仅在隔离 profile 偏好文件设 `closeBehavior: quit`，重新启动并关窗，验证实际进程退出；该项验证偏好读取和生命周期，不代表点击了原生托盘设置菜单。托盘创建失败、启动失败/超时、更新安装退出及系统结束仍沿用已有源码/事件模拟证据，没有对实际候选注入这些故障，也不声称候选已覆盖这些现场情形。

## 已验证用户操作

- 仅初始化账本、两店销售与有效人工成本：销量 1000/1.5、销售原额 100/30.015、单件成本 0.009/0。所有补充数据和报告均通过真实界面录入、预览、采用、保存。
- 手工代发未填时拒绝，明确 0 能采用且没有伪造订单行。随后通过 `File`/`DataTransfer` 的文件输入 change 事件上传合成 CSV；本人标记选中 1200/800 两行，排除他人和合计行。明确整月采用 2000，超过销量 1001.5。
- 未取得扣款仍可预览未扣款报告并保存下载；精确合计 819.965，显示 819.96，账本原子定稿，代发与仓储费率按钮禁用。
- 后补甲店 1.009、乙店 -0.004 扣款，整月合计 1.005；财务报告关联同一基础，精确结果 818.96，不把负数取绝对值，也不误入录入当月。
- 从利润明细折叠区展开后点击重开，填写说明，再采用 2001 代发并生成基础 r2；旧基础 r1 保留。
- 通过历史界面重新下载 r1，实际下载文件 SHA-256 与首次文件和保存记录相同，字节逐一相等。
- 明/暗 × 1024×768、1280×800、390×780：报告区、来源弹窗、采用预览错误处理、报告保存预览都实测，无 body 横向溢出。按钮滚动到可见区域后通过中心命中检查才触发点击；窄屏历史下载也实际执行。

## 独立文件检查

`report-files-verify.py` 直接读取实际下载的 OOXML ZIP，与应用生成函数独立：检查四次下载哈希、四/五张动态 sheet、最终金额、数字类型、0.009 与真实零、代发长单号文本、正负扣款、冻结线及打印宽度。旧报告再次下载字节完全一致。输出 `xlsx-verification.json`，不改写 XLSX。

## 边界与主线承接

- 文件输入事件验证应用实际读取/解析，不代表已操作系统文件选择对话框。
- 初始账本/销售/有效成本是合成 seed；`monthlySupplementBatches`、`monthlySupplementRows`、`profitReports`、`profitReportLines` 没有直接写入或绕过 UI 的保存。只读 repository 状态用于核验结果。
- 冻结 UI 验证覆盖代发及仓储费率入口；完整仓库写入保护由主线全量业务回归承接，本脚本不冒充逐个底层写入口测试。
- 在制 f861 预备运行仅用于准备，不作为最终证据；正式运行使用已集成基线。
- 源码模式覆盖尺寸矩阵，候选模式覆盖实际打包资源及生命周期组合。没有真实业务表、ERP/云账号、安装、更新或发布操作。Excel 最终样式逐项视觉比较由主线继续承接，不以 OOXML 读取替代 Excel/WPS 现场检查。
- 下载文件仅临时目录；归档截图、结果和哈希时排除整个 profile。测试文件不在生产打包白名单。
