(() => {
  'use strict';
  if (window.ShopeersErpDeliveryBridge) return;

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      const delivery = ['shopeers.erp.submitCostResult', 'shopeers.erp.submitCatalogResult', 'shopeers.erp.retryPending'].includes(message.type);
      const taskWrite = message.type === 'shopeers.erp.collectionTask'
        && !['list', 'get'].includes(message.payload?.action || 'list') && message.payload?.control !== 'heartbeat';
      const timer = window.setTimeout(() => reject(new Error('扩展后台响应超时，请查看收件状态后重试。')), delivery ? 210000 : taskWrite ? 70000 : 15000);
      chrome.runtime.sendMessage(message, (response) => {
        window.clearTimeout(timer);
        const error = chrome.runtime.lastError;
        if (error) return reject(new Error(error.message));
        resolve(response || { ok: false, status: 'failed', message: '扩展后台无响应。' });
      });
    });
  }

  async function submit(input = {}) {
    const payload = {
      collectionTask: input.collectionTask,
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
        status: 'failed',
        retained: false,
        resultDeliveryId: payload.resultDeliveryId,
        message: error?.message || '投递通道未确认接收，页面已缓存证据，请重试回传。',
      };
      return response;
    }
  }

  async function previewContext(input = {}) {
    try {
      return await sendMessage({
        type: 'shopeers.erp.previewContext',
        payload: {
          querySkcs: Array.isArray(input.querySkcs) ? input.querySkcs : [],
          queryCapturedAt: String(input.queryCapturedAt || '').trim(),
        },
      });
    } catch (error) {
      return { ok: false, status: 'failed', code: 'ERP_EXTENSION_ERROR', message: error?.message || '核算月份读取失败。' };
    }
  }

  async function catalogContext(input = {}) {
    return sendMessage({ type: 'shopeers.erp.catalogContext', payload: { requestId: String(input.requestId || '').trim(), querySkcs: input.querySkcs, queryCapturedAt: input.queryCapturedAt } });
  }

  async function submitCatalog(input = {}) {
    return sendMessage({ type: 'shopeers.erp.submitCatalogResult', payload: {
      requestId: String(input.requestId || '').trim(),
      querySkcs: Array.isArray(input.querySkcs) ? input.querySkcs : [],
      results: Array.isArray(input.results) ? input.results : [],
      warehouseEvidence: input.warehouseEvidence,
      catalogCoverage: input.catalogCoverage,
      resultDeliveryId: String(input.resultDeliveryId || '').trim(),
      createdAt: String(input.createdAt || '').trim(),
    } });
  }

  async function reportStatus(input = {}) {
    try {
      return await sendMessage({
        type: 'shopeers.erp.reportStatus',
        payload: {
          ready: input.ready !== false,
          sessionState: ['authenticated', 'login_required'].includes(input.sessionState) ? input.sessionState : 'unknown',
          pageState: ['purchase_ready', 'query_ready', 'login_required'].includes(input.pageState) ? input.pageState : 'page_ready',
          queryAvailable: input.queryAvailable === true,
          userAgent: String(input.userAgent || '').slice(0, 240),
        },
      });
    } catch {
      return { ok: false };
    }
  }

  const retry = (resultDeliveryId) => sendMessage({ type: 'shopeers.erp.retryPending', payload: { resultDeliveryId } });
  const collectionCheckpoint = (input) => sendMessage({ type: 'shopeers.erp.collectionCheckpoint', payload: input });
  const collectionTask = (input) => sendMessage({ type: 'shopeers.erp.collectionTask', payload: input });
  window.ShopeersErpDeliveryBridge = Object.freeze({ collectionTask, submit, submitCatalog, catalogContext, previewContext, reportStatus, retry, collectionCheckpoint });
})();
