import { aggregateLedgerRows, flattenLedgerGroups } from "./ledgerImport";
import { canonicalPlatformSku } from "./identifiers";
import { resolveFormalCostDecision } from "./costPolicy";
import { selectManualOverride } from "./manualCostOverride";
import { calculateExactProfitLine } from "./profitCalculations";

export function calculateFormalLedgerRows({ ledger, salesRows, erpCosts, approvals }) {
  const costs = new Map(erpCosts.map((row) => [canonicalPlatformSku(row.platformSku), row]));
  return flattenLedgerGroups(aggregateLedgerRows(salesRows)).map(({ id: _id, ...row }) => {
    const scope = { workspaceId: ledger.workspaceId, ledgerId: ledger.id, store: row.store, platformSku: row.platformSku };
    const erpCost = costs.get(row.canonicalPlatformSku);
    const decision = resolveFormalCostDecision({ ...scope, erpCost, manualOverride: selectManualOverride(approvals, scope) });
    return { ...row, ...calculateExactProfitLine({ revenue: row.revenue, quantity: row.qty, penalty: row.penalty, warehouseRate: ledger.warehouseRate, costDecision: decision }),
      unitCost: decision.unitCost, costSource: decision.source, costSourceRecordId: decision.sourceRecordId, costApprovalId: decision.approvalId, costPolicyVersion: decision.policyVersion, orderNumber: erpCost?.orderNumber ?? null };
  });
}

export function comparableProfitLines(lines) {
  return lines.map((row) => JSON.stringify([row.store, canonicalPlatformSku(row.platformSku), row.quantity, row.revenue, row.penalty, row.unitCost, row.purchaseCost, row.warehouseCost, row.profit, row.costSource, row.costSourceRecordId, row.costApprovalId ?? null])).sort();
}
