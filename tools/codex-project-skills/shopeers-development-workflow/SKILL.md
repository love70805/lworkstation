---
name: shopeers-development-workflow
description: Guide scoped Lworkstation changes across the monthly ledger, ERP, UI and desktop, and build PowerShell wizards for human setup.
metadata:
  version: "1.2.0"
  reviewed: "2026-11-06"
  owner: "Shopeers project mainline"
---

# Lworkstation development workflow

Start with the repository’s `AGENTS.md`, `docs/CODEX_TASK_BOARD.md` and `node tools/development-context.mjs`. Use `docs/DEVELOPMENT_WORKSPACE.md` for commands, module ownership and release instructions. Verify the actual upstream commit or the baseline selected for this batch. Preserve existing work.

## Decide what needs input

Carry a clear request through its affected entry points, background jobs, progress, results and recovery paths. Ask about unresolved business choices, material scope changes and operations that need specific authorization. An established decision applies across modules. Reuse the same execution chat and record the outcome in the existing board, integration note or PR.

Keep a newly stated long-term rule in `AGENTS.md` and its operational details in the development guide. Record a batch-only exception in the task board. Use the user’s wording to decide which applies, and ask if the distinction affects future work.

## Build a Windows setup wizard

Use `assets/wizard-template.ps1` when the task calls for a PowerShell wizard. Identify the steps the human controls, input destinations and secret values. Keep secrets out of logs and command arguments. Parse-check the script with PowerShell and leave interactive account or permission steps to the authorized user.
