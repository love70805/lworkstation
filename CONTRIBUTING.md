# Contributing to Lworkstation

Thank you for helping improve Lworkstation. The project accepts bug reports,
feature discussions, and pull requests through GitHub.

## Before You Start

- Search existing issues before opening a new one.
- Do not include business spreadsheets, account data, cookies, tokens, local
  databases, backups, ERP login information, or other private data.
- Report security vulnerabilities privately as described in `SECURITY.md`.
- Keep each pull request focused on one problem and explain the user-visible
  behavior it changes.

## Development

Lworkstation is delivered as a Windows Electron application. The browser build
is retained for frontend development and testing only.

```powershell
pnpm --dir frontend install
pnpm --dir desktop install
pnpm --dir frontend test
pnpm --dir frontend build
pnpm --dir desktop verify
```

Changes that affect the Electron shell, embedded ERP or 1688 pages, local inbox
transport, packaging, or updates should also run the relevant packaged smoke
tests. Real ERP and 1688 behavior must be verified with accounts and data that
the contributor is authorized to use.

## Pull Requests

- Use a short Conventional Commit style title where practical.
- Add or update tests for behavior changes.
- Describe manual verification and any remaining risk.
- Preserve the project rules: CNY is the default currency, ERP cost is formal,
  and 1688 cost is reference-only.
- Do not let the desktop shell decide or write formal cost or finalized profit.

By submitting a contribution, you agree that it is licensed under the
Apache License 2.0, as described in `LICENSE`.

## Brand

The source code license does not grant permission to present a modified build
as an official Lworkstation release. See `TRADEMARKS.md` before distributing a
fork or installer.
