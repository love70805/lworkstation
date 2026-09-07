import Decimal from "decimal.js";
import { canonicalPlatformSku } from "./identifiers";

function text(value) {
  return String(value ?? "").trim();
}

function positive(value) {
  try {
    const amount = new Decimal(value);
    return amount.isFinite() && amount.gt(0) ? amount : null;
  } catch {
    return null;
  }
}

function nonNegative(value) {
  try {
    const amount = new Decimal(value ?? 0);
    return amount.isFinite() && amount.gte(0) ? amount : null;
  } catch {
    return null;
  }
}

export function calculateSupplierLandedUnitCost({
  purchaseUnitPrice,
  shippingAmount = 0,
  totalPurchasePacks,
  handlingFee = 0,
  unitsPerPack = 1,
}) {
  const price = positive(purchaseUnitPrice);
  const shipping = nonNegative(shippingAmount);
  const packCount = positive(totalPurchasePacks);
  const handling = nonNegative(handlingFee);
  const packUnits = positive(unitsPerPack);
  if (!price || !shipping || !packCount || !handling || !packUnits) return null;

  return price
    .plus(shipping.div(packCount))
    .plus(handling)
    .div(packUnits)
    .toDecimalPlaces(2, Decimal.ROUND_DOWN)
    .toNumber();
}

function hasText(value) {
  return text(value).length > 0;
}

function hasPurchaseInput(variant = {}) {
  return hasText(variant.purchaseUnitPrice)
    || hasText(variant.purchasePackCount)
    || hasText(variant.unitsPerPack);
}

export function validateProductDraft(draft = {}) {
  const blockingIssues = [];
  const warningIssues = [];
  const variants = Array.isArray(draft.variants) ? draft.variants : [];

  if (!text(draft.name)) blockingIssues.push("product_name_required");
  if (!text(draft.platformSkc)) warningIssues.push("platform_skc_missing");
  if (variants.length === 0 || !variants.some((variant) => text(variant.platformSku))) warningIssues.push("platform_sku_missing");
  if (!text(draft.englishTitle)) warningIssues.push("english_title_missing");
  if (!text(draft.supplierCode)) warningIssues.push("supplier_code_missing");
  if (!text(draft.sourceUrl)) warningIssues.push("source_url_missing");
  if (Number(draft.shippingAmount ?? 0) > 0 && !positive(draft.packageWeight)) {
    warningIssues.push("package_weight_missing");
  }

  const seenSkus = new Set();
  variants.forEach((variant, index) => {
    const platformSku = text(variant.platformSku);
    if (!platformSku) return;
    const canonicalSku = canonicalPlatformSku(platformSku);
    if (seenSkus.has(canonicalSku)) blockingIssues.push(`variant_${index}_platform_sku_duplicate`);
    seenSkus.add(canonicalSku);
    if (platformSku && !positive(variant.purchaseUnitPrice)) warningIssues.push(`variant_${index}_purchase_price_missing`);
    if (platformSku && hasPurchaseInput(variant) && !positive(variant.purchasePackCount)) {
      blockingIssues.push(`variant_${index}_purchase_pack_count_invalid`);
    }
    if (platformSku && hasPurchaseInput(variant) && !positive(variant.unitsPerPack ?? 1)) {
      blockingIssues.push(`variant_${index}_units_per_pack_invalid`);
    }
  });

  const checkCount = 4 + Math.max(1, variants.length * 3);
  const issueWeight = blockingIssues.length * 2 + warningIssues.length;
  const readiness = Math.max(0, Math.min(100, Math.round(((checkCount - issueWeight) / checkCount) * 100)));

  return {
    valid: blockingIssues.length === 0,
    blockingIssues,
    warningIssues,
    blockingCount: blockingIssues.length,
    warningCount: warningIssues.length,
    readiness,
  };
}

export function validateProductSalesReadiness({ draft = {}, referenceCosts = [] } = {}) {
  const issues = [];
  const variants = Array.isArray(draft.variants) ? draft.variants : [];
  const suppliers = Array.isArray(draft.suppliers) && draft.suppliers.length ? draft.suppliers : [draft];

  if (!text(draft.name)) issues.push("product_name_required");
  if (!text(draft.platformSkc)) issues.push("platform_skc_required");
  if (!text(draft.store)) issues.push("store_required");
  if (!suppliers.some((supplier) => text(supplier.sourceUrl))) issues.push("supplier_source_required");

  variants.forEach((variant, index) => {
    if (!text(variant.attribute)) issues.push(`variant_${index}_attribute_required`);
    if (!positive(variant.salePrice)) issues.push(`variant_${index}_sale_price_required`);
    const referenceCost = Number(referenceCosts[index]);
    if (!Number.isFinite(referenceCost) || referenceCost <= 0) issues.push(`variant_${index}_reference_cost_required`);
  });

  return {
    ready: issues.length === 0,
    issues,
  };
}
