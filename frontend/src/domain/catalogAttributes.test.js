import { describe, expect, it } from "vitest";
import { catalogAttributeKey } from "./catalogAttributes";
import { buildReferenceIdentityIndex, projectReferenceIdentity } from "./selectionReferenceIdentity";
import { createLedgerCatalogDraftBuilder } from "./ledgerCatalogDraft";

describe("catalog attribute comparison", () => {
  it.each(["粉色", "蓝色", "均码", "黑色", "白色"])("accepts order-only %s / B differences and preserves both raw sources", color => {
    const ledger = `${color}-B`, erp = `B-${color}`;
    const index = buildReferenceIdentityIndex({
      ledgerIdentityRows: [{ platformSku: "SKU-A", platformSkc: "SKC-A", attribute: ledger, ledgerId: "L", period: "2026-09" }],
      erpCatalogRows: [{ platformSku: "SKU-A", platformSkc: "SKC-A", attribute: erp, warehouseSku: "W" }],
    });
    const row = projectReferenceIdentity({ attribute: ledger }, index.get("SKU-A"));
    expect(row).toMatchObject({ attribute: ledger, attributeConflict: false, attributeOrderEquivalent: true, platformSkcConflict: false });
    expect(row.attributeEvidence.map(item => item.value).sort()).toEqual([ledger, erp].sort());
    expect(row.attributeEvidence.flatMap(item => item.sources.map(source => source.kind)).sort()).toEqual(["erp", "ledger"]);
  });
  it("accepts explicit dimensions while preserving values and rejecting duplicate dimensions", () => {
    expect(catalogAttributeKey("粉色-M")).toBe(catalogAttributeKey("M-粉色"));
    expect(catalogAttributeKey("Black-XL")).toBe(catalogAttributeKey("XL-Black"));
    expect(catalogAttributeKey("颜色:粉色;规格:B")).toBe(catalogAttributeKey("规格:B;颜色:粉色"));
    expect(catalogAttributeKey("颜色:粉色;颜色:蓝色")).not.toBe(catalogAttributeKey("颜色:蓝色;颜色:粉色"));
  });
  it.each([["粉色-B", "蓝色-B"], ["1-3", "3-1"], ["10-20cm", "20cm-10"], ["红色-蓝色", "蓝色-红色"], ["M-L", "L-M"], ["B-B-粉色", "粉色-B-B"]])("keeps real or ambiguous differences: %s / %s", (left, right) => {
    expect(catalogAttributeKey(left)).not.toBe(catalogAttributeKey(right));
  });
  it("never suppresses a SKC identity conflict even if attributes are equivalent", () => {
    const index = buildReferenceIdentityIndex({ ledgerIdentityRows: [{ platformSku: "A", platformSkc: "S1", attribute: "粉色-B" }], erpCatalogRows: [{ platformSku: "A", platformSkc: "S2", attribute: "B-粉色" }] });
    expect(projectReferenceIdentity({}, index.get("A"))).toMatchObject({ platformSkcConflict: true, attributeConflict: false });
  });
  it("does not flag the same SKU in a streamed import solely for attribute order", () => {
    const builder = createLedgerCatalogDraftBuilder();
    builder.addRows([{ platformSku: "A", platformSkc: "S", store: "店铺", attribute: "粉色-B" }, { platformSku: "A", platformSkc: "S", store: "店铺", attribute: "B-粉色" }], "BATCH");
    expect(builder.finish()).toMatchObject({ issues: [], candidates: [{ attribute: "粉色-B" }] });
  });
});
