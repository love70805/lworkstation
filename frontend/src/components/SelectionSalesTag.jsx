import { Link } from "react-router-dom";
import { Badge } from "./UI";

const reasonLabels = {
  no_common_month: "多店铺尚无共同的完整台账月份",
  no_complete_month: "尚无已确认完整范围的整月台账",
  unknown_store: "店铺来源尚不明确",
  out_of_scope: "商品不在当前台账来源范围内",
  unresolved_identity: "台账中存在无法关联的商品身份",
  source_conflict: "台账来源有冲突",
  invalid_quantity: "销售数量需要核对",
  identity_conflict: "SKU 与 SKC 关系需要核对",
  missing_dates: "销售行缺少有效日期，七天销量无法计算",
};

export default function SelectionSalesTag({ item, className = "" }) {
  if (!item) return null;
  const available = item.label != null && item.quantityExact != null;
  const description = available ? `${(item.stores ?? []).join("、")} · ${item.rangeLabel ?? ""} · ${item.quantityExact} 件` : reasonLabels[item.reason ?? item.status] ?? "台账信息不足，七天销量无法计算";
  return <span className={`selection-sales-tag ${className}`} title={description}>
    <Badge tone={available ? item.label === "爆款" ? "success" : "info" : "neutral"}>{available ? item.label : "七天销量暂不可计算"}</Badge>
    <small>{description}{!available ? <> · <Link to="/ledger">查看台账来源</Link></> : null}</small>
  </span>;
}
