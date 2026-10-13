export const PRODUCT_PUBLICATION_STATUSES = Object.freeze([
  { id: "unpublished", label: "未发布", tone: "neutral" },
  { id: "published_pending_review", label: "已发布待审核", tone: "warning" },
  { id: "approved_pending_listing", label: "审核通过待上架", tone: "info" },
  { id: "listed", label: "已上架", tone: "success" },
  { id: "off_shelf", label: "已下架", tone: "neutral" },
]);

function text(value) {
  return String(value ?? "").trim();
}

function coverage(total, covered) {
  const totalCount = Math.max(0, Number(total) || 0);
  const coveredCount = Math.max(0, Math.min(totalCount, Number(covered) || 0));
  return {
    status: totalCount > 0 && coveredCount === totalCount ? "complete" : coveredCount > 0 ? "partial" : "missing",
    totalSkuCount: totalCount,
    coveredSkuCount: coveredCount,
    missingSkuCount: Math.max(0, totalCount - coveredCount),
  };
}

export function normalizeProductPublicationStatus(value) {
  const id = text(value);
  return PRODUCT_PUBLICATION_STATUSES.some((status) => status.id === id) ? id : "unpublished";
}

export function productPublicationStatusById(value) {
  const id = normalizeProductPublicationStatus(value);
  return PRODUCT_PUBLICATION_STATUSES.find((status) => status.id === id) ?? PRODUCT_PUBLICATION_STATUSES[0];
}

/** Data coverage is descriptive for selection; it never changes formal-profit eligibility. */
export function buildProductDataReadiness({
  skuCount = 0,
  erpCoveredSkuCount = 0,
  profitHistorySkuCount = 0,
  referenceProfitSkuCount = 0,
  warehouseMappedSkuCount = 0,
} = {}) {
  const purchase = coverage(skuCount, erpCoveredSkuCount);
  const profit = coverage(skuCount, profitHistorySkuCount);
  const referenceProfit = coverage(skuCount, referenceProfitSkuCount);
  const warehouseMapping = coverage(skuCount, warehouseMappedSkuCount);
  return {
    purchase,
    profit,
    referenceProfit,
    warehouseMapping,
    hasGaps: [purchase, referenceProfit, warehouseMapping].some((item) => item.status !== "complete"),
  };
}

export function productDataStatusLabel(kind, status) {
  return ({
    purchase: { complete: "已覆盖", partial: "部分覆盖", missing: "未采集" },
    referenceProfit: { complete: "可参考", partial: "部分可参考", missing: "待成本/售价" },
    profit: { complete: "已有定稿", partial: "部分定稿", missing: "尚无定稿" },
    warehouseMapping: { complete: "已映射", partial: "部分映射", missing: "待映射" },
  })[kind]?.[status] ?? "待读取";
}
