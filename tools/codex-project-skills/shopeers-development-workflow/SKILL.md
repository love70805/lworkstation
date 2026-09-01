---
name: shopeers-development-workflow
description: Apply the lightweight Shopeers/Lworkstation workflow for requirement confirmation, domain documentation, task-board planning, and Windows setup rules. Use for cross-module features, business workflows, shared contracts, schema changes, releases, security decisions, or manual setup wizards.
version: 1.1.0
status: active
reviewed: 2026-08-18
owner: Shopeers project mainline
---

# Shopeers Development Workflow

Use this project profile together with the selected upstream workflow skills. `AGENTS.md` and `docs/CODEX_TASK_BOARD.md` remain authoritative when instructions differ.

## Choose the path

- Treat a task as **small and clear** when its expected behavior, affected module, and acceptance signal are explicit and it does not introduce business semantics, a UI flow, a contract, a schema, a release decision, a security boundary, or destructive behavior.
- Small, clear defects and isolated layout fixes may proceed after read-only inspection and a focused test or visual check.
- Treat a task as **decision-bearing** when it changes business rules, cross-module behavior, shared contracts, schema or data migration, permissions/security, release packaging, destructive operations, or a broad UI redesign.
- For decision-bearing work, use `grilling` only for unresolved decisions. Do not reopen a completed decision round for routine implementation, testing, review, commit, or integration.
- Discover facts from code, tools, logs, screenshots, and primary sources yourself. Ask the user for decisions, preferences, and unavailable business knowledge.

## Hold the confirmation gate

For decision-bearing work:

1. Read the relevant implementation, `AGENTS.md`, and `docs/CODEX_TASK_BOARD.md`.
2. Ask only the questions needed to settle objective, target behavior, scope, exclusions, business rules, data effects, and acceptance criteria. Give a recommended answer for each question.
3. Present one compact confirmation brief and wait for explicit approval before repository writes.
4. After approval, execute the confirmed scope end to end without requesting approval for routine edits, tests, commits, or integration.
5. Reopen the gate only when a new user decision or material scope expansion appears.

Before approval, keep repository state unchanged. Read-only inspection and research are allowed; code edits, repository documentation writes, task creation, commits, pushes, releases, and persistent configuration changes wait behind the gate.

## Planning and integration

- Use an independent branch/worktree for cross-module or release work. A small, isolated fix may use the current worktree when no concurrent edit can collide.
- The project mainline owns cross-module contracts, merge order, full regression, and releases. Specialist tasks own only their documented module boundaries.
- Do not create GitHub issues for Shopeers planning unless the user explicitly requests them.
- `to-spec`, `to-tickets`, and `wayfinder` remain conversation-first: save accepted artifacts only after the relevant confirmation.

## Draft documents before writing

When using `grill-with-docs` or `domain-modeling`, keep proposed glossary entries, ADRs, and specifications in the conversation during grilling. Apply them only after the user approves the confirmation brief.

After approval:

- Update `CONTEXT.md` only for stable domain vocabulary, never implementation detail.
- Add an ADR only for a difficult-to-reverse choice with a real trade-off that would otherwise surprise future maintainers.
- Preserve one source of truth; link to existing project rules instead of copying them into several documents.

## Build Windows wizards

For Shopeers manual setup, use PowerShell instead of the upstream Bash wizard.

1. Inspect the repository and list every human-only stage, captured value, destination, and secret classification.
2. Present the ordered stages and wait for approval.
3. Copy `assets/wizard-template.ps1` to the agreed project or temporary path and replace only the example stages.
4. Keep secrets out of output and command arguments. Use secure input and stdin-based secret writes.
5. Parse-check the generated script with PowerShell. Do not run the interactive workflow end to end on the user's behalf.

Commit a wizard only when it is a repeatable project setup path; otherwise keep it in the operating-system temporary directory.
