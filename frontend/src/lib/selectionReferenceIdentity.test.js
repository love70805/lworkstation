import { describe, expect, it } from "vitest";
import { buildSelectionReferenceRows, groupSelectionReferenceRows } from "./selectionReferences";

const costs = ["sku-a", "sku-b"].map(platformSku => ({ platformSku, unitCost: 4.59, publishedAt: "2026-08-01" }));
const source = { ledgerId: "ledger-a", batchId: "batch-a", period: "2026-08", store: "680店", sourceSheet: "台账变动明细", sourceRow: 2 };

describe("read-only selection reference identity", () => {
  it("groups ERP-only reference costs using an existing ledger and preserves provenance", () => {
    const input = { erpCosts: costs, ledgerIdentityRows: [
      { ...source, platformSku: " SKU-A ", platformSkc: "ＳＫＣ－１", attribute: "红色" },
      { ...source, sourceRow: 3, platformSku: "sku-b", platformSkc: "SKC-1", attribute: "蓝色" },
    ] };
    const before = structuredClone(input);
    const rows = buildSelectionReferenceRows(input);
    expect(rows).toHaveLength(2);
    expect(groupSelectionReferenceRows(rows)).toMatchObject([{ platformSkc: "SKC-1", skuCount: 2 }]);
    expect(rows[0]).toMatchObject({ attribute: "红色", platformSkcSource: "ledger", attributeSource: "ledger", referenceUnitCost: 4.59, latestPeriod: null,
      platformSkcEvidence: [{ value: "SKC-1", sources: [{ ...source, kind: "ledger" }] }] });
    expect(input).toEqual(before);
  });

  it("keeps catalog values and exposes differing evidence; fills empty catalog fields", () => {
    const [row] = buildSelectionReferenceRows({
      platformSkus: [{ platformSku: "sku-a", platformSkc: "MANUAL", attribute: "人工属性" }],
      ledgerIdentityRows: [{ ...source, platformSku: "sku-a", platformSkc: "LEDGER", attribute: "台账属性" }],
    });
    expect(row).toMatchObject({ platformSkc: "MANUAL", attribute: "人工属性", platformSkcSource: "catalog" });
    expect(row.platformSkcEvidence[0].value).toBe("LEDGER");
    const [empty] = buildSelectionReferenceRows({ platformSkus: [{ platformSku: "sku-a", platformSkc: "", attribute: "" }], ledgerIdentityRows: [{ ...source, platformSku: "sku-a", platformSkc: "LEDGER", attribute: "台账属性" }] });
    expect(empty).toMatchObject({ platformSkc: "LEDGER", attribute: "台账属性" });
  });

  it("leaves conflicting months/stores unresolved and never substitutes a supplier or warehouse ID", () => {
    const rows = buildSelectionReferenceRows({ erpCosts: costs, ledgerIdentityRows: [
      { ...source, platformSku: "sku-a", platformSkc: "SKC-A", attribute: "红色" },
      { ...source, store: "其他店", period: "2026-07", platformSku: "sku-a", platformSkc: "SKC-B", attribute: "蓝色" },
      { ...source, platformSku: "sku-b", supplierNumber: "SUPPLIER", warehouseSku: "WAREHOUSE", platformSkc: "" },
      { ...source, platformSku: "ledger-only", platformSkc: "NO-REFERENCE" },
      { platformSku: "", platformSkc: "EMPTY-SKU" },
    ], profitLines: [{ platformSku: "sku-b", groupSkc: "SUPPLIER", quantity: 1 }] });
    expect(rows).toHaveLength(3);
    expect(rows.find(row => row.canonicalPlatformSku === "LEDGER-ONLY")).toMatchObject({
      platformSkc: "NO-REFERENCE", referenceUnitCost: null, latestQuantity: 0, latestProfit: null, productId: null,
    });
    expect(rows.find(row => row.platformSku === "sku-a")).toMatchObject({ platformSkc: "", attribute: "", platformSkcConflict: true, attributeConflict: true });
    expect(rows.find(row => row.platformSku === "sku-b").platformSkc).toBe("");
  });

  it("uses explicit finalized platform identity and retains conflicts against ledger history", () => {
    const [row] = buildSelectionReferenceRows({ erpCosts: [costs[0]], profitLines: [{ platformSku: "sku-a", platformSkc: "FINAL", attribute: "默认", period: "2026-07" }] });
    expect(row).toMatchObject({ platformSkc: "FINAL", platformSkcSource: "profit", attribute: "默认" });
    const [conflict] = buildSelectionReferenceRows({ erpCosts: [costs[0]], profitLines: [{ platformSku: "sku-a", platformSkc: "FINAL" }], ledgerIdentityRows: [{ ...source, platformSku: "sku-a", platformSkc: "DIFFERENT" }] });
    expect(conflict.platformSkc).toBe("");
    expect(conflict.platformSkcConflict).toBe(true);
  });
});
