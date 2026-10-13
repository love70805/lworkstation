import { Badge } from "./UI";
import { productDataStatusLabel } from "../domain/productPublication";

const sections = [
  ["purchase", "ERP 采购", "ERP 采购资料覆盖"],
  ["referenceProfit", "参考利润", "已有售价与参考成本，可计算单件参考利润"],
  ["profit", "定稿历史", "历史定稿报告覆盖；建档和参考利润不代表月度已定稿"],
  ["warehouseMapping", "仓库映射", "平台 SKU 与 ERP 仓库 SKU 的明确关联"],
];

export default function ProductDataReadiness({ readiness }) {
  return <span className="product-data-stack">{sections.map(([kind, label, description]) => {
    const status = readiness?.[kind];
    const tone = status?.status === "complete" ? "success" : status?.status === "partial" ? "warning" : "neutral";
    return <small key={kind} title={`${description}${status ? ` · ${status.coveredSkuCount}/${status.totalSkuCount} 个 SKU` : ""}`}>
      {label} <Badge tone={tone}>{productDataStatusLabel(kind, status?.status)}</Badge>
    </small>;
  })}</span>;
}
