# Lworkstation 项目开发技能

项目技能是按需使用的工作指南。以[项目约束](../AGENTS.md)确定目标和授权，用[开发指南](DEVELOPMENT_WORKSPACE.md)选择实现入口和验证范围。

| 技能 | 适用工作 |
| --- | --- |
| [shopeers-development-workflow](../tools/codex-project-skills/shopeers-development-workflow/SKILL.md) | 跨模块改动、确认尚未决定的业务取舍、编写 Windows 人工配置向导。 |
| [shopeers-profit-erp-contracts](../tools/codex-project-skills/shopeers-profit-erp-contracts/SKILL.md) | 台账导入、采购证据、人工成本、核算方式和报告快照。 |
| [shopeers-electron-security](../tools/codex-project-skills/shopeers-electron-security/SKILL.md) | Electron 权限、远程页面、收件传输和更新。 |

已明确的工作直接执行。需要讨论业务取舍时，可以一问一答。技能未安装时，使用相关源码、契约和测试继续工作。React 界面沿用现有组件和模块样式。

## 可选工具

新开发电脑如需恢复项目模板和选定的上游工作流技能，可运行 `powershell -ExecutionPolicy Bypass -File .\tools\install-codex-workflow-skills.ps1`。安装器固定上游修订，具体技能及来源见[安装脚本](../tools/install-codex-workflow-skills.ps1)。需要刻意刷新上游副本时才使用 `-Force`。这些工具仅供开发环境使用。
