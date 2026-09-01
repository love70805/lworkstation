import { selectSelectionReferenceCost } from "../domain/costPolicy";
import { canonicalPlatformSkc, canonicalPlatformSku } from "../domain/identifiers";
import { calculateReferenceProfitLine, DEFAULT_WAREHOUSE_RATE } from "../domain/profitCalculations";
import { sumMoney } from "./money";

function timestamp(item) {
  const value = item?.finalizedAt ?? item?.publishedAt ?? item?.calculatedAt ?? item?.updatedAt ?? "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latest(items) {
  return [...(items ?? [])].toSorted((a, b) => timestamp(b) - timestamp(a))[0] ?? null;
}

function groupBySku(items) {
  const grouped = new Map();
  (items ?? []).forEach((item) => {
    const sku = canonicalPlatformSku(item.platformSku ?? item.sku);
    if (!sku) return;
    if (!grouped.has(sku)) grouped.set(sku, []);
    grouped.get(sku).push(item);
  });
  return grouped;
}

function supplierReference(offer) {
  if (!offer) return null;
  const unitCost = Number(
    offer.landedUnitCost
      ?? offer.referenceUnitCost
      ?? offer.referenceCost
      ?? offer.unitCost
      ?? offer.cost,
  );
  if (!Number.isFinite(unitCost) || unitCost <= 0) return null;
  return {
    id: offer.referenceCostId ?? offer.id,
    platformSku: offer.platformSku ?? offer.sku,
    unitCost,
    currency: offer.currency ?? "CNY",
    calculatedAt: offer.calculatedAt ?? offer.updatedAt,
    source: offer.source ?? "1688",
  };
}

export function buildSelectionReferenceRows({
  platformSkus = [],
  products = [],
  supplierOffers = [],
  catalogManualCosts = [],
  erpCosts = [],
  profitLines = [],
}) {
  const platformSkuByCanonical = new Map(platformSkus.map((item) => [
    item.canonicalPlatformSku ?? canonicalPlatformSku(item.platformSku),
    item,
  ]));
  const productById = new Map(products.map((item) => [item.id, item]));
  const erpBySku = groupBySku(erpCosts);
  const manualCostHistoryBySku = groupBySku(catalogManualCosts);
  const manualCostBySku = groupBySku((catalogManualCosts ?? []).filter((item) => item.status === "active"));
  const profitBySku = groupBySku(profitLines);
  const offerBySku = groupBySku((supplierOffers ?? []).filter((offer) => offer.status !== "superseded"));
  const allSkus = new Set([
    ...platformSkuByCanonical.keys(),
    ...erpBySku.keys(),
    ...manualCostHistoryBySku.keys(),
    ...profitBySku.keys(),
    ...offerBySku.keys(),
  ]);

  return [...allSkus].map((canonicalSku) => {
    const skuRecord = platformSkuByCanonical.get(canonicalSku);
    const product = skuRecord?.productId ? productById.get(skuRecord.productId) : null;
    const erpHistory = erpBySku.get(canonicalSku) ?? [];
    const manualCostHistory = manualCostHistoryBySku.get(canonicalSku) ?? [];
    const manualCost = latest(manualCostBySku.get(canonicalSku));
    const finalizedHistory = (profitBySku.get(canonicalSku) ?? [])
      .toSorted((a, b) => String(b.period ?? "").localeCompare(String(a.period ?? "")) || timestamp(b) - timestamp(a));
    const supplierOffer = latest(offerBySku.get(canonicalSku));
    const referenceCost = selectSelectionReferenceCost({
      erpHistory,
      manualConfirmedCost: manualCost ? {
        ...manualCost,
        platformSku: manualCost.platformSku,
        unitCost: manualCost.amount ?? manualCost.unitCost,
        currency: manualCost.currency ?? "CNY",
        confirmedAt: manualCost.confirmedAt,
      } : null,
      finalizedProfitHistory: finalizedHistory,
      supplierLandedCost: supplierReference(supplierOffer),
    });
    const latestProfit = finalizedHistory[0] ?? null;
    const recentPeriods = [...new Set(finalizedHistory.map((item) => item.period).filter(Boolean))].slice(0, 3);
    const recentHistory = finalizedHistory.filter((item) => recentPeriods.includes(item.period));
    const recentQuantity = recentHistory.reduce((total, item) => total + Number(item.quantity ?? 0), 0);
    const recentRevenue = sumMoney(recentHistory.map((item) => item.revenue));
    const recentProfit = sumMoney(recentHistory.map((item) => item.profit));
    const latestQuantity = Number(latestProfit?.quantity ?? 0);
    const catalogSalePrice = Number(skuRecord?.salePrice ?? skuRecord?.price);
    const averageSalePrice = latestQuantity > 0
      ? Number(latestProfit.revenue ?? 0) / latestQuantity
      : Number.isFinite(catalogSalePrice) && catalogSalePrice >= 0 ? catalogSalePrice : null;
    const latestWarehouseRate = latestQuantity > 0
      ? Number(latestProfit.warehouseCost ?? 0) / latestQuantity
      : DEFAULT_WAREHOUSE_RATE;
    const referenceProfit = referenceCost && averageSalePrice != null
      ? calculateReferenceProfitLine({
        revenue: averageSalePrice,
        quantity: 1,
        referenceCost,
        warehouseRate: latestWarehouseRate,
      })
      : null;
    const platformSku = skuRecord?.platformSku
      ?? latestProfit?.platformSku
      ?? latest(erpHistory)?.platformSku
      ?? supplierOffer?.platformSku
      ?? canonicalSku;

    return {
      id: canonicalSku,
      canonicalPlatformSku: canonicalSku,
      platformSku,
      platformSkc: skuRecord?.platformSkc ?? latestProfit?.platformSkc ?? latestProfit?.groupSkc ?? "",
      warehouseSku: skuRecord?.warehouseSku ?? "",
      productId: product?.id ?? null,
      productName: product?.name ?? product?.title ?? "未建立商品档案",
      productStatus: product?.status ?? "unlinked",
      supplierCode: supplierOffer?.supplierCode ?? "",
      supplierName: supplierOffer?.supplierName ?? "",
      referenceUnitCost: referenceCost?.unitCost ?? null,
      referenceKind: referenceCost?.referenceKind ?? null,
      authoritativeSource: referenceCost?.authoritativeSource ?? null,
      referenceCostId: referenceCost?.id ?? null,
      referenceLedgerId: referenceCost?.ledgerId ?? null,
      referenceApprovalId: referenceCost?.costApprovalId ?? referenceCost?.approvalId ?? null,
      referenceCurrency: referenceCost?.currency ?? "CNY",
      referenceUpdatedAt: referenceCost?.publishedAt ?? referenceCost?.finalizedAt ?? referenceCost?.calculatedAt ?? referenceCost?.confirmedAt ?? referenceCost?.updatedAt ?? null,
      referenceNote: referenceCost?.referenceKind === "manual_confirmed" ? referenceCost.note ?? null : null,
      referenceConfirmedBy: referenceCost?.referenceKind === "manual_confirmed" ? referenceCost.confirmedBy ?? null : null,
      manualCostHistoryCount: manualCostHistory.length,
      latestLedgerId: latestProfit?.ledgerId ?? null,
      latestPeriod: latestProfit?.period ?? null,
      latestQuantity,
      latestRevenue: Number(latestProfit?.revenue ?? 0),
      latestProfit: latestProfit?.profit == null ? null : Number(latestProfit.profit),
      latestProfitRate: latestProfit?.profitRate == null ? null : Number(latestProfit.profitRate),
      recentMonthCount: recentPeriods.length,
      recentQuantity,
      recentRevenue,
      recentProfit,
      averageSalePrice,
      catalogSalePrice: Number.isFinite(catalogSalePrice) ? catalogSalePrice : null,
      referenceUnitProfit: referenceProfit?.profit ?? null,
      referenceProfitRate: referenceProfit?.profitRate ?? null,
      referenceCalculationMode: referenceProfit?.calculationMode ?? null,
      hasNegativeProfit: recentHistory.some((item) => Number(item.profit) < 0),
    };
  }).toSorted((a, b) => (
    String(b.latestPeriod ?? "").localeCompare(String(a.latestPeriod ?? ""))
      || a.platformSku.localeCompare(b.platformSku)
  ));
}

/** Keep the reference dataset at SKU granularity while grouping the UI by SKC. */
export function groupSelectionReferenceRows(rows = []) {
  const groups = new Map();
  rows.forEach((row) => {
    const platformSkc = String(row.platformSkc ?? "").trim();
    const key = platformSkc ? canonicalPlatformSkc(platformSkc) : `SKU:${row.canonicalPlatformSku}`;
    const current = groups.get(key);
    if (current) {
      current.variants.push(row);
      return;
    }
    groups.set(key, {
      id: `selection-reference-${key}`,
      platformSkc: platformSkc || "未填写平台 SKC",
      variants: [row],
    });
  });

  return [...groups.values()].map((group) => {
    const variants = group.variants;
    const latest = variants.find((item) => item.latestPeriod) ?? variants[0];
    const negative = variants.some((item) => item.hasNegativeProfit || Number(item.referenceUnitProfit) < 0);
    return {
      ...group,
      skuCount: variants.length,
      productName: latest.productName,
      productId: latest.productId,
      latestLedgerId: latest.latestLedgerId,
      hasNegativeProfit: negative,
      variants,
    };
  });
}
