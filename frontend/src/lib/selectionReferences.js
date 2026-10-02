import { selectSelectionReferenceCost } from "../domain/costPolicy";
import { canonicalPlatformSkc, canonicalPlatformSku } from "../domain/identifiers";
import { calculateReferenceProfitLine, DEFAULT_WAREHOUSE_RATE } from "../domain/profitCalculations";
import { sumMoney } from "./money";
import { buildReferenceIdentityIndex, projectReferenceIdentity } from "../domain/selectionReferenceIdentity";
import { buildErpProductCatalogIndex, catalogProductName, erpCatalogField, erpCatalogIdentityRows } from "../domain/erpProductCatalog";
import { buildSelectionSalesLabels } from "../domain/selectionSalesLabels";
import { selectCurrentErpCatalogCoverage } from "../domain/erpCatalogFields";
import { resolveProductStatus } from "../domain/selectionStatuses";
import Decimal from "decimal.js";
import { buildSelectionLedgerPriceIndex, selectionLedgerPrice, selectionCatalogLedgerBySkc } from "../domain/selectionLedgerPrices";
const ExactQuantity = Decimal.clone({ precision: 80 });

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
    const rawSku = item.platformSku ?? item.sku;
    if (!String(rawSku ?? "").normalize("NFKC").trim()) return;
    const sku = canonicalPlatformSku(rawSku);
    if (!grouped.has(sku)) grouped.set(sku, []);
    grouped.get(sku).push(item);
  });
  return grouped;
}

function supplierReference(offer) {
  if (!offer) return null;
  const rawCost = (
    offer.landedUnitCost
      ?? offer.referenceUnitCost
      ?? offer.referenceCost
      ?? offer.unitCost
      ?? offer.cost
  );
  if (rawCost == null || String(rawCost).trim() === "") return null;
  const unitCost = Number(rawCost);
  if (!Number.isFinite(unitCost) || unitCost < 0) return null;
  return {
    id: offer.referenceCostId ?? offer.id,
    platformSku: offer.platformSku ?? offer.sku,
    unitCost,
    currency: offer.currency ?? "CNY",
    calculatedAt: offer.calculatedAt ?? offer.updatedAt,
    source: offer.source ?? "1688",
  };
}

// The cover follows the ledger associated with the latest ERP catalog receipt.
// It uses that ledger's net SKU sales, independently of the seven-day label.
function coverSalesBySku({ erpCatalogRows, erpCosts, salesRows, importBatches, ledgers, workspaceId }) {
  const ledgerById = new Map(ledgers.filter(item => (!workspaceId || item.workspaceId === workspaceId)).map(item => [item.id, item]));
  const sourceBySkc = new Map();
  const catalogSkcs = new Set(erpCatalogRows.filter(item => item.platformSkc).map(item => canonicalPlatformSkc(item.platformSkc)));
  const catalogSources = [...erpCatalogRows, ...erpCosts.filter(item => item.platformSkc && !catalogSkcs.has(canonicalPlatformSkc(item.platformSkc)))];
  for (const source of catalogSources) {
    if (!source.platformSkc || !ledgerById.has(source.ledgerId) || workspaceId && source.workspaceId !== workspaceId) continue;
    const skc = canonicalPlatformSkc(source.platformSkc);
    const previous = sourceBySkc.get(skc);
    if (!previous || timestamp(source) > timestamp(previous.source)) sourceBySkc.set(skc, { source });
  }
  const batchById = new Map(importBatches.filter(item => item.status === "completed" && ledgerById.has(item.ledgerId) && (!workspaceId || item.workspaceId === workspaceId)).map(item => [item.id, item]));
  const totals = new Map(), coordinates = new Map(), conflicts = new Set();
  for (const row of salesRows) {
    if (!row.platformSkc || !(row.platformSku ?? row.sku)) continue;
    const skc = canonicalPlatformSkc(row.platformSkc), sku = canonicalPlatformSku(row.platformSku ?? row.sku);
    if (sourceBySkc.get(skc)?.source.ledgerId !== row.ledgerId || !ledgerById.has(row.ledgerId) || row.isDeduction || /盘亏|扣款|罚款|违约/.test(row.movementType ?? "") || workspaceId && row.workspaceId !== workspaceId) continue;
    const batch = batchById.get(row.batchId);
    if (!batch || batch.ledgerId !== row.ledgerId || row.store !== batch.store) continue;
    const quantity = Number(row.quantityExact ?? row.quantity ?? row.qty);
    if (!Number.isFinite(quantity)) { conflicts.add(sku); continue; }
    const coordinate = row.selectionFactId ? `aggregate:${row.selectionFactId}` : row.sourceRow != null ? JSON.stringify([row.ledgerId, batch.fileHash ?? batch.id, row.store, row.sourceSheet ?? "", row.sourceRow]) : `id:${row.id}`;
    const content = JSON.stringify([skc, sku, row.quantityExact ?? row.quantity ?? row.qty]);
    if (coordinates.has(coordinate)) { if (coordinates.get(coordinate) !== content) conflicts.add(sku); continue; }
    coordinates.set(coordinate, content);
    totals.set(sku, (totals.get(sku) ?? new ExactQuantity(0)).plus(row.quantityExact ?? row.quantity ?? row.qty));
  }
  return new Map([...totals].filter(([sku]) => !conflicts.has(sku)).map(([sku, quantity]) => [sku, quantity.toNumber()]));
}

export function buildSelectionReferenceRows({
  platformSkus = [],
  products = [],
  supplierOffers = [],
  catalogManualCosts = [],
  erpCosts = [],
  erpCatalogRows = [],
  profitLines = [],
  ledgerIdentityRows = [],
  erpCatalogReferences = [],
  catalogCoverage = [],
  salesRows = [],
  importBatches = [],
  ledgers = [],
  workspaceId = null,
  store = "all",
  computedReferenceRows,
  compactEvidence = false,
  selectionSalesFacts = null,
}) {
  if (computedReferenceRows) return computedReferenceRows;
  const erpCatalogBySku = buildErpProductCatalogIndex([...erpCosts, ...erpCatalogRows]);
  const identityBySku = buildReferenceIdentityIndex({ ledgerIdentityRows, profitLines, erpCatalogRows: erpCatalogIdentityRows(erpCatalogBySku), compactEvidence });
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
  const catalogCostBySku = groupBySku(erpCatalogReferences);
  const coverageBySkc = new Map();
  for (const coverage of catalogCoverage) for (const skc of coverage.platformSkcs ?? []) {
    const key = canonicalPlatformSkc(skc);
    if (!coverageBySkc.has(key)) coverageBySkc.set(key, []);
    coverageBySkc.get(key).push(coverage);
  }
  const ledgerIdentitiesBySku = groupBySku(ledgerIdentityRows);
  const ledgerPrices = selectionSalesFacts?.ledgerPriceIndex ?? buildSelectionLedgerPriceIndex({ salesRows, importBatches, ledgers, workspaceId, compactEvidence });
  const catalogLedgers = selectionCatalogLedgerBySkc([...erpCosts, ...erpCatalogRows]);
  const coverSales = coverSalesBySku({ erpCatalogRows, erpCosts, salesRows: selectionSalesFacts?.coverRows ?? salesRows, importBatches, ledgers, workspaceId });
  const allSkus = new Set([
    ...platformSkuByCanonical.keys(),
    ...erpBySku.keys(),
    ...manualCostHistoryBySku.keys(),
    ...profitBySku.keys(),
    ...offerBySku.keys(),
    ...erpCatalogBySku.keys(),
    ...identityBySku.keys(),
  ]);

  const rows = [...allSkus].map((canonicalSku) => {
    const skuRecord = platformSkuByCanonical.get(canonicalSku);
    const product = skuRecord?.productId ? productById.get(skuRecord.productId) : null;
    const erpCatalog = erpCatalogBySku.get(canonicalSku);
    const erpName = erpCatalogField(erpCatalog, "productName");
    const erpImage = erpCatalogField(erpCatalog, "imageUrl");
    const erpHistory = erpBySku.get(canonicalSku) ?? [];
    const manualCostHistory = manualCostHistoryBySku.get(canonicalSku) ?? [];
    const manualCost = latest(manualCostBySku.get(canonicalSku));
    const finalizedHistory = (profitBySku.get(canonicalSku) ?? [])
      .toSorted((a, b) => String(b.period ?? "").localeCompare(String(a.period ?? "")) || timestamp(b) - timestamp(a));
    const supplierOffer = latest(offerBySku.get(canonicalSku));
    const referenceCost = selectSelectionReferenceCost({
      erpHistory: erpHistory.filter(row => row.catalogEligible !== false),
      manualConfirmedCost: manualCost ? {
        ...manualCost,
        platformSku: manualCost.platformSku,
        unitCost: manualCost.amount ?? manualCost.unitCost,
        currency: manualCost.currency ?? "CNY",
        confirmedAt: manualCost.confirmedAt,
      } : null,
      finalizedProfitHistory: finalizedHistory,
      erpCatalogReference: erpCatalog?.relationshipConflict ? null : latest(catalogCostBySku.get(canonicalSku)),
      supplierLandedCost: supplierReference(supplierOffer),
    });
    const latestProfit = finalizedHistory[0] ?? null;
    const recentPeriods = [...new Set(finalizedHistory.map((item) => item.period).filter(Boolean))].slice(0, 3);
    const recentHistory = finalizedHistory.filter((item) => recentPeriods.includes(item.period));
    const recentQuantity = recentHistory.reduce((total, item) => total + Number(item.quantity ?? 0), 0);
    const recentRevenue = sumMoney(recentHistory.map((item) => item.revenue));
    const recentProfit = sumMoney(recentHistory.map((item) => item.profit));
    const latestQuantity = Number(latestProfit?.quantity ?? 0);
    const identity = projectReferenceIdentity(skuRecord, identityBySku.get(canonicalSku));
    const variantEdits = product?.attributes?.fieldEdits?.variants?.[canonicalSku] ?? {};
    const ledgerSalePrice = selectionLedgerPrice(ledgerPrices, canonicalSku, { ledgerId: identity.platformSkc ? catalogLedgers.get(canonicalPlatformSkc(identity.platformSkc))?.ledgerId : null, store: store !== "all" ? store : product?.store });
    const manualSalePrice = variantEdits.salePrice || (skuRecord && skuRecord.salePriceSource?.kind !== "ledger" && skuRecord.salePrice != null);
    const rawSalePrice = manualSalePrice ? skuRecord?.salePrice ?? skuRecord?.price : ledgerSalePrice.status === "ready" ? ledgerSalePrice.value : skuRecord?.salePriceSource?.kind === "ledger" ? null : skuRecord?.salePrice ?? skuRecord?.price;
    const catalogSalePrice = rawSalePrice == null || String(rawSalePrice).trim() === "" ? NaN : Number(rawSalePrice);
    const historicalAverageSalePrice = latestQuantity > 0 ? Number(latestProfit.revenue ?? 0) / latestQuantity : null;
    const averageSalePrice = Number.isFinite(catalogSalePrice) && catalogSalePrice >= 0 ? catalogSalePrice
      : ledgerSalePrice.status === "missing" && ledgerSalePrice.kind !== "ledger" && !manualSalePrice && !skuRecord?.salePriceSource ? historicalAverageSalePrice : null;
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
      ...identity,
      attribute: variantEdits.attribute ? skuRecord?.attribute ?? "" : identity.attribute,
      warehouseSku: variantEdits.warehouseSku ? skuRecord?.warehouseSku ?? "" : skuRecord?.warehouseSku || erpCatalogField(erpCatalog, "warehouseSku").value,
      productId: product?.id ?? null,
      productName: catalogProductName(product?.name || product?.title) || erpName.value || "未建立商品档案",
      imageUrl: product?.attributes?.fieldEdits?.imageUrl ? product.imageUrl ?? "" : product?.imageUrl || product?.image || (product?.attributes?.fieldEdits?.variants?.[canonicalSku]?.imageUrl ? skuRecord?.imageUrl ?? "" : skuRecord?.imageUrl || erpImage.value),
      ledgerSalePrice,
      erpPurchaseState: referenceCost ? "available" : erpCatalog?.relationshipConflict ? "mapping_conflict" : (() => {
        const coverage = identity.platformSkc ? selectCurrentErpCatalogCoverage(coverageBySkc.get(canonicalPlatformSkc(identity.platformSkc))) : null;
        const evidence = coverage?.groups?.purchaseEvidence;
        if (!evidence || evidence.reasons?.includes("not_collected")) return "not_checked";
        return evidence.state === "complete" && erpCatalog ? "no_valid_purchase" : "incomplete";
      })(),
      erpProductName: erpName,
      erpImage,
      erpCatalogSuppliers: erpCatalog?.suppliers ?? [],
      erpCatalogFields: Object.fromEntries(["productName", "imageUrl", "warehouseSku", "storeName"].map(field => [field, erpCatalogField(erpCatalog, field)])),
      erpCatalogSources: erpCatalog?.entries ?? [],
      erpCatalogPurchases: erpCatalog?.purchases ?? [],
      erpCatalogRelationshipConflict: Boolean(erpCatalog?.relationshipConflict),
      productStatus: product?.status ?? "unlinked",
      userStatus: product ? resolveProductStatus(product).statusId : null,
      storeNames: [...new Set([product?.store, ...(identity.platformSkcEvidence ?? []).flatMap(item => (item.sources ?? []).map(source => source.store))].filter(Boolean))],
      supplierCode: supplierOffer?.supplierCode ?? "",
      supplierNumbers: [...new Set((ledgerIdentitiesBySku.get(canonicalSku) ?? []).map(item => item.supplierNumber).filter(Boolean))],
      supplierName: supplierOffer?.supplierName || [...new Set((erpCatalog?.suppliers ?? []).map(item => item.supplierName).filter(Boolean))].join("、"),
      referenceUnitCost: referenceCost?.unitCost ?? null,
      referenceKind: referenceCost?.referenceKind ?? null,
      authoritativeSource: referenceCost?.authoritativeSource ?? null,
      referenceCostId: referenceCost?.id ?? null,
      referenceLedgerId: referenceCost?.ledgerId ?? null,
      referencePeriod: referenceCost?.period ?? null,
      referenceEvidence: referenceCost?.referenceOnly ? { evidenceRef: referenceCost.evidenceRef, warehouseSku: referenceCost.warehouseSku, selectedRecordIds: referenceCost.selectedRecordIds, unitConversion: referenceCost.unitConversion, batchId: referenceCost.batchId } : null,
      referenceApprovalId: referenceCost?.costApprovalId ?? referenceCost?.approvalId ?? null,
      referenceCurrency: referenceCost?.currency ?? "CNY",
      referenceUpdatedAt: referenceCost?.publishedAt ?? referenceCost?.finalizedAt ?? referenceCost?.calculatedAt ?? referenceCost?.confirmedAt ?? referenceCost?.updatedAt ?? null,
      referenceNote: referenceCost?.referenceKind === "manual_confirmed" ? referenceCost.note ?? null : null,
      referenceConfirmedBy: referenceCost?.referenceKind === "manual_confirmed" ? referenceCost.confirmedBy ?? null : null,
      manualCostHistoryCount: manualCostHistory.length,
      latestLedgerId: latestProfit?.ledgerId ?? null,
      latestPeriod: latestProfit?.period ?? null,
      latestQuantity,
      coverSalesQuantity: coverSales.get(canonicalSku) ?? null,
      latestRevenue: Number(latestProfit?.revenue ?? 0),
      latestProfit: latestProfit?.profit == null ? null : Number(latestProfit.profit),
      latestProfitRate: latestProfit?.profitRate == null ? null : Number(latestProfit.profitRate),
      recentMonthCount: recentPeriods.length,
      recentQuantity,
      recentRevenue,
      recentProfit,
      averageSalePrice, historicalAverageSalePrice,
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
  const labels = buildSelectionSalesLabels({ salesRows, importBatches, ledgers, products, productSkus: rows, workspaceId, store, labelFacts: selectionSalesFacts?.labelFacts });
  const labelBySkc = new Map(labels.items.map(item => [item.canonicalPlatformSkc, item]));
  return rows.map(row => ({ ...row, automaticSalesTag: row.platformSkc ? labelBySkc.get(canonicalPlatformSkc(row.platformSkc)) ?? null : null }));
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
      platformSkc: platformSkc || (row.platformSkcConflict ? "平台 SKC 来源待核对" : "未填写平台 SKC"),
      variants: [row],
    });
  });

  return [...groups.values()].map((group) => {
    const variants = group.variants;
    const latest = variants.find((item) => item.productId) ?? variants.find((item) => item.latestPeriod) ?? variants[0];
    const negative = variants.some((item) => item.hasNegativeProfit || Number(item.referenceUnitProfit) < 0);
    return {
      ...group,
      skuCount: variants.length,
      productName: latest.productName,
      productId: latest.productId,
      latestLedgerId: latest.latestLedgerId,
      automaticSalesTag: latest.automaticSalesTag,
      hasNegativeProfit: negative,
      variants,
    };
  });
}
