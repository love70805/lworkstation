(function () {
    'use strict';

    if (window.__erpAssistantCostV8) return;
    window.__erpAssistantCostV8 = true;

    const API_BASE = 'https://www.zhuolinkeji.cn';
    const LIST_PATH = '/purchase/purchase/v1/purchase-order-page';
    const DETAIL_PATH = '/purchase/purchase/v1/purchase-order-details';
    const SKU_PATH = '/purchase/product/v1/product-info-sku';
    const MAX_RECORDS = 3;
    const MAX_CONCURRENT_DETAIL = 8;
    const MAX_CONCURRENT_SKU = 5;
    const REQUEST_TIMEOUT = 20000;
    const MAX_LIST_PAGES = 1000;
    const PREFERRED_PAGE_SIZE = 50;
    const RETRY_COUNT = 2;
    const CACHE_TTL = 10 * 60 * 1000;
    const RESULT_CACHE_TTL = 30 * 60 * 1000;
    const RESULT_CACHE_KEY = 'latest_cost_result_v2';
    const PREFIX = '[ERP Assistant]';
    const EXTENSION_VERSION = '8.0.10';
    const STATUS_ENDPOINT = 'http://127.0.0.1:8790/erp/v1/extension-status';
    const resultPolicy = window.ShopeersErpResultPolicy;
    if (!resultPolicy) {
        console.error(PREFIX, '未加载成本结果规则模块，停止运行以避免导出未校验映射。');
        return;
    }

    const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    let capturedListUrl = '';
    let activeRun = null;
    let lastResults = [];
    let lastMeta = null;
    let searchText = '';
    let toastTimer = null;
    let pageSizeObserver = null;
    const expandedRows = new Set();
    const supplier1688UrlsByName = new Map();

    class CostError extends Error {
        constructor(message, details) {
            super(message);
            this.name = 'CostError';
            this.details = details || '';
        }
    }

    function captureListRequest(rawUrl) {
        if (!rawUrl) return;
        try {
            const url = new URL(rawUrl, window.location.href);
            if (url.pathname === LIST_PATH) {
                capturedListUrl = url.href;
                updateIdleStatus();
                schedulePageSizeUpgrade();
                console.info(PREFIX, '已捕获采购查询条件');
            }
        } catch (error) {
            console.warn(PREFIX, '无法解析采购请求 URL', error);
        }
    }

    function installRequestHooks() {
        if (nativeFetch) {
            window.fetch = function (input, init) {
                const rawUrl = typeof input === 'string' ? input : input && (input.url || input.href);
                captureListRequest(rawUrl);
                return nativeFetch(input, init);
            };
        }

        const xhrPrototype = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
        if (xhrPrototype && typeof xhrPrototype.open === 'function') {
            const nativeOpen = xhrPrototype.open;
            xhrPrototype.open = function (method, url) {
                captureListRequest(typeof url === 'string' ? url : '');
                return nativeOpen.apply(this, arguments);
            };
        }
    }

    installRequestHooks();

    function ensurePageSize50() {
        const selects = [...document.querySelectorAll('.layui-laypage-limits select')];
        const select = selects.find((item) => [...item.options].some((option) => {
            const value = String(option.value || '').trim();
            const label = String(option.textContent || '').trim();
            return value === '50' || /^50(?:条|\/页)?$/.test(label);
        }));
        if (!select) return false;
        const option = [...select.options].find((item) => {
            const value = String(item.value || '').trim();
            const label = String(item.textContent || '').trim();
            return value === '50' || /^50(?:条|\/页)?$/.test(label);
        });
        if (!option) return false;
        if (String(select.value) === String(option.value)) return true;
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        console.info(PREFIX, '已将 ERP 页面分页切换为 50 条/页');
        return true;
    }

    function schedulePageSizeUpgrade() {
        if (ensurePageSize50()) return;
        if (!document.body || !window.MutationObserver || pageSizeObserver) return;
        pageSizeObserver = new MutationObserver(() => {
            if (ensurePageSize50()) {
                pageSizeObserver.disconnect();
                pageSizeObserver = null;
            }
        });
        pageSizeObserver.observe(document.body, { childList: true, subtree: true });
        window.setTimeout(() => {
            if (!pageSizeObserver) return;
            if (ensurePageSize50()) {
                pageSizeObserver.disconnect();
                pageSizeObserver = null;
            }
        }, 3000);
    }

    function parseCapturedFilters() {
        if (!capturedListUrl) {
            throw new CostError(
                '尚未捕获采购查询条件',
                '请先在采购管理页面点击“查询”，确认表格结果刷新后再进行核算。'
            );
        }

        const url = new URL(capturedListUrl, API_BASE);
        const filters = {};
        url.searchParams.forEach((value, key) => {
            if (key !== 'page') filters[key] = value;
        });
        return filters;
    }

    function buildUrl(path, params) {
        const url = new URL(path, API_BASE);
        Object.keys(params).forEach((key) => {
            const value = params[key];
            if (value !== '' && value !== undefined && value !== null) {
                url.searchParams.set(key, String(value));
            }
        });
        return url.href;
    }

    async function apiGet(path, params, parentSignal, context) {
        if (!nativeFetch) throw new CostError('当前页面不支持 fetch');

        const controller = new AbortController();
        let timedOut = false;
        const relayAbort = () => controller.abort(parentSignal.reason);
        if (parentSignal) {
            if (parentSignal.aborted) relayAbort();
            else parentSignal.addEventListener('abort', relayAbort, { once: true });
        }

        const timeoutId = window.setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, REQUEST_TIMEOUT);

        try {
            const response = await nativeFetch(buildUrl(path, params), {
                credentials: 'include',
                signal: controller.signal,
                headers: {
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            if (!response.ok) {
                throw new CostError(context + '请求失败', 'HTTP ' + response.status + ' ' + response.statusText);
            }

            try {
                return await response.json();
            } catch (error) {
                throw new CostError(context + '返回了无效 JSON', error.message || String(error));
            }
        } catch (error) {
            if (timedOut) {
                throw new CostError(context + '请求超时', '超过 ' + REQUEST_TIMEOUT / 1000 + ' 秒，已中止该请求。');
            }
            if (parentSignal && parentSignal.aborted) {
                if (parentSignal.reason instanceof Error) throw parentSignal.reason;
                throw new DOMException('核算已取消', 'AbortError');
            }
            if (error instanceof CostError) throw error;
            throw new CostError(context + '请求失败', error.message || String(error));
        } finally {
            window.clearTimeout(timeoutId);
            if (parentSignal) parentSignal.removeEventListener('abort', relayAbort);
        }
    }

    function wait(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    async function apiGetRetry(path, params, parentSignal, context) {
        let lastError = null;
        for (let attempt = 0; attempt <= RETRY_COUNT; attempt += 1) {
            try {
                return await apiGet(path, params, parentSignal, context);
            } catch (error) {
                lastError = error;
                if (parentSignal && parentSignal.aborted) throw error;
                if (!isRetryableError(error)) throw error;
                if (attempt < RETRY_COUNT) await wait(500 * (attempt + 1));
            }
        }
        throw lastError;
    }

    function isRetryableError(error) {
        const text = String((error && error.message) || '') + ' ' + String((error && error.details) || '');
        return /超时|网络|连接|Failed to fetch|HTTP (429|5\d{2})/i.test(text);
    }

    function readCacheEntry(storageKey) {
        try {
            const raw = window.sessionStorage.getItem(storageKey);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            const timestamp = Number(entry.timestamp ?? entry.ts);
            if (!entry || !Number.isFinite(timestamp) || Date.now() - timestamp > CACHE_TTL) return null;
            return entry.value ?? entry.data ?? null;
        } catch {
            return null;
        }
    }

    function getCache(key, legacyKey = key) {
        return readCacheEntry('erpAssistantV8_' + key) ?? readCacheEntry('skuApiCache_' + legacyKey);
    }

    function setCache(key, value) {
        try {
            window.sessionStorage.setItem('erpAssistantV8_' + key, JSON.stringify({ timestamp: Date.now(), value }));
        } catch {
            // Storage may be disabled; network path remains authoritative.
        }
    }

    function getResultCache() {
        try {
            const raw = window.localStorage.getItem('erpAssistantV8_' + RESULT_CACHE_KEY);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (!entry || Date.now() - Number(entry.timestamp) > RESULT_CACHE_TTL) {
                window.localStorage.removeItem('erpAssistantV8_' + RESULT_CACHE_KEY);
                return null;
            }
            if (!Array.isArray(entry.results) || !entry.meta) return null;
            return entry;
        } catch {
            return null;
        }
    }

    function setResultCache(results, meta, capturedUrl) {
        try {
            window.localStorage.setItem('erpAssistantV8_' + RESULT_CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                results,
                meta,
                capturedUrl: capturedUrl || ''
            }));
        } catch {
            // Large result sets or disabled storage must not block核算。
        }
    }

    function dispatchCostResults(results, meta) {
        if (!Array.isArray(results) || results.length === 0) return;
        window.dispatchEvent(new CustomEvent('shopeers:erp-v8-cost-result', { detail: { results, meta } }));
    }

    function findNestedArray(value, depth = 0, visited = new Set()) {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== 'object' || depth > 4 || visited.has(value)) return null;
        visited.add(value);
        const keys = ['list', 'records', 'rows', 'items', 'data', 'result', 'skuList', 'skuInfoList', 'platformSkuList', 'purchaseOrders', 'details'];
        for (const key of keys) {
            const found = findNestedArray(value[key], depth + 1, visited);
            if (found) return found;
        }
        for (const child of Object.values(value)) {
            const found = findNestedArray(child, depth + 1, visited);
            if (found) return found;
        }
        return null;
    }

    function requireApiData(response, context) {
        if (!response || response.code !== 0) {
            const code = response && response.code !== undefined ? response.code : '缺失';
            const message = response && (response.msg || response.message);
            throw new CostError(context + '接口异常', '业务状态码：' + code + (message ? '\n' + message : ''));
        }
        if (!Array.isArray(response.data)) {
            throw new CostError(context + '数据格式异常', '接口 data 不是数组。');
        }
        return response.data;
    }

    function requireApiList(response, context) {
        if (!response || response.code !== 0) {
            const code = response && response.code !== undefined ? response.code : '缺失';
            const message = response && (response.msg || response.message);
            throw new CostError(context + '接口异常', '业务状态码：' + code + (message ? '\n' + message : ''));
        }
        const data = response.data;
        if (data == null || data === '' || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0)) return [];
        const list = findNestedArray(data);
        if (list) return list;
        if (typeof data === 'object') {
            const keys = Object.keys(data).slice(0, 20).join(', ');
            throw new CostError(context + '数据格式异常', '接口 data 不是可识别的列表。响应字段：' + (keys || '无'));
        }
        throw new CostError(context + '数据格式异常', '接口 data 不是数组或列表对象。');
    }

    function requireMappingData(response, context) {
        if (!response || response.code !== 0) {
            const code = response && response.code !== undefined ? response.code : '缺失';
            const message = response && (response.msg || response.message);
            throw new CostError(context + '接口异常', '业务状态码：' + code + (message ? '\n' + message : ''));
        }
        const data = response.data;
        if (data == null || data === '' || (typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length === 0)) return [];
        const wrapped = findNestedArray(data);
        if (wrapped) return wrapped;
        if (data && typeof data === 'object') {
            const keys = Object.keys(data).slice(0, 20).join(', ');
            const platformSku = data.barcodeSkuid || data.barCodeSkuid || data.barCodeSkuId || data.barcodeSku || data.platformSku || data.platformSkuId || data.sku || data.skuId || data.sellerSku || data.skuCode;
            if (platformSku) return [data];
            throw new CostError(context + '数据格式异常', '未找到平台 SKU 列表或平台 SKU 字段。响应字段：' + (keys || '无'));
        }
        throw new CostError(context + '数据格式异常', '接口 data 为空或不是对象。');
    }

    async function mapConcurrent(items, limit, worker, run, onProgress) {
        const results = new Array(items.length);
        let cursor = 0;
        let completed = 0;
        let firstError = null;

        async function runner() {
            while (cursor < items.length && !firstError) {
                const index = cursor++;
                try {
                    results[index] = await worker(items[index], index);
                    completed += 1;
                    if (onProgress) onProgress(completed, items.length);
                } catch (error) {
                    if (!firstError) {
                        firstError = error;
                        run.controller.abort(error);
                    }
                    throw error;
                }
            }
        }

        const workerCount = Math.max(1, Math.min(limit, items.length));
        try {
            await Promise.all(Array.from({ length: workerCount }, runner));
        } catch (error) {
            throw firstError || error;
        }
        return results;
    }

    function parseDateInfo(value) {
        const text = String(value || '');
        const match = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (!match) return null;
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const dateValue = year * 10000 + month * 100 + day;
        let timestamp = Date.parse(text.replace(' ', 'T'));
        if (!Number.isFinite(timestamp)) timestamp = dateValue;
        return {
            text: year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0'),
            yearMonth: year * 100 + month,
            dateValue,
            timestamp
        };
    }

    function selectCostRecords(records) {
        const records1688 = records.filter((record) => record.order1688);
        return (records1688.length > 0 ? records1688 : records).slice(0, MAX_RECORDS);
    }

    function supplierName(record) {
        return String(record && (
            record.supplierName || record.supplier || record.supplierCompanyName || record.supplierFullName || record.supplierTitle
        ) || '').trim();
    }

    function supplierNameKey(value) {
        return String(value || '').normalize('NFKC').replace(/\s+/g, '').toLocaleUpperCase('zh-CN');
    }

    function captureSupplier1688UrlsFromPage() {
        document.querySelectorAll('a').forEach((anchor) => {
            const url = resultPolicy.extractSupplier1688Url({
                href: anchor.getAttribute('href'),
                resolvedHref: anchor.href,
                onclick: anchor.getAttribute('onclick'),
                dataHref: anchor.getAttribute('data-href'),
                dataUrl: anchor.getAttribute('data-url'),
                html: anchor.outerHTML
            });
            const key = supplierNameKey(anchor.textContent);
            if (url && key) supplier1688UrlsByName.set(key, url);
        });
    }

    function resolveSupplier1688Url(detail, order) {
        return resultPolicy.extractSupplier1688Url(detail)
            || resultPolicy.extractSupplier1688Url(order)
            || supplier1688UrlsByName.get(supplierNameKey(supplierName(detail)))
            || supplier1688UrlsByName.get(supplierNameKey(supplierName(order)))
            || '';
    }

    function withOrderContext(detail, order, purchaseOrderId) {
        return Object.assign({}, detail, {
            _purchaseOrderId: purchaseOrderId,
            _orderNo1688: String(order.purchaseOrderNo1688 || '').trim(),
            _purchaseOrderNo: String(order.purchaseOrderNo || '').trim(),
            _supplierName: supplierName(detail) || supplierName(order),
            _supplier1688Url: resolveSupplier1688Url(detail, order)
        });
    }

    function normalizeMappings(data) {
        return resultPolicy.normalizeMappings(data);
    }

    async function fetchAllOrders(filters, run) {
        setLoading('正在读取采购单', '读取第 1 页', 5);
        const capturedPageSize = Number(filters.limit);
        const fallbackPageSize = Number.isFinite(capturedPageSize) && capturedPageSize > 0 ? capturedPageSize : null;
        let pageSize = PREFERRED_PAGE_SIZE;
        let firstResponse;
        let usedFallback = false;
        try {
            firstResponse = await apiGetRetry(
                LIST_PATH,
                Object.assign({}, filters, { page: 1, limit: PREFERRED_PAGE_SIZE }),
                run.controller.signal,
                '采购列表第 1 页'
            );
        } catch (error) {
            if (!fallbackPageSize || fallbackPageSize === PREFERRED_PAGE_SIZE) throw error;
            usedFallback = true;
            pageSize = fallbackPageSize;
            firstResponse = await apiGetRetry(
                LIST_PATH,
                Object.assign({}, filters, { page: 1, limit: fallbackPageSize }),
                run.controller.signal,
                '采购列表第 1 页（回退页大小 ' + fallbackPageSize + '）'
            );
        }
        const firstPage = requireApiList(firstResponse, '采购列表第 1 页');
        const reportedCount = Number(firstResponse.count ?? firstResponse.total ?? firstResponse.totalCount);
        const hasReportedCount = Number.isFinite(reportedCount) && reportedCount > 0;
        const rowsPerPage = firstPage.length || pageSize;
        const reportedPageCount = hasReportedCount ? Math.max(1, Math.ceil(reportedCount / rowsPerPage)) : null;
        const allOrders = [];
        const uniqueOrders = new Map();
        let page = 1;
        let terminalPage = false;
        let completedPageCount = 0;
        const pageRowCounts = [];
        while (page <= MAX_LIST_PAGES) {
            const pageData = page === 1 ? firstPage : requireApiList(await apiGetRetry(
                LIST_PATH,
                Object.assign({}, filters, { page, limit: pageSize }),
                run.controller.signal,
                '采购列表第 ' + page + ' 页'
            ), '采购列表第 ' + page + ' 页');
            if (pageData.length === 0) {
                terminalPage = true;
                break;
            }
            pageRowCounts.push(pageData.length);
            let pageAdded = 0;
            pageData.forEach((order) => {
                const id = String(order && order.purchaseOrderId || '').trim();
                if (!id) throw new CostError('采购列表缺少订单 ID', '第 ' + page + ' 页存在没有 purchaseOrderId 的记录。');
                if (!uniqueOrders.has(id)) {
                    uniqueOrders.set(id, order);
                    allOrders.push(order);
                    pageAdded += 1;
                }
            });
            if (page > 1 && pageAdded === 0) {
                throw new CostError('采购列表分页未前进', '第 ' + page + ' 页与上一页返回了相同订单，分页参数可能未生效。');
            }
            completedPageCount = page;
            if (hasReportedCount && uniqueOrders.size >= reportedCount) {
                terminalPage = true;
                setLoading('正在读取采购单', '正在读取订单列表… ' + page + '/' + reportedPageCount + ' 页', 24);
                break;
            }
            page += 1;
            setLoading(
                '正在读取采购单',
                reportedPageCount ? '正在读取订单列表… ' + page + '/' + reportedPageCount + ' 页' : '正在读取订单列表… 第 ' + page + ' 页',
                hasReportedCount ? Math.min(24, 5 + Math.round((uniqueOrders.size / Math.max(reportedCount, 1)) * 19)) : Math.min(24, 5 + page * 2)
            );
        }
        if (!terminalPage) {
            throw new CostError(
                '采购列表分页超过安全上限',
                '已连续读取 ' + MAX_LIST_PAGES + ' 页仍未结束，请检查 ERP 的分页参数。'
            );
        }
        return {
            orders: allOrders,
            pageCount: completedPageCount,
            reportedCount: hasReportedCount ? reportedCount : null,
            countMismatch: hasReportedCount && uniqueOrders.size !== reportedCount,
            pageSize,
            pageSizeFallback: usedFallback,
            firstPageRowCount: pageRowCounts[0] || 0,
            maxReturnedPerPage: pageRowCounts.length > 0 ? Math.max(...pageRowCounts) : 0,
            pageRowCounts
        };
    }

    async function fetchAllDetails(orders, run) {
        const cancelledStatus = /(?:^|[\s:：])(?:11|cancel(?:led)?|void(?:ed)?|已取消|取消|已作废|作废|已关闭|关闭)(?:$|[\s:：])/i;
        const isCancelledOrder = (order) => {
            const values = [
                order && order.purchaseStatus,
                order && order.paymentStatus,
                order && order.payStatus,
                order && order.orderStatus,
                order && order.order1688Status,
                order && order.orderStatus1688,
                order && order.purchaseOrderStatus,
                order && order.status
            ];
            Object.keys(order || {}).forEach((key) => {
                if (/(status|state|状态)/i.test(key)) values.push(order[key]);
            });
            return values.some((value) => {
                const normalized = String(value || '').normalize('NFKC').trim();
                return normalized === '11' || cancelledStatus.test(normalized);
            });
        };
        captureSupplier1688UrlsFromPage();
        const validOrders = orders.filter((order) => !isCancelledOrder(order));
        setLoading('正在读取采购明细', '0 / ' + validOrders.length + ' 个订单', 26);
        const failedOrders = [];

        const detailGroups = await mapConcurrent(
            validOrders,
            MAX_CONCURRENT_DETAIL,
            async (order) => {
                const id = String(order.purchaseOrderId || '').trim();
                const cacheKey = 'detail_' + id;
                const cached = getCache(cacheKey);
                if (Array.isArray(cached)) return cached.map((detail) => withOrderContext(detail, order, id));
                try {
                    const response = await apiGetRetry(
                        DETAIL_PATH,
                        { purchaseOrderId: id, supplierId: order.supplierId || '' },
                        run.controller.signal,
                        '采购单 ' + (order.purchaseOrderNo || order.purchaseOrderNo1688 || id) + ' 明细'
                    );
                    const data = requireApiList(response, '采购单 ' + (order.purchaseOrderNo || id) + ' 明细');
                    const normalized = data.map((detail) => withOrderContext(detail, order, id));
                    setCache(cacheKey, normalized);
                    return normalized;
                } catch (error) {
                    if (run.controller.signal.aborted) throw error;
                    failedOrders.push({ id, no: order.purchaseOrderNo || order.purchaseOrderNo1688 || id, message: error.message || String(error) });
                    return [];
                }
            },
            run,
            (completed, total) => {
                const progress = 26 + Math.round((completed / Math.max(total, 1)) * 38);
                setLoading('正在读取采购明细', completed + ' / ' + total + ' 个订单', progress);
            }
        );

        return {
            details: detailGroups.flat(),
            validOrderCount: validOrders.length,
            skippedOrderCount: orders.length - validOrders.length,
            skippedCancelledOrderCount: orders.length - validOrders.length,
            failedOrders
        };
    }

    function aggregateDetails(details, now) {
        const currentYearMonth = now.getFullYear() * 100 + now.getMonth() + 1;
        const buckets = new Map();
        let skippedCurrentMonth = 0;
        let skippedInvalid = 0;

        details.forEach((detail) => {
            const warehouseSku = String(detail && detail.itemId || '').trim();
            const date = parseDateInfo(detail && detail.creationTime);
            const qty = Number.parseFloat(detail && detail.purchaseQuantity);
            const unitPrice = Number.parseFloat(detail && detail.purchaseUnitPrice);
            if (!warehouseSku || !date || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice)) {
                skippedInvalid += 1;
                return;
            }
            if (date.yearMonth === currentYearMonth) {
                skippedCurrentMonth += 1;
                return;
            }

            if (!buckets.has(warehouseSku)) buckets.set(warehouseSku, []);
            buckets.get(warehouseSku).push({
                warehouseSku,
                name: String(detail.tradeName || '').trim(),
                qty,
                unitPrice,
                totalPrice: qty * unitPrice,
                date: date.text,
                    dateValue: date.dateValue,
                    timestamp: date.timestamp,
                    order1688: String(detail._orderNo1688 || '').trim(),
                    purchaseOrderNo: String(detail._purchaseOrderNo || '').trim(),
                    purchaseOrderId: String(detail._purchaseOrderId || detail.purchaseOrderId || '').trim(),
                    supplierName: String(detail._supplierName || supplierName(detail) || '').trim(),
                    supplier1688Url: String(detail._supplier1688Url || resolveSupplier1688Url(detail, null) || '').trim()
                });
        });

        if (buckets.size === 0) {
            throw new CostError(
                '没有可用的历史采购明细',
                '当月记录会被排除；无日期、无 SKU 或数量不大于 0 的记录也不参与核算。'
            );
        }

        const results = [];
        buckets.forEach((records, warehouseSku) => {
            records.sort((a, b) => {
                if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
                return b.purchaseOrderId.localeCompare(a.purchaseOrderId, 'zh-CN', { numeric: true });
            });

            const selected = selectCostRecords(records);
            const totalQty = selected.reduce((sum, record) => sum + record.qty, 0);
            const totalPrice = selected.reduce((sum, record) => sum + record.totalPrice, 0);
            const newest = selected[0];
            const oldest = selected[selected.length - 1];
            const sourceType = newest.order1688 ? '1688' : '采购单';

            results.push({
                warehouseSku,
                name: newest.name || records[0].name || '',
                mappings: [],
                sourceType,
                orderNumber: newest.order1688 || newest.purchaseOrderNo || '',
                calcTimes: selected.length,
                dateRange: newest.date === oldest.date ? newest.date : oldest.date + ' ~ ' + newest.date,
                totalQty,
                totalPrice: totalPrice.toFixed(2),
                unitCost: (totalPrice / totalQty).toFixed(4),
                latestTimestamp: newest.timestamp,
                supplierName: newest.supplierName || '',
                supplier1688Url: selected.find((record) => record.supplier1688Url)?.supplier1688Url || '',
                details: selected.map((record) => ({
                    date: record.date,
                    orderNumber: record.order1688 || record.purchaseOrderNo || '',
                    sourceType: record.order1688 ? '1688' : '采购单',
                    qty: record.qty,
                    price: record.totalPrice.toFixed(2),
                    unitPrice: record.unitPrice.toFixed(4),
                    supplierName: record.supplierName,
                    supplier1688Url: record.supplier1688Url
                }))
            });
        });

        results.sort((a, b) => a.warehouseSku.localeCompare(b.warehouseSku, 'zh-CN', { numeric: true }));
        return { results, skippedCurrentMonth, skippedInvalid };
    }

    async function fetchMappings(results, run) {
        setLoading('正在读取平台 SKU 映射', '0 / ' + results.length + ' 个仓库 SKU', 66);
        const failedMappings = [];
        const mappings = await mapConcurrent(
            results,
            MAX_CONCURRENT_SKU,
            async (result) => {
                const context = '仓库 SKU ' + result.warehouseSku + ' 的平台映射';
                const cacheKey = 'mapping_' + result.warehouseSku;
                const cached = getCache(cacheKey);
                if (Array.isArray(cached)) {
                    const normalizedCached = normalizeMappings(cached);
                    if (normalizedCached.length > 0 || cached.length === 0) return { mappings: normalizedCached, failed: null };
                }
                try {
                    const response = await apiGetRetry(
                        SKU_PATH,
                        { productId: result.warehouseSku },
                        run.controller.signal,
                        context
                    );
                    const normalized = normalizeMappings(requireMappingData(response, context));
                    setCache(cacheKey, normalized);
                    return { mappings: normalized, failed: null };
                } catch (error) {
                    if (run.controller.signal.aborted) throw error;
                    const failure = {
                        warehouseSku: result.warehouseSku,
                        message: error.message || String(error)
                    };
                    failedMappings.push(failure);
                    return { mappings: [], failed: failure };
                }
            },
            run,
            (completed, total) => {
                const progress = 66 + Math.round((completed / Math.max(total, 1)) * 31);
                setLoading('正在读取平台 SKU 映射', completed + ' / ' + total + ' 个仓库 SKU', progress);
            }
        );
        results.forEach((result, index) => {
            const state = mappings[index] || { mappings: [] };
            result.mappings = state.mappings || [];
        });
        return { failedMappings };
    }

    async function runCalculation(filters, run) {
        const startedAt = Date.now();
        const now = new Date();
        const querySkcs = extractQuerySkcs(filters);
        const orderState = await fetchAllOrders(filters, run);
        const orders = orderState.orders;
        const detailState = await fetchAllDetails(orders, run);
        setLoading('正在计算数量加权成本', '排除当月并选择最近采购记录', 65);
        const aggregateState = aggregateDetails(detailState.details, now);
        const mappingState = await fetchMappings(aggregateState.results, run);
        const scopedState = resultPolicy.filterResultsByMappingScope(aggregateState.results, querySkcs);
        const resultMappings = scopedState.results.flatMap((item) => item.mappings || []);
        return {
            results: scopedState.results,
            meta: {
                filters,
                querySkcs,
                mappingScopeApplied: scopedState.scoped,
                excludedMappingCount: scopedState.excludedMappingCount,
                excludedWarehouseSkuCount: scopedState.excludedWarehouseSkuCount,
                orderCount: orders.length,
                orderPageCount: orderState.pageCount,
                pageSize: orderState.pageSize,
                pageSizeFallback: orderState.pageSizeFallback,
                firstPageRowCount: orderState.firstPageRowCount,
                maxReturnedPerPage: orderState.maxReturnedPerPage,
                pageRowCounts: orderState.pageRowCounts,
                reportedOrderCount: orderState.reportedCount,
                orderCountMismatch: orderState.countMismatch,
                validOrderCount: detailState.validOrderCount,
                skippedOrderCount: detailState.skippedOrderCount,
                skippedCancelledOrderCount: detailState.skippedCancelledOrderCount,
                detailCount: detailState.details.length,
                detailFailureCount: detailState.failedOrders.length,
                detailFailures: detailState.failedOrders,
                mappingFailureCount: mappingState.failedMappings.length,
                mappingFailures: mappingState.failedMappings,
                skippedCurrentMonth: aggregateState.skippedCurrentMonth,
                skippedInvalid: aggregateState.skippedInvalid,
                warehouseSkuCount: scopedState.results.length,
                platformSkuCount: resultMappings.length,
                platformSkcCount: new Set(resultMappings.map((item) => resultPolicy.canonical(item.platformSkc)).filter(Boolean)).size,
                durationMs: Date.now() - startedAt,
                excludedMonth: now.getFullYear() + '年' + (now.getMonth() + 1) + '月'
            }
        };
    }

    async function calculate() {
        if (activeRun) {
            activeRun.cancelledByUser = true;
            activeRun.controller.abort();
        }

        hideError();
        lastResults = [];
        lastMeta = null;
        updateActionState();
        renderResults();

        let filters;
        try {
            filters = parseCapturedFilters();
        } catch (error) {
            showError(error);
            return;
        }

        const run = {
            controller: new AbortController(),
            cancelledByUser: false
        };
        activeRun = run;
        setLoading('准备核算', '正在校验采购查询条件', 2);

        try {
        const state = await runCalculation(filters, run);
            if (run.cancelledByUser) return;
            lastResults = state.results;
            lastMeta = state.meta;
            setResultCache(lastResults, lastMeta, capturedListUrl);
            dispatchCostResults(lastResults, lastMeta);
            expandedRows.clear();
            setLoading('核算完成', '正在生成结果表', 100);
            renderResults();
            renderStatus();
            updateActionState();
            hideLoading();
            showToast('已完成 ' + lastResults.length + ' 个仓库 SKU 核算');
        } catch (error) {
            if (run.cancelledByUser || (error && error.name === 'AbortError')) {
                hideLoading();
                showToast('核算已取消');
            } else {
                console.error(PREFIX, error);
                hideLoading();
                showError(error);
            }
        } finally {
            if (activeRun === run) activeRun = null;
        }
    }

    function escapeHtml(value) {
        return String(value === undefined || value === null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function buildExportRows(results) {
        const rows = [];
        results.forEach((result) => {
            const mappings = result.mappings.length > 0 ? result.mappings : [{ platformSku: result.warehouseSku, platformSkc: '' }];
            mappings.forEach((mapping) => {
                rows.push({
                    warehouseSku: result.warehouseSku,
                    platformSku: mapping.platformSku,
                    platformSkc: mapping.platformSkc || '',
                    orderNumber: result.orderNumber,
                    sourceType: result.sourceType,
                    name: result.name,
                    calcTimes: result.calcTimes,
                    dateRange: result.dateRange,
                    totalQty: result.totalQty,
                    totalPrice: result.totalPrice,
                    unitCost: result.unitCost,
                    supplierName: result.supplierName || '',
                    supplier1688Url: result.supplier1688Url || ''
                });
            });
        });
        return rows;
    }

    function csvCell(value) {
        return '"' + String(value === undefined || value === null ? '' : value).replace(/"/g, '""') + '"';
    }

    async function copyCosts() {
        if (lastResults.length === 0) return;
        const lines = ['平台SKU\t平台SKC\t仓库SKU\t1688单号\t单件平均成本\t供应商1688链接'];
        buildExportRows(lastResults).forEach((row) => {
            lines.push([row.platformSku, row.platformSkc, row.warehouseSku, row.orderNumber, row.unitCost, row.supplier1688Url].join('\t'));
        });
        try {
            await navigator.clipboard.writeText(lines.join('\n'));
            showToast('已复制 ' + (lines.length - 1) + ' 条成本数据');
        } catch (error) {
            showError(new CostError('复制失败', '请检查 Chrome 的剪贴板权限。'));
        }
    }

    function exportCsv() {
        if (lastResults.length === 0) return;
        const headers = [
            '仓库SKU', '平台SKU', '平台SKC', '单号类型', '1688单号', '产品名称', '供应商', '供应商1688链接',
            '核算次数', '核算日期范围', '总采购量', '总采购价(￥)', '单件平均成本'
        ];
        const lines = [headers.map(csvCell).join(',')];
        buildExportRows(lastResults).forEach((row) => {
            lines.push([
                row.warehouseSku, row.platformSku, row.platformSkc, row.sourceType, row.orderNumber, row.name, row.supplierName, row.supplier1688Url,
                row.calcTimes, row.dateRange, row.totalQty, row.totalPrice, row.unitCost
            ].map(csvCell).join(','));
        });
        const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const now = new Date();
        link.href = url;
        link.download = 'SKU成本核算_' + now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '.csv';
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('已导出 ' + (lines.length - 1) + ' 条成本数据');
    }

    function getFilteredResults() {
        const words = searchText.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (words.length === 0) return lastResults;
        return lastResults.filter((result) => {
            const mappings = result.mappings.map((mapping) => [mapping.platformSku, mapping.platformSkc].filter(Boolean).join(' ')).join(' ');
            const haystack = [
                result.warehouseSku, result.name, result.orderNumber, result.sourceType, result.supplierName, result.supplier1688Url, mappings
            ].join(' ').toLowerCase();
            return words.every((word) => haystack.includes(word));
        });
    }

    function renderPlatformCell(result) {
        if (result.mappings.length === 0) {
            return '<span class="erpa-muted">未映射（使用仓库SKU兜底）</span>';
        }
        const firstMapping = result.mappings[0];
        const first = escapeHtml(firstMapping.platformSku) + '<br><span class="erpa-platform-skc">' + escapeHtml(firstMapping.platformSkc) + '</span>';
        const extra = result.mappings.length - 1;
        return first + (extra > 0 ? '<span class="erpa-platform-more">+' + extra + '</span>' : '');
    }

    function renderMappingList(result) {
        if (result.mappings.length === 0) return '';
        const visible = result.mappings.slice(0, 120).map((mapping) => (
            escapeHtml(mapping.platformSku) + ' <span class="erpa-platform-skc">· ' + escapeHtml(mapping.platformSkc) + '</span>'
        )).join(' &nbsp; ');
        const remainder = result.mappings.length - 120;
        return '<div style="margin-bottom:10px;color:#5f6d80;line-height:1.7;word-break:break-all;">' +
            '<strong>平台映射（SKU · SKC）：</strong>' + visible + (remainder > 0 ? ' · 其余 ' + remainder + ' 条请查看导出文件' : '') + '</div>';
    }

    function renderSupplier1688Link(url) {
        const normalized = resultPolicy.canonical1688Url(url);
        if (!normalized) return '<span class="erpa-muted">-</span>';
        return '<a class="erpa-offer-link" href="' + escapeHtml(normalized) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(normalized) + '</a>';
    }

    function renderDetail(result) {
        const rows = result.details.map((detail) => (
            '<tr><td>' + escapeHtml(detail.date) + '</td>' +
            '<td>' + escapeHtml(detail.sourceType) + '</td>' +
            '<td class="erpa-cell-order">' + escapeHtml(detail.orderNumber || '-') + '</td>' +
            '<td class="erpa-cell-number">' + escapeHtml(detail.qty) + '</td>' +
            '<td class="erpa-cell-number">' + escapeHtml(detail.price) + '</td>' +
            '<td class="erpa-cell-number erpa-cell-cost">' + escapeHtml(detail.unitPrice) + '</td>' +
            '<td>' + renderSupplier1688Link(detail.supplier1688Url) + '</td></tr>'
        )).join('');
        return '<tr class="erpa-detail-row"><td colspan="9"><div class="erpa-detail-wrap">' +
            renderMappingList(result) +
            '<table class="erpa-detail-table"><thead><tr><th>采购日期</th><th>单号类型</th><th>单号</th>' +
            '<th>数量</th><th>总价(￥)</th><th>单价(￥)</th><th>供应商1688链接</th></tr></thead><tbody>' + rows +
            '<tr class="erpa-detail-summary"><td>数量加权平均</td><td></td><td></td>' +
            '<td class="erpa-cell-number">' + escapeHtml(result.totalQty) + '</td>' +
            '<td class="erpa-cell-number">' + escapeHtml(result.totalPrice) + '</td>' +
            '<td class="erpa-cell-number erpa-cell-cost">' + escapeHtml(result.unitCost) + '</td>' +
            '<td>' + renderSupplier1688Link(result.supplier1688Url) + '</td></tr>' +
            '</tbody></table></div></td></tr>';
    }

    function renderResults() {
        const body = document.getElementById('erpa-table-body');
        const empty = document.getElementById('erpa-empty');
        const tableWrap = document.getElementById('erpa-table-wrap');
        if (!body || !empty || !tableWrap) return;

        const results = getFilteredResults();
        if (results.length === 0) {
            body.innerHTML = '';
            tableWrap.style.display = 'none';
            empty.style.display = 'grid';
            empty.textContent = lastResults.length === 0 ? '暂无核算结果' : '没有匹配的结果';
            return;
        }

        empty.style.display = 'none';
        tableWrap.style.display = 'block';
        body.innerHTML = results.map((result) => {
            const key = result.warehouseSku;
            const expanded = expandedRows.has(key);
            const row = '<tr class="erpa-result-row' + (expanded ? ' erpa-expanded' : '') + '" data-sku="' + escapeHtml(key) + '">' +
                '<td class="erpa-cell-sku" title="' + escapeHtml(key) + '">' + escapeHtml(key) + '</td>' +
                '<td class="erpa-cell-platform" title="' + escapeHtml(result.mappings.map((item) => item.platformSku + ' · ' + item.platformSkc).join(', ')) + '">' + renderPlatformCell(result) + '</td>' +
                '<td class="erpa-cell-order" title="' + escapeHtml(result.orderNumber) + '">' + escapeHtml(result.orderNumber || '-') + '</td>' +
                '<td title="' + escapeHtml(result.name) + '">' + escapeHtml(result.name || '-') + '</td>' +
                '<td class="erpa-cell-number">' + result.calcTimes + '</td>' +
                '<td>' + escapeHtml(result.dateRange) + '</td>' +
                '<td class="erpa-cell-number">' + escapeHtml(result.totalQty) + '</td>' +
                '<td class="erpa-cell-number">' + escapeHtml(result.totalPrice) + '</td>' +
                '<td class="erpa-cell-number erpa-cell-cost">' + escapeHtml(result.unitCost) + '</td></tr>';
            return row + (expanded ? renderDetail(result) : '');
        }).join('');
    }

    function splitFilterValues(value) {
        return String(value || '')
            .split(/[\s,，;；、]+/)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    function extractQuerySkcs(filters) {
        const source = filters && typeof filters === 'object' ? filters : {};
        const keys = ['sku', 'skc', 'platformSkc', 'platformSKC', 'platformSku', 'platformSKU'];
        for (const key of keys) {
            const values = splitFilterValues(source[key]);
            if (values.length > 0) return values;
        }
        return [];
    }

    function summarizeFilters(filters) {
        const parts = [];
        const candidates = [
            ['sku', 'SKU'], ['orderNo', '单号'], ['storeId', '店铺'],
            ['createTimePeriod', '时间'], ['purchaseStatus', '状态']
        ];
        candidates.forEach(([key, label]) => {
            if (!filters[key]) return;
            if (key === 'sku') {
                const values = splitFilterValues(filters[key]);
                if (values.length > 1) {
                    const preview = values.slice(0, 2).join('、');
                    parts.push(label + '：已选 ' + values.length + ' 个' + (preview ? '（' + preview + (values.length > 2 ? '…' : '') + '）' : ''));
                    return;
                }
            }
            parts.push(label + '：' + String(filters[key]).slice(0, 80) + (String(filters[key]).length > 80 ? '…' : ''));
        });
        return parts.length > 0 ? parts.join('  ·  ') : '当前采购查询未设置额外条件';
    }

    function renderStatus() {
        const status = document.getElementById('erpa-statusbar');
        const footerLeft = document.getElementById('erpa-footer-left');
        const footerRight = document.getElementById('erpa-footer-right');
        if (!status || !footerLeft || !footerRight) return;
        if (!lastMeta) {
            updateIdleStatus();
            footerLeft.textContent = '数据链路：采购列表 → 采购明细 → 平台 SKU/SKC 映射';
            footerRight.textContent = '严格完整性校验';
            return;
        }
        const incomplete = lastMeta.detailFailureCount > 0 || lastMeta.mappingFailureCount > 0;
        status.innerHTML =
            '<span class="erpa-status-item ' + (incomplete ? 'erpa-status-warn' : 'erpa-status-ok') + '"><strong>' +
            (incomplete ? '已完成，但结果可能不完整' : '完整性校验通过') +
            '</strong></span>' +
            '<span class="erpa-status-separator"></span>' +
            '<span class="erpa-status-item">仓库 SKU <strong>' + lastMeta.warehouseSkuCount + '</strong></span>' +
            '<span class="erpa-status-item">平台映射 <strong>' + lastMeta.platformSkuCount + '</strong></span>' +
            (lastMeta.mappingScopeApplied ? '<span class="erpa-status-item">精确范围 <strong>' + lastMeta.platformSkcCount + ' 个 SKC</strong></span>' : '') +
            '<span class="erpa-status-item">有效采购单 <strong>' + lastMeta.validOrderCount + '</strong></span>' +
            '<span class="erpa-status-item">明细 <strong>' + lastMeta.detailCount + '</strong></span>' +
            (lastMeta.skippedOrderCount ? '<span class="erpa-status-item erpa-status-warn">已排除作废单 <strong>' + lastMeta.skippedOrderCount + '</strong></span>' : '') +
            (lastMeta.skippedCurrentMonth ? '<span class="erpa-status-item erpa-status-warn">已排除当月明细 <strong>' + lastMeta.skippedCurrentMonth + '</strong></span>' : '') +
            (lastMeta.detailFailureCount ? '<span class="erpa-status-item erpa-status-warn">明细读取失败 <strong>' + lastMeta.detailFailureCount + '</strong></span>' : '') +
            (lastMeta.mappingFailureCount ? '<span class="erpa-status-item erpa-status-warn">平台映射失败 <strong>' + lastMeta.mappingFailureCount + '</strong></span>' : '') +
            (lastMeta.excludedMappingCount ? '<span class="erpa-status-item">已排除范围外映射 <strong>' + lastMeta.excludedMappingCount + '</strong></span>' : '') +
            (lastMeta.excludedWarehouseSkuCount ? '<span class="erpa-status-item">未命中仓库SKU <strong>' + lastMeta.excludedWarehouseSkuCount + '</strong></span>' : '') +
            '<span class="erpa-status-item">请求分页 <strong>' + (lastMeta.pageSize || PREFERRED_PAGE_SIZE) + ' 条/页</strong>' + (lastMeta.pageSizeFallback ? '（已回退）' : '') + '</span>' +
            '<span class="erpa-status-item">后台实际返回峰值 <strong>' + (lastMeta.maxReturnedPerPage || 0) + ' 条/页</strong></span>' +
            ((lastMeta.pageSize === PREFERRED_PAGE_SIZE && lastMeta.maxReturnedPerPage > 0 && lastMeta.maxReturnedPerPage < PREFERRED_PAGE_SIZE && lastMeta.reportedOrderCount && lastMeta.reportedOrderCount > lastMeta.maxReturnedPerPage)
                ? '<span class="erpa-status-item erpa-status-warn">ERP 可能将每页限制为 ' + lastMeta.maxReturnedPerPage + ' 条，速度受服务端分页上限影响</span>'
                : '') +
            (lastMeta.orderCountMismatch ? '<span class="erpa-status-item erpa-status-warn">ERP 总数参考值与实际页数据不同，已按分页结果完成读取</span>' : '');
        footerLeft.innerHTML = '筛选：<strong>' + escapeHtml(summarizeFilters(lastMeta.filters)) + '</strong>';
        footerRight.textContent = '排除' + lastMeta.excludedMonth + ' · 1688单号优先 · 最近' + MAX_RECORDS + '单加权 · ' + (lastMeta.durationMs / 1000).toFixed(1) + '秒' + (lastMeta.cacheRestored ? ' · 临时缓存恢复' : '');
    }

    function updateIdleStatus() {
        const status = document.getElementById('erpa-statusbar');
        if (!status || lastMeta) return;
        status.innerHTML = capturedListUrl ?
            '<span class="erpa-status-item erpa-status-ok"><strong>已捕获最近一次采购查询条件</strong></span>' :
            '<span class="erpa-status-item erpa-status-warn"><strong>等待采购页面查询</strong></span>';
    }

    function setLoading(title, meta, progress) {
        const loading = document.getElementById('erpa-loading');
        if (!loading) return;
        loading.classList.add('erpa-visible');
        document.getElementById('erpa-loading-title').textContent = title;
        document.getElementById('erpa-loading-meta').textContent = meta;
        document.getElementById('erpa-progress-bar').style.width = Math.max(2, Math.min(100, progress)) + '%';
    }

    function hideLoading() {
        const loading = document.getElementById('erpa-loading');
        if (loading) loading.classList.remove('erpa-visible');
    }

    function showError(error) {
        const panel = document.getElementById('erpa-error');
        if (!panel) return;
        panel.classList.add('erpa-visible');
        document.getElementById('erpa-error-title').textContent = error && error.message ? error.message : '核算失败';
        document.getElementById('erpa-error-message').textContent = error && error.details ? error.details : '';
    }

    function hideError() {
        const panel = document.getElementById('erpa-error');
        if (panel) panel.classList.remove('erpa-visible');
    }

    function showToast(message, type) {
        const panel = document.querySelector('#erpa-cost-root .erpa-panel');
        if (!panel) return;
        const existing = document.getElementById('erpa-toast');
        if (existing) existing.remove();
        const toast = document.createElement('div');
        toast.id = 'erpa-toast';
        toast.className = 'erpa-toast' + (type === 'error' ? ' erpa-toast-error' : '');
        toast.textContent = message;
        panel.appendChild(toast);
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => toast.remove(), 2600);
    }

    function updateActionState() {
        const disabled = lastResults.length === 0;
        const copy = document.getElementById('erpa-copy');
        const csv = document.getElementById('erpa-export');
        if (copy) copy.disabled = disabled;
        if (csv) csv.disabled = disabled;
    }

    function openPanel() {
        const root = document.getElementById('erpa-cost-root');
        if (!root) return;
        root.classList.add('erpa-open');
        renderStatus();
        if (lastResults.length === 0 && !activeRun) calculate();
    }

    function requestRecalculate() {
        if (activeRun) return;
        if (lastResults.length > 0 && !window.confirm('重新核算将重新读取 ERP 采购列表、明细和平台 SKU 映射，可能需要较长时间。确定继续吗？')) return;
        calculate();
    }

    function closePanel() {
        const root = document.getElementById('erpa-cost-root');
        if (root) root.classList.remove('erpa-open');
    }

    function createUi() {
        if (!document.body || document.getElementById('erpa-cost-trigger')) return;

        const trigger = document.createElement('button');
        trigger.id = 'erpa-cost-trigger';
        trigger.type = 'button';
        trigger.innerHTML = '<span class="erpa-trigger-icon" aria-hidden="true">▦</span><span>核算 SKU 成本</span>';
        trigger.addEventListener('click', openPanel);

        const root = document.createElement('div');
        root.id = 'erpa-cost-root';
        root.innerHTML =
            '<section class="erpa-panel" role="dialog" aria-modal="true" aria-label="SKU 采购成本核算">' +
                '<header class="erpa-header"><div class="erpa-title-wrap">' +
                    '<div class="erpa-title-line"><h2 class="erpa-title">SKU 采购成本核算</h2><span class="erpa-badge">API v8.0</span></div>' +
                    '<p class="erpa-subtitle">1688 单号决定成本记录，无 1688 记录时才使用采购单号</p></div>' +
                    '<button class="erpa-icon-button" id="erpa-close" type="button" title="关闭" aria-label="关闭">×</button></header>' +
                '<div class="erpa-toolbar">' +
                    '<input class="erpa-search" id="erpa-search" type="search" autocomplete="off" placeholder="搜索仓库 SKU、平台 SKU/SKC、产品名称或单号">' +
                    '<button class="erpa-button erpa-button-primary" id="erpa-recalculate" type="button"><b aria-hidden="true">↻</b><span>重新核算</span></button>' +
                    '<button class="erpa-button" id="erpa-copy" type="button"><b aria-hidden="true">⎘</b><span>复制成本</span></button>' +
                    '<button class="erpa-button" id="erpa-export" type="button"><b aria-hidden="true">⇩</b><span>导出 CSV</span></button></div>' +
                '<div class="erpa-statusbar" id="erpa-statusbar"></div>' +
                '<div class="erpa-table-wrap" id="erpa-table-wrap"><table class="erpa-table">' +
                    '<colgroup><col style="width:180px"><col style="width:175px"><col style="width:180px"><col style="width:220px">' +
                    '<col style="width:70px"><col style="width:150px"><col style="width:90px"><col style="width:105px"><col style="width:115px"></colgroup>' +
                    '<thead><tr><th>仓库 SKU</th><th>平台 SKU / SKC</th><th>1688 / 采购单号</th><th>产品名称</th>' +
                    '<th>次数</th><th>核算日期</th><th>采购量</th><th>采购价(￥)</th><th>平均成本(￥)</th></tr></thead>' +
                    '<tbody id="erpa-table-body"></tbody></table></div>' +
                '<div class="erpa-empty" id="erpa-empty">暂无核算结果</div>' +
                '<footer class="erpa-footer"><span id="erpa-footer-left"></span><span id="erpa-footer-right"></span></footer>' +
                '<div class="erpa-loading" id="erpa-loading"><div class="erpa-loading-box"><div class="erpa-spinner"></div>' +
                    '<p class="erpa-loading-title" id="erpa-loading-title"></p><p class="erpa-loading-meta" id="erpa-loading-meta"></p>' +
                    '<div class="erpa-progress-track"><div class="erpa-progress-bar" id="erpa-progress-bar"></div></div>' +
                    '<button class="erpa-button erpa-button-danger" id="erpa-cancel" type="button">取消核算</button></div></div>' +
                '<div class="erpa-error" id="erpa-error"><div class="erpa-error-box"><h3 class="erpa-error-title" id="erpa-error-title"></h3>' +
                    '<p class="erpa-error-message" id="erpa-error-message"></p><div class="erpa-error-actions">' +
                    '<button class="erpa-button" id="erpa-error-close" type="button">关闭</button>' +
                    '<button class="erpa-button erpa-button-primary" id="erpa-error-retry" type="button">重试</button></div></div></div>' +
            '</section>';

        document.body.appendChild(trigger);
        document.body.appendChild(root);

        const cachedResult = getResultCache();
        if (cachedResult) {
            lastResults = cachedResult.results;
            lastMeta = Object.assign({}, cachedResult.meta, { cacheRestored: true });
            if (cachedResult.capturedUrl) capturedListUrl = cachedResult.capturedUrl;
            window.setTimeout(() => dispatchCostResults(lastResults, lastMeta), 0);
        }

        document.getElementById('erpa-close').addEventListener('click', closePanel);
        document.getElementById('erpa-recalculate').addEventListener('click', requestRecalculate);
        document.getElementById('erpa-copy').addEventListener('click', copyCosts);
        document.getElementById('erpa-export').addEventListener('click', exportCsv);
        document.getElementById('erpa-cancel').addEventListener('click', () => {
            if (activeRun) {
                activeRun.cancelledByUser = true;
                activeRun.controller.abort();
            }
        });
        document.getElementById('erpa-error-close').addEventListener('click', hideError);
        document.getElementById('erpa-error-retry').addEventListener('click', requestRecalculate);
        document.getElementById('erpa-search').addEventListener('input', (event) => {
            searchText = event.target.value;
            renderResults();
        });
        document.getElementById('erpa-table-body').addEventListener('click', (event) => {
            const row = event.target.closest('.erpa-result-row');
            if (!row) return;
            const sku = row.getAttribute('data-sku');
            if (expandedRows.has(sku)) expandedRows.delete(sku);
            else expandedRows.add(sku);
            renderResults();
        });
        root.addEventListener('click', (event) => {
            if (event.target === root) closePanel();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !activeRun) closePanel();
        });

        updateActionState();
        renderStatus();
        renderResults();
    }

    function initWhenReady() {
        if (document.body) {
            createUi();
            schedulePageSizeUpgrade();
            return;
        }
        document.addEventListener('DOMContentLoaded', () => {
            createUi();
            schedulePageSizeUpgrade();
        }, { once: true });
    }

    function reportExtensionStatus() {
        if (!nativeFetch) return;
        nativeFetch(STATUS_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                extensionId: 'erp-assistant',
                version: EXTENSION_VERSION,
                pageUrl: window.location.href,
                ready: true,
                userAgent: navigator.userAgent
            })
        }).catch(() => {});
    }

    initWhenReady();
    schedulePageSizeUpgrade();
    reportExtensionStatus();
    window.setInterval(reportExtensionStatus, 30000);
    console.info(PREFIX, `v${EXTENSION_VERSION} 已在采购管理页面启动`);
}());
