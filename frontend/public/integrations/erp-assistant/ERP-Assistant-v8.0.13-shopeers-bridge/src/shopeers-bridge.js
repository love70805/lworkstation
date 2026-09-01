(() => {
  'use strict';
  if (window.__shopeersErpBridgeV1) return;
  window.__shopeersErpBridgeV1 = true;

  const DEFAULT_INBOX_BASE_URL = 'http://127.0.0.1:8790';
  const INBOX_BASE_URL_KEY = 'shopeers.erpInboxBaseUrl';
  const PENDING_RESULTS_KEY = 'shopeers.erpPendingCostResults.v1';
  const MAX_ATTEMPTS = 3;
  const MAX_TOTAL_ATTEMPTS = 9;
  const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
  const RETRY_DELAYS_MS = [500, 1500];
  const LOOPBACK_REQUEST_TIMEOUT_MS = 4000;
  const DELIVERY_LOCK_PREFIX = 'shopeers-erp-result-delivery:';
  const requestContext = window.ShopeersErpRequestContext;
  const activeDeliveries = new Set();
  if (!requestContext) {
    console.error('[ERP Assistant] 未加载 ERP 请求上下文模块，停止自动回传以避免错误关联。');
    return;
  }

  function splitQuerySkcs(value) {
    return String(value || '')
      .split(/[\s,，;；、]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function canonical(value) {
    return String(value || '').normalize('NFKC').trim().toUpperCase();
  }

  function normalizedSkcs(values) {
    return requestContext.normalizedSkcs(Array.isArray(values) ? values : splitQuerySkcs(values));
  }

  function sameSkcs(left, right) {
    return requestContext.sameSkcs(left, right);
  }

  function extractQuerySkcs(detail, meta) {
    if (Array.isArray(detail?.querySkcs) && detail.querySkcs.length > 0) return normalizedSkcs(detail.querySkcs);
    if (Array.isArray(meta?.querySkcs) && meta.querySkcs.length > 0) return normalizedSkcs(meta.querySkcs);
    return [];
  }

  function validInboxBaseUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return null;
      return url.origin;
    } catch {
      return null;
    }
  }

  function readStoredBaseUrl() {
    try { return localStorage.getItem(INBOX_BASE_URL_KEY); } catch { return null; }
  }

  function resolveInboxBaseUrl(detail, meta) {
    const candidates = [
      detail?.inboxBaseUrl,
      meta?.inboxBaseUrl,
      document.documentElement?.dataset?.shopeersErpInboxBaseUrl,
      window.__SHOPEERS_ERP_INBOX_BASE_URL__,
      readStoredBaseUrl(),
      DEFAULT_INBOX_BASE_URL,
    ];
    return candidates.map(validInboxBaseUrl).find(Boolean) || DEFAULT_INBOX_BASE_URL;
  }

  function readPending() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PENDING_RESULTS_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writePending(records) {
    try {
      if (records.length === 0) localStorage.removeItem(PENDING_RESULTS_KEY);
      else localStorage.setItem(PENDING_RESULTS_KEY, JSON.stringify(records.slice(-20)));
    } catch {
      // Storage failure must not block ERP Assistant copy or CSV export.
    }
  }

  function savePending(record) {
    const records = readPending().filter((item) => item.resultDeliveryId !== record.resultDeliveryId);
    records.push(record);
    writePending(records);
  }

  function removePending(resultDeliveryId) {
    writePending(readPending().filter((item) => item.resultDeliveryId !== resultDeliveryId));
  }

  function emitDeliveryStatus(status, record, message = '') {
    window.dispatchEvent(new CustomEvent('shopeers:erp-v8-delivery-status', {
      detail: {
        status,
        resultDeliveryId: record?.resultDeliveryId || '',
        message,
        terminal: status === 'failed' || status === 'success',
        createdAt: record?.createdAt || '',
        queryCapturedAt: record?.queryCapturedAt || record?.registeredBefore || '',
        registeredBefore: record?.registeredBefore || record?.queryCapturedAt || '',
        attemptsTotal: Number(record?.attemptsTotal || 0),
      },
    }));
  }

  function makeResultDeliveryId() {
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `ERP-RESULT-${random}`;
  }

  function loopbackTimeoutError() {
    return Object.assign(new Error('ERP_LOOPBACK_TIMEOUT：连接 Shopeers 本机收件服务超时。'), {
      code: 'ERP_LOOPBACK_TIMEOUT',
      status: 408,
    });
  }

  async function fetchLoopbackJson(url, options = {}) {
    const controller = new AbortController();
    let timeoutId = null;
    const operation = (async () => {
      const response = await fetch(url, { ...options, signal: controller.signal });
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw Object.assign(new Error('ERP_LOOPBACK_INVALID_RESPONSE：Shopeers 本机收件服务返回了无效 JSON。'), {
          code: 'ERP_LOOPBACK_INVALID_RESPONSE',
          status: 502,
        });
      }
      return { response, payload: payload && typeof payload === 'object' ? payload : {} };
    })();
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(loopbackTimeoutError());
          }, LOOPBACK_REQUEST_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw loopbackTimeoutError();
      }
      throw error;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  function wait(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  function optionalFiniteNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function evidenceWarehouseSkus(warehouseEvidence) {
    const source = warehouseEvidence && typeof warehouseEvidence === 'object' ? warehouseEvidence : {};
    const values = [
      ...(Array.isArray(source.warehouses) ? source.warehouses : []),
      ...(Array.isArray(source.excludedOrders) ? source.excludedOrders : []),
      ...(Array.isArray(source.excludedDetails) ? source.excludedDetails : []),
      ...(Array.isArray(source.mappingFailures) ? source.mappingFailures : []),
    ];
    return [...new Map(values.map((item) => [canonical(item?.warehouseSku), String(item?.warehouseSku || '').trim()]).filter(([key]) => key)).values()];
  }

  function buildRows(results, warehouseEvidence) {
    const rows = [];
    const seenWarehouseSkus = new Set();
    for (const result of results) {
      const mappings = Array.isArray(result.mappings) && result.mappings.length > 0
        ? result.mappings
        : [{ platformSku: '', platformSkc: result.platformSkc || '' }];
      const costWarnings = result.costWarnings && typeof result.costWarnings === 'object'
        ? result.costWarnings
        : { count: 0, reasons: [], records: [] };
      seenWarehouseSkus.add(canonical(result.warehouseSku));
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
          previewUnitCost: optionalFiniteNumber(result.unitCost),
          unitCost: optionalFiniteNumber(result.unitCost),
          supplierName: result.supplierName || '',
          supplier1688Url: result.supplier1688Url || '',
          selectedRecordIds: Array.isArray(result.selectedRecordIds) ? result.selectedRecordIds : [],
          costRole: 'preview',
          evidenceRef: result.warehouseSku,
          costWarningCount: Number(costWarnings.count || result.costWarningCount || 0),
          costWarningReasons: Array.isArray(costWarnings.reasons) ? costWarnings.reasons : [],
          costWarningRecords: Array.isArray(costWarnings.records) ? costWarnings.records : [],
          sourceWarnings: Array.isArray(result.sourceWarnings) ? result.sourceWarnings : [],
        });
      }
    }
    for (const warehouseSku of evidenceWarehouseSkus(warehouseEvidence)) {
      if (seenWarehouseSkus.has(canonical(warehouseSku))) continue;
      rows.push({
        warehouseSku,
        platformSku: '',
        platformSkc: '',
        previewUnitCost: null,
        unitCost: null,
        selectedRecordIds: [],
        costRole: 'preview',
        evidenceRef: warehouseSku,
        sourceWarnings: ['evidence_only_warehouse_sku'],
      });
    }
    return rows;
  }

  async function resolveRequestContext(record) {
    if (!record.registeredBefore || !Number.isFinite(Date.parse(record.registeredBefore))) {
      throw Object.assign(new Error('ERP_REQUEST_CONTEXT_MISSING：缺少采购查询捕获时间，不能安全恢复 ERP 请求。'), { status: 409, code: 'ERP_REQUEST_CONTEXT_MISSING' });
    }
    const requestUrl = new URL(`${record.inboxBaseUrl}/erp/v1/requests`);
    requestUrl.searchParams.set('registeredBefore', record.registeredBefore);
    if (record.workspaceId) requestUrl.searchParams.set('workspaceId', record.workspaceId);
    const { response, payload } = await fetchLoopbackJson(requestUrl.href, { cache: 'no-store' });
    if (!response.ok) throw Object.assign(new Error(payload.message || `HTTP ${response.status}`), { status: response.status });
    const resolved = requestContext.resolveUniqueRequest(payload.records, {
      requestId: record.requestId,
      ledgerId: record.ledgerId,
      workspaceId: record.workspaceId,
      querySkcs: record.querySkcs,
      registeredBefore: record.registeredBefore,
    });
    if (!resolved) throw Object.assign(new Error('ERP_REQUEST_NOT_FOUND：没有匹配核算时间、工作区和完整 SKC 集合的 ERP 请求。'), { status: 409, code: 'ERP_REQUEST_NOT_FOUND' });
    return resolved;
  }

  function retryable(error) {
    return !Number.isFinite(error?.status) || error.status >= 500 || error.status === 408 || error.status === 429;
  }

  async function deliver(record, attempt = 1) {
    const createdAt = Date.parse(String(record.createdAt || ''));
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > PENDING_TTL_MS) {
      removePending(record.resultDeliveryId);
      emitDeliveryStatus('failed', record, '缓存的成本证据已超过 24 小时补发期限，请重新核算。');
      return;
    }
    if (Number(record.attemptsTotal || 0) >= MAX_TOTAL_ATTEMPTS) {
      removePending(record.resultDeliveryId);
      emitDeliveryStatus('failed', record, '成本证据补发已达到 9 次上限，请重新核算。');
      return;
    }
    let retryRecord = { ...record, attemptsTotal: Number(record.attemptsTotal || 0) + 1 };
    savePending(retryRecord);
    try {
      const context = retryRecord.requestId && retryRecord.ledgerId
        ? { requestId: retryRecord.requestId, ledgerId: retryRecord.ledgerId }
        : await resolveRequestContext(retryRecord);
      const hydrated = { ...retryRecord, ...context };
      retryRecord = hydrated;
      savePending(hydrated);
      emitDeliveryStatus('sending', hydrated);
      const { response, payload } = await fetchLoopbackJson(`${hydrated.inboxBaseUrl}/erp/v1/cost-results`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(hydrated),
      });
      if (!response.ok) throw Object.assign(new Error(payload.message || `HTTP ${response.status}`), { status: response.status });
      removePending(hydrated.resultDeliveryId);
      emitDeliveryStatus('success', hydrated);
      console.info('[ERP Assistant] 已投递 Shopeers 成本收件箱', payload);
    } catch (error) {
      if (attempt < MAX_ATTEMPTS && retryable(error)) {
        emitDeliveryStatus('cached', retryRecord);
        await wait(RETRY_DELAYS_MS[attempt - 1]);
        return deliver(retryRecord, attempt + 1);
      }
      if (!retryable(error)) removePending(retryRecord.resultDeliveryId);
      emitDeliveryStatus(retryable(error) ? 'cached' : 'failed', retryRecord, error?.message || '');
      console.warn('[ERP Assistant] Shopeers 本机收件服务暂不可用，结果已缓存；仍可使用复制或 CSV 导出', error);
    }
  }

  async function startDelivery(record) {
    if (activeDeliveries.has(record.resultDeliveryId)) return Promise.resolve(false);
    if (!navigator?.locks?.request) {
      console.warn('[ERP Assistant] 当前浏览器不支持跨 frame 投递锁，已跳过自动回传以避免重复补发。');
      return false;
    }
    return navigator.locks.request(
      DELIVERY_LOCK_PREFIX + canonical(record.resultDeliveryId),
      { mode: 'exclusive', ifAvailable: true },
      async (lock) => {
        if (!lock || activeDeliveries.has(record.resultDeliveryId)) return false;
        activeDeliveries.add(record.resultDeliveryId);
        try {
          await deliver(record);
          return true;
        } finally {
          activeDeliveries.delete(record.resultDeliveryId);
        }
      }
    );
  }

  window.addEventListener('shopeers:erp-v8-cost-result', async (event) => {
    const detail = event.detail || {};
    const results = Array.isArray(detail.results) ? detail.results : [];
    const meta = detail.meta || {};
    const resultDeliveryId = String(detail.resultDeliveryId || '').trim() || makeResultDeliveryId();
    if (activeDeliveries.has(resultDeliveryId)) return;
    const existing = readPending().find((item) => item.resultDeliveryId === resultDeliveryId) || null;
    const eventQuerySkcs = extractQuerySkcs(detail, meta);
    const querySkcs = eventQuerySkcs.length > 0 ? eventQuerySkcs : normalizedSkcs(existing?.querySkcs);
    if (querySkcs.length === 0) {
      console.warn('[ERP Assistant] 缺少完整平台 SKC 查询集合，结果未自动回传。');
      return;
    }
    const record = {
      resultDeliveryId,
      createdAt: String(existing?.createdAt || detail.createdAt || '').trim() || new Date().toISOString(),
      queryCapturedAt: String(existing?.queryCapturedAt || existing?.registeredBefore || detail.queryCapturedAt || detail.registeredBefore || meta.queryCapturedAt || meta.registeredBefore || '').trim(),
      registeredBefore: String(existing?.registeredBefore || existing?.queryCapturedAt || detail.registeredBefore || detail.queryCapturedAt || meta.registeredBefore || meta.queryCapturedAt || '').trim(),
      attemptsTotal: Math.max(Number(existing?.attemptsTotal || 0), Number(detail.attemptsTotal || 0)),
      inboxBaseUrl: resolveInboxBaseUrl(detail, meta),
      requestId: String(existing?.requestId || detail.requestId || meta.requestId || '').trim(),
      ledgerId: String(existing?.ledgerId || detail.ledgerId || meta.ledgerId || '').trim(),
      workspaceId: String(existing?.workspaceId || detail.workspaceId || meta.workspaceId || '').trim(),
      querySkcs,
      rows: buildRows(results, detail.warehouseEvidence),
      sourceMeta: meta,
      warehouseEvidence: detail.warehouseEvidence && typeof detail.warehouseEvidence === 'object'
        ? detail.warehouseEvidence
        : { formatVersion: 1, warehouses: [], excludedOrders: [], excludedDetails: [], detailFailures: [], mappingFailures: [] },
    };
    if (!record.queryCapturedAt) record.queryCapturedAt = record.registeredBefore;
    if (record.rows.length === 0) {
      emitDeliveryStatus('failed', record, '没有可识别仓库 SKU 的成本或排除证据，结果未自动回传。');
      return;
    }
    savePending(record);
    await startDelivery(record);
  });

  for (const pending of readPending()) void startDelivery(pending);
})();
