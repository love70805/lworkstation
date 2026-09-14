import { db } from "../db/clientDatabase";
import { getActiveMemberContext } from "./selectionRepository";
import { cachedDerived, sourceRevision, assertSourceRevision, retrySourceRead } from '../db/derivedCache';
import { readLedgerSalesRows } from './ledgerReadCache';
import { runDerivedComputation } from './derivedComputationService';
import { canonicalStore } from "../../domain/batchSalesImport";

function readScopedSales(scope, aggregate) {
  return retrySourceRead(() => readScopedSalesOnce(scope, aggregate));
}

async function readScopedSalesOnce({ workspaceId, ledgerId, store = "all", allowMissingStore = false }, aggregate) {
    const revision = sourceRevision();
    const current = await getActiveMemberContext();
    const ledger = await db.ledgers.get(ledgerId);
    if (!workspaceId || current.workspaceId !== workspaceId || !ledger || ledger.workspaceId !== workspaceId) throw new Error("账本不属于当前工作区。");
    const rows = await readLedgerSalesRows(workspaceId, ledgerId);
    if (!allowMissingStore && store !== "all" && !rows.some((row) => canonicalStore(row.store) === canonicalStore(store))) throw new Error("店铺不属于当前账本。");
    assertSourceRevision(revision);
    const result = await aggregate(store === "all" ? rows : rows.filter((row) => canonicalStore(row.store) === canonicalStore(store)), ledger.period);
    assertSourceRevision(revision);
    return result;
}

export async function readLedgerSalesAnalytics(scope) {
  // Keep this live-query result as the selected scope's read-only source. Date
  // clicks can reuse it without cloning the full ledger from IndexedDB again.
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const store = scope.store ?? 'all';
  return readScopedSales(scope, async (rows, period) => ({ ...await cachedDerived({ scope: [scope.workspaceId, scope.ledgerId, store === 'all' ? null : canonicalStore(store), period, today], formula: 'daily-sales@3-chart', revision: sourceRevision(), compute: () => runDerivedComputation('sales', { rows, period, store, today }) }), sourceRows: rows }));
}

export async function readLedgerDailySalesDetails({ workspaceId, ledgerId, store = "all", date }) {
  const scope = { workspaceId, ledgerId, store, date };
  return readScopedSales(scope, async (rows, period) => ({ ...await cachedDerived({ scope: [workspaceId, ledgerId, store === 'all' ? null : canonicalStore(store), period, date], formula: 'daily-details@1', revision: sourceRevision(), compute: () => runDerivedComputation('day', { rows, period, date }) }), scope }));
}
