import { legacyReportLine } from '../domain/profitReports';
import { createLedgerGroupKey, createLedgerSkuKey } from '../domain/ledgerImport';
import { canonicalPlatformSku } from '../domain/identifiers';
import { manualSnapshot, selectManualOverride, storeSkuKey } from '../domain/manualCostOverride';

// Decorate computed rows without calculating their amounts again.
export function presentReportProducts(lines, snapshot) {
  const costs = new Map((snapshot.costs ?? []).map(row => [canonicalPlatformSku(row.platformSku), row]));
  const approvalsBySku = new Map();
  const manualByScope = new Map();
  for (const approval of snapshot.approvals ?? []) {
    const key = canonicalPlatformSku(approval.platformSku);
    if (manualSnapshot(approval)?.kind === 'manual_override') {
      const scopedKey = storeSkuKey(manualSnapshot(approval).store, key);
      if (!manualByScope.has(scopedKey)) manualByScope.set(scopedKey, []);
      manualByScope.get(scopedKey).push(approval);
    } else if (approval.status === 'approved' && String(approval.approvedAt) >= String(approvalsBySku.get(key)?.approvedAt ?? '')) approvalsBySku.set(key, approval);
  }
  const sourceById = new Map((snapshot.rows ?? []).map(row => [row.id, row]));
  return lines.map(line => {
    const key = canonicalPlatformSku(line.platformSku);
    const cost = costs.get(key);
    const approval = approvalsBySku.get(key);
    const manualOverride = selectManualOverride(manualByScope.get(storeSkuKey(line.store, key)), { workspaceId: snapshot.ledger.workspaceId, ledgerId: snapshot.ledger.id, store: line.store, platformSku: line.platformSku });
    const firstSource = sourceById.get(line.sourceRows?.[0]?.id);
    const reference1688Cost = approval?.referenceCost ?? (Number(firstSource?.directUnitCost) > 0 ? { unitCost: firstSource.directUnitCost, orderNumber: firstSource.order1688 } : null);
    const groupKey = createLedgerGroupKey(line);
    return { ...legacyReportLine(line), id: `${groupKey}::${createLedgerSkuKey(line)}`, groupKey, manualOverride, approval, reference1688Cost, warehouseSku: cost?.warehouseSku ?? null, orderNumber: line.orderNumber || cost?.orderNumber || reference1688Cost?.orderNumber || null };
  });
}
