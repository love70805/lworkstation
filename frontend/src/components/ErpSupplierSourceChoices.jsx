import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "./UI";

export default function ErpSupplierSourceChoices({ supplier, links, index, disabled, edited, dirty, onChoose }) {
  const [open, setOpen] = useState(!supplier.sourceUrl && links.length > 1);
  return <details className="supplier-source-choices" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>ERP 来源链接 · {links.length} 个{!supplier.sourceUrl && links.length > 1 ? "，请选择" : ""}</summary>
    <p>同一供应商可有多个商品或店铺链接。选择只更新当前草稿，保存后生效。</p>
    {links.map(link => <div className="supplier-source-option" key={link.url}>
      <a href={link.url} target="_blank" rel="noreferrer"><span>{link.type === "product" ? `商品 ${link.sourceProductId}` : "1688 店铺"}</span><ExternalLink size={12} /><small>{link.url}</small></a>
      <Button variant="ghost" aria-label={`采用供应商 ${index + 1} 的链接 ${link.url}`} disabled={disabled || supplier.sourceUrl === link.url} onClick={() => onChoose(link)}>{supplier.sourceUrl === link.url ? "当前链接" : "采用此链接"}</Button>
    </div>)}
    {edited ? <small role="status">{dirty ? "已选择来源链接，保存后生效" : "已保存人工选择的来源链接"}</small> : null}
  </details>;
}
