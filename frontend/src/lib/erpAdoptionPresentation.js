export function summarizeAdoptionForDisplay(adoption, { status = null } = {}) {
  if (!adoption?.summary) return null;
  if (status === "voided") return { title: "本次 ERP 采用已撤回", details: "原回传与撤回记录已保留，请核对当前有效成本。", automaticCount: 0, remainingCount: 0 };
  if (status === "rejected") return { title: "本次 ERP 回传已拒绝", details: "原回传记录已保留，请检查拒绝原因。", automaticCount: 0, remainingCount: 0 };
  const summary = adoption.summary;
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
