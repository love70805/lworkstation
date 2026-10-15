import { makeId } from "../db/utils";
import { erpSupplierLink, erpSupplierStableIdentity } from "../../domain/erpProductCatalog";

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
  if (Array.isArray(supplier.sourceLinks) && supplier.sourceLinks.some(link => erpSupplierLink(link?.url))) return true;
  return (Array.isArray(supplier.variants) ? supplier.variants : []).some((variant) => (
    [variant.sourceSku, variant.purchaseUnitPrice].some((value) => catalogText(value))
  ));
}

export function catalogSupplierProfile(supplier = {}, fallback = "") {
  const supplierId = catalogSupplierIdentity(supplier, fallback);
  return {
    id: catalogText(supplier.id) || supplierId,
    supplierId,
    stableSupplierId: catalogText(supplier.stableSupplierId),
    supplierCode: catalogText(supplier.supplierCode),
    supplierName: catalogText(supplier.supplierName),
    sourceProductId: catalogText(supplier.sourceProductId),
    sourceUrl: catalogText(supplier.sourceUrl),
    sourceUrlKind: erpSupplierLink(supplier.sourceUrl)?.type ?? null,
    catalogSource: supplier.catalogSource === "erp" ? "erp" : null,
    sourceLinks: [...new Map((Array.isArray(supplier.sourceLinks) ? supplier.sourceLinks : []).map(item => erpSupplierLink(item?.url)).filter(Boolean).map(item => [item.url, item])).values()],
    sourceRecords: Array.isArray(supplier.sourceRecords) ? supplier.sourceRecords.map(item => ({
      kind: "erp", platformSku: catalogText(item.platformSku), platformSkc: catalogText(item.platformSkc), warehouseSku: catalogText(item.warehouseSku),
      batchId: catalogText(item.batchId), evidenceRef: catalogText(item.evidenceRef), recordId: catalogText(item.recordId), purchaseOrderNo: catalogText(item.purchaseOrderNo), capturedAt: catalogText(item.capturedAt),
      purchaseOrderId: catalogText(item.purchaseOrderId), lineNumber: catalogText(item.lineNumber),
    })) : [],
    shippingAmount: Number(supplier.shippingAmount) || 0,
    handlingFee: Number(supplier.handlingFee) || 0,
    variants: (Array.isArray(supplier.variants) ? supplier.variants : []).map(catalogSupplierVariantProfile),
  };
}

export function matchingCatalogSupplierProfile(profiles, candidate) {
  const byId = profiles.find(profile => profile.supplierId === candidate.supplierId);
  if (byId) return byId;
  const stable = erpSupplierStableIdentity(candidate);
  const byStable = stable ? profiles.filter(profile => erpSupplierStableIdentity(profile) === stable) : [];
  if (byStable.length === 1) return byStable[0];
  const natural = catalogSupplierNaturalKey(candidate);
  if (!natural) return null;
  const matches = profiles.filter(profile => catalogSupplierNaturalKey(profile) === natural
    && (!stable || !erpSupplierStableIdentity(profile) || erpSupplierStableIdentity(profile) === stable));
  return matches.length === 1 ? matches[0] : null;
}

function mergeSupplierVariants(previous, incoming) {
  const variants = new Map();
  for (const variant of [...previous, ...incoming]) {
    const sku = catalogText(variant.platformSku).normalize('NFKC').toUpperCase();
    variants.set(sku || `pending-${variants.size}`, variant);
  }
  return [...variants.values()];
}

export function catalogSupplierProfiles(suppliers = []) {
  const profiles = [];
  (Array.isArray(suppliers) ? suppliers : []).forEach((supplier, index) => {
    if (!catalogSupplierHasData(supplier)) return;
    const profile = catalogSupplierProfile(supplier, `supplier-${index + 1}`);
    const matched = matchingCatalogSupplierProfile(profiles, profile);
    const previousIndex = matched ? profiles.indexOf(matched) : null;
    if (previousIndex == null) {
      profiles.push(profile);
      return;
    }
    const previous = profiles[previousIndex];
    profiles[previousIndex] = {
      ...previous,
      ...profile,
      id: previous.id,
      supplierId: previous.supplierId,
      stableSupplierId: profile.stableSupplierId || previous.stableSupplierId,
      supplierCode: profile.supplierCode || previous.supplierCode,
      supplierName: profile.supplierName || previous.supplierName,
      sourceProductId: profile.sourceProductId || previous.sourceProductId,
      sourceUrl: profile.sourceUrl || previous.sourceUrl,
      sourceLinks: [...new Map([...previous.sourceLinks, ...profile.sourceLinks].map(item => [item.url, item])).values()],
      sourceRecords: [...new Map([...previous.sourceRecords, ...profile.sourceRecords].map(item => [JSON.stringify(item), item])).values()],
      variants: mergeSupplierVariants(previous.variants, profile.variants),
    };
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
  (offers ?? []).forEach((offer) => {
    const profile = catalogSupplierProfile(offer, offer.id);
    const matched = matchingCatalogSupplierProfile(profiles, profile);
    const existingIndex = matched ? profiles.indexOf(matched) : null;
    if (existingIndex == null) {
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
      sourceLinks: [...new Map([...existing.sourceLinks, ...profile.sourceLinks].map(item => [item.url, item])).values()],
      sourceRecords: [...new Map([...existing.sourceRecords, ...profile.sourceRecords].map(item => [JSON.stringify(item), item])).values()],
    };
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

