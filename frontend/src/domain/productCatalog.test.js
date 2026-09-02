import { describe, expect, it } from "vitest";
import { calculateSupplierLandedUnitCost, validateProductDraft, validateProductSalesReadiness } from "./productCatalog";

describe("product catalog", () => {
  it("按批准公式计算 1688 参考落地单件成本", () => {
    expect(calculateSupplierLandedUnitCost({
      purchaseUnitPrice: 20,
      shippingAmount: 30,
      totalPurchasePacks: 10,
      handlingFee: 2,
      unitsPerPack: 5,
    })).toBe(5);
  });

  it("直接舍弃 1688 落地单件成本的小数点后两位", () => {
    expect(calculateSupplierLandedUnitCost({
      purchaseUnitPrice: 10.999,
      shippingAmount: 1,
      totalPurchasePacks: 3,
      handlingFee: 0,
      unitsPerPack: 1,
    })).toBe(11.33);
  });

  it("把平台 SKU 重复视为阻断项，但允许先保存待补资料的商品档案", () => {
    const validation = validateProductDraft({
      name: "测试商品",
      platformSkc: "SKC-1",
      shippingAmount: 10,
      variants: [
        { platformSku: " sku-a ", purchaseUnitPrice: 5, purchasePackCount: 1, unitsPerPack: 1 },
        { platformSku: "ＳＫＵ－Ａ", purchaseUnitPrice: 6, purchasePackCount: 1, unitsPerPack: 1 },
      ],
    });

    expect(validation.valid).toBe(false);
    expect(validation.warningIssues).toContain("package_weight_missing");
    expect(validation.blockingIssues).toContain("variant_1_platform_sku_duplicate");
  });

  it("允许未发布商品先以名称建立档案，SKC 和平台 SKU 后续补齐", () => {
    const validation = validateProductDraft({ name: "SHEIN 候选款", publicationStatus: "unpublished" });

    expect(validation).toMatchObject({ valid: true, blockingIssues: [] });
    expect(validation.warningIssues).toEqual(expect.arrayContaining(["platform_skc_missing", "platform_sku_missing"]));
  });

  it("允许信息完整的商品进入正式商品库", () => {
    const validation = validateProductDraft({
      name: "测试商品",
      englishTitle: "Test product",
      platformSkc: "SKC-1",
      supplierCode: "SUP-1",
      sourceUrl: "https://detail.1688.com/offer/1.html",
      shippingAmount: 0,
      variants: [{ platformSku: "SKU-A", purchaseUnitPrice: 5, purchasePackCount: 2, unitsPerPack: 1 }],
    });

    expect(validation.valid).toBe(true);
    expect(validation.blockingCount).toBe(0);
  });

  it("在要求资料完整的销售状态下检查店铺、供应商、售价和参考成本", () => {
    const readiness = validateProductSalesReadiness({
      draft: {
        name: "测试商品",
        platformSkc: "SKC-1",
        store: "美国主店",
        suppliers: [{ sourceUrl: "https://detail.1688.com/offer/1.html" }],
        variants: [{ attribute: "红色", platformSku: "SKU-A", salePrice: 29.9 }],
      },
      referenceCosts: [8.5],
    });

    expect(readiness).toEqual({ ready: true, issues: [] });
    expect(validateProductSalesReadiness({ draft: { variants: [{}] }, referenceCosts: [] }).issues).toContain("store_required");
  });
});
