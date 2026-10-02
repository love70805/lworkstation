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
  const CHECKPOINT_KEY = 'shopeersErpCollectionCheckpointsV1';
  const CHECKPOINT_TTL_MS = 24 * 60 * 60 * 1000;
  const CHECKPOINT_MAX_BYTES = 1024 * 1024;
  const QUERY_FIELDS = new Set(['sku', 'limit', 'storeId', 'queryRange', 'createTimePeriod', 'orderNo', 'supplierName', 'organizationName', 'createdBy', 'warehouseId', 'paymentType', 'paymentStatus', 'purchaseStatus']);
  let checkpointWrites = Promise.resolve();

  function checkpointBytes(value) {
    let bytes = 0;
    for (const character of JSON.stringify(value)) { const code = character.codePointAt(0); bytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4; }
    return bytes;
  }

  // Whitelist, rather than copy arbitrary page objects, so checkpoints can never
  // persist login responses, credentials or an attacker supplied endpoint.
  function checkpointFilters(input) {
    const entries = Object.entries(input || {}).filter(([key]) => !/(token|authorization|cookie|password|secret|capability|endpoint|base.?url)/i.test(key));
    if (entries.some(([key, value]) => !QUERY_FIELDS.has(key) || !['string', 'number'].includes(typeof value) || String(value).length > 128000)) throw loopbackError('ERP_CHECKPOINT_QUERY_UNSUPPORTED', '查询包含尚未验证的条件，不能保存不完整的恢复范围；请重新查询。', 409);
    return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, String(value)]));
  }
  function checkpointBinding(request) {
    return JSON.stringify({ workspaceId: request.workspaceId, ledgerId: request.ledgerId, ledgerPeriod: request.ledgerPeriod, requestId: request.requestId,
      registeredAt: request.registeredAt, version: request.version ?? request.updatedAt ?? null, platformSkcs: normalizedSkcs(request.platformSkcs),
      expectedSkus: (request.expectedSkus || []).map(item => [canonical(item.platformSkc), canonical(item.platformSku)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
  }
  async function cleanCheckpoints() {
    const stored = await chrome.storage.local.get(CHECKPOINT_KEY);
    const records = (Array.isArray(stored[CHECKPOINT_KEY]) ? stored[CHECKPOINT_KEY] : []).filter(item => item.schemaVersion === 1 && item.extensionVersion === chrome.runtime.getManifest().version && Number.isFinite(item.updatedAt) && Date.now() - item.updatedAt >= 0 && Date.now() - item.updatedAt < CHECKPOINT_TTL_MS).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
    while (checkpointBytes(records) > CHECKPOINT_MAX_BYTES) records.pop();
    await chrome.storage.local.set({ [CHECKPOINT_KEY]: records });
    return records;
  }
  function collectionCheckpoint(input, sender) {
    const operation = checkpointWrites.catch(() => {}).then(() => collectionCheckpointOperation(input, sender));
    checkpointWrites = operation;
    return operation;
  }
  async function collectionCheckpointOperation(input = {}, sender) {
    if (!senderAllowed(sender)) throw loopbackError('ERP_UNTRUSTED_SENDER', '只允许 ERP 采购管理页管理采集检查点。', 403);
    const config = await runtimeConfig();
    let records = await cleanCheckpoints();
    if (input.action === 'list') return { ok: true, records: records.filter(item => item.workspaceId === config.workspaceId && item.state !== 'completed').map(({ binding, ...item }) => item) };
    const payload = await fetchLoopbackJson('/erp/v1/requests', { query: { workspaceId: config.workspaceId }, config });
    const request = (payload.records || []).find(item => item.requestId === input.requestId && item.workspaceId === config.workspaceId && item.status === 'registered' && item.requestKind !== 'catalog');
    const old = records.find(item => item.requestId === input.requestId && item.workspaceId === config.workspaceId);
    const binding = request ? checkpointBinding(request) : null;
    if (!request || !/^\d{4}-(0[1-9]|1[0-2])$/.test(request.ledgerPeriod || '') || old && old.binding !== binding) {
      records = records.filter(item => item !== old);
      await chrome.storage.local.set({ [CHECKPOINT_KEY]: records });
      throw loopbackError('ERP_CHECKPOINT_INVALID', '原采集范围已变化或失效，请回工作台重新发起采集。', 409);
    }
    assertRecordWorkspace({ workspaceId: config.workspaceId }, await runtimeConfig());
    if (input.action === 'restore') {
      if (!old || old.state === 'completed') throw loopbackError('ERP_CHECKPOINT_MISSING', '未找到有效的未完成采集，请重新查询。', 409);
      const liveFilters = checkpointFilters(input.filters);
      if (Object.keys(liveFilters).length && JSON.stringify(liveFilters) !== JSON.stringify(old.filters)) throw loopbackError('ERP_CHECKPOINT_QUERY_CHANGED', '当前查询条件已变化，请重新采集；旧任务不会混入当前范围。', 409);
      const pending = (await readPending()).find(item => item.resultDeliveryId === old.resultDeliveryId && item.workspaceId === config.workspaceId);
      return { ok: true, checkpoint: { ...old, binding: undefined }, pendingDeliveryId: pending?.resultDeliveryId || null, reuseEvidence: false, reason: 'account_and_history_require_revalidation' };
    }
    if (input.action !== 'save') throw loopbackError('ERP_CHECKPOINT_ACTION_INVALID', '未知检查点操作。', 400);
    if (input.state === 'completed' && (!old || input.resultDeliveryId !== old.resultDeliveryId)) throw loopbackError('ERP_CHECKPOINT_STALE_ACK', '旧采集送达确认不能结束新的任务。', 409);
    if (input.rotateDelivery === true && (!old || input.resultDeliveryId !== old.resultDeliveryId)) throw loopbackError('ERP_CHECKPOINT_STALE_ACK', '旧采集确认不能改写新任务投递身份。', 409);
    const filters = checkpointFilters(input.filters);
    const targetSkcs = normalizedSkcs(request.platformSkcs);
    const targetSet = new Set(targetSkcs);
    if (!filters.sku || !targetSkcs.length || !Number.isFinite(Date.parse(input.queryCapturedAt))) throw loopbackError('ERP_CHECKPOINT_SCOPE_MISSING', '检查点缺少完整目标或查询时间。', 409);
    if (old && JSON.stringify(filters) !== JSON.stringify(old.filters)) throw loopbackError('ERP_CHECKPOINT_QUERY_CHANGED', '查询条件已变化，旧检查点不可覆盖。', 409);
    const record = { schemaVersion: 1, extensionVersion: chrome.runtime.getManifest().version, workspaceId: config.workspaceId, requestId: request.requestId, ledgerPeriod: request.ledgerPeriod, binding,
      platformSkcs: targetSkcs, filters, queryCapturedAt: input.queryCapturedAt, accountState: 'unverified',
      completedTargets: normalizedSkcs(input.completedTargets).filter(skc => targetSet.has(skc)),
      resultDeliveryId: input.rotateDelivery !== true && old && (old.state !== 'completed' || input.state === 'completed') ? old.resultDeliveryId : makeResultDeliveryId(),
      state: input.state === 'completed' ? 'completed' : 'pending', updatedAt: Date.now() };
    if (checkpointBytes([record]) > CHECKPOINT_MAX_BYTES) throw loopbackError('ERP_CHECKPOINT_TOO_LARGE', '任务超过本机检查点空间上限；本次读取可继续，中断后需重新查询。', 413);
    records = [record, ...records.filter(item => item !== old)].slice(0, 8);
    while (checkpointBytes(records) > CHECKPOINT_MAX_BYTES) records.pop();
    await chrome.storage.local.set({ [CHECKPOINT_KEY]: records });
    return { ok: true, checkpoint: { ...record, binding: undefined } };
  }

  async function acknowledgeCheckpointDelivery(record) {
    const operation = checkpointWrites.catch(() => {}).then(async () => {
      const records = await cleanCheckpoints();
      const checkpoint = records.find(item => item.workspaceId === record.workspaceId && item.resultDeliveryId === record.resultDeliveryId);
      if (!checkpoint) return;
      const complete = record.sourceMeta && !record.sourceMeta.orderCountMismatch && !record.sourceMeta.detailFailureCount && !record.sourceMeta.mappingFailureCount;
      checkpoint.state = complete ? 'completed' : 'pending';
      if (!complete) checkpoint.resultDeliveryId = makeResultDeliveryId();
      checkpoint.updatedAt = Date.now();
      await chrome.storage.local.set({ [CHECKPOINT_KEY]: records });
    });
    checkpointWrites = operation;
    await operation;
  }

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
      throw Object.assign(new Error('ERP_INBOX_NOT_CONFIGURED：Lworkstation 桌面运行时尚未配置安全收件通道。'), {
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
        throw loopbackError('ERP_LOOPBACK_INVALID_RESPONSE', 'Lworkstation 本机收件服务返回了无效 JSON。', 502);
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
            reject(loopbackError('ERP_LOOPBACK_TIMEOUT', '连接 Lworkstation 本机收件服务超时。', 408));
          }, LOOPBACK_REQUEST_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      if (error?.name === 'AbortError') throw loopbackError('ERP_LOOPBACK_TIMEOUT', '连接 Lworkstation 本机收件服务超时。', 408);
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
      if (['requestid', 'ledgerid', 'ledgerperiod', 'workspaceid', 'expectedskus', 'ledgerscoperole', 'cacherestored', 'deliveryterminal'].includes(normalized)) continue;
      result[key] = stripUntrustedControl(child, depth + 1);
    }
    return result;
  }

  function optionalFiniteNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function catalogText(value) {
    if (!['string', 'number'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) return '';
    return String(value).normalize('NFKC').trim();
  }

  function catalogUrl(value) {
    try {
      const url = new URL(catalogText(value));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
      if ([...url.searchParams.keys()].some(key => /(token|authorization|cookie|password|secret|capability|endpoint|base.?url)/i.test(key))) return '';
      url.hash = '';
      return url.href;
    } catch { return ''; }
  }

  function purchaseCatalog(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return Object.fromEntries([
      'picturesLinking', 'pictureLink1688', 'purchaseSpecificationAndModel1688', 'model1688',
      'specificationAndModel', 'productColor', 'purchaseProportion1688', 'purchaseOrderDetailId',
      'purchaseOrderId', 'purchaseOrderNo', 'lineNumber', 'supplierId', 'barcodeSkuid', 'barcodeSkcid',
    ].map(key => [key, (['picturesLinking', 'pictureLink1688'].includes(key) ? catalogUrl(value[key]) : catalogText(value[key])) || null]));
  }

  function purchaseMatchesMapping(catalog, mapping) {
    return (!catalog?.barcodeSkuid || canonical(catalog.barcodeSkuid) === canonical(mapping?.platformSku))
      && (!catalog?.barcodeSkcid || canonical(catalog.barcodeSkcid) === canonical(mapping?.platformSkc));
  }

  function purchaseSummary(result, mapping, mappings, warehouseEvidence) {
    const warehouses = Array.isArray(warehouseEvidence) ? warehouseEvidence : warehouseEvidence?.warehouses;
    const warehouse = (Array.isArray(warehouses) ? warehouses : []).find(item => canonical(item?.warehouseSku) === canonical(result?.warehouseSku));
    // Catalog metadata follows complete purchase evidence, independently of the
    // latest three records selected for a monthly weighted-cost preview.
    const candidates = (Array.isArray(warehouse?.purchaseRecords) ? warehouse.purchaseRecords : [])
      .filter(record => purchaseMatchesMapping(purchaseCatalog(record?.purchaseCatalog), mapping));
    const record = candidates[0];
    const resultCompatible = purchaseMatchesMapping(purchaseCatalog(result?.purchaseCatalog), mapping);
    const source = record || (!warehouse?.purchaseRecords?.length && resultCompatible ? result : null);
    const catalog = source && Object.hasOwn(source, 'purchaseCatalog') ? purchaseCatalog(source.purchaseCatalog) : null;
    const scopedSkuCount = new Set(mappings.filter(item => purchaseMatchesMapping(catalog, item)).map(item => canonical(item?.platformSku)).filter(Boolean)).size;
    const imageUrl = catalog?.picturesLinking
      || (scopedSkuCount === 1 ? catalog?.pictureLink1688 : '')
      || (!catalog ? catalogUrl(source?.imageUrl) : '');
    return {
      name: catalogText(record?.productName) || (source && resultCompatible ? catalogText(result?.name) : ''),
      imageUrl,
      supplierName: catalogText(source?.supplierName),
      supplier1688Url: catalogText(source?.supplier1688Url),
      supplier1688Links: supplierLinks(candidates.length ? candidates.flatMap(item => item?.supplier1688Links || []) : source?.supplier1688Links),
      ...(source && Object.hasOwn(source, 'purchaseCatalog') ? { purchaseCatalog: catalog } : {}),
    };
  }

  function catalogMappings(values, warehouseSku) {
    const mappings = new Map();
    for (const item of (Array.isArray(values) ? values : [])) {
      const platformSku = catalogText(item?.platformSku);
      const platformSkc = catalogText(item?.platformSkc);
      if (!platformSku || !platformSkc) continue;
      const mapping = {
        platformSku, platformSkc,
        warehouseSku: catalogText(item?.warehouseSku) || catalogText(warehouseSku),
        productName: catalogText(item?.productName),
        imageUrl: catalogUrl(item?.imageUrl),
        attribute: catalogText(item?.attribute),
        storeName: catalogText(item?.storeName),
        ...(Object.hasOwn(item || {}, 'storeId') ? { storeId: catalogText(item.storeId) } : {}),
        articleNumber: catalogText(item?.articleNumber),
        platform: catalogText(item?.platform),
      };
      mappings.set(JSON.stringify(mapping), mapping);
    }
    return [...mappings.values()];
  }

  function supplierLinks(values) {
    const links = new Map();
    for (const item of (Array.isArray(values) ? values : [])) {
      const safeUrl = catalogUrl(item?.url);
      if (!safeUrl) continue;
      const url = new URL(safeUrl);
      let value;
      if (item?.type === 'product' && url.hostname === 'detail.1688.com' && /^\/offer\/\d{7,20}\.html$/i.test(url.pathname)) {
        value = `https://detail.1688.com${url.pathname}`;
      } else if (item?.type === 'store' && url.hostname.endsWith('.1688.com') && !['detail.1688.com', 'www.1688.com'].includes(url.hostname)) {
        value = url.href;
      }
      if (!value) continue;
      const name = catalogText(item?.supplierName);
      const link = { type: item.type, url: value, ...(name ? { supplierName: name } : {}) };
      links.set(JSON.stringify(link), link);
    }
    return [...links.values()];
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
      const catalog = catalogMappings(result?.catalogMappings || result?.mappings, result?.warehouseSku);
      seenWarehouseSkus.add(canonical(result?.warehouseSku));
      for (const mapping of mappings) {
        const purchase = purchaseSummary(result, mapping, mappings, warehouseEvidence);
        rows.push({
          warehouseSku: String(result?.warehouseSku || '').trim(),
          platformSku: String(mapping?.platformSku || '').trim(),
          platformSkc: String(mapping?.platformSkc || result?.platformSkc || '').trim(),
          orderNumber: result?.orderNumber,
          sourceType: result?.sourceType,
          name: catalogText(mapping?.productName) || purchase.name,
          imageUrl: catalogUrl(mapping?.imageUrl) || purchase.imageUrl,
          attribute: catalogText(mapping?.attribute) || (new Set(mappings.map(item => canonical(item?.platformSku)).filter(Boolean)).size === 1 ? catalogText(result?.attribute) : ''),
          ...(Object.hasOwn(purchase, 'purchaseCatalog') ? { purchaseCatalog: purchase.purchaseCatalog } : {}),
          catalogMappings: catalog,
          calcTimes: result?.calcTimes,
          dateRange: result?.dateRange,
          totalQty: result?.totalQty,
          totalPrice: result?.totalPrice,
          previewUnitCost: optionalFiniteNumber(result?.unitCost),
          unitCost: optionalFiniteNumber(result?.unitCost),
          supplierName: purchase.supplierName,
          ...(Array.isArray(result.supplierNames) ? { supplierNames: result.supplierNames.map(catalogText).filter(Boolean) } : {}),
          supplier1688Url: purchase.supplier1688Url,
          supplier1688Links: purchase.supplier1688Links,
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

  function findUniqueRequest(records, { querySkcs, registeredBefore, workspaceId }) {
    const snapshotAt = Date.parse(String(registeredBefore || ''));
    const candidates = (Array.isArray(records) ? records : []).filter((request) => {
      if (request?.requestKind === 'catalog' || request?.kind === 'catalog') return false;
      if (request?.status && request.status !== 'registered') return false;
      if (String(request?.workspaceId || '').trim() !== workspaceId) return false;
      const registeredAt = Date.parse(String(request?.registeredAt || request?.requestedAt || ''));
      if (!Number.isFinite(snapshotAt) || !Number.isFinite(registeredAt) || registeredAt > snapshotAt) return false;
      return normalizedSkcs(querySkcs).length > 0 && normalizedSkcs(querySkcs).every((skc) => normalizedSkcs(request?.platformSkcs).includes(skc));
    });
    if (candidates.length > 1) throw loopbackError('ERP_REQUEST_AMBIGUOUS', '多个 ERP 请求同时匹配完整 SKC 集合和查询快照。', 409);
    if (candidates.length === 0) throw loopbackError('ERP_REQUEST_NOT_FOUND', '没有匹配完整 SKC 集合和查询快照的 ERP 请求。', 409);
    return candidates[0];
  }

  function resolveUniqueRequest(records, context) {
    const request = findUniqueRequest(records, context);
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
    await chrome.storage.local.set({ [PENDING_RESULTS_KEY]: records });
  }

  let pendingWrites = Promise.resolve();
  function mutatePending(change) {
    const operation = pendingWrites.catch(() => {}).then(async () => writePending(change(await readPending())));
    pendingWrites = operation;
    return operation;
  }
  function savePending(record) {
    return mutatePending((records) => [...records.filter((item) => item.resultDeliveryId !== record.resultDeliveryId), record]);
  }

  function removePending(resultDeliveryId) {
    return mutatePending((records) => records.filter((item) => item.resultDeliveryId !== resultDeliveryId));
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
    if (record.requestKind === 'catalog' && record.requestId) return record;
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
        message: error?.message || 'Lworkstation 本机收件服务尚未配置。',
      };
    }
    const createdAt = Date.parse(String(record.createdAt || ''));
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > PENDING_TTL_MS) {
      await savePending({ ...record, deliveryTerminal: true });
      return { ok: false, status: 'failed', message: '缓存的成本证据已超过 24 小时补发期限，请重新核算。', ...record };
    }
    if (Number(record.attemptsTotal || 0) >= MAX_TOTAL_ATTEMPTS) {
      await savePending({ ...record, deliveryTerminal: true });
      return { ok: false, status: 'failed', message: '成本证据补发已达到 9 次上限，请重新核算。', ...record };
    }
    let retryRecord = { ...record, attemptsTotal: Number(record.attemptsTotal || 0) + 1 };
    await savePending(retryRecord);
    try {
      retryRecord = await hydrate(retryRecord, initialConfig);
      await savePending(retryRecord);
      const config = await runtimeConfig();
      assertRecordWorkspace(retryRecord, config);
      const payload = await fetchLoopbackJson(retryRecord.requestKind === 'catalog' ? '/erp/v1/catalog-results' : '/erp/v1/cost-results', {
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
          ...(retryRecord.requestKind === 'catalog' ? { catalogCoverage: retryRecord.catalogCoverage } : {}),
          warehouseEvidence: retryRecord.warehouseEvidence,
        },
      });
      // Retire/rotate the task before removing its exact queued payload. If the
      // worker exits in this gap, retrying that payload remains idempotent.
      await acknowledgeCheckpointDelivery(retryRecord);
      await removePending(retryRecord.resultDeliveryId);
      return { ok: true, status: 'success', ...retryRecord, deliveryId: payload.deliveryId, batchId: payload.batchId, envelope: payload.envelope };
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
      if (!retryable(error) && !workspaceBlocked) await savePending({ ...retryRecord, deliveryTerminal: true });
      return {
        ...retryRecord,
        ok: false,
        status: retryable(error) || workspaceBlocked ? 'cached' : 'failed',
        code: error?.code || 'ERP_LOOPBACK_DELIVERY_FAILED',
        message: error?.message || 'Lworkstation 本机收件服务暂不可用。',
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

  function trustedSiteSenderUrl(sender) {
    try {
      const url = new URL(sender?.url || sender?.tab?.url || '');
      return url.protocol === 'https:'
        && (url.hostname === 'zhuolinkeji.cn' || url.hostname.endsWith('.zhuolinkeji.cn'))
        ? url.href
        : '';
    } catch {
      return '';
    }
  }

  function senderAllowed(sender) {
    const siteUrl = trustedSiteSenderUrl(sender);
    return Boolean(siteUrl && new URL(siteUrl).pathname === ERP_PAGE_PATH);
  }

  function makeResultDeliveryId() {
    return `ERP-RESULT-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  }

  async function submitCostResult(input, sender) {
    if (!senderAllowed(sender)) throw loopbackError('ERP_UNTRUSTED_SENDER', '只允许 ERP 采购管理页的隔离脚本投递。', 403);
    let config;
    let configurationError;
    try {
      config = await runtimeConfig();
    } catch (error) {
      configurationError = error;
      const stored = await chrome.storage.local.get(INBOX_WORKSPACE_ID_KEY);
      config = { workspaceId: String(stored[INBOX_WORKSPACE_ID_KEY] || '').trim() };
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
    if (configurationError) return { ...record, ok: false, status: 'failed', retained: true, code: configurationError.code, message: '证据已保留在扩展后台；安全通道未配置，尚未投递。配置后重试；缺少工作区快照时须重新采集。' };
    return startDelivery(record);
  }

  async function catalogRequest(input, sender) {
    if (!senderAllowed(sender)) throw loopbackError('ERP_UNTRUSTED_SENDER', '只允许 ERP 采购管理页读取资料请求。', 403);
    const config = await runtimeConfig();
    const payload = await fetchLoopbackJson('/erp/v1/requests', { query: { workspaceId: config.workspaceId }, config });
    const source = input?.queryCapturedAt ? findUniqueRequest(payload.records, { querySkcs: normalizedSkcs(input.querySkcs), registeredBefore: input.queryCapturedAt, workspaceId: config.workspaceId }) : null;
    let candidates = (payload.records || []).filter(request => (!source || request.sourceRequestId === source.requestId) && (!request.sourceRequestId || (payload.records || []).some(cost => cost.requestId === request.sourceRequestId && cost.status === 'registered' && cost.workspaceId === config.workspaceId)) && request.requestKind === 'catalog' && request.status === 'registered' && request.workspaceId === config.workspaceId && (!input?.requestId || request.requestId === input.requestId));
    if (source) candidates = candidates.filter(request => request.requestId === `${source.requestId}-CATALOG`);
    else if (!input?.requestId) {
      const explicit = candidates.filter(request => request.requestId !== `${request.sourceRequestId}-CATALOG`);
      if (explicit.length) candidates = explicit;
    }
    if (candidates.length !== 1) throw loopbackError(candidates.length ? 'ERP_REQUEST_AMBIGUOUS' : 'ERP_REQUEST_NOT_FOUND', candidates.length ? '存在多个资料请求，请在工作台取消旧请求后再补充。' : '请先在工作台登记补充资料请求。', 409);
    assertRecordWorkspace({ workspaceId: config.workspaceId }, await runtimeConfig());
    return { request: candidates[0], config };
  }

  async function catalogContext(input, sender) {
    const { request } = await catalogRequest(input, sender);
    return { ok: true, request: { requestId: request.requestId, platformSkcs: request.platformSkcs, ledgerPeriod: request.ledgerPeriod, missingGroups: request.missingGroups } };
  }

  function buildCatalogRows(results, querySkcs) {
    const scope = new Set(normalizedSkcs(querySkcs));
    const rows = [];
    for (const result of (Array.isArray(results) ? results : [])) {
      const warehouseSku = catalogText(result?.warehouseSku);
      const catalog = catalogMappings(result?.catalogMappings || result?.mappings, warehouseSku);
      for (const mapping of (Array.isArray(result?.mappings) ? result.mappings : [])) {
        if (!scope.has(canonical(mapping.platformSkc)) || !catalogText(mapping.platformSku) || !warehouseSku || canonical(mapping.warehouseSku) !== canonical(warehouseSku)) continue;
        rows.push({ warehouseSku, platformSku: catalogText(mapping.platformSku), platformSkc: catalogText(mapping.platformSkc), productName: catalogText(mapping.productName) || catalogText(result.name), imageUrl: catalogUrl(mapping.imageUrl) || catalogUrl(result.imageUrl), attribute: catalogText(mapping.attribute), catalogMappings: catalog, purchaseCatalog: purchaseCatalog(result.purchaseCatalog), supplierName: catalogText(result.supplierName), supplierNames: (result.supplierNames || []).map(catalogText).filter(Boolean), supplier1688Links: supplierLinks(result.supplier1688Links), sourceWarnings: Array.isArray(result.sourceWarnings) ? result.sourceWarnings : [] });
      }
    }
    return rows;
  }

  async function submitCatalogResult(input, sender) {
    const { request, config } = await catalogRequest({ requestId: String(input?.requestId || '').trim() }, sender);
    if (!input?.requestId || input.requestId !== request.requestId || !sameSkcs(input?.querySkcs, request.platformSkcs)) throw loopbackError('ERP_REQUEST_CONTEXT_MISSING', '资料请求或完整平台 SKC 范围不匹配。', 409);
    const rows = buildCatalogRows(stripUntrustedControl(input?.results), request.platformSkcs);
    const warehouseScope = new Set(rows.map(row => canonical(row.warehouseSku)));
    const rawEvidence = stripUntrustedControl(input?.warehouseEvidence || { warehouses: [] });
    const warehouseEvidence = { warehouses: (rawEvidence.warehouses || []).filter(entry => warehouseScope.has(canonical(entry.warehouseSku))) };
    const resultDeliveryId = /^ERP-RESULT-[A-Za-z0-9._:-]+$/.test(String(input?.resultDeliveryId || '').trim()) ? input.resultDeliveryId.trim() : makeResultDeliveryId();
    const existing = (await readPending()).find(record => record.resultDeliveryId === resultDeliveryId);
    if (existing && (existing.requestKind !== 'catalog' || existing.requestId !== request.requestId || existing.workspaceId !== config.workspaceId)) throw loopbackError('ERP_RESULT_DELIVERY_CONFLICT', '投递标识已绑定其他请求。', 409);
    const record = existing || { requestKind: 'catalog', requestId: request.requestId, ledgerId: request.ledgerId || null, workspaceId: config.workspaceId, querySkcs: request.platformSkcs, resultDeliveryId, createdAt: String(input?.createdAt || '').trim() || new Date().toISOString(), attemptsTotal: 0, rows, warehouseEvidence, catalogCoverage: stripUntrustedControl(input?.catalogCoverage) };
    await savePending(record);
    return { ...await startDelivery(record), retained: (await readPending()).some(item => item.resultDeliveryId === resultDeliveryId) };
  }

  async function previewContext(input, sender) {
    if (!senderAllowed(sender)) throw loopbackError('ERP_UNTRUSTED_SENDER', '只允许 ERP 采购管理页读取核算月份。', 403);
    const querySkcs = normalizedSkcs(input?.querySkcs);
    const queryCapturedAt = String(input?.queryCapturedAt || '').trim();
    if (!querySkcs.length || !Number.isFinite(Date.parse(queryCapturedAt))) {
      throw loopbackError('ERP_REQUEST_CONTEXT_MISSING', '缺少完整 SKC 集合或查询快照时间。', 409);
    }
    const config = await runtimeConfig();
    const payload = await fetchLoopbackJson('/erp/v1/requests', {
      query: { workspaceId: config.workspaceId, registeredBefore: queryCapturedAt }, config,
    });
    const request = findUniqueRequest(payload.records, { querySkcs, registeredBefore: queryCapturedAt, workspaceId: config.workspaceId });
    const currentConfig = await runtimeConfig();
    assertRecordWorkspace({ workspaceId: config.workspaceId }, currentConfig);
    if (request.ledgerPeriod == null) throw loopbackError('ERP_LEDGER_PERIOD_UNKNOWN', '关联请求缺少核算月份，请返回工作台刷新关联后重新查询。', 409);
    if (typeof request.ledgerPeriod !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(request.ledgerPeriod)) {
      throw loopbackError('ERP_LEDGER_PERIOD_INVALID', '关联请求的核算月份无效，请返回工作台重新查询。', 409);
    }
    return { ok: true, ledgerPeriod: request.ledgerPeriod, requestId: request.requestId, platformSkcs: request.platformSkcs };
  }

  async function retryPending(input, sender) {
    if (!senderAllowed(sender)) throw loopbackError('ERP_UNTRUSTED_SENDER', '只允许 ERP 采购管理页重试。', 403);
    const record = (await readPending()).find((item) => item.resultDeliveryId === input?.resultDeliveryId);
    if (!record) return { ok: false, status: 'failed', message: '此结果没有待补发证据，可能已经接收；请在工作台查看批次。' };
    assertRecordWorkspace(record, await runtimeConfig());
    return startDelivery({ ...record, attemptsTotal: 0, deliveryTerminal: false });
  }

  async function reportInstalled({ ready = false, sender = null, sessionState = 'unknown', pageState = 'page_ready', queryAvailable = false } = {}) {
    const pageUrl = trustedSiteSenderUrl(sender);
    const config = await runtimeConfig();
    return fetchLoopbackJson('/erp/v1/extension-status', {
      config,
      method: 'POST',
      body: {
        extensionId: sender ? (Number(sender.frameId || 0) === 0 ? 'erp-assistant' : `erp-assistant-frame-${Number(sender.frameId)}`) : 'erp-assistant-installation',
        version: chrome.runtime.getManifest().version,
        ready,
        pageUrl,
        context: sender ? 'extension-isolated' : 'extension-background',
        handshakeVersion: sender ? 1 : 0,
        workspaceId: config.workspaceId,
        sessionState: ['authenticated', 'login_required'].includes(sessionState) ? sessionState : 'unknown',
        pageState: ['purchase_ready', 'query_ready', 'login_required'].includes(pageState) ? pageState : 'page_ready',
        queryAvailable: queryAvailable === true,
      },
    });
  }

  async function flushPending() {
    for (const record of await readPending()) if (!record.deliveryTerminal) await startDelivery(record);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const operation = message?.type === 'shopeers.erp.submitCostResult'
      ? submitCostResult(message.payload, sender)
      : message?.type === 'shopeers.erp.collectionCheckpoint'
        ? collectionCheckpoint(message.payload, sender)
      : message?.type === 'shopeers.erp.catalogContext'
        ? catalogContext(message.payload, sender)
      : message?.type === 'shopeers.erp.submitCatalogResult'
        ? submitCatalogResult(message.payload, sender)
      : message?.type === 'shopeers.erp.previewContext'
        ? previewContext(message.payload, sender)
      : message?.type === 'shopeers.erp.retryPending'
        ? retryPending(message.payload, sender)
      : message?.type === 'shopeers.erp.reportStatus'
        ? (trustedSiteSenderUrl(sender)
            ? reportInstalled({ ...message.payload, ready: message.payload?.ready !== false, sender }).then(() => ({ ok: true, status: 'success' }))
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
    void collectionCheckpointCleanup();
    chrome.alarms.create('erp-assistant-heartbeat', { periodInMinutes: 1 });
    chrome.alarms.create('erp-assistant-delivery-retry', { periodInMinutes: 1 });
  }

  function collectionCheckpointCleanup() {
    const operation = checkpointWrites.catch(() => {}).then(cleanCheckpoints);
    checkpointWrites = operation;
    return operation.catch(() => {});
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
    if (alarm.name === 'erp-assistant-heartbeat') void collectionCheckpointCleanup();
    if (alarm.name === 'erp-assistant-delivery-retry') void flushPending();
  });

  if (globalThis.__SHOPEERS_ERP_BACKGROUND_TEST__) {
    globalThis.__SHOPEERS_ERP_BACKGROUND_TEST_API__ = {
      buildCatalogRows,
      collectionCheckpoint,
      acknowledgeCheckpointDelivery,
      cleanCheckpoints,
      catalogContext,
      submitCatalogResult,
      buildRows,
      fetchLoopbackJson,
      flushPending,
      readPending,
      reportInstalled,
      previewContext,
      senderAllowed,
      stripUntrustedControl,
      submitCostResult,
      retryPending,
    };
  } else {
    schedule();
    void reportInstalled().catch(() => {});
    void flushPending();
  }
})();
