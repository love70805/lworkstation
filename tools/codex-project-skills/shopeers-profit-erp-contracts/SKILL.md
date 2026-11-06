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
- The same valid manual unit cost belongs to one workspace, month, store and platform SKU. Regular accounting prefers it to the regular ERP cost. Lowest-cost accounting takes the lower of this manual value and the lowest eligible ERP purchase price across history. Use a sole eligible candidate when available and report a missing cost when both are absent. Test actual manual zero, audit and revocation. Keep 1688 selection quotes outside both calculations.
- Both modes use the same ledger, active warehouse rate and adopted dispatch and deduction sources for the workspace and month. Check edits from either mode against both current calculations. A saved export keeps its own source snapshot and remains readable after a later edit.
- The ERP extension transports evidence. The workstation validates and adopts qualifying costs. Check the actual version, request association, scope and evidence completeness before accepting a batch. Preserve the supported read path for legacy receipts.

For changed contracts, update the producer, consumer and tests together. Choose focused checks for the affected behavior, including retries, partial receipts, shared monthly inputs or mode-specific unit costs when relevant. Use isolated data for writes.
