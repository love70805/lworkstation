import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "../components/UI";
import { isUnmappedCostMatch } from "../lib/costMatching";
import { ERP_ADOPTION_ITEM_LABELS } from "../lib/erpAdoptionPresentation";
import { formatErpUnitCost, formatManualUnitCost } from "../lib/profitPrecision";

const columnLabels = ["平台 SKC", "平台 SKU / 属性", "ERP 证据 / 候选", "当前采用结果", "详情与更正"];

export function CostMatchTableHeader() {
  return <><span className="visually-hidden">成本核对分组</span><div className="cost-match-column-headings" aria-hidden="true">{columnLabels.map(label => <span key={label}>{label}</span>)}</div></>;
}

function candidateStatus(item, candidateSkuSet, adoptionItemsBySku) {
  const adoptionItem = adoptionItemsBySku.get(item.canonicalPlatformSku);
  if (adoptionItem) return ERP_ADOPTION_ITEM_LABELS[adoptionItem.state] ?? "回传待核对";
  if (candidateSkuSet.has(item.canonicalPlatformSku)) {
    if (item.status === "matched") return "手动批次待采用";
    if (item.status === "anomaly_pending") return item.costDecision?.selectedRecords?.length === 0 ? "本月及以前无合格采购" : item.evidenceComplete ? "采购异常待处理" : "采购证据不完整";
    return "未查到可用成本，原因待查";
  }
  return item.status === "matched" ? "已采用 ERP" : item.periodReviewRequired ? "原采用选样待复核" : "尚未收到可用成本";
}

function VariantIdentity({ item, storeCount }) {
  return <div className="cost-match-identity">
    <strong className="mono" title={item.platformSku}>{item.platformSku}</strong>
    <span>{item.attribute || "未提供属性"}</span>
    {storeCount > 1 ? <small>{storeCount} 个店铺，分别采用成本</small> : null}
    {item.attributeEvidence?.length > 1 ? <details><summary>查看 {item.attributeEvidence.length} 种属性来源</summary>{item.attributeEvidence.map(({ attribute, sources }) => <p key={attribute}><strong>{attribute}</strong>：{sources.slice(0, 3).map(source => `${source.store || "店铺未填"}${source.sourceSheet ? `/${source.sourceSheet}` : ""} 第${source.sourceRow ?? "?"}行`).join("、")}{sources.length > 3 ? `，另 ${sources.length - 3} 行` : ""}</p>)}</details> : null}
  </div>;
}

function CurrentStoreCost({ line }) {
  if (!line) return <span className="cost-match-no-store">无对应店铺明细</span>;
  const effectiveAt = line.manualOverride?.approvedAt ?? line.erpCost?.publishedAt;
  return <div className="cost-match-store-result">
    <strong>{line.store || "店铺未填"}</strong>
    <span className="mono">{line.decision.eligibleForExactProfit ? line.manualOverride ? formatManualUnitCost(line.decision.unitCost) : formatErpUnitCost(line.decision.unitCost) : "待补成本"}</span>
    <small>{line.manualOverride ? "人工更正有效" : line.decision.eligibleForExactProfit ? "ERP 已采用" : "未采用有效成本"}{effectiveAt ? ` · ${new Date(effectiveAt).toLocaleDateString("zh-CN")}` : ""}</small>
  </div>;
}

// Each store occupies an actual table row. Shared SKU identity and ERP evidence
// span those rows, so long attributes and store statuses cannot drift apart.
export default function CostMatchGroupRows({ group, reviewRowsBySku, candidateSkuSet, adoptionItemsBySku, expanded, onToggle, onDetails, onCorrect, locked, evidencePreview }) {
  const unmapped = group.variants.filter(isUnmappedCostMatch);
  const collapsed = unmapped.length > 0 && !expanded;
  const variants = collapsed ? group.variants.filter(item => !isUnmappedCostMatch(item)) : group.variants;
  const variantRows = variants.map(item => ({ item, lines: reviewRowsBySku.get(item.canonicalPlatformSku) ?? [] }));
  const showEvidence = expanded && unmapped.length > 0 && Boolean(evidencePreview);
  const rowCount = variantRows.reduce((count, variant) => count + Math.max(1, variant.lines.length), 0) + Number(collapsed) + Number(showEvidence);
  const skcCell = <td rowSpan={rowCount} className="cost-match-skc-cell"><div className="cost-group-skc"><span className="cost-group-skc-label">
    {unmapped.length ? <button className="cost-group-toggle" type="button" aria-expanded={expanded} aria-label={`${expanded ? "收起" : "展开"} ${group.platformSkc} 未映射证据`} onClick={onToggle}>{expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}<strong className="mono">{group.platformSkc}</strong></button> : <strong className="mono">{group.platformSkc}</strong>}
    <small>{group.skuCount} 个 SKU{unmapped.length ? ` · ${unmapped.length} 条未映射` : ""}</small>
  </span></div></td>;

  return <table className="cost-match-group-table" aria-label={`平台 SKC ${group.platformSkc} 成本核对`}>
    <colgroup>{columnLabels.map((label, index) => <col key={label} className={`cost-match-column-${index}`} />)}</colgroup>
    <thead className="visually-hidden"><tr>{columnLabels.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
    <tbody>
      {variantRows.map(({ item, lines }, variantIndex) => {
        const storeLines = lines.length ? lines : [null];
        return <Fragment key={item.canonicalPlatformSku}>{storeLines.map((line, storeIndex) => <tr key={line?.id ?? "unmapped"} data-platform-sku={item.platformSku} data-store={line?.store ?? ""} className={storeIndex === 0 ? "cost-match-sku-row" : "cost-match-store-subrow"}>
          {variantIndex === 0 && storeIndex === 0 ? skcCell : null}
          {storeIndex === 0 ? <><td rowSpan={storeLines.length} className="cost-match-sku-cell"><VariantIdentity item={item} storeCount={lines.length} /></td><td rowSpan={storeLines.length} className="cost-match-candidate-cell"><div className="cost-status-stack">{item.unitCost != null ? <span className="mono table-number">{formatErpUnitCost(item.unitCost)}</span> : <span className="pending-text">尚无可用值</span>}<small>{candidateStatus(item, candidateSkuSet, adoptionItemsBySku)}</small></div></td></> : null}
          <td className="cost-match-current-cell"><CurrentStoreCost line={line} /></td>
          <td className="cost-match-actions-cell">{line ? <div className="cost-match-row-actions"><Button variant="ghost" aria-label={`${line.store} · ${item.platformSku} · 详情`} onClick={() => onDetails(line)}>详情</Button>{!locked && !line.decision.eligibleForExactProfit ? <Button variant="ghost" aria-label={`${line.store} · ${item.platformSku} · 人工更正`} onClick={() => onCorrect(line)}>人工更正</Button> : null}</div> : <small>仅原始证据</small>}</td>
        </tr>)}</Fragment>;
      })}
      {collapsed ? <tr className="cost-match-collapsed-row">{!variantRows.length ? skcCell : null}<td colSpan={4}><span>{unmapped.length} 条未映射证据</span><Button variant="ghost" onClick={onToggle} aria-expanded={false}>展开查看</Button></td></tr> : null}
      {showEvidence ? <tr className="cost-match-evidence-row"><td colSpan={4}>{evidencePreview}</td></tr> : null}
    </tbody>
  </table>;
}
