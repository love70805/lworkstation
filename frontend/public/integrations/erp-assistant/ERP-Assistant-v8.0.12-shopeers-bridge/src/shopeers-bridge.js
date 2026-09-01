(() => {
  'use strict';
  if (window.__shopeersErpBridgeV1) return;
  window.__shopeersErpBridgeV1 = true;
  const endpoint = 'http://127.0.0.1:8790/erp/v1/cost-results';
  function splitQuerySkcs(value) {
    return String(value || '')
      .split(/[\s,，;；、]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function extractQuerySkcs(meta) {
    if (Array.isArray(meta?.querySkcs) && meta.querySkcs.length > 0) return meta.querySkcs;
    const filters = meta?.filters && typeof meta.filters === 'object' ? meta.filters : {};
    for (const key of ['sku', 'skc', 'platformSkc', 'platformSKC', 'platformSku', 'platformSKU']) {
      const values = splitQuerySkcs(filters[key]);
      if (values.length > 0) return values;
    }
    return [];
  }

  window.addEventListener('shopeers:erp-v8-cost-result', async (event) => {
    const detail = event.detail || {};
    const results = Array.isArray(detail.results) ? detail.results : [];
    if (results.length === 0) return;
    const meta = detail.meta || {};
    const warehouseEvidence = detail.warehouseEvidence && typeof detail.warehouseEvidence === 'object'
      ? detail.warehouseEvidence
      : { formatVersion: 1, warehouses: [], excludedOrders: [], excludedDetails: [], detailFailures: [], mappingFailures: [] };
    const requestId = String(detail.requestId || meta.requestId || '').trim();
    const querySkcs = extractQuerySkcs(meta);
    const rows = [];
    for (const result of results) {
      const mappings = Array.isArray(result.mappings) && result.mappings.length > 0
        ? result.mappings
        : [{ platformSku: result.warehouseSku }];
      const costWarnings = result.costWarnings && typeof result.costWarnings === 'object'
        ? result.costWarnings
        : { count: 0, reasons: [], records: [] };
      for (const mapping of mappings) {
        rows.push({
          warehouseSku: result.warehouseSku,
          platformSku: mapping.platformSku,
          platformSkc: mapping.platformSkc || result.platformSkc || '',
          orderNumber: result.orderNumber,
          sourceType: result.sourceType,
          name: result.name,
          calcTimes: result.calcTimes,
          dateRange: result.dateRange,
          totalQty: result.totalQty,
          totalPrice: result.totalPrice,
          previewUnitCost: Number(result.unitCost),
          unitCost: Number(result.unitCost),
          supplierName: result.supplierName || '',
          supplier1688Url: result.supplier1688Url || '',
          selectedRecordIds: Array.isArray(result.selectedRecordIds) ? result.selectedRecordIds : [],
          costRole: 'preview',
          evidenceRef: result.warehouseSku,
          costWarningCount: Number(costWarnings.count || result.costWarningCount || 0),
          costWarningReasons: Array.isArray(costWarnings.reasons) ? costWarnings.reasons : [],
          costWarningRecords: Array.isArray(costWarnings.records) ? costWarnings.records : [],
        });
      }
    }
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows, requestId, querySkcs, sourceMeta: meta, warehouseEvidence }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || 'HTTP ' + response.status);
      console.info('[ERP Assistant] 已投递 Shopeers 成本收件箱', payload);
    } catch (error) {
      console.warn('[ERP Assistant] Shopeers 本机收件服务不可用，仍可使用复制或 CSV 导出', error);
    }
  });
})();
