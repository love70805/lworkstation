(() => {
  'use strict';

  const INBOX_BASE_URL_KEY = 'shopeersErpInboxBaseUrl';
  const INBOX_CAPABILITY_KEY = 'shopeersErpInboxCapability';
  const INBOX_WORKSPACE_ID_KEY = 'shopeersErpWorkspaceId';
  const PENDING_RESULTS_KEY = 'shopeersErpPendingCostResultsV2';
  const MAX_ATTEMPTS = 3;
  const MAX_TOTAL_ATTEMPTS = 9;
  const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
  const RETRY_DELAYS_MS = [500, 1500];
  const LOOPBACK_REQUEST_TIMEOUT_MS = 4000;
  const ERP_PAGE_PATH = '/view/system/purchaseOrderModule/purchasingManagement.html';
  const activeDeliveries = new Set();

  function canonical(value) {
    return String(value || '').normalize('NFKC').trim().toUpperCase();
  }

  function normalizedSkcs(values) {
    return [...new Set((Array.isArray(values) ? values : [])
      .map((item) => canonical(item && typeof item === 'object' ? item.platformSkc : item))
      .filter(Boolean))].sort();
  }

  function sameSkcs(left, right) {
    const a = normalizedSkcs(left);
    const b = normalizedSkcs(right);
    return a.length === b.length && a.every((value, index) => value === b[index]);
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

  async function runtimeConfig() {
    const stored = await chrome.storage.local.get([INBOX_BASE_URL_KEY, INBOX_CAPABILITY_KEY, INBOX_WORKSPACE_ID_KEY]);
    const baseUrl = validInboxBaseUrl(stored[INBOX_BASE_URL_KEY]);
    const capability = String(stored[INBOX_CAPABILITY_KEY] || '').trim();
    const workspaceId = String(stored[INBOX_WORKSPACE_ID_KEY] || '').trim();
    if (!baseUrl || capability.length < 32 || !workspaceId) {
      throw Object.assign(new Error('ERP_INBOX_NOT_CONFIGURED：Shopeers 桌面运行时尚未配置安全收件通道。'), {
        code: 'ERP_INBOX_NOT_CONFIGURED',
        status: 503,
      });
    }
    return { baseUrl, capability, workspaceId };
  }

  function loopbackError(code, message, status) {
    return Object.assign(new Error(`${code}：${message}`), { code, status });
  }

  async function fetchLoopbackJson(route, { method = 'GET', query = null, body = null, config = null } = {}) {
    const { baseUrl, capability } = config || await runtimeConfig();
    const url = new URL(route, baseUrl);
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== null && value !== undefined && String(value).trim() !== '') url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    let timeoutId = null;
    const operation = (async () => {
      const response = await fetch(url.href, {
        method,
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${capability}`,
          ...(body == null ? {} : { 'content-type': 'application/json' }),
        },
        ...(body == null ? {} : { body: JSON.stringify(body) }),
      });
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw loopbackError('ERP_LOOPBACK_INVALID_RESPONSE', 'Shopeers 本机收件服务返回了无效 JSON。', 502);
      }
      if (!response.ok) {
        throw Object.assign(new Error(String(payload?.message || `HTTP ${response.status}`)), {
          code: String(payload?.error || 'ERP_LOOPBACK_HTTP_ERROR'),
          status: response.status,
        });
      }
      return payload && typeof payload === 'object' ? payload : {};
    })();
    try {
      return await Promise.race([
        operation,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            controller.abort();
            reject(loopbackError('ERP_LOOPBACK_TIMEOUT', '连接 Shopeers 本机收件服务超时。', 408));
          }, LOOPBACK_REQUEST_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      if (error?.name === 'AbortError') throw loopbackError('ERP_LOOPBACK_TIMEOUT', '连接 Shopeers 本机收件服务超时。', 408);
      throw error;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  function stripUntrustedControl(value, depth = 0) {
    if (value == null || depth > 8) return value ?? null;
    if (Array.isArray(value)) return value.map((item) => stripUntrustedControl(item, depth + 1));
    if (typeof value !== 'object') return value;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (/(token|authorization|cookie|password|secret|capability|endpoint|baseurl)/i.test(normalized)) continue;
      if (['requestid', 'ledgerid', 'workspaceid', 'expectedskus', 'ledgerscoperole', 'cacherestored', 'deliveryterminal'].includes(normalized)) continue;
      result[key] = stripUntrustedControl(child, depth + 1);
    }
    return result;
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
    return [...new Map(values
      .map((item) => [canonical(item?.warehouseSku), String(item?.warehouseSku || '').trim()])
      .filter(([key]) => key)).values()];
  }

  function buildRows(results, warehouseEvidence) {
    const rows = [];
    const seenWarehouseSkus = new Set();
    for (const result of (Array.isArray(results) ? results : [])) {
      const mappings = Array.isArray(result?.mappings) && result.mappings.length > 0
        ? result.mappings
        : [{ platformSku: '', platformSkc: result?.platformSkc || '' }];
      const warnings = result?.costWarnings && typeof result.costWarnings === 'object'
        ? result.costWarnings
        : { count: 0, reasons: [], records: [] };
      seenWarehouseSkus.add(canonical(result?.warehouseSku));
      for (const mapping of mappings) {
        rows.push({
          warehouseSku: String(result?.warehouseSku || '').trim(),
          platformSku: String(mapping?.platformSku || '').trim(),
          platformSkc: String(mapping?.platformSkc || result?.platformSkc || '').trim(),
          orderNumber: result?.orderNumber,
          sourceType: result?.sourceType,
          name: result?.name,
          calcTimes: result?.calcTimes,
          dateRange: result?.dateRange,
          totalQty: result?.totalQty,
          totalPrice: result?.totalPrice,
          previewUnitCost: optionalFiniteNumber(result?.unitCost),
          unitCost: optionalFiniteNumber(result?.unitCost),
          supplierName: String(result?.supplierName || ''),
          supplier1688Url: String(result?.supplier1688Url || ''),
          selectedRecordIds: Array.isArray(result?.selectedRecordIds) ? result.selectedRecordIds : [],
          costRole: 'preview',
          evidenceRef: String(result?.warehouseSku || '').trim(),
          costWarningCount: Number(warnings.count || result?.costWarningCount || 0),
          costWarningReasons: Array.isArray(warnings.reasons) ? warnings.reasons : [],
          costWarningRecords: Array.isArray(warnings.records) ? warnings.records : [],
          sourceWarnings: Array.isArray(result?.sourceWarnings) ? result.sourceWarnings : [],
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

  function normalizedExpectedSkus(values) {
    const result = new Map();
    for (const item of (Array.isArray(values) ? values : [])) {
      const platformSku = String(item?.platformSku || '').trim();
      const platformSkc = String(item?.platformSkc || '').trim();
      if (platformSku && platformSkc) result.set(canonical(platformSku), { platformSku, platformSkc });
    }
    return [...result.values()];
  }

  function resolveUniqueRequest(records, { querySkcs, registeredBefore, workspaceId }) {
    const snapshotAt = Date.parse(String(registeredBefore || ''));
    const candidates = (Array.isArray(records) ? records : []).filter((request) => {
      if (request?.status && request.status !== 'registered') return false;
      if (String(request?.workspaceId || '').trim() !== workspaceId) return false;
      const registeredAt = Date.parse(String(request?.registeredAt || request?.requestedAt || ''));
      if (!Number.isFinite(snapshotAt) || !Number.isFinite(registeredAt) || registeredAt > snapshotAt) return false;
      return sameSkcs(request?.platformSkcs, querySkcs);
    });
    if (candidates.length > 1) throw loopbackError('ERP_REQUEST_AMBIGUOUS', '多个 ERP 请求同时匹配完整 SKC 集合和查询快照。', 409);
    if (candidates.length === 0) throw loopbackError('ERP_REQUEST_NOT_FOUND', '没有匹配完整 SKC 集合和查询快照的 ERP 请求。', 409);
    const request = candidates[0];
    return {
      requestId: String(request.requestId || '').trim(),
      ledgerId: String(request.ledgerId || '').trim(),
      workspaceId: String(request.workspaceId || '').trim(),
      expectedSkus: normalizedExpectedSkus(request.expectedSkus),
    };
  }

  function assignLedgerScopeRoles(rows, expectedSkus, querySkcs) {
    const expectedBySku = new Map(normalizedExpectedSkus(expectedSkus).map((item) => [canonical(item.platformSku), item]));
    const queriedSkcs = new Set(normalizedSkcs(querySkcs));
    return rows.map((row) => {
      const platformSku = String(row?.platformSku || '').trim();
      const platformSkc = String(row?.platformSkc || '').trim();
      const warehouseSku = String(row?.warehouseSku || '').trim();
      const auxiliary = expectedBySku.size > 0
        && platformSku && platformSkc && warehouseSku
        && !expectedBySku.has(canonical(platformSku))
        && queriedSkcs.has(canonical(platformSkc));
      return { ...row, ledgerScopeRole: auxiliary ? 'auxiliary' : 'expected' };
    });
  }

  async function readPending() {
    const stored = await chrome.storage.local.get(PENDING_RESULTS_KEY);
    const records = stored[PENDING_RESULTS_KEY];
    return Array.isArray(records) ? records : [];
  }

  async function writePending(records) {
    await chrome.storage.local.set({ [PENDING_RESULTS_KEY]: records.slice(-20) });
  }

  async function savePending(record) {
    const records = (await readPending()).filter((item) => item.resultDeliveryId !== record.resultDeliveryId);
    records.push(record);
    await writePending(records);
  }

  async function removePending(resultDeliveryId) {
    await writePending((await readPending()).filter((item) => item.resultDeliveryId !== resultDeliveryId));
  }

  function retryable(error) {
    return !Number.isFinite(error?.status) || error.status === 408 || error.status === 429 || error.status >= 500;
  }

  function wait(delayMs) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  function workspaceContextError(recordWorkspaceId) {
    const missing = !String(recordWorkspaceId || '').trim();
    return loopbackError(
      'ERP_WORKSPACE_CONTEXT_CHANGED',
      missing
        ? '缓存的 ERP 成本结果缺少可信工作区快照，请重新核算。'
        : `缓存的 ERP 成本结果属于另一个工作区，切回原工作区后可继续投递。`,
      409,
    );
  }

  function assertRecordWorkspace(record, config) {
    if (!record?.workspaceId || record.workspaceId !== config.workspaceId) {
      throw workspaceContextError(record?.workspaceId);
    }
  }

  async function hydrate(record, config) {
    assertRecordWorkspace(record, config);
    if (record.requestId && record.ledgerId && Array.isArray(record.expectedSkus)) return record;
    const payload = await fetchLoopbackJson('/erp/v1/requests', {
      query: { workspaceId: config.workspaceId, registeredBefore: record.queryCapturedAt },
      config,
    });
    const context = resolveUniqueRequest(payload.records, { ...record, workspaceId: config.workspaceId });
    return {
      ...record,
      ...context,
      rows: assignLedgerScopeRoles(record.rows, context.expectedSkus, record.querySkcs),
    };
  }

  async function deliver(record, attempt = 1) {
    const attemptsTotalBeforeDelivery = record.attemptsTotal;
    let initialConfig;
    try {
      initialConfig = await runtimeConfig();
      assertRecordWorkspace(record, initialConfig);
    } catch (error) {
      return {
        ...record,
        ok: false,
        status: 'cached',
        code: error?.code || 'ERP_INBOX_NOT_CONFIGURED',
        message: error?.message || 'Shopeers 本机收件服务尚未配置。',
      };
    }
    const createdAt = Date.parse(String(record.createdAt || ''));
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > PENDING_TTL_MS) {
      await removePending(record.resultDeliveryId);
      return { ok: false, status: 'failed', message: '缓存的成本证据已超过 24 小时补发期限，请重新核算。', ...record };
    }
    if (Number(record.attemptsTotal || 0) >= MAX_TOTAL_ATTEMPTS) {
      await removePending(record.resultDeliveryId);
      return { ok: false, status: 'failed', message: '成本证据补发已达到 9 次上限，请重新核算。', ...record };
    }
    let retryRecord = { ...record, attemptsTotal: Number(record.attemptsTotal || 0) + 1 };
    await savePending(retryRecord);
    try {
      retryRecord = await hydrate(retryRecord, initialConfig);
      await savePending(retryRecord);
      const config = await runtimeConfig();
      assertRecordWorkspace(retryRecord, config);
      const payload = await fetchLoopbackJson('/erp/v1/cost-results', {
        method: 'POST',
        config,
        body: {
          resultDeliveryId: retryRecord.resultDeliveryId,
          requestId: retryRecord.requestId,
          ledgerId: retryRecord.ledgerId,
          workspaceId: config.workspaceId,
          querySkcs: retryRecord.querySkcs,
          rows: retryRecord.rows,
          sourceMeta: retryRecord.sourceMeta,
          warehouseEvidence: retryRecord.warehouseEvidence,
        },
      });
      await removePending(retryRecord.resultDeliveryId);
      return { ok: true, status: 'success', ...retryRecord, deliveryId: payload.deliveryId, batchId: payload.batchId };
    } catch (error) {
      const workspaceBlocked = error?.code === 'ERP_WORKSPACE_CONTEXT_CHANGED';
      if (workspaceBlocked) {
        retryRecord = { ...retryRecord, attemptsTotal: attemptsTotalBeforeDelivery };
        await savePending(retryRecord);
      }
      if (attempt < MAX_ATTEMPTS && retryable(error)) {
        await wait(RETRY_DELAYS_MS[attempt - 1]);
        return deliver(retryRecord, attempt + 1);
      }
      if (!retryable(error) && !workspaceBlocked) await removePending(retryRecord.resultDeliveryId);
      return {
        ...retryRecord,
        ok: false,
        status: retryable(error) || workspaceBlocked ? 'cached' : 'failed',
        code: error?.code || 'ERP_LOOPBACK_DELIVERY_FAILED',
        message: error?.message || 'Shopeers 本机收件服务暂不可用。',
      };
    }
  }

  async function startDelivery(record) {
    if (activeDeliveries.has(record.resultDeliveryId)) {
      return { ok: false, status: 'cached', message: '同一结果正在投递。', ...record };
    }
    activeDeliveries.add(record.resultDeliveryId);
    try {
      return await deliver(record);
    } finally {
      activeDeliveries.delete(record.resultDeliveryId);
    }
  }

  function trustedSenderUrl(sender) {
    try {
      const url = new URL(sender?.url || sender?.tab?.url || '');
      return url.protocol === 'https:'
        && (url.hostname === 'zhuolinkeji.cn' || url.hostname.endsWith('.zhuolinkeji.cn'))
        && url.pathname === ERP_PAGE_PATH
        ? url.href
        : '';
    } catch {
      return '';
    }
  }

  function senderAllowed(sender) {
    return Boolean(trustedSenderUrl(sender));
  }

  function makeResultDeliveryId() {
    return `ERP-RESULT-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  }

  async function submitCostResult(input, sender) {
    if (!senderAllowed(sender)) throw loopbackError('ERP_UNTRUSTED_SENDER', '只允许 ERP 采购管理页的隔离脚本投递。', 403);
    let config;
    try {
      config = await runtimeConfig();
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        code: error?.code || 'ERP_INBOX_NOT_CONFIGURED',
        message: error?.message || 'Shopeers 桌面运行时尚未配置安全收件通道。',
      };
    }
    const querySkcs = normalizedSkcs(input?.querySkcs ?? input?.meta?.querySkcs);
    const queryCapturedAt = String(input?.queryCapturedAt || input?.registeredBefore || input?.meta?.queryCapturedAt || '').trim();
    if (querySkcs.length === 0 || !Number.isFinite(Date.parse(queryCapturedAt))) {
      throw loopbackError('ERP_REQUEST_CONTEXT_MISSING', '缺少完整 SKC 集合或查询快照时间。', 409);
    }
    const warehouseEvidence = stripUntrustedControl(input?.warehouseEvidence && typeof input.warehouseEvidence === 'object'
      ? input.warehouseEvidence
      : { formatVersion: 1, warehouses: [], excludedOrders: [], excludedDetails: [], detailFailures: [], mappingFailures: [] });
    const rows = buildRows(stripUntrustedControl(input?.results), warehouseEvidence);
    if (rows.length === 0) throw loopbackError('EMPTY_COST_RESULTS', '没有可识别仓库 SKU 的成本或排除证据。', 400);
    const resultDeliveryId = /^ERP-RESULT-[A-Za-z0-9._:-]+$/.test(String(input?.resultDeliveryId || '').trim())
      ? String(input.resultDeliveryId).trim()
      : makeResultDeliveryId();
    const existing = (await readPending()).find((item) => item.resultDeliveryId === resultDeliveryId);
    const record = existing || {
      resultDeliveryId,
      createdAt: String(input?.createdAt || '').trim() || new Date().toISOString(),
      queryCapturedAt,
      registeredBefore: queryCapturedAt,
      attemptsTotal: 0,
      workspaceId: config.workspaceId,
      querySkcs,
      rows,
      sourceMeta: stripUntrustedControl(input?.meta),
      warehouseEvidence,
    };
    await savePending(record);
    return startDelivery(record);
  }

  async function reportInstalled({ ready = false, sender = null } = {}) {
    const pageUrl = trustedSenderUrl(sender);
    return fetchLoopbackJson('/erp/v1/extension-status', {
      method: 'POST',
      body: {
        extensionId: ready ? 'erp-assistant' : 'erp-assistant-installation',
        version: chrome.runtime.getManifest().version,
        ready,
        pageUrl,
        context: ready ? 'extension-isolated' : 'extension-background',
      },
    });
  }

  async function flushPending() {
    for (const record of await readPending()) await startDelivery(record);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const operation = message?.type === 'shopeers.erp.submitCostResult'
      ? submitCostResult(message.payload, sender)
      : message?.type === 'shopeers.erp.reportStatus'
        ? (senderAllowed(sender)
            ? reportInstalled({ ready: message.payload?.ready !== false, sender }).then(() => ({ ok: true, status: 'success' }))
            : Promise.reject(loopbackError('ERP_UNTRUSTED_SENDER', '扩展状态来源无效。', 403)))
        : Promise.reject(loopbackError('ERP_UNKNOWN_MESSAGE', '未知扩展消息。', 400));
    operation
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({
        ok: false,
        status: retryable(error) ? 'cached' : 'failed',
        message: error?.message || '扩展后台处理失败。',
        code: error?.code || 'ERP_EXTENSION_ERROR',
      }));
    return true;
  });

  function schedule() {
    chrome.alarms.create('erp-assistant-heartbeat', { periodInMinutes: 1 });
    chrome.alarms.create('erp-assistant-delivery-retry', { periodInMinutes: 1 });
  }

  chrome.runtime.onInstalled.addListener(() => {
    schedule();
    void reportInstalled().catch(() => {});
    void flushPending();
  });
  chrome.runtime.onStartup.addListener(() => {
    schedule();
    void reportInstalled().catch(() => {});
    void flushPending();
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'erp-assistant-heartbeat') void reportInstalled().catch(() => {});
    if (alarm.name === 'erp-assistant-delivery-retry') void flushPending();
  });

  if (globalThis.__SHOPEERS_ERP_BACKGROUND_TEST__) {
    globalThis.__SHOPEERS_ERP_BACKGROUND_TEST_API__ = {
      fetchLoopbackJson,
      flushPending,
      readPending,
      reportInstalled,
      senderAllowed,
      stripUntrustedControl,
      submitCostResult,
    };
  } else {
    schedule();
    void reportInstalled().catch(() => {});
    void flushPending();
  }
})();
