import { AlertCircle, Pencil } from "lucide-react";
import { Badge, Button } from "../components/UI";
import ReferenceIdentityEvidence from "../components/ReferenceIdentityEvidence";

const columnLabels = ["平台 SKU / 属性", "当前参考成本", "最近定稿月", "近三月经营", "最近实际利润", "单件参考利润", "参考状态"];
const sourceLabels = { erp_history: "ERP 历史", manual_confirmed: "人工确认", finalized_profit_history: "定稿历史", supplier_landed: "1688 参考" };
const money = (value, fractionDigits = 2) => Number(value ?? 0).toLocaleString("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
const percent = value => value == null ? "--" : `${Number(value).toFixed(1)}%`;
const count = value => Number(value ?? 0).toLocaleString("zh-CN");
const shortDate = value => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) : null;
};

export function ReferenceTableHeader() {
  return <><span className="visually-hidden">按平台 SKC 分组的成本与利润参考</span><div className="reference-column-headings" aria-hidden="true">{columnLabels.map(label => <span key={label}>{label}</span>)}</div></>;
}

function ReferenceCost({ variant }) {
  if (variant.referenceUnitCost == null) return <Badge tone="danger">缺失</Badge>;
  return <div className="reference-value-stack">
    <strong className="mono reference-money">{money(variant.referenceUnitCost, variant.authoritativeSource === "erp" ? 4 : 2)}</strong>
    <span title={variant.referenceNote ?? undefined}><Badge tone={variant.authoritativeSource === "erp" ? "success" : "neutral"}>{sourceLabels[variant.referenceKind] ?? "参考"}</Badge></span>
    {variant.referenceKind === "manual_confirmed" ? <small>{shortDate(variant.referenceUpdatedAt) ? `确认于 ${shortDate(variant.referenceUpdatedAt)}` : "已确认"}{variant.manualCostHistoryCount > 1 ? ` · ${variant.manualCostHistoryCount} 条记录` : ""}</small> : null}
  </div>;
}

function ReferenceStatus({ variant }) {
  if (variant.referenceUnitCost == null) return <Badge tone="danger"><AlertCircle size={12} aria-hidden="true" />缺参考成本</Badge>;
  if (variant.averageSalePrice == null) return <Badge>等待售价历史</Badge>;
  if (variant.hasNegativeProfit) return <Badge tone="danger"><AlertCircle size={12} aria-hidden="true" />出现负利润</Badge>;
  return <Badge tone="success">可用于选品参考</Badge>;
}

// A real row owns all values for one SKU, including identity provenance.
// Expanding its source details grows this same row across every value column.
export default function ReferenceGroupRows({ group, onEdit, onOpenLedger }) {
  const openLedger = variant => variant.latestLedgerId && onOpenLedger(variant.latestLedgerId);
  return <table className="reference-group-table" aria-label={`平台 SKC ${group.platformSkc} 经营参考`}>
    <caption><div className="reference-group-heading"><strong className="mono">{group.platformSkc}</strong><span>{group.skuCount} 个 SKU · {group.productName}</span><Button variant="ghost" icon={Pencil} onClick={event => { event.stopPropagation(); onEdit(); }}>{group.productId ? "编辑档案" : "建立档案"}</Button></div></caption>
    <colgroup>{columnLabels.map((label, index) => <col key={label} className={`reference-column-${index}`} />)}</colgroup>
    <thead className="visually-hidden"><tr>{columnLabels.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
    <tbody>{group.variants.map(variant => <tr key={variant.canonicalPlatformSku} data-platform-sku={variant.platformSku}
      tabIndex={variant.latestLedgerId ? 0 : undefined}
      onClick={event => { if (!event.target.closest("button, a, summary, details")) openLedger(variant); }}
      onKeyDown={event => { if (event.key === "Enter" && event.target === event.currentTarget) { event.preventDefault(); openLedger(variant); } }}>
      <td className="reference-identity-cell"><div className="reference-sku-identity"><strong className="mono">{variant.platformSku}</strong><span>{variant.attribute || (variant.attributeConflict ? "属性来源待核对" : "未提供属性")}</span><ReferenceIdentityEvidence variant={variant} /></div></td>
      <td className="reference-cost-cell"><ReferenceCost variant={variant} /></td>
      <td className="reference-period-cell">{variant.latestPeriod ? <div className="reference-value-stack"><button className="reference-period-link mono" type="button" disabled={!variant.latestLedgerId} onClick={() => openLedger(variant)} aria-label={`查看 ${variant.platformSku} ${variant.latestPeriod} 定稿利润`}>{variant.latestPeriod}</button><small>销量 {count(variant.latestQuantity)}</small></div> : <span className="pending-text">暂无定稿</span>}</td>
      <td className="reference-revenue-cell"><div className="reference-value-stack"><strong className="mono reference-money">{money(variant.recentRevenue)}</strong><small>{variant.recentMonthCount} 个月 · {count(variant.recentQuantity)} 件</small></div></td>
      <td className="reference-profit-cell">{variant.latestProfit == null ? <span className="pending-text">--</span> : <div className={`reference-value-stack ${variant.latestProfit < 0 ? "danger-text" : "success-text"}`}><strong className="mono reference-money">{money(variant.latestProfit)}</strong><small>利润率 {percent(variant.latestProfitRate)}</small></div>}</td>
      <td className="reference-unit-profit-cell">{variant.referenceUnitProfit == null ? <span className="pending-text">缺少售价历史</span> : <div className={`reference-value-stack ${variant.referenceUnitProfit < 0 ? "danger-text" : "success-text"}`}><strong className="mono reference-money">{money(variant.referenceUnitProfit)}</strong><small>参考利润率 {percent(variant.referenceProfitRate)}</small></div>}</td>
      <td className="reference-status-cell"><ReferenceStatus variant={variant} /></td>
    </tr>)}</tbody>
  </table>;
}
