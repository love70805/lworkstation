import { expect, it } from "vitest";
import { erpCatalogReferenceCosts } from "./erpCatalogReference";
import { buildSelectionReferenceRows } from "../lib/selectionReferences";

const envelope = price => ({ workspaceId: "W", query: { platformSkcs: ["P"] }, rows: [{ platformSku: "S", platformSkc: "P", warehouseSku: "WH", unitConversion: { warehouseUnits: 2, platformUnits: 1, source: "erp_platform_mapping", sourceRef: "mapping:WH:S" } }], warehouseEvidence: [{ warehouseSku: "WH", evidenceRef: "warehouse:WH", evidenceComplete: true, purchaseRecords: [{ recordId: "R", warehouseSku: "WH", purchaseDate: "2026-08-28", quantity: 6, unitPrice: price }, { recordId: "FUTURE", warehouseSku: "WH", purchaseDate: "2026-09-01", quantity: 100, unitPrice: 99 }] }] });

it("does not choose a reference across contradictory warehouse catalog mappings", () => {
  const rows = buildSelectionReferenceRows({ erpCatalogRows: [
    { platformSku: "S", platformSkc: "P", warehouseSku: "WH", catalogQuerySkcs: ["P"] },
    { platformSku: "S", platformSkc: "P", warehouseSku: "WH-OTHER", catalogQuerySkcs: ["P"] },
  ], erpCatalogReferences: erpCatalogReferenceCosts(envelope(4), { batchId: "B", period: "2026-08" }) });
  expect(rows[0]).toMatchObject({ erpCatalogRelationshipConflict: true, referenceUnitCost: null });
});

it("uses full warehouse purchase evidence and explicit conversion without adopting a cost", () => {
  expect(erpCatalogReferenceCosts(envelope(4), { batchId: "B", period: "2026-08" })).toMatchObject([{ unitCost: 8, referenceOnly: true, selectedRecordIds: ["R"], referenceKind: "erp_catalog_reference" }]);
});
it("retains true zero and a small positive reference rather than converting them to missing", () => {
  expect(erpCatalogReferenceCosts(envelope(0), { period: "2026-08" })[0].unitCost).toBe(0);
  expect(erpCatalogReferenceCosts(envelope(0.000001), { period: "2026-08" })[0].unitCost).toBe(0.000002);
});
it("refuses absent evidence, unclear units, future-only purchases, and contradictory identities", () => {
  const source = envelope(4); delete source.rows[0].unitConversion;
  expect(erpCatalogReferenceCosts(source, { period: "2026-08" })).toEqual([]);
  source.rows[0].unitConversion = envelope(4).rows[0].unitConversion; source.warehouseEvidence[0].evidenceComplete = false;
  expect(erpCatalogReferenceCosts(source, { period: "2026-08" })).toEqual([]);
  const future = envelope(4); future.warehouseEvidence[0].purchaseRecords.shift();
  expect(erpCatalogReferenceCosts(future, { period: "2026-08" })).toEqual([]);
});
