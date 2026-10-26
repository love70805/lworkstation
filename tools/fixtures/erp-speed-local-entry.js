// Bundled only by the benchmark runner and loaded at an isolated test origin.
import { db } from '../../frontend/src/data/db/clientDatabase';
import { setActiveMemberContext } from '../../frontend/src/data/repositories/selectionRepository';
import { createOrGetMonthlyLedger, saveErpCostRequest, receiveErpCostInboxEnvelope, getLedgerSnapshot } from '../../frontend/src/data/repositories/profitRepository';
import { readCachedReportProducts } from '../../frontend/src/data/repositories/derivedComputationService';
import { buildErpCostRequest } from '../../frontend/src/domain/erpCosts';

let ledger;
export async function setup(requestId, targets) {
  // This module is served only at benchmark.invalid inside a fresh Electron profile.
  if (location.hostname !== 'benchmark.invalid') throw new Error('Isolated benchmark origin required');
  await db.delete(); await db.open();
  await setActiveMemberContext({ workspaceId: 'workspace-default', memberId: 'benchmark-finance', role: 'finance' });
  ledger = await createOrGetMonthlyLedger({ period: '2026-09', warehouseRate: 0.7 });
  await db.salesRows.bulkAdd(targets.map(row => ({ ...row, workspaceId: ledger.workspaceId, ledgerId: ledger.id, quantity: 2, amount: 100, importedAt: '2026-09-30T00:00:00Z' })));
  const request = buildErpCostRequest({ id: requestId, workspaceId: ledger.workspaceId, ledgerId: ledger.id, ledgerPeriod: ledger.period, platformSkcs: targets.map(row => row.platformSkc), expectedSkus: targets, requestedAt: new Date().toISOString(), requestedBy: 'benchmark-finance' });
  await saveErpCostRequest(request);
  return { ledger, request };
}
export async function adopt(envelope) {
  const start = performance.now();
  const receipt = await receiveErpCostInboxEnvelope({ envelope, receivedVia: 'isolated-native-benchmark' });
  const adopted = performance.now();
  const snapshot = await getLedgerSnapshot(ledger.id);
  const products = await readCachedReportProducts({ snapshot });
  const finished = performance.now();
  return { receiveAndAdoptMs: adopted - start, profitReadAndComputeMs: finished - adopted, totalMs: finished - start,
    adoptionError: receipt.adoptionError ?? null, adoption: receipt.adoption,
    costs: snapshot.costs.map(row => ({ platformSku: row.platformSku, unitCost: row.unitCost })),
    products: products.map(row => ({ platformSku: row.platformSku, unitCostExact: row.unitCostExact, profitExact: row.profitExact, costSource: row.costSource })) };
}
export async function close() { db.close(); }
