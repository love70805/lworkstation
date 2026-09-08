# 2026-09-08 依赖更新集成验收

用户授权合并 Dependabot 更新；主线从 `main@334ac7b` 建立仓库内临时 Worktree，逐项保留原始提交并合并 #4–#12。

| PR | 更新 |
| --- | --- |
| #4 | pnpm/action-setup 4 → 6 |
| #5 | actions/setup-node 4 → 7 |
| #6 | actions/checkout 4 → 7 |
| #7 | 桌面 lucide 0.468.0 → 1.40.0 |
| #8 | pg 8.13.1 → 8.23.0 |
| #9 | lucide-react 0.468.0 → 1.40.0 |
| #10 | jose 5.10.0 → 6.2.11 |
| #11 | papaparse 5.5.4 → 5.7.0 |
| #12 | dexie 4.4.4 → 4.4.5 |

跨范围原因：集中审查并集成机器人提交，验证前端、同步鉴权及桌面图标兼容性。仅机械解决 package.json 相邻依赖行冲突，保留全部升级；业务规则、公共数据 contract、数据库结构及发布版本不变。

## 本地验证

- 前端与桌面 frozen-lockfile 安装成功，两端依赖审计均无已知漏洞。
- `pnpm --dir frontend release:check`：73 个文件、510 项测试、生产构建及集成门禁通过。
- 针对 [JOSE 6 的运行时和密码学变化](https://github.com/panva/jose/releases/tag/v6.0.0)，补充 6 项真实签名/JWKS 回归：ES256、RS256 正常鉴权，以及过期、错误 issuer、错误 audience、签名篡改时拒绝授权；定向测试全部通过。测试采用生产入口相同的依赖加载方式与临时本地 JWKS 服务。
- `pnpm --dir desktop verify`、Windows unpacked 构建及 `smoke:packaged` 通过，使用隔离用户目录及合成数据。
- Edge 检查 6 个页面在桌面和移动宽度下的 12 个用例通过；概览截图人工检查通过。真实构建 worker 的 CSV/TSV/XLSX 导入与导出、异常引号检测通过；桌面 HTML 引用的 11 个图标均成功生成 SVG。
- 本地证据保存在主仓库忽略目录 `qa/dependabot-2026-09-08/`。新增测试纳入 GitHub 完整回归，合并前要求 `release-check` 和 `desktop-verify` 成功。

本轮交付源码依赖集成，不发布新 GitHub Release。既有本机 QA 候选安装包不会自动包含本次更新；Windows unpacked 产物仅用于本轮兼容性验收。
