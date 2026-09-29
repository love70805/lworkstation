import { canonicalPlatformSku } from "./identifiers";

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const fields = ["name", "imageUrl", "store", "supplierName", "sourceUrl", "notes"];

/** Track explicit edits, including an intentionally empty value. Never infer manual intent from a later ERP delivery. */
export function productFieldEdits({ draft, existingProduct, existingSkus = [] }) {
  const edits = { ...(existingProduct?.attributes?.fieldEdits ?? {}), ...(draft.fieldEdits ?? {}) };
  for (const field of fields) if (existingProduct && hasOwn(draft, field) && String(draft[field] ?? "") !== String(existingProduct[field] ?? "")) edits[field] = true;
  const previous = new Map(existingSkus.map(sku => [sku.canonicalPlatformSku ?? canonicalPlatformSku(sku.platformSku), sku]));
  edits.variants = { ...(existingProduct?.attributes?.fieldEdits?.variants ?? {}), ...(draft.fieldEdits?.variants ?? {}) };
  for (const variant of draft.variants ?? []) {
    if (!variant.platformSku) continue;
    const key = canonicalPlatformSku(variant.platformSku), old = previous.get(key);
    if (!old) continue;
    const edited = { ...(edits.variants[key] ?? {}) };
    for (const field of ["attribute", "imageUrl", "warehouseSku"]) if (hasOwn(variant, field) && String(variant[field] ?? "") !== String(old[field] ?? "")) edited[field] = true;
    edits.variants[key] = edited;
  }
  return edits;
}

export function supplierQuoteEdited({ supplier, supplierIndex, variants, existingOffers, isNew, intent, pendingBinding = false }) {
  if (pendingBinding) return true;
  if (intent != null) return (intent.supplierIds ?? []).includes(supplier.supplierId)
    || (supplierIndex === 0 && (intent.supplierIds ?? []).includes("primary"));
  if (isNew) return variants.some(variant => variant.purchaseUnitPrice != null && String(variant.purchaseUnitPrice).trim() !== "");
  // Compatibility for callers using the old explicit quote API: omitted quote fields do nothing.
  // The new editor always sends an intent, so metadata edits cannot accidentally enter this branch.
  return variants.some(variant => {
    if (!hasOwn(variant, "purchaseUnitPrice") || variant.purchaseUnitPrice == null || String(variant.purchaseUnitPrice).trim() === "") return false;
    const current = existingOffers.find(offer => offer.supplierId === supplier.supplierId && (offer.canonicalPlatformSku ?? canonicalPlatformSku(offer.platformSku)) === variant.canonicalPlatformSku && offer.status !== "superseded");
    return !current || Number(current.purchaseUnitPrice) !== Number(variant.purchaseUnitPrice)
      || (hasOwn(variant, "purchasePackCount") && Number(current.purchasePackCount) !== Number(variant.purchasePackCount))
      || (hasOwn(variant, "unitsPerPack") && Number(current.unitsPerPack) !== Number(variant.unitsPerPack));
  });
}
