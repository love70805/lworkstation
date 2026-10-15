import { ExternalLink } from "lucide-react";
import { groupErpCatalogPurchases, groupErpCatalogSources } from "../domain/erpCatalogPresentation";

function Sources({ sources }) {
  if (!sources.length) return null;
  return <details className="catalog-source-history"><summary>回传来源 · {sources.length} 次</summary><ul>{sources.map((source, index) => <li key={index}>
    <span>{source.capturedAt?.replace("T", " ") || "时间未提供"}</span><span className="mono">批次 {source.batchId || "未提供"}</span>
    {source.recordId ? <span className="mono">明细 {source.recordId}</span> : null}
    {source.evidenceRef ? <span className="mono">证据 {source.evidenceRef}</span> : null}
  </li>)}</ul></details>;
}

export default function ErpCatalogEvidence({ sources = [], purchases = [] }) {
  const skus = groupErpCatalogSources(sources), groups = groupErpCatalogPurchases(purchases);
  const purchaseCount = groups.reduce((total, group) => total + group.records.length, 0);
  return <div className="catalog-evidence-groups">
    {skus.length ? <section aria-label="平台 SKU 来源"><h3>平台 SKU 来源 · {skus.length} 个</h3><p>相同资料合并展示；不同内容和每次回传来源均可展开查看。</p>
      {skus.map(group => <article className="catalog-source-card" key={group.key}><strong className="mono">{group.platformSku}</strong>
        {group.versions.length > 1 ? <small>{group.versions.length} 份不同资料，含历史来源；当前属性以规格表为准。</small> : null}
        {group.versions.map(version => <div className="catalog-source-version" key={version.key}>
          <span>SKC：<span className="mono">{version.platformSkc || "未提供"}</span></span>
          <span>平台属性：{version.attribute || "未提供"}</span><span>原始名称：{version.productName || "未提供"}</span>
          {version.warehouseSku ? <span>仓库 SKU：<span className="mono">{version.warehouseSku}</span></span> : null}
          {version.storeName ? <span>店铺：{version.storeName}</span> : null}
          {version.imageUrl ? <a href={version.imageUrl} target="_blank" rel="noreferrer">来源图片<ExternalLink size={12} /></a> : null}
          {version.trusted === false ? <span className="field-error">身份关系待核对</span> : null}
          <Sources sources={version.sources} />
        </div>)}
      </article>)}
    </section> : null}
    {groups.length ? <section aria-label="ERP 采购来源"><h3>采购来源 · {purchaseCount} 条记录 / {groups.length} 组</h3><p>按供应商、仓库与采购规格归组，展开查看订单。采购规格与平台属性分别保留。</p>
      {groups.map(group => { const purchase = group.purchaseCatalog ?? {}; return <details className="catalog-purchase-group" key={group.key}>
        <summary><strong>{group.supplierName || "供应商未提供"}</strong><span>{purchase.purchaseSpecificationAndModel1688 || "采购规格未提供"}</span><span>{group.records.length} 条采购记录</span></summary>
        <div className="catalog-purchase-meta"><span className="mono">仓库 {group.warehouseSku || "未提供"}</span><span className="mono">平台 SKU {group.platformSkus.join("、") || "未提供"}</span>
          {purchase.supplierId ? <span className="mono">ERP 供应商编号 {purchase.supplierId}</span> : null}
          {purchase.purchaseProportion1688 ? <span>1688 采购规格比例：{purchase.purchaseProportion1688.replace(/^(\d+)-(\d+)$/, "$1:$2")}</span> : null}
          {[["model1688", "1688 型号"], ["specificationAndModel", "ERP 规格型号"], ["productColor", "采购颜色"]].map(([key, label]) => purchase[key] ? <span key={key}>{label}：{purchase[key]}</span> : null)}
          {purchase.pictureLink1688 ? <a href={purchase.pictureLink1688} target="_blank" rel="noreferrer">采购图片<ExternalLink size={12} /></a> : null}
          {purchase.picturesLinking && purchase.picturesLinking !== purchase.pictureLink1688 ? <a href={purchase.picturesLinking} target="_blank" rel="noreferrer">ERP 商品图片<ExternalLink size={12} /></a> : null}
        </div>
        <ul className="catalog-purchase-records">{group.records.map(record => <li key={record.key}><strong className="mono">{record.source?.purchaseOrderNo || record.source?.recordId || "采购明细"}</strong>
          {record.purchaseCatalog?.lineNumber != null ? <span>订单行号 {record.purchaseCatalog.lineNumber}</span> : null}<Sources sources={record.sources} />
        </li>)}</ul>
      </details>; })}
    </section> : null}
  </div>;
}
