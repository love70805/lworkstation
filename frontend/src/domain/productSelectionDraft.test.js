import { describe, expect, it } from "vitest";
import { normalizeProductTags, productDraftReferences, productSalePrice, productSaveReadiness } from "./productSelectionDraft";

const variant = { platformSku: "SKU-A", attribute: "红色", purchaseUnitPrice: 20, purchasePackCount: 1, unitsPerPack: 1, salePrice: 30 };
const draft = { name: "商品 A", platformSkc: "SKC-A", store: "甲店", sourceUrl: "https://detail.1688.com/offer/1.html", variants: [variant] };

describe("current selection draft", () => {
  it("uses edited supplier quotations instead of old persisted 1688 references", () => {
    const [reference] = productDraftReferences(draft, [{ canonicalPlatformSku: "SKU-A", referenceKind: "supplier_landed", referenceUnitCost: 10 }]);
    expect(reference).toMatchObject({ unitCost: 20, referenceKind: "supplier_landed", sourceLabel: "1688 参考" });
    expect(productDraftReferences({ ...draft, variants: [{ ...variant, purchaseUnitPrice: "" }] }, [{ canonicalPlatformSku: "SKU-A", referenceKind: "supplier_landed", referenceUnitCost: 10 }])[0].unitCost).toBeNull();
  });
  it("keeps authoritative history and shows the separate current supplier quote", () => {
    for (const referenceKind of ["erp_history", "manual_confirmed", "finalized_profit_history"]) {
      expect(productDraftReferences(draft, [{ canonicalPlatformSku: "SKU-A", referenceKind, referenceUnitCost: 12 }])[0]).toMatchObject({ unitCost: 12, referenceKind, supplier: { unitCost: 20 } });
    }
  });
  it("matches supplier quotes by SKU and uses the lowest current quote", () => {
    const suppliers = [
      { supplierName: "A", variants: [{ ...variant, purchaseUnitPrice: 25 }] },
      { supplierName: "B", variants: [{ ...variant, purchaseUnitPrice: 15 }] },
    ];
    expect(productDraftReferences({ ...draft, suppliers })[0]).toMatchObject({ unitCost: 15, supplier: { supplierName: "B" } });
    expect(productDraftReferences({ variants: [{ platformSku: "" }] })[0].unitCost).toBeNull();
  });
  it("distinguishes an empty sale price from an explicit zero", () => {
    for (const value of [null, undefined, "", " ", "invalid", -1]) expect(productSalePrice(value)).toBeNull();
    expect(productSalePrice("0")).toBe(0);
    expect(productSalePrice("0.01")).toBe(0.01);
  });
  it("normalizes tag delimiters only when committing the raw input", () => {
    expect(normalizeProductTags("A,B，C、A\n D ")).toEqual(["A", "B", "C", "D"]);
  });
  it("requires SKU and positive sale price for readiness, including custom statuses", () => {
    expect(productSaveReadiness({ draft, statusDefinition: { requiresReadiness: true } }).valid).toBe(true);
    expect(productSaveReadiness({ draft: { ...draft, variants: [] }, statusDefinition: { requiresReadiness: true } }).issues).toContain("platform_sku_required");
    expect(productSaveReadiness({ draft: { ...draft, variants: [{ ...variant, salePrice: 0 }] }, statusDefinition: { requiresReadiness: true } }).issues).toContain("variant_0_sale_price_required");
    expect(productSaveReadiness({ draft: { name: "未完成" }, statusDefinition: { requiresReadiness: false } }).valid).toBe(true);
  });
});
