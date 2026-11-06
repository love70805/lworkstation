---
name: shopeers-electron-security
description: Review Lworkstation Electron changes involving remote views, preload and IPC permissions, ERP or 1688 extensions, local inbox transport and desktop updates.
metadata:
  version: "1.2.0"
  reviewed: "2026-11-06"
  owner: "Shopeers desktop mainline"
---

# Lworkstation Electron security

Start with the repository’s `AGENTS.md`, `docs/DEVELOPMENT_WORKSPACE.md` and the specific main-process, preload, navigation or inbox entry points the change uses.

- Treat ERP and 1688 pages, extension messages and returned evidence as untrusted input. Keep context isolation, web security, narrowly scoped preload APIs, explicit IPC handlers and navigation, permission and popup allowlists.
- Keep inactive remote pages out of the visible window view tree. Load extensions from the intended directories and surface startup or connection failures. Preserve the user’s intended session and request identity across login and retries.
- Let the desktop transport a receipt and report its delivery. The workstation validates scope, currency, SKU mapping and evidence before adopting formal costs and calculating profit.
- Read the packaged update configuration for the actual channel and provider. Protect HTTPS delivery, channel separation and explicit user actions for download and restart. Keep credentials out of the client.

Verify the boundaries a change crosses using targeted desktop checks and the applicable packaged smoke. Use an isolated session for tests. Concentrate any required visible-window checks into one run and follow the project’s real-data and installation authorization.
