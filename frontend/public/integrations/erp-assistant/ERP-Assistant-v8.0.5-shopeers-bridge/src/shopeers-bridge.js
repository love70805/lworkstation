(() => {
  'use strict';
  if (window.__shopeersErpBridgeV1) return;
  window.__shopeersErpBridgeV1 = true;
  const endpoint = 'http://127.0.0.1:8790/erp/v1/cost-results';
  window.addEventListener('shopeers:erp-v8-cost-result', async (event) => {
    const detail = event.detail || {};
    const results = Array.isArray(detail.results) ? detail.results : [];
    if (results.length === 0) return;
    const rows = [];
    for (const result of results) {
      const mappings = Array.isArray(result.mappings) && result.mappings.length > 0
        ? result.mappings
        : [{ platformSku: result.warehouseSku }];
      for (const mapping of mappings) {
        rows.push({
          warehouseSku: result.warehouseSku,
          platformSku: mapping.platformSku,
          orderNumber: result.orderNumber,
          sourceType: result.sourceType,
          name: result.name,
          calcTimes: result.calcTimes,
          dateRange: result.dateRange,
          totalQty: result.totalQty,
          totalPrice: result.totalPrice,
          unitCost: Number(result.unitCost),
        });
      }
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows, meta: detail.meta || {} }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'HTTP ' + response.status);
      console.info('[ERP Assistant] 已投递 Shopeers 成本收件箱', payload);
    } catch (error) {
      console.warn('[ERP Assistant] Shopeers 本机收件服务不可用，仍可使用复制或 CSV 导出', error);
    }
  });
})();
