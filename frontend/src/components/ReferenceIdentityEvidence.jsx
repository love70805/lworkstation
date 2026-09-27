const labels = { catalog: "商品档案", ledger: "台账", profit: "定稿利润" };

export default function ReferenceIdentityEvidence({ variant }) {
  const conflict = variant.platformSkcConflict || variant.attributeConflict;
  const projected = variant.platformSkcSource === "ledger" || variant.attributeSource === "ledger";
  if (!conflict && !projected) return null;
  return <details className="reference-identity-evidence">
    <summary>{conflict ? "身份来源有差异" : "身份来自台账"}</summary>
    {["platformSkc", "attribute"].map(field => (variant[`${field}Evidence`] ?? []).length ? <div key={field}>
      <strong>{field === "platformSkc" ? "平台 SKC" : "属性"} · {labels[variant[`${field}Source`]] ?? "待核对"}</strong>
      {variant[`${field}Evidence`].map(item => <p key={item.value}>
        <span>{item.value}</span>{item.sources.map((source, index) => <small key={index} title={`账本 ${source.ledgerId || "未提供"}${source.batchId ? ` · 批次 ${source.batchId}` : ""}`}>{labels[source.kind]} · {source.period || "月份未提供"} · {source.store || "店铺未提供"}{source.sourceSheet ? ` · ${source.sourceSheet}` : ""}{source.sourceRow != null ? ` 第 ${source.sourceRow} 行` : ""}</small>)}
      </p>)}
      <details className="reference-source-identifiers"><summary>查看原始关联</summary>{variant[`${field}Evidence`].flatMap(item => item.sources.map((source, index) => <p key={`${item.value}-${index}`}><span>{item.value}</span><small>账本 {source.ledgerId || "未提供"}{source.batchId ? ` · 批次 ${source.batchId}` : ""}</small></p>))}</details>
    </div> : null)}
  </details>;
}
