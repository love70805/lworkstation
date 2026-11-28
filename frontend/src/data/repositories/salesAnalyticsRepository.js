import { db } from "../db/clientDatabase";
import { getActiveMemberContext } from "./selectionRepository";
import Dexie from 'dexie';
import { cachedDerived, sourceRevision, ledgerTableRevision, assertSourceRevision, retrySourceRead, observeSourceRevision } from '../db/derivedCache';
import { readLedgerSalesRows } from './ledgerReadCache';
import { readPageSaleChunks } from './ledgerPageSalesRepository';
import { periodDetailColumns } from '../../domain/ledgerPageSales';
import { runDerivedComputation } from './derivedComputationService';
import { canonicalStore } from "../../domain/batchSalesImport";

function cachedSales(ledgerId, options) {
  if (Dexie.currentTransaction?.mode === 'readwrite') return options.compute();
  return cachedDerived({ ...options, revisionReader: () => ledgerTableRevision('salesRows', ledgerId) });
}

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
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  const { workspaceId, ledgerId, store = 'all' } = scope;
  return retrySourceRead(async () => {
    const revision = sourceRevision();
    const current = await getActiveMemberContext();
    const ledger = await db.ledgers.get(ledgerId);
    if (!workspaceId || current.workspaceId !== workspaceId || ledger?.workspaceId !== workspaceId) throw new Error('账本不属于当前工作区。');
    assertSourceRevision(revision);
    await observeSourceRevision();
    const result = await cachedSales(ledgerId, { scope: [workspaceId, ledgerId, store === 'all' ? null : canonicalStore(store), ledger.period, today], formula: 'daily-sales@5-chart',
      compute: async () => {
        const pageChunks = await readPageSaleChunks(workspaceId, ledgerId, {parent:ledger});
        const hasStore = store === 'all' || pageChunks.some(chunk => [...chunk.stores.keys()].some(name => canonicalStore(name) === canonicalStore(store)));
        return { hasStore, data: await runDerivedComputation('sales', { pageChunks, workspaceId, period: ledger.period, store, today }) };
      } });
    assertSourceRevision(revision);
    if (!result.hasStore && !scope.allowMissingStore) throw new Error('店铺不属于当前账本。');
    return result.data;
  });
}

export async function readLedgerDailySalesDetails({ workspaceId, ledgerId, store = "all", date }) {
  const scope = { workspaceId, ledgerId, store, date };
  return readScopedSales(scope, async (rows, period) => ({ ...await cachedSales(ledgerId, { scope: [workspaceId, ledgerId, store === 'all' ? null : canonicalStore(store), period, date], formula: 'daily-details@1', compute: () => runDerivedComputation('day', { rows, period, date }) }), scope }));
}

export async function readLedgerPeriodSalesDetails({ workspaceId, ledgerId, store = 'all', date = null }) {
  const scope = { workspaceId, ledgerId, store, date };
  return retrySourceRead(async () => {
    const revision = sourceRevision();
    const [current, ledger] = await Promise.all([getActiveMemberContext(), db.ledgers.get(ledgerId)]);
    if (!workspaceId || current.workspaceId !== workspaceId || ledger?.workspaceId !== workspaceId) throw new Error('账本不属于当前工作区。');
    if (!await observeSourceRevision()) await db.salesRows.count();
    const { period } = ledger;
    const detail = await cachedSales(ledgerId, {
      scope: [workspaceId, ledgerId, store === 'all' ? null : canonicalStore(store), period, date],
      formula: 'period-sku-details@2',
      compute: async () => {
        const chunks = await readPageSaleChunks(workspaceId, ledgerId, { parent: ledger });
        return runDerivedComputation('period-detail', { detailChunks: chunks.map(periodDetailColumns), workspaceId, store, period, date });
      },
    });
    assertSourceRevision(revision);
    return { ...detail, scope };
  });
}

// Keep the displayed series together even when a long history exceeds the
// shared cache's entry limit. This retains only one workspace/store view.
let recentMonthlySeries;
export async function readWorkspaceSalesMonths({ workspaceId, store = 'all' }) {
  return retrySourceRead(async () => {
    const revision = sourceRevision();
    const current = await getActiveMemberContext();
    if (!workspaceId || current.workspaceId !== workspaceId) throw new Error('账本不属于当前工作区。');
    const ledgers = await db.ledgers.where('workspaceId').equals(workspaceId).toArray();
    if (!await observeSourceRevision()) await db.salesRows.count();
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const storeKey = store === 'all' ? null : canonicalStore(store);
    const previous = !Dexie.currentTransaction && recentMonthlySeries?.workspaceId === workspaceId
      && recentMonthlySeries.storeKey === storeKey ? recentMonthlySeries.entries : null;
    const entries = new Map();
    // Historical plotting retains compact summaries only. Read each cold ledger
    // transiently instead of filling the shared raw-row cache with up to 600k rows.
    for (const ledger of ledgers.sort((a, b) => a.period.localeCompare(b.period) || a.id.localeCompare(b.id))) {
      const calendar = ledger.period < today.slice(0, 7) ? 'closed' : today;
      const version = JSON.stringify([ledger.period, calendar, ledgerTableRevision('salesRows', ledger.id)]);
      const prior = previous?.get(ledger.id);
      if (prior?.version === version) {
        entries.set(ledger.id, prior);
        continue;
      }
      const chartMonth = await cachedSales(ledger.id, {
        scope: [workspaceId, ledger.id, storeKey, ledger.period, calendar],
        formula: 'monthly-chart@1',
        compute: async () => {
          const pageChunks = await readPageSaleChunks(workspaceId, ledger.id);
          assertSourceRevision(revision);
          const data = await runDerivedComputation('sales', { pageChunks, workspaceId, requireExplicitOwner: true, period: ledger.period, store, today });
          return data.chartMonth;
        },
      });
      entries.set(ledger.id, { version, month: { ...chartMonth, ledgerId: ledger.id } });
    }
    assertSourceRevision(revision);
    if (!Dexie.currentTransaction) recentMonthlySeries = { workspaceId, storeKey, entries };
    return Array.from(entries.values(), entry => entry.month);
  });
}
