import { describe, expect, it } from "vitest";
import { collectErpPlatformSkcs } from "./erpQueryScope";

describe("ERP query scope", () => {
  it("deduplicates platform SKC and preserves display casing", () => {
    expect(collectErpPlatformSkcs([
      { platformSkc: " skc-1 " },
      { platformSkc: "SKC-1" },
      { platformSkc: "SKC-2", platformSku: "SKU-2" },
    ])).toMatchObject({ platformSkcs: ["skc-1", "SKC-2"], missingCount: 0 });
  });

  it("does not substitute supplier number or platform SKU", () => {
    const result = collectErpPlatformSkcs([
      { supplierNumber: "SUP-1", platformSku: "SKU-1", sourceRow: 2 },
    ]);
    expect(result.platformSkcs).toEqual([]);
    expect(result.missingRows[0]).toMatchObject({ sourceRow: 2, platformSku: "SKU-1", supplierNumber: "SUP-1" });
  });
});
