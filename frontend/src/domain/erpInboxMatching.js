import { canonicalPlatformSkc } from "./identifiers";

function normalizedSkcSet(values = []) {
  const result = new Set();
  for (const item of Array.isArray(values) ? values : []) {
    try {
      const value = canonicalPlatformSkc(item && typeof item === "object" ? item.platformSkc : item);
      if (value) result.add(value);
    } catch {
      // A malformed inbox record is non-matching, not fatal to the whole queue.
    }
  }
  return result;
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export const ERP_INBOX_MATCH_REASONS = Object.freeze({
  matched: "范围完全匹配",
  ledger_closed: "账本已定稿或锁定",
  ledger_mismatch: "账本不匹配",
  request_mismatch: "ERP 请求不匹配",
  skc_mismatch: "平台 SKC 集合不完整或不匹配",
  request_missing: "找不到关联的 ERP 请求",
  current_filter_mismatch: "与当前页面筛选 SKC 范围不同，需手动载入",
  inbox_not_pending: "批次已载入或处理",
});

export function evaluateErpInboxMatch({ inbox, request, ledger, currentPlatformSkcs = null } = {}) {
  if (!request) return { scopeMatched: false, canAutoLoad: false, reason: "request_missing" };

  const batch = inbox?.envelope?.batch ?? {};
  const inboxLedgerId = String(batch.ledgerId ?? inbox?.ledgerId ?? "").trim();
  const inboxRequestId = String(batch.requestId ?? inbox?.requestId ?? "").trim();
  const requestLedgerId = String(request.ledgerId ?? "").trim();
  const requestId = String(request.id ?? request.requestId ?? "").trim();
  const ledgerId = String(ledger?.id ?? "").trim();

  if (!ledgerId || inboxLedgerId !== ledgerId || requestLedgerId !== ledgerId) {
    return { scopeMatched: false, canAutoLoad: false, reason: "ledger_mismatch" };
  }
  if (!requestId || inboxRequestId !== requestId || String(inbox?.requestId ?? inboxRequestId).trim() !== requestId) {
    return { scopeMatched: false, canAutoLoad: false, reason: "request_mismatch" };
  }

  const requestSkcs = normalizedSkcSet(request.platformSkcs);
  const inboxSkcs = normalizedSkcSet(batch.query?.platformSkcs);
  if (requestSkcs.size === 0 || !sameSet(requestSkcs, inboxSkcs)) {
    return { scopeMatched: false, canAutoLoad: false, reason: "skc_mismatch" };
  }

  if (["finalized", "locked"].includes(ledger?.status)) {
    return { scopeMatched: true, canAutoLoad: false, reason: "ledger_closed" };
  }
  const currentSkcs = currentPlatformSkcs == null ? null : normalizedSkcSet(currentPlatformSkcs);
  if (currentSkcs && (currentSkcs.size === 0 || !sameSet(requestSkcs, currentSkcs))) {
    return { scopeMatched: true, filterScopeMatched: false, canAutoLoad: false, reason: "current_filter_mismatch" };
  }
  if (inbox?.status !== "pending") {
    return { scopeMatched: true, filterScopeMatched: true, canAutoLoad: false, reason: "inbox_not_pending" };
  }
  return { scopeMatched: true, filterScopeMatched: true, canAutoLoad: true, reason: "matched" };
}

function inboxTimestamp(inbox) {
  const value = Date.parse(String(inbox?.envelope?.sentAt ?? inbox?.receivedAt ?? ""));
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

export function buildErpInboxQueue({ inboxes = [], requests = [], ledger, currentPlatformSkcs = null } = {}) {
  const requestById = new Map((Array.isArray(requests) ? requests : []).map((request) => [
    String(request?.id ?? request?.requestId ?? "").trim(),
    request,
  ]).filter(([id]) => id));
  const items = (Array.isArray(inboxes) ? inboxes : [])
    .toSorted((left, right) => inboxTimestamp(left) - inboxTimestamp(right))
    .map((inbox) => {
      const requestId = String(inbox?.requestId ?? inbox?.envelope?.batch?.requestId ?? "").trim();
      const request = requestById.get(requestId) ?? null;
      return { inbox, request, ...evaluateErpInboxMatch({ inbox, request, ledger, currentPlatformSkcs }) };
    });
  const hasLoaded = items.some((item) => item.inbox?.status === "loaded" && item.scopeMatched);
  return {
    items,
    pendingCount: items.filter((item) => ["pending", "loaded"].includes(item.inbox?.status)).length,
    autoLoad: hasLoaded ? null : items.find((item) => item.canAutoLoad) ?? null,
  };
}
