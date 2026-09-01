import { makeId } from "../db/utils";

export function catalogText(value) {
  return String(value ?? "").trim();
}

export function catalogSupplierNaturalKey(supplier = {}) {
  const parts = [supplier.supplierCode, supplier.supplierName, supplier.sourceProductId, supplier.sourceUrl]
    .map((value) => catalogText(value).toLowerCase());
  return parts.some(Boolean) ? parts.join("\u001f") : "";
}

export function catalogSupplierIdentity(supplier = {}, fallback = "") {
  const explicitId = catalogText(supplier.supplierId ?? supplier.id);
  if (explicitId) return explicitId;
  const natural = catalogSupplierNaturalKey(supplier);
  return `SUP-${natural || catalogText(fallback) || "legacy"}`;
}

export function catalogSupplierVariantProfile(variant = {}) {
  return {
    platformSku: catalogText(variant.platformSku),
    sourceSku: catalogText(variant.sourceSku),
    purchaseUnitPrice: variant.purchaseUnitPrice ?? "",
    purchasePackCount: variant.purchasePackCount ?? 0,
    unitsPerPack: variant.unitsPerPack ?? 1,
  };
}

export function catalogSupplierHasData(supplier = {}) {
  if ([supplier.supplierCode, supplier.supplierName, supplier.sourceProductId, supplier.sourceUrl].some((value) => catalogText(value))) return true;
  return (Array.isArray(supplier.variants) ? supplier.variants : []).some((variant) => (
    [variant.sourceSku, variant.purchaseUnitPrice].some((value) => catalogText(value))
  ));
}

export function catalogSupplierProfile(supplier = {}, fallback = "") {
  const supplierId = catalogSupplierIdentity(supplier, fallback);
  return {
    id: catalogText(supplier.id) || supplierId,
    supplierId,
    supplierCode: catalogText(supplier.supplierCode),
    supplierName: catalogText(supplier.supplierName),
    sourceProductId: catalogText(supplier.sourceProductId),
    sourceUrl: catalogText(supplier.sourceUrl),
    shippingAmount: Number(supplier.shippingAmount) || 0,
    handlingFee: Number(supplier.handlingFee) || 0,
    variants: (Array.isArray(supplier.variants) ? supplier.variants : []).map(catalogSupplierVariantProfile),
  };
}

export function catalogSupplierProfiles(suppliers = []) {
  const profiles = [];
  const indexBySupplierId = new Map();
  const indexByNaturalKey = new Map();
  (Array.isArray(suppliers) ? suppliers : []).forEach((supplier, index) => {
    if (!catalogSupplierHasData(supplier)) return;
    const profile = catalogSupplierProfile(supplier, `supplier-${index + 1}`);
    const naturalKey = catalogSupplierNaturalKey(profile);
    const previousIndex = indexBySupplierId.get(profile.supplierId) ?? (naturalKey ? indexByNaturalKey.get(naturalKey) : null);
    if (previousIndex == null) {
      indexBySupplierId.set(profile.supplierId, profiles.length);
      if (naturalKey) indexByNaturalKey.set(naturalKey, profiles.length);
      profiles.push(profile);
      return;
    }
    const previous = profiles[previousIndex];
    profiles[previousIndex] = {
      ...previous,
      ...profile,
      id: previous.id,
      supplierId: previous.supplierId,
      supplierCode: profile.supplierCode || previous.supplierCode,
      supplierName: profile.supplierName || previous.supplierName,
      sourceProductId: profile.sourceProductId || previous.sourceProductId,
      sourceUrl: profile.sourceUrl || previous.sourceUrl,
      variants: profile.variants.length ? profile.variants : previous.variants,
    };
    indexBySupplierId.set(profile.supplierId, previousIndex);
    if (naturalKey) indexByNaturalKey.set(naturalKey, previousIndex);
  });
  return profiles;
}

export function catalogPendingVariantHasData(variant = {}) {
  return [
    variant.attribute,
    variant.color,
    variant.warehouseSku,
    variant.sourceSku,
    variant.imageUrl,
    variant.purchaseUnitPrice,
    variant.salePrice,
  ].some((value) => catalogText(value));
}

export function catalogPendingVariants(variants = []) {
  return (Array.isArray(variants) ? variants : [])
    .filter((variant) => !catalogText(variant.platformSku) && catalogPendingVariantHasData(variant))
    .map((variant) => ({
      id: catalogText(variant.id) || makeId("VAR"),
      attribute: catalogText(variant.attribute),
      color: catalogText(variant.color),
      swatch: catalogText(variant.swatch) || "#9ca3af",
      platformSku: "",
      warehouseSku: catalogText(variant.warehouseSku),
      sourceSku: catalogText(variant.sourceSku),
      imageUrl: catalogText(variant.imageUrl),
      purchaseUnitPrice: variant.purchaseUnitPrice ?? "",
      salePrice: variant.salePrice ?? "",
      purchasePackCount: variant.purchasePackCount ?? 1,
      unitsPerPack: variant.unitsPerPack ?? 1,
    }));
}

export function catalogDisplaySupplierProfiles(product, offers = []) {
  const profiles = catalogSupplierProfiles(product?.attributes?.supplierProfiles ?? []);
  if (!profiles.length && catalogSupplierHasData(product)) profiles.push(catalogSupplierProfile(product));
  const bySupplierId = new Map(profiles.map((profile, index) => [profile.supplierId, index]));
  const byNaturalKey = new Map(profiles
    .map((profile, index) => [catalogSupplierNaturalKey(profile), index])
    .filter(([key]) => key));
  (offers ?? []).forEach((offer) => {
    const profile = catalogSupplierProfile(offer, offer.id);
    const naturalKey = catalogSupplierNaturalKey(profile);
    const existingIndex = bySupplierId.get(profile.supplierId) ?? (naturalKey ? byNaturalKey.get(naturalKey) : null);
    if (existingIndex == null) {
      bySupplierId.set(profile.supplierId, profiles.length);
      if (naturalKey) byNaturalKey.set(naturalKey, profiles.length);
      profiles.push(profile);
      return;
    }
    const existing = profiles[existingIndex];
    profiles[existingIndex] = {
      ...existing,
      supplierCode: existing.supplierCode || profile.supplierCode,
      supplierName: existing.supplierName || profile.supplierName,
      sourceProductId: existing.sourceProductId || profile.sourceProductId,
      sourceUrl: existing.sourceUrl || profile.sourceUrl,
    };
    bySupplierId.set(profile.supplierId, existingIndex);
    if (naturalKey) byNaturalKey.set(naturalKey, existingIndex);
  });
  return profiles;
}

export function catalogSupplierOfferKey({ productId, supplierId, canonicalPlatformSku: sku }) {
  return [catalogText(productId), catalogText(supplierId), catalogText(sku)].join("\u001f");
}

export function activeSupplierOffer(offer) {
  return offer?.status !== "superseded";
}

export function supplierOfferContent(offer) {
  return JSON.stringify({
    supplierId: catalogText(offer.supplierId),
    platformSkuId: catalogText(offer.platformSkuId),
    platformSku: catalogText(offer.platformSku),
    canonicalPlatformSku: catalogText(offer.canonicalPlatformSku),
    source: catalogText(offer.source) || "1688",
    sourceProductId: catalogText(offer.sourceProductId),
    sourceUrl: catalogText(offer.sourceUrl),
    supplierCode: catalogText(offer.supplierCode),
    supplierName: catalogText(offer.supplierName),
    sourceSku: catalogText(offer.sourceSku),
    purchaseUnitPrice: Number(offer.purchaseUnitPrice) || null,
    shippingAmount: Number(offer.shippingAmount) || 0,
    handlingFee: Number(offer.handlingFee) || 0,
    purchasePackCount: Number(offer.purchasePackCount) || 0,
    totalPurchasePacks: Number(offer.totalPurchasePacks) || 0,
    unitsPerPack: Number(offer.unitsPerPack) || 1,
    landedUnitCost: Number(offer.landedUnitCost) || null,
    referenceUnitCost: Number(offer.referenceUnitCost) || null,
    currency: offer.currency ?? "CNY",
  });
}

