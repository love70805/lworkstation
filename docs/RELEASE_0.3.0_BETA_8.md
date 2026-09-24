# 0.3.0-beta.8 · 已采用 ERP 成本证据详情修复

状态（2026-09-24）：Windows 候选、PR / main CI、公开 Beta 发布、四资产匿名回读与真实更新通道检查完成。稳定版仍为 0.2.19；本机未安装，未改写真实业务数据。

## 现场原因与修复

Beta.7 现场同一平台 SKU 顶部为“当前采用：¥4.5900 · ERP”，正式成本已经生效。证据详情却报缺少 `evidenceRef` 并要求重采。完整 v2 批次校验通过后，发布路径保存成本行时漏写 `evidenceRef` 和 `evidenceComplete`；页面重新读取正式成本行时因此产生伪异常。

Beta.8 在新采用行中保存经过源批次校验的证据字段。Beta.7 已采用旧行仅在原批次仍有效、工作区/账本/请求/源批次相符，且仓库证据唯一完整、采购与排除记录一致时，只读投影证据字段，不迁移或改写旧行。范围不明时继续显示原缺失状态。撤回墓碑、人工更正优先、金额与定稿保护不变。详情说明 ERP 已生效时无需人工确认。具体边界见[证据引用契约](integration/ERP_PUBLISHED_EVIDENCE_REFERENCE.md)。

## 验收

- 前端 130 文件 / 878 测试、生产构建、桌面 verify 全套通过。
- 隔离 headless Edge 使用 11 条采购记录；最近三条 20×4.5、15×4.5、15×4.8 自动采用 4.5900 元，重新打开详情无缺 `evidenceRef` 提示。把隔离行模拟为 Beta.7 存储格式后，再次打开同样无伪异常，物理数据库行仍缺字段。原始脚本、结果、截图位于本机 `archive/beta8-evidence/`。
- Windows packaged smoke 及 `release:check` 通过。[PR #111](https://github.com/love70805/lworkstation/pull/111) 两项必需检查和 [main CI](https://github.com/love70805/lworkstation/actions/runs/35985998406) 均通过。浏览器测试未连接真实 ERP 账号；桌面打包与收件由独立 smoke 验证。

## 资产、集成与公开回读

候选构建提交 `a73a73120615f5e42839cbbc67a2fbdd15c6a688`，PR #111 合并提交 `fd8e256f07d645b98df170b9747dc4c01447a91a`。两者的 `frontend/`、`desktop/`、`integrations/`、`tools/` 内容一致。标签 `v0.3.0-beta.8` 指向合并提交；[GitHub Beta.8](https://github.com/love70805/lworkstation/releases/tag/v0.3.0-beta.8) 为预发布，GitHub Latest 保持 `v0.2.19`。

候选位于 `releases/candidates/0.3.0-beta.8-evidence-reference/`，公开资产源位于 `releases/prerelease/0.3.0-beta.8/`。四项均已从匿名公开地址回读并与本机逐项哈希一致：

| 资产 | SHA-256 |
| --- | --- |
| `Lworkstation-Setup-0.3.0-beta.8.exe` | `6015D7EFBFA4642D9B794157EEC6BFC50FAA48D92F7B33CBE644F774C2BC0F38` |
| `Lworkstation-Setup-0.3.0-beta.8.exe.blockmap` | `807A98062F763341955B9FA30F89223C615F606DC7082FE3A91A94A86A70B1AF` |
| `beta.yml` | `5061D0FACC342D9C6A0A065F95E2CAF607E76221046BAF01A5FFECEA1CD2B77E` |
| `SHA256.txt` | `BA8E5C9F20393651A2E3CA4E72D5F2C144A34444C1C367E7B956675B2916BA13` |

真实 GitHub 更新提供方检查：Beta.7 可发现 Beta.8，Beta.8 显示当前版本，稳定版 0.2.19 仅查看 `latest.yml`。未下载更新或执行安装。
