import { canonicalPlatformSku } from "./identifiers";
import { calculateSupplierLandedUnitCost, validateProductDraft, validateProductSalesReadiness } from "./productCatalog";

export function normalizeProductTags(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(/[,，、\n]/);
  return [...new Set(values.map((tag) => String(tag).trim()).filter(Boolean))];
}

// An explicitly entered zero is a price; an empty field is missing information.
export function productSalePrice(value) {
  if (value == null || String(value).trim() === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function productDraftReferences(draft = {}, historicalRows = []) {
  const history = new Map(historicalRows.map((row) => [row.canonicalPlatformSku ?? canonicalPlatformSku(row.platformSku), row]));
  const variants = draft.variants ?? [];
  const suppliers = draft.suppliers?.length ? draft.suppliers : [draft];
  const supplierCosts = new Map();
  suppliers.forEach((supplier, supplierIndex) => {
    const quotedVariants = variants.filter((variant) => String(variant.platformSku ?? "").trim()).map((variant) => {
      const key = canonicalPlatformSku(variant.platformSku);
      const quote = supplier.variants?.find((item) => String(item.platformSku ?? "").trim() && canonicalPlatformSku(item.platformSku) === key) ?? {};
      return {
        platformSku: variant.platformSku,
        purchaseUnitPrice: quote.purchaseUnitPrice ?? (supplierIndex === 0 ? variant.purchaseUnitPrice : ""),
        purchasePackCount: quote.purchasePackCount ?? (supplierIndex === 0 ? variant.purchasePackCount : 0),
        unitsPerPack: quote.unitsPerPack ?? (supplierIndex === 0 ? variant.unitsPerPack : 1),
      };
    });
    const totalPurchasePacks = quotedVariants.reduce((sum, variant) => sum + Number(variant.purchasePackCount ?? 0), 0);
    quotedVariants.forEach((variant) => {
      const cost = calculateSupplierLandedUnitCost({ ...variant, shippingAmount: supplier.shippingAmount, handlingFee: supplier.handlingFee, totalPurchasePacks });
      const key = canonicalPlatformSku(variant.platformSku);
      if (cost == null || (supplierCosts.has(key) && supplierCosts.get(key).unitCost <= cost)) return;
      supplierCosts.set(key, { unitCost: cost, supplierName: supplier.supplierName || supplier.supplierCode || `供应商 ${supplierIndex + 1}` });
    });
  });
  return variants.map((variant) => {
    const key = String(variant.platformSku ?? "").trim() ? canonicalPlatformSku(variant.platformSku) : "";
    const historical = history.get(key);
    const supplier = supplierCosts.get(key) ?? null;
    // Persisted 1688 quotations must never hide the current editable quotation.
    const authoritative = historical?.referenceUnitCost != null && historical.referenceKind !== "supplier_landed" ? historical : null;
    return {
      unitCost: authoritative?.referenceUnitCost ?? supplier?.unitCost ?? null,
      referenceKind: authoritative?.referenceKind ?? (supplier ? "supplier_landed" : null),
      sourceLabel: authoritative ? ({ erp_history: "ERP 历史", manual_confirmed: "人工确认", finalized_profit_history: "定稿历史" }[authoritative.referenceKind] ?? "历史参考") : "1688 参考",
      historical: authoritative,
      supplier,
    };
  });
}

export function productSaveReadiness({ draft, statusDefinition, historicalRows = [] }) {
  const validation = validateProductDraft(draft);
  const references = productDraftReferences(draft, historicalRows);
  const readiness = statusDefinition?.requiresReadiness
    ? validateProductSalesReadiness({ draft, referenceCosts: references.map((reference) => reference.unitCost) })
    : { ready: true, issues: [] };
  return { valid: validation.valid && readiness.ready, issues: [...validation.blockingIssues, ...readiness.issues], validation, readiness, references };
}

export function productReadinessIssueLabel(issue) {
  const labels = { product_name_required: "缺少商品名称", platform_skc_required: "缺少平台 SKC", platform_sku_required: "至少填写一个平台 SKU", store_required: "未分配店铺", supplier_source_required: "缺少 1688 供应商链接" };
  if (labels[issue]) return labels[issue];
  const match = /^variant_(\d+)_(.+)$/.exec(issue);
  if (!match) return issue;
  const detail = { platform_sku_required: "缺少平台 SKU", platform_sku_duplicate: "平台 SKU 重复", attribute_required: "缺少属性/规格", sale_price_required: "在售售价须大于 0", reference_cost_required: "缺少可用参考成本", purchase_pack_count_invalid: "采购份数必须大于 0", units_per_pack_invalid: "每份单品数必须大于 0" }[match[2]] ?? match[2];
  return `第 ${Number(match[1]) + 1} 个 SKU：${detail}`;
}
