import { canonicalPlatformSkc, canonicalPlatformSku, canonicalWarehouseSku } from "../domain/identifiers";
import { storeSkuKey } from "../domain/manualCostOverride";
import { validateErpCostInboxEnvelope } from "../domain/erpInboxContract";
import { reconcileErpCostRows } from "../domain/erpCosts";
import { compareErpSourceOrder, erpBatchAdoptionBoundary, erpSourceOrder } from "../domain/erpAutomaticAdoption";
import { describeLedgerCostIdentityIssue } from "../domain/ledgerCostIdentity";
import { describeErpAdoptionReason } from "./erpAdoptionPresentation";
import { describeEvidenceIssues } from "./costMatching";

const INBOX_STATUSES = new Set(["pending", "loaded", "applied", "voided", "rejected"]);
const RETIRED_STATUSES = new Set(["voided", "rejected"]);
const EXCEPTION_STATES = new Set(["anomaly_pending", "evidence_incomplete", "missing", "ledger_protected", "superseded"]);
const text = value => String(value ?? "").trim();
const list = value => Array.isArray(value) ? value : [];
const skuOf = row => text(row?.platformSku ?? row?.canonicalPlatformSku) ? canonicalPlatformSku(row.platformSku ?? row.canonicalPlatformSku) : null;
const skcOf = row => {
  const value = typeof row === "object" ? row?.platformSkc : row;
  return text(value) ? canonicalPlatformSkc(value) : null;
};
const currentMissing = row => row?.decision?.eligibleForExactProfit !== true;
const finiteAmount = value => value != null && text(value) && Number.isFinite(Number(value)) ? Number(value) : null;
const unique = values => [...new Set(values.filter(Boolean))];

function receivedTime(inbox) {
  for (const value of [inbox.receivedAt, inbox.envelope?.sentAt, inbox.envelope?.batch?.generatedAt]) {
    const timestamp = Date.parse(value ?? "");
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function belongsToLedger(inbox, request, ledger) {
  if (!INBOX_STATUSES.has(inbox?.status) || !text(inbox?.id)) return false;
  if (inbox.workspaceId !== ledger.workspaceId || inbox.ledgerId !== ledger.id) return false;
  const source = inbox.envelope?.batch;
  for (const record of [source, request]) {
    if (!record) continue;
    if (record.workspaceId && record.workspaceId !== ledger.workspaceId) return false;
    if (record.ledgerId && record.ledgerId !== ledger.id) return false;
    if (record.ledgerPeriod && record.ledgerPeriod !== ledger.period) return false;
    if (record.costPeriod && record.costPeriod !== ledger.period) return false;
  }
  return true;
}

function scopedReviewRows(reviewRows, ledger) {
  const rows = new Map();
  for (const row of reviewRows) {
    if (row.workspaceId && row.workspaceId !== ledger.workspaceId) continue;
    if (row.ledgerId && row.ledgerId !== ledger.id) continue;
    if (row.period && row.period !== ledger.period) continue;
    const sku = skuOf(row);
    if (!sku) continue;
    const key = storeSkuKey(row.store, sku);
    // A duplicate projection must not hide a row that still needs a cost.
    if (!rows.has(key) || currentMissing(row)) rows.set(key, row);
  }
  return rows;
}

function expectedScope(inbox, request) {
  const source = inbox.envelope?.batch ?? {};
  const queried = new Set(list(source.query?.platformSkcs).map(skcOf).filter(Boolean));
  const scope = new Map();
  const hasRequestScope = Array.isArray(request?.expectedSkus) && request.expectedSkus.length > 0;
  const candidates = hasRequestScope ? request.expectedSkus : list(source.rows).filter(row => row.ledgerScopeRole !== "auxiliary");
  for (const row of candidates) {
    const sku = skuOf(row);
    if (!sku || !skcOf(row) || !queried.has(skcOf(row))) continue;
    scope.set(sku, { platformSku: row.platformSku ?? sku, platformSkc: row.platformSkc });
  }
  // Historical requests can predate the exact request snapshot. Their durable
  // adoption items establish SKU membership without adding SKC siblings.
  if (!hasRequestScope) for (const item of list(inbox.adoption?.items)) {
    const sku = skuOf(item);
    if (sku && !scope.has(sku)) scope.set(sku, { platformSku: item.platformSku ?? sku, platformSkc: item.platformSkc ?? null });
  }
  return scope;
}

function matchesForReview(inbox, request, ledger, scope, wantedSkus) {
  if (!wantedSkus.size) return { matches: new Map(), boundary: null, error: null };
  try {
    const result = validateErpCostInboxEnvelope(inbox.envelope, {
      expectedWorkspaceId: ledger.workspaceId,
      expectedLedgerId: ledger.id,
      expectedRequestId: inbox.requestId,
      expectedPlatformSkcs: request?.platformSkcs ?? null,
      expectedSkus: request?.expectedSkus?.length ? request.expectedSkus : null,
    });
    if (result.batch.batchId !== inbox.batchId || result.batch.requestId !== inbox.requestId) {
      throw new Error("回传记录与原始批次或请求不一致。");
    }
    const expectedSkus = [...scope].filter(([sku]) => wantedSkus.has(sku)).map(([, row]) => row);
    const costRows = result.rows.filter(row => wantedSkus.has(skuOf(row)) && row.ledgerScopeRole === "expected");
    const reconciliation = reconcileErpCostRows({ workspaceId: ledger.workspaceId, period: ledger.period, expectedSkus, costRows, resolutions: inbox.costResolutions ?? [] });
    return { matches: new Map(reconciliation.matches.map(row => [row.canonicalPlatformSku, row])), boundary: erpBatchAdoptionBoundary(result.batch), error: null };
  } catch (error) {
    return { matches: new Map(), boundary: null, error: error.message || "采购证据无法读取。" };
  }
}

function anomalyReason(match) {
  const reasons = unique((match?.costDecision?.anomalies ?? match?.anomalies ?? []).filter(record => record.status !== 'resolved').flatMap(record => record.reasons ?? []));
  const labels = {
    unit_price_zero: "原始采购单价为 0 元，须核对采购价格",
    unit_price_one: "原始采购单价为 1 元，须确认是否为真实采购价格",
    recent_price_shift_low: "近期采购价格相比历史下降，低于历史参考区间",
    recent_price_shift_high: "近期采购价格相比历史上涨，高于历史参考区间",
    extreme_price_deviation: "单次采购价格极端偏离历史中位价",
  };
  const descriptions = reasons.map(reason => labels[reason] ?? `采购价格异常：${reason}`);
  if (reasons.some(reason => ["recent_price_shift_low", "recent_price_shift_high", "extreme_price_deviation"].includes(reason)) && match.baseline?.enabled) {
    descriptions.push(`历史中位价 ¥${Number(match.baseline.median).toFixed(4)}，参考区间 ¥${Number(match.baseline.lowerBound).toFixed(4)} 至 ¥${Number(match.baseline.upperBound).toFixed(4)}`);
  }
  return descriptions;
}

function reasonForEntry({ inbox, request, ledger, item, row, match, boundary, error }) {
  const reasons = [];
  if (inbox.status === "voided") reasons.push("本次 ERP 采用已撤回，原始证据仅供历史查看");
  if (inbox.status === "rejected") reasons.push("本次 ERP 回传已拒绝，原始证据仅供历史查看");
  if (row?.decision?.identityIssue) reasons.push(describeLedgerCostIdentityIssue(row.decision.identityIssue));
  if (error) reasons.push(`原始回传未通过证据校验：${error}`);
  if (!request) reasons.push("关联 ERP 请求缺失，无法核实原登记范围");
  if (inbox.adoptionFailure) reasons.push(`自动采用未完成：${inbox.adoptionFailure.message || "处理失败，需重试"}`);
  if (inbox.adoptionPending) reasons.push("已收到回传，正在核验并处理正式成本");
  if (item?.state === "ledger_protected") reasons.push("账本定稿保护，本次回传未修改成本");
  if (item?.state === "superseded") reasons.push("原回传已被较新来源替代，请核对最新回传");
  if (item?.reason && !["anomaly_pending", "missing", "finalized", "locked"].includes(item.reason)) reasons.push(describeErpAdoptionReason(item.reason));
  if (inbox.adoption?.reason) reasons.push(describeErpAdoptionReason(inbox.adoption.reason));
  if (boundary?.globalReasons.length) reasons.push(describeErpAdoptionReason(boundary.globalReasons.join(",")));
  const sourceMeta = inbox.envelope?.batch?.sourceMeta;
  for (const [field, label] of [["detailFailures", "采购明细读取失败"], ["mappingFailures", "平台 SKU 映射失败"]]) {
    for (const failure of list(sourceMeta?.[field])) {
      if (failure?.warehouseSku && (!match?.sourceWarehouseSku || canonicalWarehouseSku(failure.warehouseSku) !== canonicalWarehouseSku(match.sourceWarehouseSku))) continue;
      if (!failure?.warehouseSku && failure?.platformSku && skuOf(failure) !== skuOf(row ?? item)) continue;
      reasons.push(`${label}${text(failure?.message) ? `：${text(failure.message)}` : "，需补齐对应来源证据"}`);
    }
  }
  reasons.push(...anomalyReason(match));
  if (match?.evidenceComplete === false || item?.state === "evidence_incomplete") {
    reasons.push("采购证据不完整");
    if (match) reasons.push(...describeEvidenceIssues(match).filter(issue => issue.key !== "excludedRecords").map(issue => issue.detail));
  }
  if (match?.costDecision?.selectedRecords?.length === 0) reasons.push(`${ledger.period} 及以前没有合格采购记录`);
  if (row?.decision?.reasons?.includes("erp_cost_period_unverified")) reasons.push("已采用成本的采购选样不符合本月范围，需复核原始证据");
  if (!reasons.length) {
    if (match?.status === "missing" || item?.state === "missing") reasons.push("本次回传未取得该平台 SKU 的可用 ERP 成本");
    else if (item?.state === "anomaly_pending") reasons.push("原始采购异常仍需核对");
    else if (match?.status === "matched") reasons.push("本次已生成 ERP 候选价格，但当前尚无有效采用成本");
    else reasons.push("当前尚无可用 ERP 采购证据，请重新采集或人工更正");
  }
  return unique(reasons).join("；");
}

function reviewEntry({ batch, request, ledger, item, row, match, boundary, error, sourceRow }) {
  const sku = skuOf(row ?? item ?? sourceRow);
  return {
    id: JSON.stringify([batch.id, row ? storeSkuKey(row.store, sku) : sku]),
    reviewRowId: row?.id ?? null,
    inboxId: batch.id,
    batchId: batch.batchId,
    batchIndex: batch.index,
    platformSku: row?.platformSku ?? item?.platformSku ?? sourceRow?.platformSku ?? sku,
    canonicalPlatformSku: sku,
    platformSkc: row?.platformSkc ?? match?.platformSkc ?? sourceRow?.platformSkc ?? null,
    warehouseSku: match?.sourceWarehouseSku ?? sourceRow?.warehouseSku ?? null,
    store: row?.store ?? null,
    attribute: row?.attribute ?? match?.attribute ?? sourceRow?.attribute ?? "",
    productName: match?.productName ?? sourceRow?.productName ?? "",
    unitCost: finiteAmount(match?.unitCost ?? match?.previewUnitCost ?? sourceRow?.previewUnitCost ?? sourceRow?.unitCost),
    reasonText: reasonForEntry({ inbox: batch.inbox, request, ledger, item, row, match, boundary, error }),
    state: item?.state ?? (match?.status === "anomaly_pending" ? "anomaly_pending" : "missing"),
    currentMissing: Boolean(row && currentMissing(row)),
    canCorrect: Boolean(row && row.id != null && row.decision?.identityIssue?.code !== "ledger_sku_skc_conflict"),
    match: match ?? null,
  };
}

function missingWithoutEvidence(row, latest = null) {
  const sku = skuOf(row);
  const reasonText = latest?.inbox.status === "voided" ? "最近的 ERP 采用已撤回，当前没有可用回传证据；请重新采集或人工更正"
    : latest?.inbox.status === "rejected" ? "最近的 ERP 回传已拒绝，当前没有可用回传证据；请重新采集或人工更正"
      : row.decision?.identityIssue ? describeLedgerCostIdentityIssue(row.decision.identityIssue)
        : "尚未收到本月该平台 SKU 的可用 ERP 回传；请重新采集或人工更正";
  return { id: `current:${storeSkuKey(row.store, sku)}`, reviewRowId: row.id ?? null, inboxId: null, batchId: null, batchIndex: null,
    platformSku: row.platformSku ?? sku, canonicalPlatformSku: sku, platformSkc: row.platformSkc ?? null,
    warehouseSku: null, store: row.store ?? null, attribute: row.attribute ?? "", productName: "", unitCost: null,
    reasonText, state: "missing", currentMissing: true,
    canCorrect: row.id != null && row.decision?.identityIssue?.code !== "ledger_sku_skc_conflict", match: null };
}

// Display-only projection. Decisions supplied by the parent remain authoritative;
// historical receipts and their adoption states are never edited or re-adopted.
export function buildErpInboxReview({ inboxes = [], requests = [], ledger, reviewRows = [] } = {}) {
  if (!ledger?.workspaceId || !ledger?.id || !/^\d{4}-(0[1-9]|1[0-2])$/.test(ledger.period ?? "")) return { batches: [], exceptions: [] };
  const requestById = new Map(requests.map(request => [text(request.id ?? request.requestId), request]));
  const currentRows = scopedReviewRows(reviewRows, ledger);
  const rowsBySku = new Map();
  for (const row of currentRows.values()) {
    const sku = skuOf(row);
    if (!rowsBySku.has(sku)) rowsBySku.set(sku, []);
    rowsBySku.get(sku).push(row);
  }
  const scoped = inboxes.filter(inbox => belongsToLedger(inbox, requestById.get(text(inbox.requestId)), ledger))
    .toSorted((left, right) => receivedTime(left) - receivedTime(right) || text(left.id).localeCompare(text(right.id)));
  const latestByStoreSku = new Map();
  const batches = scoped.map((inbox, index) => {
    const request = requestById.get(text(inbox.requestId));
    const source = inbox.envelope?.batch ?? {};
    const scope = expectedScope(inbox, request);
    const historical = new Map(list(inbox.adoption?.items).filter(item => EXCEPTION_STATES.has(item.state) && skuOf(item)).map(item => [skuOf(item), item]));
    const wantedSkus = new Set([...historical.keys(), ...[...scope.keys()].filter(sku => (rowsBySku.get(sku) ?? []).some(currentMissing))]);
    const { matches, boundary, error } = matchesForReview(inbox, request, ledger, scope, wantedSkus);
    const summary = inbox.adoption?.summary;
    const automaticCount = RETIRED_STATUSES.has(inbox.status) ? 0 : summary ? Math.max(0, Number(summary.adoptedCount ?? 0) - Number(summary.manualEffectiveCount ?? 0))
      : list(inbox.adoption?.items).filter(item => item.state === "adopted").length;
    const batch = { id: inbox.id, inbox, batchId: inbox.batchId, index: index + 1, total: scoped.length,
      skcCount: new Set(list(source.query?.platformSkcs).map(skcOf).filter(Boolean)).size,
      automaticCount, currentMissingCount: 0, coveredCount: 0, historicalExceptionCount: historical.size, entries: [] };
    const sourceOrder = erpSourceOrder(request ?? { requestedAt: inbox.receivedAt ?? inbox.envelope?.sentAt }, { ...source, batchId: inbox.batchId });
    for (const sku of wantedSkus) {
      const item = historical.get(sku) ?? list(inbox.adoption?.items).find(candidate => skuOf(candidate) === sku);
      const sourceRow = list(source.rows).find(row => skuOf(row) === sku && row.ledgerScopeRole !== "auxiliary");
      const rows = rowsBySku.get(sku) ?? [];
      const relevantRows = historical.has(sku) ? rows : rows.filter(currentMissing);
      if (!rows.length && historical.has(sku)) relevantRows.push(null);
      for (const row of relevantRows) {
        const entry = reviewEntry({ batch, request, ledger, item, row, match: matches.get(sku), boundary, error, sourceRow });
        batch.entries.push(entry);
        if (entry.currentMissing) {
          const key = storeSkuKey(row.store, sku);
          const previous = latestByStoreSku.get(key);
          const order = previous ? compareErpSourceOrder(sourceOrder, previous.sourceOrder) : 1;
          if (order > 0 || order === 0 && receivedTime(inbox) >= receivedTime(previous.inbox)) latestByStoreSku.set(key, { entry, inbox, sourceOrder });
        } else if (row?.decision?.eligibleForExactProfit === true) batch.coveredCount += 1;
      }
    }
    batch.currentMissingCount = batch.entries.filter(entry => entry.currentMissing).length;
    return batch;
  });
  const exceptions = [...currentRows].filter(([, row]) => currentMissing(row)).map(([key, row]) => {
    const latest = latestByStoreSku.get(key);
    return latest && !RETIRED_STATUSES.has(latest.inbox.status) ? latest.entry : missingWithoutEvidence(row, latest);
  });
  return { batches, exceptions };
}
