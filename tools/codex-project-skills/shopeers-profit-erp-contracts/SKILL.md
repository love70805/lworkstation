---
name: shopeers-profit-erp-contracts
description: Trace Lworkstation ledger imports, ERP evidence, manual cost overrides, profit calculations and report snapshots across the frontend and desktop inbox.
metadata:
  version: "1.2.0"
  reviewed: "2026-11-06"
  owner: "Shopeers profit and ERP mainline"
---

# Lworkstation profit and ERP contracts

Read the repository’s `AGENTS.md` for accounting and authorization decisions. Use `frontend/docs/integration/DOMAIN_MODEL.md` for entity relationships and `docs/DEVELOPMENT_WORKSPACE.md` for verification commands.

- Trace a change from the ledger’s workspace, month, store and platform SKU through the registered ERP request, versioned receipt, adoption and report. SKC groups variants. Warehouse-level evidence may be shared while SKU mapping and scope remain explicit.
- Distinguish formal ERP evidence, explicit manual overrides and 1688 selection references. Check missing evidence separately from an actual zero. Validate manual precedence, audit and revocation in the affected accounting mode.
- A month stays editable. A saved export has its own source snapshot. Verify that an old ledger can use the current workflow, a later edit changes the current result, and a previously exported report still reads its own inputs.
- The ERP extension transports evidence. The workstation validates and adopts qualifying costs. Check the actual version, request association, scope and evidence completeness before accepting a batch. Preserve the supported read path for legacy receipts.

For changed contracts, update the producer, consumer and tests together. Choose focused checks for the affected behavior, including retries, partial receipts or accounting-mode isolation when relevant. Use isolated data for writes.
