---
name: shopeers-electron-security
description: Design, modify, review, and verify the Shopeers Electron desktop shell, including WebContentsView remote pages, preload and IPC boundaries, ERP/1688 MV3 extensions, navigation allowlists, persistent sessions, inbox lifecycle, updates, packaging, and smoke tests. Use for changes under desktop/ or a desktop bridge.
version: 1.1.0
status: active
reviewed: 2026-08-18
owner: Shopeers desktop mainline
---

# Shopeers Electron Security

Treat `desktop/` as a security boundary around the React workstation and untrusted ERP/1688 pages. The desktop shell may host and transport evidence, but it must never decide or publish formal costs or monthly profit.

## Trust Boundaries

- The local Shopeers workstation is trusted application code.
- ERP and 1688 remote pages, extension content scripts, popup pages, and service workers are untrusted or partially trusted inputs.
- The local ERP inbox on `127.0.0.1:8790` is a transport boundary; validate version, workspace, request, currency, SKU mapping, evidence completeness, and integrity before the frontend repository accepts data.
- Renderer code must not gain Node, filesystem, arbitrary process, or unrestricted navigation capabilities.

## Safe Change Workflow

1. Read `AGENTS.md`, `docs/CODEX_TASK_BOARD.md`, `desktop/README.md`, and the relevant main/preload/navigation/inbox files.
2. Trace the change across main process, preload, renderer messages, remote views, extension bridge, and frontend repository. State which side owns validation.
3. Preserve secure defaults: `contextIsolation`, `webSecurity`, narrow preload APIs, explicit IPC handlers, HTTPS or approved local endpoints, and allowlisted navigation/popups/permissions.
4. Keep active remote views isolated from the workstation. Non-active views should not remain in the window view tree when the shell does not need them.
5. Load extensions only from the intended unpacked directories. Surface load failures clearly without blanking the workstation or silently falling back to unsafe behavior.
6. Keep update metadata configurable and HTTPS-based when automatic updates are enabled; never embed repository tokens or credentials in the client. Automatic updates are currently deferred and must not be re-enabled implicitly.
7. Keep inbox lifecycle and status reporting in the desktop layer, but leave anomaly detection, manual confirmation, formal cost publication, and profit finalization to Shopeers frontend/domain code.

## Verification

Run the narrow checks first. Use the full frontend suite when the change touches the renderer, shared contracts, or release integration:

```powershell
pnpm --dir desktop verify
pnpm --dir desktop smoke:packaged
pnpm --dir frontend erp:bridge:test
pnpm --dir frontend erp:inbox:test
pnpm --dir frontend test
pnpm --dir frontend build
```

For real-browser changes, manually verify ERP/1688 login persistence, pagination capture, SKU/SKC/warehouse mapping, controlled new-window behavior, extension status, restart behavior, and recovery to the workstation after a remote-page failure.
