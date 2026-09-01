# Shopeers Codex Skills

The project defines three core Shopeers-specific skills under `$CODEX_HOME/skills`. The React UI skill is optional and may be disabled; its absence must not block ordinary UI work.

- `shopeers-electron-security`: Electron shell trust boundaries, remote views, extensions, navigation, updates, inbox lifecycle, and packaged verification.
- `shopeers-profit-erp-contracts`: Ledger, ERP evidence, formal cost, manual confirmation, anomaly handling, versioned contracts, and finalized-profit invariants.
- `shopeers-development-workflow`: Requirement confirmation, delayed document writes, task-board planning, and Windows wizard behavior.

Use the Electron skill for `desktop/` and desktop bridges. Use the profit/ERP skill when a change touches ledger, cost, inbox, repository, contract, or finalized-profit behavior. Use the optional UI skill when installed for broad React UI work; otherwise follow existing components, style modules, browser visual checks, and tests. Cross-module changes should use all available affected skills and follow the integration branch workflow in `docs/CODEX_TASK_BOARD.md`.

These skills guide Codex; they are not shipped with the application and do not replace runtime validation. The baseline checks remain `pnpm --dir frontend test`, `pnpm --dir frontend build`, `pnpm --dir desktop verify`, and the relevant bridge/inbox tests.

## Workflow skills

The following Chinese workflow skills are selected from
`vinvcn/mattpocock-skills-zh-CN` at commit
`9fb0161ac2be0c45c59cbea0878eb77d92cc24b5`:

- `grill-me`: user-invoked entry for a sustained requirement interview powered by `grilling`.
- `grilling`: interview the user in decision rounds and wait for shared understanding before acting.
- `grill-with-docs`: combine requirement interviews with domain terminology and decision documentation.
- `domain-modeling`: clarify the shared business vocabulary and durable domain decisions.
- `to-questionnaire`: prepare a structured questionnaire for facts or decisions owned by another person.
- `wait-what`: stop and request a clearer restatement when a message cannot be understood reliably.
- `to-spec`: summarize an established conversation into a specification.
- `to-tickets`: split an approved specification into dependency-aware vertical slices.
- `wayfinder`: map decisions for work too large or uncertain for one development session.
- `research`: investigate primary sources and preserve sourced findings.
- `diagnosing-bugs`: build a reproducible feedback loop before fixing difficult bugs or performance regressions.
- `code-review`: review a fixed diff against repository standards and the requested behavior.
- `resolving-merge-conflicts`: resolve conflicts from the original intent of both changes.
- `codebase-design`: design maintainable modules, interfaces, seams, and test surfaces.
- `improve-codebase-architecture`: scan architectural friction and present improvement candidates.
- `wizard`: create guided setup procedures for steps that require human interaction.
- `handoff`: produce a compact handoff for another task or fresh context.
- `writing-for-agents`: improve instructions written for Codex and other agents.

Install or restore the selected upstream skills and the project workflow adapter on a new development computer with:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\install-codex-workflow-skills.ps1
```

Use `-Force` only when intentionally refreshing the installed copies from the
pinned source revision. Restart Codex, or begin a new turn, after installation so
the new skills are discovered.

These workflow skills supplement the project rules; they do not replace
`AGENTS.md`, `docs/CODEX_TASK_BOARD.md`, specialist task routing, or the mainline
integration and release process. `shopeers-development-workflow` applies the
approved lightweight project profile: decision-bearing work is confirmed
before repository writes, while small, fully specified defects and isolated UI
fixes may proceed directly. Accepted specifications and tickets use the
existing task board, and manual setup wizards use PowerShell.

The upstream `teach`, `setup-matt-pocock-skills`, global mandatory `tdd`,
`implement`, and `prototype` skills are intentionally not installed.
