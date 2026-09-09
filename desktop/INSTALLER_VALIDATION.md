# Assisted installer and compact update popover

0.2.10 implementation, based on `3d364ac`. Public app identity and version metadata are unchanged. Stable and historical public Beta share the existing identity; their update channels remain isolated. Security QA has its separate identity. No migration of these identities is part of this change.

- Assisted NSIS defaults to the current user and exposes a directory page. A first interactive install may append the application folder name to the selected parent (upstream electron-builder behavior).
- `installer.nsh` preserves the registered directory when it is already selected, including custom directories lacking the app filename. `--updated` also preserves the installed user/machine scope. It never changes AppData or the update runtime policy.
- The compact popover is 296px wide, with collapsed release details and visible version/channel, status and applicable actions. Long errors remain readable; details and content can scroll.

## Validation

`pnpm --dir desktop verify` checks packaging, installation settings and existing update/single-instance contracts. Run the renderer fixture with Electron 44:

```powershell
& <Electron44.exe> desktop/update-popover-smoke.cjs
```

It uses a temporary synthetic profile and stubbed update operations (no network/download/install), validates all nine statuses in light/dark appearances, and writes result JSON/screenshots under the reported temporary directory.

2026-09-10 specialist installation validation used electron-builder 26.15.3's real assisted NSIS templates and an isolated `com.shopeers.installer-smoke.0210` identity. Its payload was deliberately non-executable synthetic text, not a business installation. All builds used `--publish never` and `--prepackaged`, with the production NSIS options plus isolated names, output path and `runAfterFinish: false`.

Observed the native current-user and directory wizard pages. This host's native screenshot/input-value APIs were unsupported, so actual custom path entry was exercised through supported NSIS `/S /D=<Chinese and space path>`. Subsequently `--updated` **without `/S` or `/D`** installed the next fixture version with exit 0: registered InstallLocation unchanged, no extra application subdirectory, payload and DisplayName advanced, shortcut still pointed to the custom directory, AppData sentinel preserved. The fixture was then uninstalled and the sentinel hash checked before removing synthetic data.

Raw evidence/config/installers are in the specialist worktree's ignored `desktop/release-test/installer-0.2.10/`; `evidence.json` records exact paths and hashes. Main must archive these before clearing fixtures. Popover screenshots are in the temporary path reported by its runner. No official installer was built, published or installed by this task. Main must still validate the final integrated application/installer and its real visible first-install path selection.
