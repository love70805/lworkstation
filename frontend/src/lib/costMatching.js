import { canonicalPlatformSkc, canonicalPlatformSku } from "../domain/identifiers";

function normalizedSearch(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

export function matchesCostQuery(match, query) {
  const normalizedQuery = normalizedSearch(query);
  if (!normalizedQuery) return true;
  const searchText = [
    match.platformSkc,
    match.platformSku,
    match.sourcePlatformSku,
    match.attribute,
    match.sourceWarehouseSku,
    match.supplierName,
    match.supplier1688Url,
    match.orderNumber,
    match.productName,
  ].map(normalizedSearch).join(" ");
  return searchText.includes(normalizedQuery);
}

export function filterCostMatches(matches = [], query = "") {
  return matches.filter((match) => matchesCostQuery(match, query));
}

export function filterCostMatchGroups(groups = [], query = "") {
  const normalizedQuery = normalizedSearch(query);
  if (!normalizedQuery) return groups;
  return groups.filter((group) => (
    normalizedSearch(group.platformSkc).includes(normalizedQuery)
    || group.variants.some((match) => matchesCostQuery(match, normalizedQuery))
  ));
}

export function isUnmappedCostMatch(match = {}) {
  return Boolean(match.sourceWarehouseSku && (match.mappingFallback || !match.sourcePlatformSku));
}

function readableSourceWarning(value, match = {}) {
  const warning = String(value ?? "").trim();
  if (warning === "purchase_evidence_missing") return "采购证据缺失";
  if (warning.startsWith("mapping_failure:expected_skc_mismatch:")) {
    const platformSku = warning.slice("mapping_failure:expected_skc_mismatch:".length) || match.platformSku || "未知";
    const sourceSkc = match.raw?.platformSkc || match.sourcePlatformSkc || "未知";
    return `平台 SKU ${platformSku} 的 ERP 平台 SKC（${sourceSkc}）与当前账本期望 SKC（${match.platformSkc || "未知"}）不一致`;
  }
  if (warning.startsWith("mapping_failure:missing_expected_platform_sku:")) {
    return `当前账本平台 SKU ${warning.slice("mapping_failure:missing_expected_platform_sku:".length) || "未知"} 未收到 ERP 精确映射`;
  }
  if (warning.startsWith("mapping_failure:outside_query_skc:")) return "ERP 返回的平台 SKC 不在本次完整查询范围内";
  if (warning.startsWith("mapping_failure:missing_platform_sku")) return "ERP 映射缺少平台 SKU";
  if (warning.startsWith("mapping_failure:missing_platform_skc")) return "ERP 映射缺少平台 SKC";
  if (warning === "mapping_failure:expected_scope_unavailable") return "缺少当前账本 expected SKU 请求快照，无法验证映射范围";
  if (warning.startsWith("mapping_failure:")) return "平台 SKU/SKC 映射失败（原因未识别）";
  if (warning.startsWith("detail_failure:")) return `采购明细读取失败（${warning.slice("detail_failure:".length) || "原因未知"}）`;
  if (warning === "evidence_only_warehouse_sku") return "仅有仓库 SKU 证据，未完成平台映射";
  if (warning === "mapping_missing_for_warehouse_sku") return "仓库 SKU 缺少平台映射";
  return warning;
}

export function groupAuxiliaryCostRows(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const platformSkc = String(row?.platformSkc ?? "").trim() || "平台 SKC 未知";
    const warehouseSku = String(row?.warehouseSku ?? row?.sourceWarehouseSku ?? "").trim() || "仓库 SKU 未知";
    const key = `${canonicalPlatformSkc(platformSkc)}::${warehouseSku.normalize("NFKC").toUpperCase()}`;
    const group = groups.get(key) ?? {
      id: `auxiliary-${key}`,
      platformSkc,
      warehouseSku,
      variants: [],
      purchaseRecordCount: 0,
      excludedRecordCount: 0,
    };
    group.variants.push({
      platformSku: String(row?.platformSku ?? "").trim() || "平台 SKU 未知",
      supplierName: String(row?.supplierName ?? "").trim(),
      supplier1688Url: String(row?.supplier1688Url ?? "").trim(),
      previewUnitCost: row?.previewUnitCost ?? row?.unitCost ?? null,
    });
    group.purchaseRecordCount = Math.max(group.purchaseRecordCount, Array.isArray(row?.purchaseRecords) ? row.purchaseRecords.length : 0);
    group.excludedRecordCount = Math.max(group.excludedRecordCount, Array.isArray(row?.excludedRecords) ? row.excludedRecords.length : 0);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function describeEvidenceIssues(match = {}) {
  const issues = [];
  const purchaseRecords = Array.isArray(match.purchaseRecords) ? match.purchaseRecords : [];
  const excludedRecords = Array.isArray(match.excludedRecords) ? match.excludedRecords : [];
  const sourceWarnings = Array.isArray(match.sourceWarnings) ? match.sourceWarnings.filter(Boolean) : [];
  const evidenceRef = match.raw?.evidenceRef ?? match.evidenceRef ?? "";
  const mappingFailures = Array.isArray(match.mappingFailures)
    ? match.mappingFailures
    : (Array.isArray(match.raw?.mappingFailures) ? match.raw.mappingFailures : []);
  const detailFailures = Array.isArray(match.detailFailures)
    ? match.detailFailures
    : (Array.isArray(match.raw?.detailFailures) ? match.raw.detailFailures : []);
  const mappingWarnings = sourceWarnings.filter((warning) => String(warning).startsWith("mapping_failure:"));
  const detailWarnings = sourceWarnings.filter((warning) => warning === "purchase_evidence_missing" || String(warning).startsWith("detail_failure:"));
  const otherWarnings = sourceWarnings.filter((warning) => !mappingWarnings.includes(warning) && !detailWarnings.includes(warning));

  if (!match.sourceWarehouseSku) issues.push({ key: "warehouseSku", label: "仓库 SKU", detail: "缺少仓库 SKU，无法归属采购证据。" });
  if (!match.sourcePlatformSku || !match.platformSkc || match.mappingFallback) {
    issues.push({ key: "mapping", label: "平台 SKU/SKC 映射", detail: match.mappingFallback ? "使用仓库 SKU 兜底，未完成平台 SKU 精确映射。" : "缺少平台 SKU 或平台 SKC 映射。" });
  }
  if (purchaseRecords.length === 0) issues.push({ key: "purchaseRecords", label: "采购记录", detail: "没有可用于核算的采购记录。" });
  if (excludedRecords.length > 0) issues.push({ key: "excludedRecords", label: "排除记录", detail: `发现 ${excludedRecords.length} 条已排除记录，原因仅保留在审计证据中。` });
  if (mappingFailures.length > 0) issues.push({ key: "mappingFailures", label: "映射失败", detail: `发现 ${mappingFailures.length} 条平台 SKU/SKC 映射失败记录。` });
  if (detailFailures.length > 0) issues.push({ key: "detailFailures", label: "明细失败", detail: `发现 ${detailFailures.length} 条采购明细读取失败记录。` });
  if (mappingWarnings.length > 0) issues.push({ key: "mappingSourceWarnings", label: "平台身份映射", detail: mappingWarnings.map((warning) => readableSourceWarning(warning, match)).join("；") });
  if (detailWarnings.length > 0) issues.push({ key: "detailSourceWarnings", label: "采购证据采集", detail: detailWarnings.map((warning) => readableSourceWarning(warning, match)).join("；") });
  if (otherWarnings.length > 0) issues.push({ key: "sourceWarnings", label: "采集警告", detail: otherWarnings.map((warning) => readableSourceWarning(warning, match)).join("；") });
  if (!evidenceRef) issues.push({ key: "evidenceRef", label: "证据引用", detail: "缺少 evidenceRef，无法确认行与仓库证据的稳定关联。" });
  if (issues.length === 0 && match.evidenceComplete === false) {
    issues.push({ key: "batchEvidence", label: "批次证据状态", detail: "批次被标记为不完整，需要重新生成完整 ERP v2 证据。" });
  }
  return issues;
}

export function evidenceRepairGuidance(issueKeys = []) {
  const keys = new Set(issueKeys);
  const guidance = [];
  if (keys.has("warehouseSku") || keys.has("mapping")) guidance.push("回到 ERP 采购页重新抓取平台 SKU/SKC 与仓库 SKU 映射。");
  if (keys.has("purchaseRecords")) guidance.push("确认采购页已加载历史订单明细，并重新执行成本核算。");
  if (keys.has("excludedRecords")) guidance.push("排除记录会继续保留审计；请核对取消、关闭或当月记录的排除原因。");
  if (keys.has("mappingSourceWarnings") || keys.has("mappingFailures")) guidance.push("核对当前账本平台 SKU/SKC 与 ERP 仓库映射；修正商品身份或仓库 SKU 映射后重新采集。");
  if (keys.has("detailSourceWarnings") || keys.has("detailFailures")) guidance.push("检查 ERP 采购页分页和历史订单明细是否完整加载后重新采集。");
  if (keys.has("sourceWarnings")) guidance.push("按采集警告完成对应修正后重新回传。");
  if (keys.has("evidenceRef") || keys.has("batchEvidence")) guidance.push("使用 ERP Assistant v8.0.15 重新生成完整 v2 批次，再回到本页载入。");
  return [...new Set(guidance)];
}

export function hasMappingIdentityIssue(matches = []) {
  return matches.some((match) => (
    (Array.isArray(match?.sourceWarnings) && match.sourceWarnings.some((warning) => String(warning).startsWith("mapping_failure:")))
    || (Array.isArray(match?.mappingFailures) && match.mappingFailures.length > 0)
    || (Array.isArray(match?.raw?.mappingFailures) && match.raw.mappingFailures.length > 0)
  ));
}

export async function switchLoadedErpInboxDraft({
  candidate,
  previous = null,
  parseCandidate,
  markStatus,
  switchStatus,
  now = () => new Date().toISOString(),
} = {}) {
  if (!candidate?.id || typeof parseCandidate !== "function" || (typeof markStatus !== "function" && typeof switchStatus !== "function")) {
    throw new Error("ERP 待处理批次切换参数无效。");
  }
  const parsed = await parseCandidate();
  const switchedAt = now();
  if (typeof switchStatus === "function") {
    await switchStatus({ candidateId: candidate.id, previousId: previous?.id ?? null, switchedAt });
    return parsed;
  }
  await markStatus(candidate.id, "loaded", { loadedAt: switchedAt });
  if (previous?.id && previous.id !== candidate.id) {
    try {
      await markStatus(previous.id, "pending", { unloadedAt: switchedAt, unloadReason: "switched_batch" });
    } catch (error) {
      await markStatus(candidate.id, "pending", { unloadedAt: switchedAt, unloadReason: "switch_rollback" });
      throw error;
    }
  }
  return parsed;
}

export async function rejectErpInboxBatchesForCostMatching({
  ids,
  loadedInboxId = null,
  rejectBatches,
  clearLoadedDraft,
} = {}) {
  const result = await rejectBatches({ ids });
  const clearedLoadedDraft = Boolean(loadedInboxId && result.loadedIds?.includes(loadedInboxId));
  if (clearedLoadedDraft) clearLoadedDraft();
  return { ...result, clearedLoadedDraft };
}

const ERP_INBOX_HISTORY_STATUS_LABELS = {
  applied: "已发布",
  rejected: "已删除",
  voided: "已作废",
};

export function buildErpInboxHistory(records = [], ledgerId = null) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => (!ledgerId || record?.ledgerId === ledgerId) && ERP_INBOX_HISTORY_STATUS_LABELS[record?.status])
    .map((record) => ({
      ...record,
      statusLabel: ERP_INBOX_HISTORY_STATUS_LABELS[record.status],
      historyAt: record.voidedAt ?? record.appliedAt ?? record.rejectedAt ?? record.receivedAt ?? null,
      sourceLabel: record.receivedVia ?? record.envelope?.transport ?? "来源未知",
    }))
    .toSorted((left, right) => String(right.historyAt ?? "").localeCompare(String(left.historyAt ?? "")));
}

/**
 * The ERP query unit is platform SKC. Keep the reconciliation at SKU level,
 * but present one compact row per SKC so variant branches do not flood the
 * procurement review table.
 */
export function groupCostMatchesBySkc(matches = []) {
  const groups = new Map();

  matches.forEach((match) => {
    const platformSkc = String(match.platformSkc ?? "").trim();
    const groupKey = platformSkc
      ? canonicalPlatformSkc(platformSkc)
      : `SKU:${canonicalPlatformSku(match.platformSku)}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.variants.push(match);
      return;
    }
    groups.set(groupKey, {
      id: `cost-group-${groupKey}`,
      platformSkc: platformSkc || "未填写平台 SKC",
      canonicalPlatformSkc: platformSkc ? canonicalPlatformSkc(platformSkc) : null,
      variants: [match],
    });
  });

  return [...groups.values()].map((group) => {
    const matchedCount = group.variants.filter((item) => item.status === "matched").length;
    const missingCount = group.variants.length - matchedCount;
    return {
      ...group,
      skuCount: group.variants.length,
      matchedCount,
      missingCount,
      status: missingCount === 0 ? "matched" : "missing",
    };
  });
}

