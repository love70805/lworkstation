(() => {
  'use strict';
  if (window.ShopeersErpDeliveryBridge) return;

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) return reject(new Error(error.message));
        resolve(response || { ok: false, status: 'failed', message: '扩展后台无响应。' });
      });
    });
  }

  async function submit(input = {}) {
    const payload = {
      results: Array.isArray(input.results) ? input.results : [],
      meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
      warehouseEvidence: input.warehouseEvidence && typeof input.warehouseEvidence === 'object'
        ? input.warehouseEvidence
        : { formatVersion: 1, warehouses: [], excludedOrders: [], excludedDetails: [], detailFailures: [], mappingFailures: [] },
      resultDeliveryId: String(input.resultDeliveryId || '').trim(),
      querySkcs: Array.isArray(input.querySkcs) ? input.querySkcs : [],
      createdAt: String(input.createdAt || '').trim(),
      queryCapturedAt: String(input.queryCapturedAt || input.registeredBefore || '').trim(),
    };
    try {
      return await sendMessage({ type: 'shopeers.erp.submitCostResult', payload });
    } catch (error) {
      const response = {
        ok: false,
        status: 'cached',
        resultDeliveryId: payload.resultDeliveryId,
        message: error?.message || '隔离投递通道暂不可用，后台缓存会按上限补发。',
      };
      return response;
    }
  }

  async function reportStatus(input = {}) {
    try {
      return await sendMessage({
        type: 'shopeers.erp.reportStatus',
        payload: {
          ready: input.ready !== false,
          userAgent: String(input.userAgent || '').slice(0, 240),
        },
      });
    } catch {
      return { ok: false };
    }
  }

  window.ShopeersErpDeliveryBridge = Object.freeze({ submit, reportStatus });
})();
