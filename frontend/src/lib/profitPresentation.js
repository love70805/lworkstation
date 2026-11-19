import Decimal from 'decimal.js';
import { legacyReportLine } from '../domain/profitReports';
import { createLedgerGroupKey, createLedgerSkuKey } from '../domain/ledgerImport';
import { canonicalPlatformSku } from '../domain/identifiers';
import { manualSnapshot, selectManualOverride, manualCostConflicts, storeSkuKey } from '../domain/manualCostOverride';

// Decorate computed rows without calculating their amounts again.
export function presentReportProducts(lines, snapshot) {
  const costs = new Map((snapshot.costs ?? []).map(row => [canonicalPlatformSku(row.platformSku), row]));
  const approvalsBySku = new Map();
  const manualByScope = new Map();
  const conflicts = manualCostConflicts(snapshot.approvals, snapshot.ledger);
  for (const approval of snapshot.approvals ?? []) {
    const key = canonicalPlatformSku(approval.platformSku);
    if (manualSnapshot(approval)?.kind === 'manual_override') {
      const scopedKey = storeSkuKey(manualSnapshot(approval).store, key);
      if (!manualByScope.has(scopedKey)) manualByScope.set(scopedKey, []);
      manualByScope.get(scopedKey).push(approval);
    } else if (approval.status === 'approved' && String(approval.approvedAt) >= String(approvalsBySku.get(key)?.approvedAt ?? '')) approvalsBySku.set(key, approval);
  }
  const firstOrders = snapshot.pageSales?.firstOrders ?? new Map();
  const references = snapshot.pageSales?.references ?? new Map();
  if (!snapshot.pageSales) for (const source of snapshot.rows ?? []) {
    firstOrders.set(source.id, source.order1688);
    if (source.hasDirectUnitCost) references.set(`${source.groupKey ?? createLedgerGroupKey(source)}::${source.skuKey ?? createLedgerSkuKey(source)}`, new Decimal(source.directUnitCost ?? 0).toDecimalPlaces(2, Decimal.ROUND_DOWN).toNumber());
  }
  return lines.map(line => {
    const key = canonicalPlatformSku(line.platformSku);
    const cost = costs.get(key);
    const approval = approvalsBySku.get(key);
    const manualOverride = selectManualOverride(manualByScope.get(storeSkuKey(line.store, key)), { workspaceId: snapshot.ledger.workspaceId, ledgerId: snapshot.ledger.id, store: line.store, platformSku: line.platformSku });
    const groupKey = createLedgerGroupKey(line);
    const referenceUnitCost = references.get(`${groupKey}::${createLedgerSkuKey(line)}`);
    const reference1688Cost = approval?.referenceCost ?? (referenceUnitCost > 0 ? { unitCost: referenceUnitCost, orderNumber: firstOrders.get(line.sourceRows?.[0]?.id) } : null);
    return { ...legacyReportLine(line), id: `${groupKey}::${createLedgerSkuKey(line)}`, groupKey, manualOverride, manualCostConflict: conflicts.get(storeSkuKey(line.store, key)), approval, reference1688Cost, warehouseSku: cost?.warehouseSku ?? null, orderNumber: line.orderNumber || cost?.orderNumber || reference1688Cost?.orderNumber || null };
  });
}
