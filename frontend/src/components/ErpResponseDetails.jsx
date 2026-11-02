import { normalizeErpDiagnostic } from '../domain/erpDiagnostics';

export default function ErpResponseDetails({ failures = [] }) {
  const items = failures.filter(item => item?.message || item?.erpResponse).slice(0, 20);
  if (!items.length) return null;
  return <details className="cost-erp-responses"><summary>ERP 返回与失败原因（{items.length}{failures.length > items.length ? '+' : ''}）</summary>
    {items.map((item, index) => {
      const raw = normalizeErpDiagnostic(item.erpResponse);
      return <div key={index}><p><strong>{item.stage || 'ERP 核验'}{item.warehouseSku ? ` · 仓库 SKU ${item.warehouseSku}` : ''}{item.no || item.id ? ` · 采购单 ${item.no || item.id}` : ''}</strong></p><p>{item.message}</p>{raw ? <pre aria-label="ERP 原返回数据">{raw}</pre> : null}</div>;
    })}
    <p>仅展示必要业务字段；长返回已截取，登录信息已隐藏。</p>
  </details>;
}
