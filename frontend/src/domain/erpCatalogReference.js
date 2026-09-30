import Decimal from "decimal.js";
import { canonicalPlatformSkc, canonicalPlatformSku, canonicalWarehouseSku } from "./identifiers";
import { normalizePurchaseEvidenceRecord, validateCostPeriod } from "./erpPurchaseEvidence";
import { selectLatestPurchaseRecords } from "./erpPurchaseSelection";

/** A separate reference projection. It never creates a sale or a formal-cost row. */
export function erpCatalogReferenceCosts(envelope, { batchId, publishedAt, period } = {}) {
  if (!period) return [];
  validateCostPeriod(period);
  const scope = new Set((envelope.query?.platformSkcs ?? []).map(item => canonicalPlatformSkc(item.platformSkc ?? item)));
  const evidenceBySku = new Map((envelope.warehouseEvidence ?? []).map(evidence => [canonicalWarehouseSku(evidence.warehouseSku), evidence]));
  const output = new Map();
  for (const row of envelope.rows ?? []) {
    for (const mapping of [row, ...(row.catalogMappings ?? [])]) {
      if (!mapping.platformSku || !mapping.platformSkc || !mapping.warehouseSku || !scope.has(canonicalPlatformSkc(mapping.platformSkc))) continue;
      if (canonicalWarehouseSku(mapping.warehouseSku) !== canonicalWarehouseSku(row.warehouseSku)) continue;
      const evidence = evidenceBySku.get(canonicalWarehouseSku(mapping.warehouseSku));
      if (!evidence?.evidenceComplete || (evidence.sourceWarnings ?? []).some(warning => /detail_failure|mapping_failure|purchase.*incomplete/.test(warning))) continue;
      // ERP purchaseQuantity and purchaseUnitPrice are already expressed for
      // the warehouse item. The 1688 purchase proportion is procurement
      // composition, not a second multiplier on this warehouse unit cost.
      const normalized = (evidence.purchaseRecords ?? []).map((record, index) => normalizePurchaseEvidenceRecord(record, index, mapping.warehouseSku, { period }));
      const records = selectLatestPurchaseRecords(normalized);
      if (!records.length || records.some(record => canonicalWarehouseSku(record.warehouseSku) !== canonicalWarehouseSku(mapping.warehouseSku))) continue;
      const quantity = records.reduce((total, record) => total.plus(record.quantity), new Decimal(0));
      if (!quantity.gt(0)) continue;
      const amount = records.reduce((total, record) => total.plus(new Decimal(record.quantity).times(record.unitPrice)), new Decimal(0));
      const cost = amount.div(quantity);
      const item = { id: `ERP-REFERENCE:${batchId}:${canonicalPlatformSku(mapping.platformSku)}:${canonicalWarehouseSku(mapping.warehouseSku)}`,
        platformSku: mapping.platformSku, platformSkc: mapping.platformSkc, warehouseSku: mapping.warehouseSku, evidenceRef: evidence.evidenceRef,
        workspaceId: envelope.workspaceId, ledgerId: envelope.ledgerId ?? null, period, unitCost: cost.toNumber(), unitCostExact: cost.toString(), currency: "CNY",
        batchId, publishedAt, referenceKind: "erp_catalog_reference", authoritativeSource: "erp_reference", calculationMode: "reference",
        selectedRecordIds: records.map(record => record.recordId), source: "verified_purchase_evidence", referenceOnly: true };
      const key = canonicalPlatformSku(mapping.platformSku);
      const previous = output.get(key);
      if (previous?.conflict) continue;
      // A SKU with contradictory mappings must be resolved; never choose the cheapest branch.
      if (previous && (canonicalPlatformSkc(previous.platformSkc) !== canonicalPlatformSkc(item.platformSkc) || canonicalWarehouseSku(previous.warehouseSku) !== canonicalWarehouseSku(item.warehouseSku) || previous.unitCostExact !== item.unitCostExact)) output.set(key, { conflict: true });
      else if (!previous?.conflict) output.set(key, item);
    }
  }
  return [...output.values()].filter(item => !item.conflict);
}
