const ERP_ADOPTION_REASON_LABELS = Object.freeze({
  request_or_ledger_missing: '关联 ERP 请求或账本缺失或不匹配',
  ledger_period_mismatch: 'ERP 请求月份与账本月份不一致',
  legacy_request_scope_missing: '旧请求无法从当前账本重建平台 SKU 范围',
  legacy_request_ambiguous_scope: '旧请求中同一平台 SKU 对应多个平台 SKC',
  legacy_evidence: '旧批次缺少正式核算所需的完整采购证据',
  source_incomplete: 'ERP 来源声明整体证据不完整',
  source_warning: 'ERP 来源存在整体采集警告',
  unscoped_source_failure: 'ERP 采集失败未定位到具体 SKU',
  sku_not_in_ledger: '该平台 SKU 不在当前账本',
  item_evidence_incomplete: '该 SKU 的采购证据不完整',
  newer_source_exists: '已有较新的 ERP 回传',
});

export function describeErpAdoptionReason(reason) {
  return String(reason ?? '').split(',').map(value => value.trim()).filter(Boolean)
    .map(value => ERP_ADOPTION_REASON_LABELS[value] ?? `原因代码 ${value}`).join('；');
}

export function summarizeAdoptionForDisplay(adoption, { status = null } = {}) {
  if (!adoption?.summary) return null;
  if (status === "voided") return { title: "本次 ERP 采用已撤回", details: "原回传与撤回记录已保留，请核对当前有效成本。", automaticCount: 0, remainingCount: 0 };
  if (status === "rejected") return { title: "本次 ERP 回传已拒绝", details: "原回传记录已保留，请检查拒绝原因。", automaticCount: 0, remainingCount: 0 };
  const summary = adoption.summary;
  const reasonText = describeErpAdoptionReason(adoption.reason);
  const automaticCount = Math.max(0, (summary.adoptedCount ?? 0) - (summary.manualEffectiveCount ?? 0));
  const remainingCount = summary.remainingCount ?? 0;
  const details = [
    `ERP 自动采用 ${automaticCount} 项`,
    summary.manualEffectiveCount ? `人工更正仍有效 ${summary.manualEffectiveCount} 项` : null,
    summary.anomalyCount ? `采购异常 ${summary.anomalyCount} 项` : null,
    summary.evidenceIncompleteCount ? `证据不完整 ${summary.evidenceIncompleteCount} 项` : null,
    summary.missingCount ? `未取得成本 ${summary.missingCount} 项` : null,
    summary.protectedCount ? `定稿保护 ${summary.protectedCount} 项` : null,
    summary.supersededCount ? `旧回传跳过 ${summary.supersededCount} 项` : null,
    adoption.state === 'blocked' && reasonText ? reasonText : null,
  ].filter(Boolean).join(" · ");
  const title = adoption.state === "applied" ? "本次 ERP 回传已处理"
    : adoption.state === "partial" ? `已自动采用 ${automaticCount} 项，剩余 ${remainingCount} 项待处理`
      : adoption.state === "protected" ? "账本已定稿，回传证据已保留"
        : adoption.state === "blocked" ? "回传来源未通过整批校验"
          : "本次 ERP 回传仍待处理";
  return { title, details, automaticCount, remainingCount };
}

export const ERP_ADOPTION_ITEM_LABELS = Object.freeze({
  adopted: "本次 ERP 已自动采用",
  manual_effective: "ERP 证据已存，人工更正有效",
  anomaly_pending: "采购异常待处理",
  evidence_incomplete: "采购证据不完整",
  missing: "未取得 ERP 成本",
  ledger_protected: "账本定稿保护，成本未改",
  superseded: "旧回传已跳过",
});

export const ERP_ADOPTION_ACTIONS = Object.freeze({
  anomaly_pending: "核对采购异常或人工更正",
  evidence_incomplete: "重新采集完整采购证据",
  missing: "重新查询 ERP 或人工更正",
  ledger_protected: "查看定稿账本与保留证据",
  superseded: "查看较新的回传记录",
});

export function groupAdoptionExceptions(adoption) {
  const groups = new Map();
  for (const item of adoption?.items ?? []) {
    if (!ERP_ADOPTION_ACTIONS[item.state]) continue;
    const entries = groups.get(item.state) ?? [];
    entries.push(item);
    groups.set(item.state, entries);
  }
  return [...groups].map(([state, items]) => ({ state, label: ERP_ADOPTION_ITEM_LABELS[state], action: ERP_ADOPTION_ACTIONS[state], items }));
}
