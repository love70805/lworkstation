# Lworkstation 0.2.9 发布验收

2026-09-09 11:52:44（UTC+8）已公开为 [GitHub Latest 稳定版](https://github.com/love70805/lworkstation/releases/tag/v0.2.9)。用户已明确批准发布；本轮未远程安装或修改用户 a1823 的数据。

## 修复与基线

修复 Windows ERP 回传 `EPERM rename erp-inbox.json.tmp` 的恢复缺口，以及 GET 过期处理绕过 POST 写入队列的并发竞争。所有读改写串行，每次使用独占临时文件，短暂 EPERM/EACCES/EBUSY 有限重试，失败保留正式文件并允许后续幂等重投。具体根因、业务边界与复现见 [ERP inbox 修复](integration/ERP_INBOX_EPERM_2026-09.md)。

专职 4123774，集成承接 6c74307。版本准备5430068，测试依赖安全补丁f7da15e。构建/标签62b9075a4c1ab790a992dba6fe285b7284ac8674；PR #43、#44 已合并，main ee6ead563144f57b7426807e83bbdc930421916f与构建文件树一致。

审计门禁发现开发依赖Vitest/@vitest/mocker公告GHSA-82fw-gwwq-j7x9，已从4.1.10升级4.1.11。仅测试依赖及锁文件改变，无应用业务依赖变化，未降低审计标准。

## 验证结果

- 新版本测试工具下完整release:check通过：80文件/552项测试、生产构建、ERP桥接/inbox、同步、数据库及部署门禁；11组desktop verify通过。
- 合成HTTP并发：原版15GET/5POST中12个ENOENT失败，修复后零失败、五个POST全保存。
- 原生Windows临时只读目标300ms：原版真实EPERM、HTTP400；修复后HTTP202。打包EXE携带的服务复测约409ms恢复，原哨兵记录保留。
- 定向测试覆盖永久拒绝后原字节不变、最多六次rename尝试、释放队列、后续批次重投成功且幂等、慢body、非重试错误、只清理本次临时文件。
- 主工作区稳定构建、release:organize/check、packaged smoke通过；安装包中的runtime服务与审查源码哈希一致。
- 0.2.8适配器经实际NSIS updater下载0.2.9完整包，SHA校验通过，未调用安装；公开provider确认0.2.8发现0.2.9、0.2.9无更高版本、Beta不接收本稳定包。
- GitHub CI 34308377885、34308491354、34308498136、34308625721通过。

## 公开资产下载回读

四个资产均匿名重新下载，并与本地上传文件逐一核对。

| 资产 | 字节数 | SHA-256 |
| --- | ---: | --- |
| Lworkstation-Setup-0.2.9.exe | 116376621 | `739524B980EE295D27B5E7544FD9D611123D2A2DC4DFA130E27A962F198F04B0` |
| Lworkstation-Setup-0.2.9.exe.blockmap | 122149 | `C615B71B863E425DCD58671754CCD235A3C2EF1E799187DA6E89EC1809EA1D67` |
| latest.yml | 353 | `AD3849B6BE62EA0CB2B0360B0A63CAAA736378CBD2E327FAA981F2604E393542` |
| SHA256.txt | 276 | `A4362928EDD932514274F467865C81102B07E4D15C2D07C0E3950268DFFFE331` |

## 状态边界

本机候选`releases/candidates/0.2.9-erp-inbox-recovery/`与公开包相同；当前稳定产物`releases/latest/`，证据`archive/erp-inbox-eperm-2026-09-09/`。该归档仅合成数据，没有用户远端ERP文件。

现场具体拒绝原因尚未确定，持续文件占用/永久权限拒绝仍会明确失败；不能据本地测试声称远端问题已消失。请用户在异常电脑从0.2.8更新、重启后重新回传，并保留原`erp-inbox.json`与遗留`.tmp`，不要清空数据。未进行本机正式覆盖安装，不声称完成0.2.8→0.2.9真实用户升级验收。

安装身份、利润规则、定稿快照、数据库和更新通道不变。0011云端迁移未执行；Windows签名仍未配置。0.2.8及更早公开资产保持原样。
