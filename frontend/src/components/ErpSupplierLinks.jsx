import { useState } from "react";
import { ExternalLink } from "lucide-react";
export default function ErpSupplierLinks({ links }) {
  const [open, setOpen] = useState(links.length > 1);
  return <details className="supplier-source-links" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>供应商链接 · {links.length} 个</summary>
    <p>该供应商的商品页和店铺页均保留，可直接打开，无需选择唯一链接或逐项确认。</p>
    {links.map(link => <div className="supplier-source-option" key={link.url}>
      <a href={link.url} target="_blank" rel="noreferrer"><span>{link.type === "product" ? `1688 商品页 ${link.sourceProductId}` : "1688 店铺页"}</span><ExternalLink size={12} /><small>{link.url}</small></a>
    </div>)}
  </details>;
}
