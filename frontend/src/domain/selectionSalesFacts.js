import Decimal from "decimal.js";
import { buildSelectionLedgerPriceIndex } from "./selectionLedgerPrices";
import { prepareSelectionSalesLabelFacts } from "./selectionSalesLabels";
const ExactQuantity = Decimal.clone({ precision: 80 });

// Immutable, disposable facts only. Original business rows and source evidence
// remain in the ledger; no catalog ownership or manual field is cached here.
export function prepareSelectionSalesFacts({ salesRows = [], ledgers = [], importBatches = [], workspaceId }) {
  const ledgerById = new Map(ledgers.filter(row => row.workspaceId === workspaceId).map(row => [row.id, row]));
  const batches = new Map(importBatches.filter(row => row.workspaceId === workspaceId && row.status === "completed" && ledgerById.has(row.ledgerId)).map(row => [row.id, row]));
  const rows = salesRows.filter(row => row.workspaceId === workspaceId && batches.get(row.batchId)?.ledgerId === row.ledgerId);
  const identities = new Map();
  for (const row of rows) {
    const identity = { workspaceId, ledgerId: row.ledgerId, batchId: row.batchId, period: ledgerById.get(row.ledgerId).period,
      platformSku: row.platformSku ?? row.sku, platformSkc: row.platformSkc, attribute: row.attribute,
      store: row.store, supplierNumber: row.supplierNumber, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, sourceOrder: row.id };
    const key = JSON.stringify([identity.ledgerId, identity.batchId, identity.platformSku, identity.platformSkc, identity.attribute, identity.store, identity.supplierNumber]);
    const previous = identities.get(key);
    if (previous) previous.sourceCount++;
    else identities.set(key, { ...identity, sourceCount: 1 });
  }
  const ledgerPriceIndex = buildSelectionLedgerPriceIndex({ salesRows: rows, importBatches, ledgers, workspaceId, compactEvidence: true });
  // Decimal instances cannot cross Worker/IndexedDB structured clone safely.
  for (const scopes of ledgerPriceIndex.values()) for (const scope of scopes.values()) {
    scope.totals = new Map([...scope.totals].map(([price, total]) => [price, total.toFixed()]));
  }
  const coordinates = new Map();
  for (const row of rows) {
    if (!row.platformSkc || !(row.platformSku ?? row.sku) || row.isDeduction || /盘亏|扣款|罚款|违约/.test(row.movementType ?? "") || row.store !== batches.get(row.batchId)?.store) continue;
    const batch = batches.get(row.batchId);
    const key = row.sourceRow != null ? JSON.stringify([row.ledgerId, batch.fileHash ?? batch.id, row.store, row.sourceSheet ?? "", row.sourceRow]) : `id:${row.id}`;
    if (!coordinates.has(key)) coordinates.set(key, []);
    coordinates.get(key).push(row);
  }
  const coverGroups = new Map(), coverDuplicates = [];
  for (const group of coordinates.values()) {
    // Keep ambiguous source coordinates individually: the final ERP ledger
    // choice may include only one side, so their conflict cannot be predecided.
    if (group.length > 1) { coverDuplicates.push(...group); continue; }
    const row = group[0], quantity = row.quantityExact ?? row.quantity ?? row.qty;
    const valid = Number.isFinite(Number(quantity));
    const key = JSON.stringify([row.ledgerId, row.batchId, row.platformSkc, row.platformSku ?? row.sku, row.store, valid]);
    if (!coverGroups.has(key)) coverGroups.set(key, { workspaceId, ledgerId: row.ledgerId, batchId: row.batchId, platformSkc: row.platformSkc, platformSku: row.platformSku ?? row.sku, store: row.store, selectionFactId: key, quantityExact: valid ? new ExactQuantity(0) : "invalid" });
    const aggregate = coverGroups.get(key);
    if (valid) aggregate.quantityExact = aggregate.quantityExact.plus(quantity);
  }
  const coverRows = [...coverGroups.values()].map(row => ({ ...row, quantityExact: String(row.quantityExact) }));
  for (const row of coverDuplicates) coverRows.push({ id: row.id, workspaceId, ledgerId: row.ledgerId, batchId: row.batchId, platformSkc: row.platformSkc, platformSku: row.platformSku ?? row.sku, store: row.store, sourceSheet: row.sourceSheet, sourceRow: row.sourceRow, quantityExact: row.quantityExact ?? row.quantity ?? row.qty });
  return { workspaceId, sourceRowCount: rows.length, ledgerIdentityRows: [...identities.values()], ledgerPriceIndex,
    coverRows, labelFacts: prepareSelectionSalesLabelFacts({ salesRows: rows, importBatches, ledgers, workspaceId }) };
}

// Per-ledger partitions stay below the entry limit and can survive restart.
// These arrays/maps are new; consuming a projection never mutates cached facts.
export function combineSelectionSalesFacts(parts, workspaceId) {
  const ledgerPriceIndex = new Map(), completeMonths = new Map();
  for (const part of parts) {
    for (const [sku, scopes] of part.ledgerPriceIndex) {
      if (!ledgerPriceIndex.has(sku)) ledgerPriceIndex.set(sku, new Map());
      for (const [scope, value] of scopes) ledgerPriceIndex.get(sku).set(scope, value);
    }
    for (const [store, months] of part.labelFacts.completeMonths) {
      if (!completeMonths.has(store)) completeMonths.set(store, new Set());
      for (const month of months) completeMonths.get(store).add(month);
    }
  }
  return { workspaceId, sourceRowCount: parts.reduce((sum, part) => sum + part.sourceRowCount, 0), ledgerIdentityRows: parts.flatMap(part => part.ledgerIdentityRows).sort((a, b) => Number(a.sourceOrder) - Number(b.sourceOrder)), ledgerPriceIndex,
    coverRows: parts.flatMap(part => part.coverRows), labelFacts: { rows: parts.flatMap(part => part.labelFacts.rows), conflicts: parts.flatMap(part => part.labelFacts.conflicts), completeMonths, completeStoreNames: parts.flatMap(part => part.labelFacts.completeStoreNames) } };
}
