# 桌面体验验收（2026-09-13）

基线 f25a523。仅桌面生命周期及主题相关共享前端；未改版本、导航、核算或数据库，未启动已安装应用、安装或发布。

## 行为与接口

- 启动时外壳显示现有标识和保存主题，工作站可用后立即结束；加载失败/30秒超时显示重试、退出。工作站 renderer 崩溃同样进入恢复界面。
- 默认关闭隐藏到系统托盘，工作站 renderer 与 inbox 保持运行。托盘点击恢复，菜单可选择关闭时退出及明确退出。`desktop-preferences.json` 增加 `closeBehavior: tray|quit`，旧偏好默认 tray。
- 退出、更新退出、结束会话不再隐藏；销毁托盘、views并停止自有inbox子进程。启动过程关闭隐藏不被后续初始化反向弹出。托盘失败则提示并按关闭退出。
- 新 IPC `desktop:startup-action` 仅接受壳主框架的 retry/quit；`workspace:ready` 仅接受工作站主框架。runtime增加只读appearance；publicState增加startup/lifecycleNotice。原主题键不变。
- 主题目标同步应用并通知外壳，旧动画可取消；仅工作站整体160ms opacity动画，切换期间禁用局部颜色过渡。同值重入立即清理禁用标记；减少动态/无API直接应用。ERP/1688视图不参与动画。

## 验证

- frontend test/build等价本地入口：87文件585测试通过，build通过（既有大chunk提示）。pnpm启动器要求刷新依赖，改为执行package scripts对应本地Vitest/Vite入口，未重装依赖。
- desktop verify全部12脚本通过；既有single-instance真实烟测通过，含不同profile并行与异常重启。
- experience-smoke使用实际main.cjs、原生BrowserWindow/Tray及自有inbox服务：启动中关闭、隐藏后ERP合成收发、托盘恢复、第二进程唤回、明确退出/子进程退出、更新退出、实际网络错误重试、30秒超时重试、托盘创建失败、关闭偏好保存、启动中退出均通过。
- 主题烟测使用实际前端+外壳、独立profile：明暗首启、11次快速切换、最终外壳一致、同值清理单元测试、reduced-motion、无动画API、1024×768/1280×800/390×780无横向溢出。
- 加入1000行合成DOM压力数据测量：两方向分别1/2次>=50ms长任务，最长帧间隔约66.5/50.1ms。该结果不是60fps或低配机器不卡顿保证；未做旧版同机对照。已消除逐行主题过渡，不宣称解决所有大表渲染耗时。

## 复跑和边界

`node desktop/experience-smoke.cjs`；主题先启动本worktree Vite 127.0.0.1:5188，再执行`node desktop/theme-smoke.cjs`。可通过DESKTOP_EXPERIENCE_ELECTRON与PLAYWRIGHT_PATH指定工具路径。脚本只创建临时profile，阻断外部ERP/1688网络；测试harness不入打包files。

托盘通过真实Tray的事件/菜单回调驱动，并非人工点击系统通知区域。系统退出测试注入session-end事件，没有关闭真实Windows会话。更新测试截获quitAndInstall安装器部分，但实际退出/清理已执行；未安装任何包。最终正式包仍需主线集成后的packaged smoke。

最终证据归档由交付消息给出，含PNG、result及哈希，不包含profile。源临时证据：experience-DACYSB、theme-gE3gIC、single-instance-iGu6lR。
