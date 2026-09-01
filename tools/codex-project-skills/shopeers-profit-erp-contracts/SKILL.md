---
name: shopeers-profit-erp-contracts
description: Design, implement, review, and verify Shopeers ledger, ERP cost, manual confirmation, cost matching, inbox transport, and finalized-profit changes. Use when a change touches these domains or crosses their shared contracts.
version: 1.1.0
status: active
reviewed: 2026-08-18
owner: Shopeers profit and ERP mainline
---

# Shopeers Profit and ERP Contracts

Protect the distinction between selection references and formal monthly accounting. Read `AGENTS.md`, `docs/CODEX_TASK_BOARD.md`, and `frontend/docs/integration/DOMAIN_MODEL.md` before changing a contract or calculation.

## Non-Negotiable Invariants

- Currency is CNY unless a contract explicitly says otherwise and validation rejects mismatches.
- Platform SKU is globally unique within the workspace and is the accounting identity; SKC groups variants.
- ERP formal purchase cost is authoritative for monthly profit. A 1688 value is reference-only and must never be silently written to formal profit.
- When ERP cost is missing, a manual confirmation must carry an explicit source, status, actor, timestamp, and audit trail. It must not silently overwrite a finalized month.
- A finalized monthly profit line is immutable from ordinary UI flows.
- An ERP extension collects raw evidence and reports anomalies; it does not confirm, correct, or publish formal cost.
- Shopeers `CostMatching` and repositories independently validate batch format, evidence completeness, SKU mapping, zero prices, anomaly disposition, and source provenance before publication.

## Contract Workflow

Use this skill for data or contract changes in the profit/ERP domain. Purely visual changes that do not alter these values or statuses do not need to invoke it.

1. Identify the source of every value and classify it as ledger revenue, ERP formal cost, manual confirmation, warehouse cost, return penalty, or 1688 reference.
2. Trace the complete path: ledger import -> ERP request -> inbox envelope -> validation -> cost matching -> repository publication -> profit calculation/finalization.
3. Preserve versioned contracts. Current ERP batch transport is v2 with complete `warehouseEvidence`; v1 may be previewed as `legacy_partial` but cannot be formally published.
4. Keep domain validation close to the contract and business write. Do not rely on UI-only guards.
5. Keep anomaly decisions explicit, auditable, and reversible before finalization. Do not hide missing or suspicious cost behind a computed profit number.
6. For cross-module fields, update the contract, affected repository, UI status, bridge/inbox tests, and integration documentation together.

## Verification

At minimum run:

```powershell
pnpm --dir frontend test
pnpm --dir frontend build
pnpm --dir frontend erp:bridge:test
pnpm --dir frontend erp:inbox:test
pnpm --dir desktop verify
```

Add focused tests for source precedence, duplicate SKU/SKC mapping, incomplete evidence, zero or anomalous cost, manual confirmation provenance, finalized immutability, retry/idempotency, and legacy envelope rejection. Review UI labels to ensure reference cost is never presented as formal ERP cost.
