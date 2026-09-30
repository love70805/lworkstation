import { expect, it } from "vitest";
import { erpCatalogReferenceCosts } from "./erpCatalogReference";
import { calculateWarehouseCostDecision } from "./erpCostResolution";
import { buildSelectionReferenceRows } from "../lib/selectionReferences";

const envelope = (price, ratio = "1-1") => ({ workspaceId: "W", query: { platformSkcs: ["P"] }, rows: [{ platformSku: "S", platformSkc: "P", warehouseSku: "WH", purchaseCatalog: { purchaseProportion1688: ratio } }], warehouseEvidence: [{ warehouseSku: "WH", evidenceRef: "warehouse:WH", evidenceComplete: true, purchaseRecords: [{ recordId: "R", warehouseSku: "WH", purchaseDate: "2026-08-28", quantity: 6, unitPrice: price, totalPrice: 6 * price, purchaseCatalog: { purchaseProportion1688: ratio } }, { recordId: "FUTURE", warehouseSku: "WH", purchaseDate: "2026-09-01", quantity: 100, unitPrice: 99 }] }] });

it("does not choose a reference across contradictory warehouse catalog mappings", () => {
  const rows = buildSelectionReferenceRows({ erpCatalogRows: [
    { platformSku: "S", platformSkc: "P", warehouseSku: "WH", catalogQuerySkcs: ["P"] },
    { platformSku: "S", platformSkc: "P", warehouseSku: "WH-OTHER", catalogQuerySkcs: ["P"] },
  ], erpCatalogReferences: erpCatalogReferenceCosts(envelope(4), { batchId: "B", period: "2026-08" }) });
  expect(rows[0]).toMatchObject({ erpCatalogRelationshipConflict: true, referenceUnitCost: null });
});

it.each([["1-1", 4, 6], ["1-2", 6, 6], ["2-1", 3, 20]])("uses ERP warehouse-unit cost for %s procurement composition without applying the ratio again", (ratio, price, quantity) => {
  const source = envelope(price, ratio);
  source.rows[0].unitConversion = { warehouseUnits: 99, platformUnits: 1, source: "erp_platform_mapping", sourceRef: "legacy" };
  source.warehouseEvidence[0].purchaseRecords[0].quantity = quantity;
  source.warehouseEvidence[0].purchaseRecords[0].totalPrice = quantity * price;
  const reference = erpCatalogReferenceCosts(source, { batchId: "B", period: "2026-08" });
  const formal = calculateWarehouseCostDecision({ warehouseSku: "WH", purchaseRecords: source.warehouseEvidence[0].purchaseRecords, period: "2026-08" });
  expect(reference).toMatchObject([{ unitCost: price, referenceOnly: true, selectedRecordIds: ["R"], referenceKind: "erp_catalog_reference" }]);
  expect(reference[0].unitConversion).toBeUndefined();
  expect(formal.formalUnitCost).toBe(price);
  expect(formal.totalQuantity).toBe(quantity);
  expect(formal.totalPrice).toBe(quantity * price);
});
it("retains true zero and a small positive reference rather than converting them to missing", () => {
  expect(erpCatalogReferenceCosts(envelope(0), { period: "2026-08" })[0].unitCost).toBe(0);
  expect(erpCatalogReferenceCosts(envelope(0.000001), { period: "2026-08" })[0].unitCost).toBe(0.000001);
});
it("refuses incomplete evidence and future-only purchases", () => {
  const source = envelope(4); source.warehouseEvidence[0].evidenceComplete = false;
  expect(erpCatalogReferenceCosts(source, { period: "2026-08" })).toEqual([]);
  const future = envelope(4); future.warehouseEvidence[0].purchaseRecords.shift();
  expect(erpCatalogReferenceCosts(future, { period: "2026-08" })).toEqual([]);
});
