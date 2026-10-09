(function () {
    'use strict';

    if (window.__erpAssistantCostV8) return;
    window.__erpAssistantCostV8 = true;

    const API_BASE = 'https://www.zhuolinkeji.cn';
    const LIST_PATH = '/purchase/purchase/v1/purchase-order-page';
    const DETAIL_PATH = '/purchase/purchase/v1/purchase-order-details';
    const SKU_PATH = '/purchase/product/v1/product-info-sku';
    const PURCHASE_PAGE_PATH = '/view/system/purchaseOrderModule/purchasingManagement.html';
    const MAX_RECORDS = 3;
    const MAX_CONCURRENT_DETAIL = 8;
    const MAX_CONCURRENT_SKU = 5;
    const REQUEST_TIMEOUT = 120000;
    const COST_STAGE_BUDGET_MS = 60 * 60 * 1000;
    const PREFERRED_PAGE_SIZE = 50;
    const RETRY_COUNT = 2;
    const CACHE_TTL = 10 * 60 * 1000;
    const RESULT_CACHE_TTL = 30 * 60 * 1000;
    const RESULT_CACHE_KEY = 'latest_cost_result_v7';
    const PREFIX = '[ERP Assistant]';
    const EXTENSION_VERSION = '8.0.39';
    const resultPolicy = window.ShopeersErpResultPolicy;
    const requestContextPolicy = window.ShopeersErpRequestContext;
    if (!resultPolicy || !requestContextPolicy) {
        console.error(PREFIX, '未加载成本结果或请求上下文规则模块，停止运行以避免导出未校验映射。');
        return;
    }

    const catalogCollector = window.ShopeersErpCatalogCollector?.create({ apiGet: apiGetRetry, readWarehouseEvidence, policy: resultPolicy, getCache, setCache, onProgress: (stage, completed, total, detail = {}) => {
        if (!activeRun) return;
        if (activeRun.readProgress?.label !== stage) beginReadProgress(activeRun, stage, total, detail.unit || '个目标');
        activeRun.readProgress.completed = completed;
        if (detail.lane != null) {
            if (detail.active === false) activeRun.readProgress.lanes.delete(detail.lane);
            else activeRun.readProgress.lanes.set(detail.lane, { title: detail.target, completed: detail.pagesDone ?? null, total: detail.pagesTotal ?? null, unit: '页' });
        } else if (completed === total) activeRun.readProgress.lanes.clear();
        setLoading(stage, activeRun.catalogPhase ? '资料最多30分钟，可取消；成本结果已保留' : '按已登记的平台 SKC/SKU 核对目标档案，可取消');
    } });

    const nativeFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
    let capturedListUrl = '';
    let capturedQueryCapturedAt = '';
    let activeRun = null;
    let lastResults = [];
    let lastMeta = null;
    let lastWarehouseEvidence = null;
    let searchText = '';
    let resultPage = 0;
    let toastTimer = null;
    let pageSizeObserver = null;
    let pageSizeObservedBody = null;
    let uiRepairObserver = null;
    let uiRepairTimer = null;
    let documentEventsBound = false;
    let bridgeConnection = 'connecting';
    let statusReportPending = false;
    let statusReportQueued = false;
    let currentPageUrl = window.location.href;
    let querySnapshotRestoreAllowed = isPurchasePage();
    let erpSessionState = 'unknown';
    // Evidence is isolated to this document and exact task. A restarted document
    // has no verified account/history continuity and must read authoritative APIs.
    const taskCache = new Map();
    let resumableCheckpoint = null;
    let checkpointMessage = '';
    let taskStage = '';
    let collectionTaskState = null;
    let requestSlots = 0;
    let requestTurns = 0;
    let requestLimit = 8;
    let throttleUntil = 0;
    const isTopFrame = window.top === window;
    const expandedRows = new Set();

    function supportedErpUrl(value) {
        try {
            const url = new URL(value, window.location.href);
            return url.protocol === 'https:' && (url.hostname === 'zhuolinkeji.cn' || url.hostname.endsWith('.zhuolinkeji.cn')) ? url : null;
        } catch { return null; }
    }

    function isPurchasePage() {
        return supportedErpUrl(window.location.href)?.pathname === PURCHASE_PAGE_PATH;
    }

    function needsLogin() {
        return erpSessionState === 'login_required' || /(?:^|\/)(?:login|signin)(?:[/.]|$)/i.test(window.location.pathname)
            || [...document.querySelectorAll('input[type="password"]')].some((input) => input.getClientRects().length > 0);
    }

    function activePurchaseFrame() {
        if (!isTopFrame || isPurchasePage()) return null;
        return [...document.querySelectorAll('iframe')].find((frame) => {
            if (!frame.getClientRects().length) return false;
            const style = window.getComputedStyle(frame);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            let url;
            try { url = supportedErpUrl(frame.contentWindow.location.href); } catch { url = supportedErpUrl(frame.getAttribute('src')); }
            return url?.pathname === PURCHASE_PAGE_PATH;
        }) || null;
    }

    function renderPageContext() {
        const status = document.getElementById('erpa-page-context');
        if (!status) return;
        const available = isPurchasePage() && !needsLogin();
        const connection = bridgeConnection === 'connected' ? '工作台已连接' : bridgeConnection === 'connecting' ? '正在连接工作台' : '工作台暂未连接，采集证据可由扩展后台保留';
        const condition = needsLogin() ? '请先登录 ERP，再打开采购管理查询。' : !available ? '请进入采购管理并查询，再预览 SKU 成本。' : capturedListUrl ? '采购查询已捕获，可采集成本证据。' : '请先在采购管理点击“查询”，再预览成本。';
        status.replaceChildren();
        const copy = document.createElement('span');
        copy.textContent = '助手已加载 · ' + connection + '。' + condition;
        status.appendChild(copy);
        if (!available && !needsLogin()) {
            const link = document.createElement('a');
            link.className = 'erpa-button';
            link.href = new URL(PURCHASE_PAGE_PATH, window.location.origin).href;
            link.textContent = '打开采购管理';
            status.appendChild(link);
        }
        const recalculate = document.getElementById('erpa-recalculate');
        if (recalculate) recalculate.disabled = !available || !capturedListUrl || Boolean(activeRun);
        const supplement = document.getElementById('erpa-supplement-catalog');
        if (supplement) supplement.disabled = !available || Boolean(activeRun) || !catalogCollector;
        const retry = document.getElementById('erpa-retry-delivery');
        if (retry) retry.disabled = !available;
        const resume = document.getElementById('erpa-resume');
        if (resume) { resume.hidden = !resumableCheckpoint && !collectionTaskState; resume.disabled = !available || Boolean(activeRun); }
        const task = document.getElementById('erpa-task-status');
        const failed = document.getElementById('erpa-retry-batches');
        if (failed) { failed.hidden = !collectionTaskState?.batches?.some(batch => ['failed', 'incomplete'].includes(batch.status)); failed.disabled = Boolean(activeRun); }
        if (task) task.textContent = taskStage || (resumableCheckpoint ? '待继续 · 列表进度 ' + resumableCheckpoint.completedTargets.length + '/' + resumableCheckpoint.platformSkcs.length + '；原账号未验证' : checkpointMessage);
    }

    function previewScopeLabel() {
        const period = resultPolicy.validLedgerPeriod(lastMeta?.ledgerPeriod);
        return period ? `台账月份：${period} · 采用当月及以前采购` : '台账月份待关联 · 暂不计算预览成本';
    }

    async function readPreviewContext(querySkcs, queryCapturedAt) {
        const bridge = window.ShopeersErpDeliveryBridge;
        if (!bridge?.previewContext) return { ledgerPeriod: null, message: '请更新扩展并从工作台选择台账后重新查询。' };
        const settled = await requestContextPolicy.settleRequestContext(bridge.previewContext({ querySkcs, queryCapturedAt }), 5000);
        const response = settled.context;
        return response?.ok && resultPolicy.validLedgerPeriod(response.ledgerPeriod)
            ? { ledgerPeriod: response.ledgerPeriod, requestId: response.requestId, platformSkcs: response.platformSkcs, expectedSkus: response.expectedSkus, requestSnapshot: response.requestSnapshot }
            : { ledgerPeriod: null, message: response?.message || settled.error?.message || '未取得唯一台账月份，请回工作台选择台账后重新查询。' };
    }

    async function restorePreviewContext(cached) {
        const marker = lastMeta;
        const context = await readPreviewContext(cached.meta?.querySkcs || extractQuerySkcs(cached.meta?.filters), cached.queryCapturedAt || cached.meta?.queryCapturedAt);
        if (activeRun || lastMeta !== marker) return;
        lastResults = resultPolicy.previewForLedger(cached.results, cached.warehouseEvidence, context.ledgerPeriod);
        lastMeta = { ...lastMeta, ...buildWarningMeta(lastResults), ledgerPeriod: context.ledgerPeriod, previewContextMessage: context.message };
        renderResults();
        renderStatus();
        renderAnomalyBanner();
    }

    class CostError extends Error {
        constructor(message, details) {
            super(message);
            this.name = 'CostError';
            this.details = details || '';
        }
    }

    function captureListRequest(rawUrl) {
        if (!rawUrl || !isPurchasePage()) return;
        try {
            const url = supportedErpUrl(rawUrl);
            if (url?.pathname === LIST_PATH) {
                taskCache.clear();
                capturedListUrl = url.href;
                capturedQueryCapturedAt = new Date().toISOString();
                const filters = {};
                url.searchParams.forEach((value, key) => { if (key !== 'page') filters[key] = value; });
                updateIdleStatus();
                renderPageContext();
                void reportExtensionStatus();
                schedulePageSizeUpgrade();
                console.info(PREFIX, '已捕获采购查询条件');
            }
        } catch (error) {
            console.warn(PREFIX, '无法解析采购请求 URL', error);
        }
    }

    window.addEventListener('shopeers:erp-v8-query-captured', (event) => {
        captureListRequest(event?.detail?.url);
    });

    function ensurePageSize50() {
        if (!isPurchasePage()) return false;
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
        if (!isPurchasePage()) return;
        if (ensurePageSize50()) return;
        if (!document.body || !window.MutationObserver) return;
        if (pageSizeObserver && pageSizeObservedBody !== document.body) {
            pageSizeObserver.disconnect();
            pageSizeObserver = null;
            pageSizeObservedBody = null;
        }
        if (pageSizeObserver) return;
        pageSizeObserver = new MutationObserver(() => {
            if (ensurePageSize50()) {
                pageSizeObserver.disconnect();
                pageSizeObserver = null;
                pageSizeObservedBody = null;
            }
        });
        pageSizeObservedBody = document.body;
        pageSizeObserver.observe(document.body, { childList: true, subtree: true });
        window.setTimeout(() => {
            if (!pageSizeObserver) return;
            if (ensurePageSize50()) {
                pageSizeObserver.disconnect();
                pageSizeObserver = null;
                pageSizeObservedBody = null;
            }
        }, 3000);
    }

    function parseCapturedFilters() {
        if (!isPurchasePage() || needsLogin() || !capturedListUrl) {
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

    function buildUrl(path, params, { preserveEmpty = false } = {}) {
        const url = new URL(path, API_BASE);
        Object.keys(params).forEach((key) => {
            const value = params[key];
            if ((value !== '' || preserveEmpty) && value !== undefined && value !== null) {
                url.searchParams.set(key, String(value));
            }
        });
        return url.href;
    }

    async function apiGet(path, params, parentSignal, context) {
        if (parentSignal?.aborted) throw parentSignal.reason || new DOMException('请求已中止', 'AbortError');
        if (parentSignal?.deadlineAt && Date.now() >= parentSignal.deadlineAt) throw new CostError('本批读取时间已到', '已完成结果保留；未完成证据需要继续读取。');
        if (parentSignal?.requestBudget != null && --parentSignal.requestBudget < 0) throw new CostError('本次资料请求预算已到', '已完成成本保持；再次补充资料时重新核验采购历史。');
        if (!nativeFetch) throw new CostError('当前页面不支持 fetch');

        const controller = new AbortController();
        let timedOut = false;
        const relayAbort = () => controller.abort(parentSignal.reason);
        if (parentSignal) {
            if (parentSignal.aborted) relayAbort();
            else parentSignal.addEventListener('abort', relayAbort, { once: true });
        }

        let rejectAbort;
        const aborted = new Promise((_, reject) => { rejectAbort = reject; });
        const onAbort = () => rejectAbort(controller.signal.reason || new DOMException('请求已中止', 'AbortError'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        if (controller.signal.aborted) onAbort();
        const slowId = window.setTimeout(() => setLoading('ERP 请求响应较慢', context + ' · 已等待8秒（每次最多120秒，可取消）'), 8000);
        const timeoutId = window.setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, REQUEST_TIMEOUT);

        try {
            const response = await Promise.race([nativeFetch(buildUrl(path, params), {
                credentials: 'include',
                signal: controller.signal,
                headers: {
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest'
                }
            }), aborted]);

            if (response.status === 401 || response.status === 403) { taskCache.clear(); erpSessionState = 'login_required'; throw Object.assign(new CostError('ERP 登录已失效', '请登录 ERP 并重新查询后重试。'), { code: 'ERP_LOGIN_REQUIRED' }); }
            if (!response.ok) {
                const error = new CostError(context + '请求失败', 'HTTP ' + response.status + ' ' + response.statusText);
                if (response.status === 429) {
                    const value = response.headers?.get?.('Retry-After');
                    const delay = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
                    error.retryAfter = Number.isFinite(delay) ? Math.max(0, delay) : 1000;
                    requestLimit = 2; throttleUntil = Math.max(throttleUntil, Date.now() + error.retryAfter);
                }
                throw error;
            }

            try {
                const body = await Promise.race([response.json(), aborted]);
                if (response.status === 401 || response.status === 403 || [401, 403].includes(Number(body?.code)) || /登录|login|session.*expired/i.test(String(body?.msg || body?.message || ''))) {
                    erpSessionState = 'login_required';
                    taskCache.clear();
                    throw Object.assign(new CostError('ERP 登录已失效', '请登录 ERP 并重新查询后重试。'), { code: 'ERP_LOGIN_REQUIRED' });
                }
                return body;
            } catch (error) {
                if (error instanceof CostError) throw error;
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
            window.clearTimeout(slowId);
            controller.signal.removeEventListener('abort', onAbort);
            if (parentSignal) parentSignal.removeEventListener('abort', relayAbort);
        }
    }

    function wait(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    async function apiGetRetry(path, params, parentSignal, context) {
        // Fast/cache-backed responses must still allow stop controls and budget
        // timers to run; an unbroken promise chain can starve browser events.
        if (++requestTurns % 32 === 0) await wait(0);
        let lastError = null;
        for (let attempt = 0; attempt <= RETRY_COUNT; attempt += 1) {
            if (parentSignal?.aborted) throw parentSignal.reason || new DOMException('核算已取消', 'AbortError');
            if (attempt) setLoading('请求较慢，正在重试', context + ' · 第 ' + attempt + '/' + RETRY_COUNT + ' 次重试（每次最多120秒，可取消）');
            try {
                while (requestSlots >= requestLimit || Date.now() < throttleUntil) {
                    if (parentSignal?.aborted) throw parentSignal.reason || new DOMException('请求已中止', 'AbortError');
                    if (activeRun?.pauseRequested) throw Object.assign(new CostError('采集已暂停'), { code: 'ERP_COLLECTION_PAUSED' });
                    await wait(Math.min(100, Math.max(10, throttleUntil - Date.now())));
                }
                if (activeRun?.pauseRequested) throw Object.assign(new CostError('采集已暂停'), { code: 'ERP_COLLECTION_PAUSED' });
                requestSlots += 1;
                renderReadProgress();
                try { return await apiGet(path, params, parentSignal, context); }
                finally { requestSlots -= 1; renderReadProgress(); }
            } catch (error) {
                lastError = error;
                if (parentSignal && parentSignal.aborted) throw error;
                if (!isRetryableError(error)) throw error;
                if (attempt < RETRY_COUNT) await wait(Math.min(1000, Math.max(500 * (attempt + 1), error.retryAfter || 0)));
            }
        }
        throw lastError;
    }

    function isRetryableError(error) {
        const text = String((error && error.message) || '') + ' ' + String((error && error.details) || '');
        return /超时|网络|连接|Failed to fetch|HTTP (429|5\d{2})/i.test(text);
    }

    function getCache(key) {
        const entry = taskCache.get(key);
        if (!entry || !activeRun && Date.now() - entry.timestamp > CACHE_TTL) return null;
        return entry.value;
    }

    function setCache(key, value) {
        taskCache.set(key, { timestamp: Date.now(), value });
    }

    async function refreshCheckpoint(force = false) {
        if (!isPurchasePage() || !window.ShopeersErpDeliveryBridge?.collectionCheckpoint) return;
        try {
            if (window.ShopeersErpDeliveryBridge.collectionTask) {
                const response = await window.ShopeersErpDeliveryBridge.collectionTask({ action: 'list' });
                if ((!activeRun || force) && response?.ok && Array.isArray(response.tasks)) {
                    collectionTaskState = response.tasks.find(task => !['stopped','completed','invalidated'].includes(task.status)) || null;
                    if (collectionTaskState) updateTaskStatus(collectionTaskState);
                }
            }
            const response = await window.ShopeersErpDeliveryBridge.collectionCheckpoint({ action: 'list' });
            if (activeRun && !force) return;
            resumableCheckpoint = response?.ok ? response.records?.[0] || null : null;
            renderPageContext();
        } catch { /* Offline collection remains available; no false saved claim. */ }
    }

    async function saveCheckpoint(run, state = 'pending', rotateDelivery = false) {
        if (!run.requestId) return;
        if (!run.requestSnapshot || !window.ShopeersErpDeliveryBridge?.collectionCheckpoint) throw new CostError('采集请求快照未保存', '请重新查询；当前结果不能自动回传。');
        try {
            const response = await window.ShopeersErpDeliveryBridge.collectionCheckpoint({ action: run.restartCheckpoint ? 'restart' : 'save', requireFresh: !run.resultDeliveryId && !run.restartCheckpoint, previousDeliveryId: run.previousDeliveryId, requestId: run.requestId, requestSnapshot: run.requestSnapshot, resultDeliveryId: run.resultDeliveryId, rotateDelivery, filters: run.filters, queryCapturedAt: run.queryCapturedAt, completedTargets: run.completedTargets || [], state });
            if (response?.ok && response.checkpoint) { run.resultDeliveryId = response.checkpoint.resultDeliveryId; run.restartCheckpoint = false; resumableCheckpoint = state === 'completed' ? null : response.checkpoint; checkpointMessage = ''; }
            else throw new CostError('采集请求快照未保存', response?.message || '请重新查询；当前结果不能自动回传。');
        } catch (error) {
            checkpointMessage = error.details || error.message || '检查点尚未保存；请重新查询';
            throw error instanceof CostError ? error : new CostError('采集请求快照未保存', checkpointMessage);
        }
    }

    async function resumeCollection() {
        if (activeRun || needsLogin()) return;
        if (collectionTaskState) {
            try {
                const task = (await taskOperation({ action: 'control', taskId: collectionTaskState.taskId, control: 'resume', filters: collectionTaskState.filters })).task;
                capturedListUrl = buildUrl(LIST_PATH, task.filters, { preserveEmpty: true });
                capturedQueryCapturedAt = task.queryCapturedAt;
                await calculate(task.requestId, false, null, null, null, task);
            } catch (error) { showError(error); }
            return;
        }
        if (!resumableCheckpoint) return;
        const pending = resumableCheckpoint;
        try {
            const response = await window.ShopeersErpDeliveryBridge.collectionCheckpoint({ action: 'restore', requestId: pending.requestId, filters: capturedListUrl ? parseCapturedFilters() : undefined });
            if (!response?.ok || !response.checkpoint) throw new CostError('未完成采集已失效', response?.message || '请回工作台重新发起采集。');
            const checkpoint = response.checkpoint;
            if (response.pendingDeliveryId) {
                taskStage = '送达中 · 重试已保留证据'; renderPageContext();
                const delivery = await window.ShopeersErpDeliveryBridge.retry(response.pendingDeliveryId);
                taskStage = delivery?.status === 'success' ? '已送达 · 待工作台采用' : '待送达 · 已保留';
                await refreshCheckpoint(); renderPageContext();
                return;
            }
            taskCache.clear();
            // Restore the exact captured defaults too. API reads omit blank
            // parameters, but stripping them here would change the bound query
            // on the first post-restart checkpoint save.
            capturedListUrl = buildUrl(LIST_PATH, checkpoint.filters, { preserveEmpty: true });
            capturedQueryCapturedAt = checkpoint.queryCapturedAt;
            checkpointMessage = '当前登录会话重新读取；原账号未验证';
            showToast(checkpointMessage);
            await calculate(checkpoint.requestId, false, null, null, checkpoint.resultDeliveryId);
        } catch (error) { resumableCheckpoint = null; showError(error); renderPageContext(); }
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

    function makeResultDeliveryId() {
        const random = globalThis.crypto?.randomUUID?.() || (Date.now() + '-' + Math.random().toString(16).slice(2));
        return 'ERP-RESULT-' + random;
    }

    function setResultCache(results, meta, warehouseEvidence, capturedUrl, resultDeliveryId, deliveryState = {}) {
        try {
            const queryCapturedAt = String(deliveryState.queryCapturedAt || deliveryState.registeredBefore || meta?.queryCapturedAt || meta?.registeredBefore || '').trim();
            window.localStorage.setItem('erpAssistantV8_' + RESULT_CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                results,
                meta,
                warehouseEvidence,
                capturedUrl: capturedUrl || '',
                resultDeliveryId,
                createdAt: String(deliveryState.createdAt || '').trim() || new Date().toISOString(),
                queryCapturedAt,
                registeredBefore: queryCapturedAt,
                attemptsTotal: Math.max(0, Number(deliveryState.attemptsTotal || 0)),
                deliveryTerminal: Boolean(deliveryState.deliveryTerminal),
                importEnvelope: deliveryState.importEnvelope || null
            }));
        } catch {
            // Large result sets or disabled storage must not block核算。
        }
    }

    let lastImportEnvelope = null;
    function handleDeliveryStatus(detail = {}) {
        if (detail.resultDeliveryId) {
            const cached = getResultCache();
            if (cached && cached.resultDeliveryId === detail.resultDeliveryId) {
                if (detail.envelope) lastImportEnvelope = detail.envelope;
                setResultCache(cached.results, cached.meta, cached.warehouseEvidence, cached.capturedUrl, cached.resultDeliveryId, {
                    createdAt: detail.createdAt || cached.createdAt,
                    queryCapturedAt: detail.queryCapturedAt || detail.registeredBefore || cached.queryCapturedAt || cached.registeredBefore,
                    attemptsTotal: Math.max(Number(cached.attemptsTotal || 0), Number(detail.attemptsTotal || 0)),
                    deliveryTerminal: Boolean(cached.deliveryTerminal || detail.status === 'success' || detail.status === 'failed'),
                    importEnvelope: detail.envelope || cached.importEnvelope || null,
                });
            } else return;
        }
        const messages = {
            sending: '正在回传 Lworkstation 成本证据',
            success: '已送达 · 待工作台采用',
            cached: '回传暂未成功，已缓存等待有限补发',
            failed: '成本证据回传失败，后台保留待处理证据'
        };
        const message = detail.message || messages[detail.status];
        taskStage = detail.status === 'success' ? '已送达 · 待工作台采用' : detail.status === 'sending' ? '送达中' : detail.status === 'cached' ? '待送达 · 已保留' : '送达未完成';
        renderPageContext();
        if (message) showToast(message, detail.status === 'failed' ? 'error' : undefined);
    }

    function dispatchCostResults(results, meta, warehouseEvidence, resultDeliveryId, deliveryState = {}, run = null) {
        if (!Array.isArray(results)) return;
        if (!run?.requestId || !run.requestSnapshot || !run.resultDeliveryId) return false;
        const bridge = window.ShopeersErpDeliveryBridge;
        if (!bridge || typeof bridge.submit !== 'function') {
            console.warn(PREFIX, '隔离投递桥尚未就绪，本地预览、复制和 CSV 仍可使用。');
            return false;
        }
        const deliveryMeta = requestContextPolicy.deliverySourceMeta(meta);
        const queryCapturedAt = String(deliveryState.queryCapturedAt || deliveryState.registeredBefore || deliveryMeta.queryCapturedAt || deliveryMeta.registeredBefore || '').trim();
        handleDeliveryStatus({ status: 'sending', resultDeliveryId });
        void bridge.submit({
            results,
            meta: deliveryMeta,
            warehouseEvidence,
            resultDeliveryId,
            querySkcs: Array.isArray(deliveryMeta.querySkcs) ? deliveryMeta.querySkcs : [],
            createdAt: String(deliveryState.createdAt || '').trim(),
            queryCapturedAt,
            registeredBefore: queryCapturedAt
        }).then(async response => {
            handleDeliveryStatus(response);
            // The background owns ACK retirement/rotation. Refreshing UI state
            // must not rotate twice or turn a durable ACK into a failed delivery.
            await refreshCheckpoint(true);
            if (run && !run.costEvidenceComplete && response?.status === 'success') {
                taskStage = '待继续 · 采购或映射证据未齐';
            }
            renderPageContext();
        }, (error) => handleDeliveryStatus({
            status: 'cached',
            resultDeliveryId,
            message: error?.message || '隔离投递通道暂不可用，后台缓存会按上限补发。'
        }));
        return true;
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

        async function runner(laneIndex) {
            while (cursor < items.length && !firstError && !run.controller.signal.aborted) {
                const index = cursor++;
                try {
                    results[index] = await worker(items[index], index, laneIndex);
                    completed += 1;
                    if (onProgress) onProgress(completed, items.length);
                } catch (error) {
                    if (!firstError) {
                        firstError = error;
                        if (error.code !== 'ERP_COLLECTION_PAUSED') run.controller.abort(error);
                    }
                    throw error;
                }
            }
        }

        const workerCount = Math.max(1, Math.min(limit, items.length));
        try {
            const settled = await Promise.allSettled(Array.from({ length: workerCount }, (_, index) => runner(index)));
            if (firstError) throw firstError;
            if (settled.some(item => item.status === 'rejected')) throw settled.find(item => item.status === 'rejected').reason;
        } catch (error) {
            throw firstError || error;
        }
        if (run.controller.signal.aborted) throw run.controller.signal.reason || new DOMException('核算已取消', 'AbortError');
        return results;
    }

    function parseDateInfo(value) {
        return resultPolicy.purchaseDateInfo(value);
    }

    function selectCostRecords(records) {
        return records.slice(0, MAX_RECORDS);
    }

    function warningReasons(detail) {
        return Array.isArray(detail && detail.warningReasons)
            ? detail.warningReasons.filter(Boolean)
            : [];
    }

    function formatWarningReasons(reasons) {
        return (Array.isArray(reasons) ? reasons : [])
            .map((reason) => resultPolicy.costWarningLabel(reason))
            .filter(Boolean)
            .join('；');
    }

    function resultCostWarnings(result) {
        if (result && result.costWarnings) return result.costWarnings;
        return resultPolicy.summarizeCostWarnings(result && result.details);
    }

    function buildWarningMeta(results) {
        const summaries = (Array.isArray(results) ? results : []).map(resultCostWarnings);
        return {
            costWarningCount: summaries.reduce((sum, summary) => sum + Number(summary.count || 0), 0)
        };
    }

    function supplierName(record) {
        return String(record && (
            record.supplierName || record.supplier || record.supplierCompanyName || record.supplierFullName || record.supplierTitle
        ) || '').trim();
    }

    function supplierNameKey(value) {
        return String(value || '').normalize('NFKC').replace(/\s+/g, '').toLocaleUpperCase('zh-CN');
    }

    function resolveSupplier1688Links(detail, order) {
        const detailName = supplierName(detail);
        const orderName = supplierName(order);
        const name = detailName || orderName;
        if (!detail) return resultPolicy.extractSupplier1688Links(order, orderName);
        // An order can contain several products from one supplier. Product links
        // belong to this detail, never to another row found by supplier name.
        return resultPolicy.normalizeSupplier1688Links([
            { type: 'product', url: detail.productLink1688, supplierName: name },
            { type: 'product', url: detail.purchasingLink1688, supplierName: name },
            ...resultPolicy.extractSupplier1688Links(detail, name),
            ...(name && supplierNameKey(name) === supplierNameKey(orderName)
                ? resultPolicy.extractSupplier1688Links(order, orderName).filter(link => link.type === 'store') : []),
        ]);
    }

    function resolveSupplier1688Url(detail, order) {
        const name = supplierNameKey(supplierName(detail) || supplierName(order));
        const links = resolveSupplier1688Links(detail, order).filter(link => supplierNameKey(link.supplierName) === name);
        return links.find(link => link.type === 'product')?.url || '';
    }

    function withOrderContext(detail, order, purchaseOrderId) {
        return Object.assign({}, detail, {
            _purchaseOrderId: purchaseOrderId,
            _orderNo1688: String(order.purchaseOrderNo1688 || '').trim(),
            _purchaseOrderNo: String(order.purchaseOrderNo || '').trim(),
            _supplierName: supplierName(detail) || supplierName(order),
            _supplier1688Url: resolveSupplier1688Url(detail, order),
            _supplier1688Links: resolveSupplier1688Links(detail, order),
            _orderStatusFields: resultPolicy.purchaseStatusFields(order),
        });
    }

    function normalizeMappings(data) {
        return resultPolicy.normalizeMappings(data);
    }

    function completeHistoryFilters(filters, warehouseSku = null) {
        const sku = String(warehouseSku || filters?.sku || '').trim();
        if (!sku) throw new CostError('采购历史缺少商品范围', '请先按目标 SKC 或仓库 SKU 查询；完整历史不会扫描全部公司商品。');
        // These are the field names observed in the ERP purchase query. Keep the
        // selected store, expand time/status restrictions, and bound pagination.
        return { ...filters, sku, queryRange: '0', createTimePeriod: '', orderNo: '', supplierName: '', organizationName: '', createdBy: '', warehouseId: '0', paymentType: '0', paymentStatus: '0', purchaseStatus: '',
            exceptionSheetStatus: '', tradeName: '', inTransitTime: '', exceptionHandlingStatus: '', emergencySign: '', purchasingPersonnel: '',
            accountName1688: '', storeAssociatedAccountName1688: '', suggestedPayment: '', orderType: '', buildType: '', mineableType: '', adjacentToTheSameSupplier: '0', sort: '' };
    }

    async function fetchAllOrders(filters, run) {
        if (run.controller.signal.aborted) throw run.controller.signal.reason || new DOMException('核算已取消', 'AbortError');
        const snapshotKey = 'purchase_pages_v2_' + JSON.stringify([run.requestId || run.queryCapturedAt || '', run.ledgerPeriod || '', filters]);
        const complete = getCache(snapshotKey + ':complete');
        if (complete?.countMismatch === false && Array.isArray(complete.orders)) {
            run.onPurchasePage?.(complete.pageCount, complete.pageCount, '复用已读齐采购 · ' + complete.orders.length + ' 个订单');
            return complete;
        }
        run.onPurchasePage?.(0, null, '正在读取第 1 页 · 总页数待 ERP 返回');
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
            if (run.controller.signal.aborted || !fallbackPageSize || fallbackPageSize === PREFERRED_PAGE_SIZE || !/HTTP 400|HTTP 422/.test(error.details || '')) throw error;
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
        const rawCount = firstResponse.count ?? firstResponse.total ?? firstResponse.totalCount;
        const reportedCount = rawCount == null || rawCount === '' ? NaN : Number(rawCount);
        if (rawCount != null && rawCount !== '' && (!Number.isInteger(reportedCount) || reportedCount < 0)) throw new CostError('采购列表总数无效', '请重试ERP查询，不能以异常总数判定读取完整。');
        const hasReportedCount = Number.isFinite(reportedCount) && reportedCount >= 0;
        const rowsPerPage = firstPage.length || pageSize;
        const reportedPageCount = hasReportedCount ? Math.max(1, Math.ceil(reportedCount / rowsPerPage)) : null;
        const allOrders = [];
        const uniqueOrders = new Map();
        let page = 1;
        let terminalPage = false;
        let completedPageCount = 0;
        const pageRowCounts = [];
        const firstFingerprint = JSON.stringify(firstResponse);
        const previous = getCache(snapshotKey);
        const cacheRevision = previous?.firstFingerprint === firstFingerprint ? previous.revision : String(Date.now());
        setCache(snapshotKey, { firstFingerprint, revision: cacheRevision });
        while (true) {
            if (run.controller.signal.aborted) throw run.controller.signal.reason || new DOMException('核算已取消', 'AbortError');
            // A matching first page proves nothing about a changed later page.
            // Partial targets always re-read every page before becoming complete.
            const pageResponse = page === 1 ? firstResponse : await apiGetRetry(
                LIST_PATH,
                Object.assign({}, filters, { page, limit: pageSize }),
                run.controller.signal,
                '采购列表第 ' + page + ' 页'
            );
            const pageData = requireApiList(pageResponse, '采购列表第 ' + page + ' 页');
            const currentCount = Number(pageResponse.count ?? pageResponse.total ?? pageResponse.totalCount);
            if (hasReportedCount && currentCount !== reportedCount) throw new CostError('采购列表数量已变化', '请重新查询后重试；未完成结果不会覆盖已有成本。');
            if (pageData.length === 0) {
                run.onPurchasePage?.(page, reportedPageCount, '已读 ' + uniqueOrders.size + ' 个订单');
                if (!hasReportedCount || uniqueOrders.size === reportedCount) setCache(snapshotKey + ':' + cacheRevision + ':' + page, pageResponse);
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
            if (hasReportedCount && uniqueOrders.size > reportedCount) throw new CostError('采购列表数量不一致', '返回订单超过接口声明总数，请重新查询；不能将变化中的记录作为完整证据。');
            setCache(snapshotKey + ':' + cacheRevision + ':' + page, pageResponse);
            completedPageCount = page;
            run.onPurchasePage?.(page, reportedPageCount, '已读 ' + uniqueOrders.size + ' 个订单');
            if (hasReportedCount && uniqueOrders.size >= reportedCount) {
                terminalPage = true;
                break;
            }
            page += 1;
        }
        const completed = {
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
        if (!completed.countMismatch) setCache(snapshotKey + ':complete', completed);
        return completed;
    }

    async function fetchAllDetails(orders, run) {
        const orderStatusValues = (order) => {
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
            return [...new Set(values.map((value) => String(value || '').normalize('NFKC').trim()).filter(Boolean))];
        };
        const isCancelledOrder = (order) => {
            return resultPolicy.cancelledPurchase(Object.fromEntries(Object.entries(order || {}).filter(([key]) => /(status|state|状态)/i.test(key))));
        };
        const validOrders = orders.filter((order) => !isCancelledOrder(order));
        const excludedOrders = orders.filter(isCancelledOrder).map((order) => ({
            recordId: 'excluded-order:' + String(order && order.purchaseOrderId || '').trim(),
            purchaseOrderId: String(order && order.purchaseOrderId || '').trim(),
            purchaseOrderNo: String(order && order.purchaseOrderNo || '').trim(),
            order1688: String(order && order.purchaseOrderNo1688 || '').trim(),
            warehouseSku: String(order && (order.itemId || order.warehouseSku || order.skuCode || order.sku) || '').trim(),
            supplierName: supplierName(order),
            supplier1688Url: resolveSupplier1688Url(null, order),
            statusValues: orderStatusValues(order),
            statusFields: resultPolicy.purchaseStatusFields(order),
            eligible: false,
            exclusionReasons: ['cancelled_or_closed']
        }));
        if (!run.catalogPhase) beginReadProgress(run, '采购明细', validOrders.length, '个订单');
        const failedOrders = [];

        const detailGroups = await mapConcurrent(
            validOrders,
            MAX_CONCURRENT_DETAIL,
            async (order, index, lane) => {
                const id = String(order.purchaseOrderId || '').trim();
                const cacheKey = 'detail_' + id;
                const cached = getCache(cacheKey);
                if (Array.isArray(cached)) return cached.map((detail) => withOrderContext(detail, order, id));
                if (!run.catalogPhase) setReadLane(run, lane, { title: '采购单 ' + (order.purchaseOrderNo || id) });
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
                    if (run.controller.signal.aborted || ['ERP_LOGIN_REQUIRED', 'ERP_COLLECTION_PAUSED'].includes(error.code)) throw error;
                    failedOrders.push({ id, no: order.purchaseOrderNo || order.purchaseOrderNo1688 || id, message: error.message || String(error) });
                    return [];
                } finally {
                    if (!run.catalogPhase) run.readProgress.lanes.delete(lane);
                }
            },
            run,
            (completed, total) => {
                if (!run.catalogPhase) {
                    run.readProgress.completed = completed;
                    run.readProgress.failures = failedOrders.length;
                    setLoading('采购明细', '');
                }
            }
        );

        return {
            details: detailGroups.flat(),
            validOrderCount: validOrders.length,
            skippedOrderCount: orders.length - validOrders.length,
            skippedCancelledOrderCount: orders.length - validOrders.length,
            excludedOrders,
            failedOrders
        };
    }

    function aggregateDetails(details, { allowEmpty = false } = {}) {
        const buckets = new Map();
        const excludedDetails = [];
        let skippedInvalid = 0;

        details.forEach((detail, detailIndex) => {
            const warehouseSku = String(detail && detail.itemId || '').trim();
            const date = parseDateInfo(detail && detail.creationTime);
            const qty = Number.parseFloat(detail && detail.purchaseQuantity);
            const unitPrice = Number.parseFloat(detail && detail.purchaseUnitPrice);
            const purchaseCatalog = resultPolicy.purchaseCatalogFromDetail(detail);
            const evidenceBase = {
                recordId: String(detail.detailId || detail.purchaseOrderDetailId || detail.id || ((detail._purchaseOrderId || detail.purchaseOrderId || 'order') + ':' + detailIndex)).trim(),
                warehouseSku,
                name: String(detail.tradeName || '').trim(),
                imageUrl: resultPolicy.purchaseImageUrl(detail),
                attribute: resultPolicy.catalogText(detail.attribute),
                ...(purchaseCatalog ? { purchaseCatalog } : {}),
                quantity: Number.isFinite(qty) ? qty : null,
                unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
                totalPrice: Number.isFinite(qty) && Number.isFinite(unitPrice) ? qty * unitPrice : null,
                purchaseDate: date ? date.text : String(detail && detail.creationTime || '').trim(),
                order1688: String(detail._orderNo1688 || '').trim(),
                purchaseOrderNo: String(detail._purchaseOrderNo || '').trim(),
                purchaseOrderId: String(detail._purchaseOrderId || detail.purchaseOrderId || '').trim(),
                supplierName: String(detail._supplierName || supplierName(detail) || '').trim(),
                supplier1688Url: String(detail._supplier1688Url || resolveSupplier1688Url(detail, null) || '').trim(),
                supplier1688Links: resultPolicy.normalizeSupplier1688Links(detail._supplier1688Links || resolveSupplier1688Links(detail, null)),
                statusFields: { ...detail._orderStatusFields, ...resultPolicy.purchaseStatusFields(detail) },
                eligible: false,
                selectedForPreview: false,
                exclusionReasons: []
            };
            if (resultPolicy.cancelledPurchase(evidenceBase.statusFields)) {
                excludedDetails.push(Object.assign({}, evidenceBase, { exclusionReasons: ['cancelled_or_closed'] }));
                return;
            }
            if (!warehouseSku || !date || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
                skippedInvalid += 1;
                excludedDetails.push(Object.assign({}, evidenceBase, { exclusionReasons: ['invalid_purchase_detail'] }));
                return;
            }
            if (!buckets.has(warehouseSku)) buckets.set(warehouseSku, []);
            buckets.get(warehouseSku).push({
                recordId: evidenceBase.recordId,
                warehouseSku,
                name: evidenceBase.name,
                imageUrl: evidenceBase.imageUrl,
                attribute: evidenceBase.attribute,
                ...(purchaseCatalog ? { purchaseCatalog } : {}),
                qty,
                unitPrice,
                totalPrice: qty * unitPrice,
                date: date.text,
                dateValue: date.dateValue,
                timestamp: date.timestamp,
                order1688: evidenceBase.order1688,
                purchaseOrderNo: evidenceBase.purchaseOrderNo,
                purchaseOrderId: evidenceBase.purchaseOrderId,
                supplierName: evidenceBase.supplierName,
                supplier1688Url: evidenceBase.supplier1688Url,
                supplier1688Links: evidenceBase.supplier1688Links,
                statusFields: evidenceBase.statusFields
            });
        });

        if (buckets.size === 0 && !allowEmpty) {
            throw new CostError(
                '没有可用的采购明细',
                '无日期、无 SKU、数量不大于 0 或单价无效的记录不参与预览；账本月末截止范围待工作台筛选。'
            );
        }

        const results = [];
        const warehouses = [];
        buckets.forEach((records, warehouseSku) => {
            records.sort((a, b) => {
                if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
                return b.purchaseOrderId.localeCompare(a.purchaseOrderId, 'zh-CN', { numeric: true });
            });

            const annotatedRecords = resultPolicy.annotateCostWarnings(records);
            const selected = selectCostRecords(annotatedRecords);
            const selectedRecords = new Set(selected);
            const totalQty = selected.reduce((sum, record) => sum + record.qty, 0);
            const totalPrice = selected.reduce((sum, record) => sum + record.totalPrice, 0);
            const newest = selected[0];
            const oldest = selected[selected.length - 1];
            const sourceTypes = new Set(selected.map((record) => record.order1688 ? '1688' : '采购单'));
            const sourceType = sourceTypes.size > 1 ? '混合采购' : [...sourceTypes][0];
            const costWarnings = resultPolicy.summarizeCostWarnings(selected);

            warehouses.push({
                warehouseSku,
                evidenceComplete: true,
                purchaseRecords: annotatedRecords.map((record) => ({
                    recordId: record.recordId,
                    warehouseSku: record.warehouseSku,
                    productName: record.name,
                    imageUrl: record.imageUrl,
                    attribute: record.attribute,
                    ...(Object.hasOwn(record, 'purchaseCatalog') ? { purchaseCatalog: record.purchaseCatalog } : {}),
                    quantity: record.qty,
                    unitPrice: record.unitPrice,
                    totalPrice: record.totalPrice,
                    purchaseDate: record.date,
                    order1688: record.order1688,
                    purchaseOrderNo: record.purchaseOrderNo,
                    purchaseOrderId: record.purchaseOrderId,
                    supplierName: record.supplierName,
                    supplier1688Url: record.supplier1688Url,
                    supplier1688Links: record.supplier1688Links,
                    statusFields: record.statusFields,
                    eligible: true,
                    selectedForPreview: selectedRecords.has(record),
                    exclusionReasons: [],
                    warningReasons: record.warningReasons
                }))
            });

            results.push({
                warehouseSku,
                name: newest.name || records[0].name || '',
                imageUrl: newest.imageUrl || '',
                attribute: newest.attribute || '',
                ...(Object.hasOwn(newest, 'purchaseCatalog') ? { purchaseCatalog: newest.purchaseCatalog } : {}),
                mappings: [],
                catalogMappings: [],
                sourceType,
                orderNumber: newest.order1688 || newest.purchaseOrderNo || '',
                calcTimes: selected.length,
                dateRange: newest.date === oldest.date ? newest.date : oldest.date + ' ~ ' + newest.date,
                totalQty,
                totalPrice: totalPrice.toFixed(2),
                unitCost: (totalPrice / totalQty).toFixed(4),
                proposedUnitCost: (totalPrice / totalQty).toFixed(4),
                latestTimestamp: newest.timestamp,
                supplierName: newest.supplierName || '',
                supplier1688Url: newest.supplier1688Url || '',
                supplier1688Links: resultPolicy.normalizeSupplier1688Links(selected.flatMap(record => record.supplier1688Links || [])),
                selectedRecordIds: [...new Set(selected.map((record) => record.recordId))],
                costWarnings,
                costWarningCount: costWarnings.count,
                details: selected.map((record) => ({
                    recordId: record.recordId,
                    date: record.date,
                    orderNumber: record.order1688 || record.purchaseOrderNo || '',
                    sourceType: record.order1688 ? '1688' : '采购单',
                    qty: record.qty,
                    price: record.totalPrice.toFixed(2),
                    unitPrice: record.unitPrice.toFixed(4),
                    warningReasons: record.warningReasons,
                    supplierName: record.supplierName,
                    supplier1688Url: record.supplier1688Url,
                    supplier1688Links: record.supplier1688Links,
                }))
            });
        });

        results.sort((a, b) => a.warehouseSku.localeCompare(b.warehouseSku, 'zh-CN', { numeric: true }));
        return {
            results,
            skippedInvalid,
            warehouseEvidence: {
                formatVersion: 1,
                warehouses,
                excludedDetails
            }
        };
    }

    async function readWarehouseEvidence(warehouseSku, run) {
        if (!run.filters) return { warehouseSku, purchaseRecords: [], excludedRecords: [], sourceWarnings: ['captured_purchase_scope_missing'], evidenceComplete: false };
        if (!run.purchaseEvidencePromises) run.purchaseEvidencePromises = new Map();
        const key = resultPolicy.canonical(warehouseSku);
        if (!run.purchaseEvidencePromises.has(key)) run.purchaseEvidencePromises.set(key, (async () => {
            const orders = await fetchAllOrders(completeHistoryFilters(run.filters, warehouseSku), run);
            const details = await fetchAllDetails(orders.orders, run);
            return { aggregate: aggregateDetails(details.details, { allowEmpty: true }), orders, details };
        })());
        const { aggregate, orders, details } = await run.purchaseEvidencePromises.get(key);
        const matches = item => resultPolicy.canonical(item?.warehouseSku) === resultPolicy.canonical(warehouseSku);
        const existing = aggregate.warehouseEvidence.warehouses.find(matches);
        const sourceWarnings = [...(orders.countMismatch ? ['purchase_count_mismatch'] : []), ...details.failedOrders.map(item => 'detail_failure:' + item.id)];
        return { warehouseSku, purchaseRecords: existing?.purchaseRecords || [], excludedRecords: [...aggregate.warehouseEvidence.excludedDetails.filter(matches), ...details.excludedOrders.map(order => ({ ...order, warehouseSku }))], sourceWarnings, evidenceComplete: !sourceWarnings.length };
    }

    async function supplementCatalog() {
        if (activeRun || !isPurchasePage() || needsLogin() || !catalogCollector) return;
        taskCache.clear();
        const run = { controller: new AbortController(), cancelledByUser: false, filters: capturedListUrl ? parseCapturedFilters() : null };
        activeRun = run;
        renderPageContext();
        hideError();
        try {
            const bridge = window.ShopeersErpDeliveryBridge;
            const context = (await requestContextPolicy.settleRequestContext(bridge.catalogContext({}), 5000)).context;
            if (!context?.ok || !context.request) throw new CostError('资料请求未关联', context?.message || '请先在工作台登记补充资料请求。');
            run.requestId = context.request.requestId;
            run.ledgerPeriod = context.request.ledgerPeriod;
            run.expectedSkus = context.request.expectedSkus;
            run.catalogPhase = true;
            setLoading('正在补充 ERP 资料', context.request.platformSkcs.join(' / '));
            const state = await catalogCollector.collect(context.request.platformSkcs, run);
            if (run.controller.signal.aborted) return;
            const response = await bridge.submitCatalog({ requestId: context.request.requestId, querySkcs: context.request.platformSkcs, platformScopePolicy: 'ledger_platform_pair', results: state.results, warehouseEvidence: state.warehouseEvidence, catalogCoverage: state.coverage, resultDeliveryId: makeResultDeliveryId(), createdAt: new Date().toISOString() });
            showToast(response?.status === 'success' ? (state.coverage.purchaseEvidence.state === 'complete' ? '资料已送达本机收件服务' : '可用资料已送达，采购证据尚未读齐；再次补充时重新核验') : response?.retained ? '资料已由扩展后台保留，等待持久收件确认' : '资料尚未确认送达，请重试补充资料', response?.status === 'failed' ? 'error' : undefined);
        } catch (error) {
            if (!run.cancelledByUser) showError(error instanceof CostError ? error : new CostError('补充 ERP 资料失败', error?.message || String(error)));
        } finally {
            if (activeRun === run) activeRun = null;
            hideLoading();
            renderPageContext();
        }
    }

    async function fetchMappings(results, run) {
        if (!catalogCollector) throw new CostError('资料模块未加载', '请重新安装完整 ERP Assistant 扩展。');
        const failedMappings = [];
        beginReadProgress(run, '平台 SKU 映射', results.length, '个仓库 SKU');
        await mapConcurrent(results, MAX_CONCURRENT_SKU, async (result, index, lane) => {
            setReadLane(run, lane, { title: result.warehouseSku });
            try {
                const state = await catalogCollector.mappings(result.warehouseSku, run);
                result.mappings = state.mappings;
                result.catalogMappings = state.catalogMappings;
                const conflicts = resultPolicy.platformMappingConflicts([result], run.expectedSkus, run.querySkcs, run.platformTargets);
                result.catalogMappingsComplete = state.complete && !conflicts.length;
                if (!result.catalogMappingsComplete && resultPolicy.filterCatalogByPlatformScope([result], run.expectedSkus, run.querySkcs, run.platformTargets).results.length) failedMappings.push({ warehouseSku: result.warehouseSku, message: [...state.reasons, ...conflicts].join(';') });
            } finally { run.readProgress.lanes.delete(lane); }
        }, run, completed => {
            run.readProgress.completed = completed;
            run.readProgress.failures = failedMappings.length;
            setLoading('平台 SKU 映射', '');
        });
        return { failedMappings };
    }

    async function runCalculation(filters, run) {
        const startedAt = Date.now();
        const capturedSkcs = extractQuerySkcs(filters);
        const previewContext = run.previewContext || await readPreviewContext(capturedSkcs, run.queryCapturedAt);
        // Inbox identities are { platformSkc, canonicalPlatformSkc } objects.
        // Canonical keys bind scope; ERP queries must use the original identifier.
        const querySkcs = (run.batchSkcs || (Array.isArray(previewContext.platformSkcs) && previewContext.platformSkcs.length ? previewContext.platformSkcs : capturedSkcs)).map((target) => {
            const value = target && typeof target === 'object' ? target.platformSkc : target;
            if (typeof value !== 'string' || !value.trim()) throw new CostError('核算目标格式无效', '平台 SKC 缺少可查询的标识，请返回工作台重新查询。');
            return value.trim();
        });
        run.requestId = previewContext.requestId;
        run.requestSnapshot = previewContext.requestSnapshot;
        run.ledgerPeriod = previewContext.ledgerPeriod;
        run.expectedSkus = previewContext.expectedSkus || run.task?.expectedSkus || run.task?.requestSnapshot?.expectedSkus;
        run.querySkcs = querySkcs;
        run.platformTargets = resultPolicy.platformScope(run.expectedSkus, querySkcs);
        if (run.expectedRequestId && run.requestId !== run.expectedRequestId) throw new CostError('原采集请求已变化', '请重新查询；不能将原任务恢复到其他请求。');
        // A page remaining open is not proof of the same signed-in account or
        // unchanged history. Every new attempt starts from authoritative reads.
        if (!run.task) taskCache.clear();
        run.completedTargets = [];
        if (!run.task) await saveCheckpoint(run);
        const historyFilters = completeHistoryFilters(filters);
        const directoryState = await catalogCollector.directory(querySkcs, run);
        const mappingState = await fetchMappings(directoryState.results, run);
        const scopedState = resultPolicy.filterCatalogByPlatformScope(directoryState.results, run.expectedSkus, querySkcs, run.platformTargets);
        const missingTargets = resultPolicy.missingPlatformTargets(scopedState.results, run.expectedSkus, querySkcs, run.platformTargets);
        mappingState.failedMappings.push(...missingTargets);
        const scopedWarehouseSkus = new Set(scopedState.results.map(result => resultPolicy.canonical(result.warehouseSku)));
        if (!scopedWarehouseSkus.size) throw new CostError('目标平台规格未取得映射', missingTargets.map(target => target.platformSkc + ' / ' + target.platformSku).join('\n') + '\n请在 ERP 核对这些已使用规格的映射，不能用其他仓库档案代替。');
        beginReadProgress(run, '采购列表', querySkcs.length, '个 SKC');
        const targetStates = await mapConcurrent(querySkcs, 2, async (skc, index, lane) => {
            const targetRun = { ...run, onPurchasePage: (completed, total, meta) => setReadLane(run, lane, { title: skc, completed, total, unit: '页', meta }) };
            try {
                const state = await fetchAllOrders(completeHistoryFilters(filters, skc), targetRun);
                if (!state.countMismatch) run.completedTargets.push(skc);
                if (!run.task) await saveCheckpoint(run);
                return state;
            } finally { run.readProgress.lanes.delete(lane); }
        }, run, completed => {
            run.readProgress.completed = completed;
            setLoading('采购列表', '');
        });
        const orderState = { ...targetStates[0], orders: [...new Map(targetStates.flatMap(state => state.orders).map(order => [String(order.purchaseOrderId), order])).values()], pageCount: targetStates.reduce((sum, state) => sum + state.pageCount, 0), countMismatch: targetStates.some(state => state.countMismatch), pageRowCounts: targetStates.flatMap(state => state.pageRowCounts) };
        const orders = orderState.orders;
        const detailState = await fetchAllDetails(orders, run);
        run.readProgress = null;
        setLoading('正在整理采购证据', previewContext.ledgerPeriod ? `台账月份：${previewContext.ledgerPeriod}` : '未取得台账月份，继续采集完整证据');
        const aggregateState = aggregateDetails(detailState.details.filter(detail => scopedWarehouseSkus.has(resultPolicy.canonical(detail.itemId))), { allowEmpty: true });
        const costsByWarehouse = new Map(aggregateState.results.map(result => [resultPolicy.canonical(result.warehouseSku), result]));
        aggregateState.results = scopedState.results.map(product => ({ ...product, ...costsByWarehouse.get(resultPolicy.canonical(product.warehouseSku)), mappings: product.mappings, catalogMappings: product.catalogMappings, catalogMappingsComplete: product.catalogMappingsComplete }));
        for (const product of scopedState.results) {
            if (!aggregateState.warehouseEvidence.warehouses.some(warehouse => resultPolicy.canonical(warehouse.warehouseSku) === resultPolicy.canonical(product.warehouseSku))) aggregateState.warehouseEvidence.warehouses.push({ warehouseSku: product.warehouseSku, purchaseRecords: [], excludedRecords: [], sourceWarnings: [], evidenceComplete: true });
        }
        for (const warehouse of aggregateState.warehouseEvidence.warehouses) {
            const product = scopedState.results.find(result => resultPolicy.canonical(result.warehouseSku) === resultPolicy.canonical(warehouse.warehouseSku));
            warehouse.sourceWarnings = [...(warehouse.sourceWarnings || []), ...(!directoryState.complete ? ['target_directory_incomplete'] : []), ...(product.catalogMappingsComplete !== true ? ['target_mapping_incomplete'] : [])];
            warehouse.evidenceComplete = !orderState.countMismatch && !detailState.failedOrders.length && !warehouse.sourceWarnings.length;
        }
        const catalogState = { coverage: Object.fromEntries(['directory','mappings','images','suppliers','purchaseEvidence'].map(group => [group, { state: 'unavailable', reasons: ['catalog_supplement_pending'] }])) };
        const resultMappings = aggregateState.results.flatMap(item => item.mappings || []);
        const warehouseEvidence = {
            formatVersion: 1,
            warehouses: aggregateState.warehouseEvidence.warehouses,
            excludedOrders: detailState.excludedOrders,
            excludedDetails: aggregateState.warehouseEvidence.excludedDetails.filter((item) => (
                !item.warehouseSku || scopedWarehouseSkus.has(resultPolicy.canonical(item.warehouseSku))
            )),
            detailFailures: detailState.failedOrders,
            mappingFailures: mappingState.failedMappings
        };
        const previewResults = resultPolicy.previewForLedger(aggregateState.results, warehouseEvidence, previewContext.ledgerPeriod);
        const warningMeta = buildWarningMeta(previewResults);
        for (const warehouse of warehouseEvidence.warehouses) {
            const ids = new Set(previewResults.find(result => resultPolicy.canonical(result.warehouseSku) === resultPolicy.canonical(warehouse.warehouseSku))?.selectedRecordIds || []);
            warehouse.purchaseRecords.forEach(record => { record.selectedForPreview = ids.has(record.recordId); });
        }
        return {
            catalogInitial: aggregateState,
            results: previewResults,
            warehouseEvidence,
            meta: {
                catalogVersion: 1,
                catalogCoverage: catalogState.coverage,
                queryCapturedAt: run.queryCapturedAt,
                registeredBefore: run.queryCapturedAt,
                filters,
                historyFilters,
                purchaseHistoryScope: 'complete_target_history',
                historyQueryRange: historyFilters.queryRange,
                historyTargetSku: querySkcs.join(','),
                querySkcs,
                platformScopePolicy: 'ledger_platform_pair',
                scopeDirectoryComplete: directoryState.complete,
                targetMappingFailureCount: missingTargets.length,
                ignoredDetailCount: detailState.details.filter(detail => !scopedWarehouseSkus.has(resultPolicy.canonical(detail.itemId))).length,
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
                reportedOrderCount: targetStates.length === 1 ? orderState.reportedCount : null,
                orderCountMismatch: orderState.countMismatch,
                validOrderCount: detailState.validOrderCount,
                skippedOrderCount: detailState.skippedOrderCount,
                skippedCancelledOrderCount: detailState.skippedCancelledOrderCount,
                detailCount: detailState.details.length,
                detailFailureCount: detailState.failedOrders.length,
                detailFailures: detailState.failedOrders,
                mappingFailureCount: mappingState.failedMappings.length,
                mappingFailures: mappingState.failedMappings,
                skippedInvalid: aggregateState.skippedInvalid,
                warehouseSkuCount: previewResults.length,
                platformSkuCount: resultMappings.length,
                platformSkcCount: new Set(resultMappings.map((item) => resultPolicy.canonical(item.platformSkc)).filter(Boolean)).size,
                costWarningCount: warningMeta.costWarningCount,
                evidenceRecordCount: warehouseEvidence.warehouses.reduce((sum, item) => sum + item.purchaseRecords.length, 0),
                excludedEvidenceCount: warehouseEvidence.excludedOrders.length + warehouseEvidence.excludedDetails.length,
                exclusionStats: [...warehouseEvidence.excludedOrders, ...warehouseEvidence.excludedDetails].map((record) => ({
                    recordId: record.recordId || null,
                    purchaseOrderId: record.purchaseOrderId || null,
                    purchaseOrderNo: record.purchaseOrderNo || null,
                    order1688: record.order1688 || null,
                    warehouseSku: record.warehouseSku || null,
                    supplierName: record.supplierName || null,
                    supplier1688Url: record.supplier1688Url || null,
                    statusValues: Array.isArray(record.statusValues) ? record.statusValues.join('|') : '',
                    ...resultPolicy.purchaseStatusFields(record.statusFields),
                    exclusionReasons: Array.isArray(record.exclusionReasons) ? record.exclusionReasons.join('|') : ''
                })),
                sourceFormat: 'erp-assistant-v8-preview-evidence',
                extensionVersion: EXTENSION_VERSION,
                durationMs: Date.now() - startedAt,
                ledgerPeriod: previewContext.ledgerPeriod,
                previewContextMessage: previewContext.message || null,
                previewScope: previewContext.ledgerPeriod ? 'ledger_month' : 'period_unknown',
                ledgerMonthCutoffStatus: previewContext.ledgerPeriod ? 'applied' : 'pending_ledger'
            }
        };
    }

    async function completeOptionalCatalog(state, run) {
        try {
            hideLoading();
            run.catalogPhase = true;
            run.readProgress = null;
            const bridge = window.ShopeersErpDeliveryBridge;
            const settled = await requestContextPolicy.settleRequestContext(bridge.catalogContext({ querySkcs: state.meta.querySkcs, queryCapturedAt: run.queryCapturedAt }), 5000);
            const context = settled.context;
            if (!context?.ok || !context.request) { showToast('成本已完成；资料请求未关联，可在工作台登记后补充资料'); return; }
            if (run.controller.signal.aborted) return;
            run.expectedSkus = context.request.expectedSkus;
            run.catalogPhase = true;
            setLoading('成本已完成，正在补充资料', '资料最多30分钟；可取消，成本结果已保留');
            const catalog = await catalogCollector.collect(state.meta.querySkcs, run, state.catalogInitial);
            if (run.controller.signal.aborted) return;
            if (context.request.platformSkcs.length !== state.meta.querySkcs.length) {
                for (const group of Object.values(catalog.coverage)) {
                    if (group.state === 'complete') group.state = 'partial';
                    group.reasons.push('query_scope_subset');
                }
            }
            if (run.controller.signal.aborted) return;
            run.readProgress = null;
            setLoading('资料读取已结束，正在回传', '等待本机持久收件确认');
            const response = await bridge.submitCatalog({ requestId: context.request.requestId, querySkcs: state.meta.querySkcs, platformScopePolicy: 'ledger_platform_pair', results: catalog.results, warehouseEvidence: catalog.warehouseEvidence, catalogCoverage: catalog.coverage, resultDeliveryId: makeResultDeliveryId(), createdAt: new Date().toISOString() });
            showToast(response?.status === 'success' ? '资料已送达本机收件服务' : response?.retained ? '资料已由扩展后台保留，等待持久收件确认' : '资料尚未确认送达，请重试补充资料');
            const coverageComplete = Object.values(catalog.coverage).every(group => group.state === 'complete' || group.state === 'partial' && group.reasons?.length > 0 && group.reasons.every(reason => reason === 'query_scope_subset'));
            const labels = { directory: '商品目录', mappings: '平台映射', images: '图片', suppliers: '供应商/1688链接', purchaseEvidence: '采购证据' };
            const missing = Object.entries(catalog.coverage).filter(([, group]) => group.state !== 'complete' && group.reasons?.some(reason => reason !== 'query_scope_subset')).map(([key, group]) => labels[key] + '缺项 ' + (group.missingCount || 1));
            return { ...response, coverageComplete, message: response?.status === 'success' && !coverageComplete ? '资料已送达，但尚未齐全：' + missing.join('；') + '。可补齐 ERP 资料后继续。' : response?.message };
        } catch (error) {
            if (error.code === 'ERP_COLLECTION_PAUSED') run.pauseRequested = true;
            if (!run.cancelledByUser) showToast('成本已完成；资料补充未完成：' + (error.message || String(error)), 'error');
            return { status: 'failed', message: error.details || error.message || String(error) };
        } finally { hideLoading(); }
    }

    async function taskOperation(input) {
        const response = await window.ShopeersErpDeliveryBridge.collectionTask(input);
        if (!response?.ok) throw Object.assign(new CostError('采集任务未保存', response?.message || '本机收件服务暂不可用，请重试。'), { code: response?.code });
        return response;
    }

    function updateTaskStatus(task) {
        collectionTaskState = task;
        if (activeRun?.task?.taskId === task.taskId) activeRun.task = task;
        const batches = task.batches || [];
        const collected = batches.filter(batch => batch.collectedAt || ['collected','delivered','incomplete'].includes(batch.status)).reduce((n, batch) => n + batch.platformSkcs.length, 0);
        const delivered = batches.filter(batch => batch.deliveryId || batch.status === 'delivered').reduce((n, batch) => n + batch.platformSkcs.length, 0);
        const total = batches.reduce((n, batch) => n + batch.platformSkcs.length, 0);
        const failed = batches.filter(batch => ['failed','incomplete'].includes(batch.status));
        const stores = [...new Set((task.expectedSkus || task.requestSnapshot?.expectedSkus || []).map(item => item.store).filter(Boolean))];
        const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(task.createdAt || new Date().toISOString())) / 1000));
        taskStage = (task.status === 'stopped' ? '已停止' : task.status === 'invalidated' ? '范围已变化' : activeRun?.catalogPhase ? '补充资料' : task.status === 'paused' ? '待继续' : delivered === total && total ? '成本全部送达' : '分批采集')
            + ' · 已采集 ' + collected + '/' + total + ' SKC · 已送达 ' + delivered + '/' + total
            + ' SKC · 已采用 ' + (task.summary?.adopted ?? 0) + ' SKU'
            + ' · 原范围 ' + (task.ledgerPeriod || '月份待关联') + (stores.length ? ' / ' + stores.join('、') : '')
            + ' · 已送达 ' + batches.filter(batch => batch.deliveryId).length + '/' + batches.length + ' 批'
            + ' · ' + elapsed + ' 秒'
            + (failed.length ? ' · ' + failed.length + ' 批待核对：' + (failed[0].error?.message || failed[0].error || '证据不完整') : '')
            + (batches.some(batch => batch.catalogStatus) ? ' · 资料已检查 ' + batches.filter(batch => ['completed', 'failed'].includes(batch.catalogStatus)).length + '/' + batches.length + ' 批，齐全 ' + batches.filter(batch => batch.catalogStatus === 'completed').length + ' 批' : '');
        renderPageContext();
    }

    async function runBatchedCalculation(run) {
        taskCache.clear(); requestLimit = 8; throttleUntil = 0;
        const bridge = window.ShopeersErpDeliveryBridge;
        let task = (await taskOperation({ action: 'control', taskId: run.task.taskId, control: 'resume', filters: run.filters })).task;
        run.task = task;
        const snapshot = task.requestSnapshot;
        run.previewContext = { ...run.previewContext, requestId: task.requestId, ledgerPeriod: snapshot.ledgerPeriod,
            platformSkcs: snapshot.platformSkcs, requestSnapshot: run.previewContext?.requestSnapshot || JSON.stringify(snapshot) };
        const catalogStates = new Map();
        let heartbeatBusy = false;
        const heartbeat = window.setInterval(async () => {
            if (heartbeatBusy || activeRun !== run) return;
            heartbeatBusy = true;
            try {
                let fresh = (await taskOperation({ action: 'get', taskId: task.taskId })).task;
                if (!['paused','stopped','invalidated'].includes(fresh.status)) fresh = (await taskOperation({ action: 'control', taskId: task.taskId, control: 'heartbeat' })).task;
                task = fresh; run.task = fresh;
                if (fresh.status === 'paused') run.pauseRequested = true;
                if (['stopped','invalidated'].includes(fresh.status)) { run.cancelledByUser = true; run.controller.abort(); }
                updateTaskStatus(task);
            } catch { taskStage = '进度续约暂未确认；已送达结果保留'; renderPageContext(); }
            finally { heartbeatBusy = false; }
        }, 3000);
        try {
            for (const initial of task.batches) {
                if (run.cancelledByUser || run.pauseRequested) break;
                task = (await taskOperation({ action: 'get', taskId: task.taskId })).task;
                let batch = task.batches.find(item => item.batchId === initial.batchId);
                if (['delivered','failed','incomplete'].includes(batch.status)) continue;
                if (batch.resultDeliveryId) {
                    const retry = await bridge.retry(batch.resultDeliveryId);
                    task = (await taskOperation({ action: 'get', taskId: task.taskId })).task;
                    batch = task.batches.find(item => item.batchId === initial.batchId);
                    if (['delivered','incomplete'].includes(batch.status)) continue;
                    if (batch.status === 'collected' && retry?.status === 'cached') { run.pauseRequested = true; break; }
                    if (batch.status === 'collected') {
                        await taskOperation({ action: 'batch', taskId: task.taskId, batchId: batch.batchId, attemptId: batch.attemptId, state: 'pending' });
                    }
                }
                if (task.status === 'paused') { run.pauseRequested = true; break; }
                if (['stopped','invalidated'].includes(task.status)) { run.cancelledByUser = true; break; }
                const started = await taskOperation({ action: 'batch', taskId: task.taskId, batchId: batch.batchId, state: 'running', phase: 'cost' });
                batch = started.batch; task = started.task; run.task = task;
                run.batchId = batch.batchId;
                run.catalogPhase = false; run.readProgress = null;
                run.batchSkcs = batch.platformSkcs; run.controller = new AbortController();
                run.controller.signal.deadlineAt = Date.now() + COST_STAGE_BUDGET_MS;
                run.resultDeliveryId = makeResultDeliveryId();
                const identity = { taskId: task.taskId, batchId: batch.batchId, attemptId: batch.attemptId };
                const budget = window.setTimeout(() => run.controller.abort(new CostError('本批成本读取时间已到', '60分钟时限已到；可重试此批次。')), COST_STAGE_BUDGET_MS);
                let deliveryAttempted = false;
                try {
                    updateTaskStatus(task);
                    const state = await runCalculation(run.filters, run);
                    window.clearTimeout(budget);
                    if (run.cancelledByUser) break;
                    const evidenceComplete = state.meta.scopeDirectoryComplete && !state.meta.orderCountMismatch && !state.meta.detailFailureCount && !state.meta.mappingFailureCount;
                    const issues = [];
                    if (state.meta.orderCountMismatch) issues.push('采购列表数量未核对一致');
                    if (!state.meta.scopeDirectoryComplete) issues.push('目标商品档案未读齐');
                    if (state.meta.detailFailureCount) issues.push('采购明细读取失败 ' + state.meta.detailFailureCount + ' 单');
                    if (state.meta.mappingFailureCount) {
                        const empty = state.warehouseEvidence.mappingFailures.filter(item => item.message.includes('mapping_empty')).length;
                        issues.push('已使用的平台规格映射未确认 ' + state.meta.mappingFailureCount + ' 项' + (empty ? '（ERP 返回空映射 ' + empty + ' 项）' : ''));
                    }
                    const saved = await taskOperation({ action: 'batch', ...identity, state: 'collected', resultDeliveryId: run.resultDeliveryId, evidenceComplete, error: issues.join('；') });
                    task = saved.task;
                    const deliveryState = { createdAt: new Date().toISOString(), queryCapturedAt: run.queryCapturedAt };
                    const combined = new Map(lastResults.map(row => [resultPolicy.canonical(row.warehouseSku), row]));
                    for (const row of state.results) {
                        const key = resultPolicy.canonical(row.warehouseSku), previous = combined.get(key);
                        combined.set(key, { ...row, mappings: [...new Map([...(previous?.mappings || []), ...row.mappings].map(mapping => [resultPolicy.canonical(mapping.platformSku), mapping])).values()] });
                    }
                    lastResults = [...combined.values()];
                    lastMeta = { ...state.meta, querySkcs: [...new Set([...(lastMeta?.querySkcs || []), ...state.meta.querySkcs])], warehouseSkuCount: lastResults.length, platformSkuCount: lastResults.reduce((sum,row) => sum + row.mappings.length, 0) };
                    lastWarehouseEvidence = { ...state.warehouseEvidence, warehouses: [...new Map([...(lastWarehouseEvidence?.warehouses || []), ...state.warehouseEvidence.warehouses].map(row => [resultPolicy.canonical(row.warehouseSku), row])).values()] };
                    setResultCache(state.results, state.meta, state.warehouseEvidence, capturedListUrl, run.resultDeliveryId, deliveryState);
                    run.readProgress = null;
                    setLoading('本批成本已采集，正在回传', '等待本机持久收件确认');
                    deliveryAttempted = true;
                    const response = await bridge.submit({ ...deliveryState, ...state, resultDeliveryId: run.resultDeliveryId, querySkcs: batch.platformSkcs, collectionTask: identity });
                    if (response.status !== 'success' && !response.retained) throw new CostError('此批成本尚未送达', response.message || '请重试失败批次。');
                    catalogStates.set(batch.batchId, state);
                    task = (await taskOperation({ action: 'get', taskId: task.taskId })).task;
                    updateTaskStatus(task); renderResults(); renderStatus(); updateActionState();
                } catch (error) {
                    if (run.cancelledByUser) break;
                    if (deliveryAttempted) {
                        // A lost ACK or status read cannot demote a durable receipt.
                        // Preserve the collected identity for receipt reconciliation.
                        run.pauseRequested = true;
                        taskStage = '回执待核对 · 已采集结果保留，点击继续核对';
                        break;
                    }
                    const paused = error.code === 'ERP_COLLECTION_PAUSED' || run.pauseRequested;
                    const result = await taskOperation({ action: 'batch', ...identity, state: paused ? 'pending' : 'failed', error: paused ? null : error.details || error.message });
                    task = result.task;
                    if (paused || error.code === 'ERP_LOGIN_REQUIRED') { run.pauseRequested = true; break; }
                    updateTaskStatus(task);
                } finally { window.clearTimeout(budget); }
            }
            if (!run.cancelledByUser && !run.pauseRequested) {
                // Optional reads start only after every cost batch was attempted.
                run.controller = new AbortController();
                task = (await taskOperation({ action: 'get', taskId: task.taskId })).task;
                for (const batch of task.batches) {
                    if (run.cancelledByUser || run.pauseRequested) break;
                    if (!['delivered','incomplete'].includes(batch.status) || batch.catalogStatus === 'completed') continue;
                    const identity = { taskId: task.taskId, batchId: batch.batchId, attemptId: batch.attemptId };
                    task = (await taskOperation({ action: 'batch', ...identity, state: 'catalog_running', phase: 'catalog' })).task;
                    run.task = task; run.batchSkcs = batch.platformSkcs; run.batchId = batch.batchId;
                    const state = catalogStates.get(batch.batchId) || { meta: { querySkcs: batch.platformSkcs } };
                    const response = await completeOptionalCatalog(state, run);
                    if (run.cancelledByUser) break;
                    task = (await taskOperation({ action: 'batch', ...identity, state: response?.status === 'success' && response.coverageComplete ? 'catalog_completed' : 'catalog_failed', error: response?.message || '资料尚未确认送达，可继续补充。' })).task;
                    updateTaskStatus(task);
                }
            }
            if (run.pauseRequested && !run.cancelledByUser) task = (await taskOperation({ action: 'control', taskId: task.taskId, control: 'pause' })).task;
            run.task = task; run.costReadComplete = true;
            updateTaskStatus(task);
        } finally { window.clearInterval(heartbeat); hideLoading(); }
    }

    async function calculate(expectedRequestId = null, restartCheckpoint = false, previousDeliveryId = null, previewContext = null, resultDeliveryId = null, restoredTask = null) {
        if (activeRun) {
            activeRun.cancelledByUser = true;
            activeRun.controller.abort();
        }

        hideError();
        lastResults = [];
        lastMeta = null;
        lastWarehouseEvidence = null;
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
            cancelledByUser: false,
            expectedRequestId,
            restartCheckpoint,
            previousDeliveryId,
            previewContext,
            resultDeliveryId,
            filters,
            queryCapturedAt: capturedQueryCapturedAt || new Date().toISOString()
        };
        let budgetTimer = window.setTimeout(() => run.controller.abort(new CostError('本次成本读取时间已到', '已达到60分钟上限，任务待继续；原账号未验证，继续时按当前登录会话重新读取采购。未完成证据不会变为正式完整成本。')), COST_STAGE_BUDGET_MS);
        activeRun = run;
        taskStage = '读取中';
        setLoading('准备核算', '正在校验采购查询条件；成本采集最多60分钟，可取消');

        try {
            if (window.ShopeersErpDeliveryBridge.collectionTask) {
                const context = previewContext || await readPreviewContext(extractQuerySkcs(filters), run.queryCapturedAt);
                if (context.requestId || restoredTask) {
                    const response = restoredTask ? { ok: true, task: restoredTask } : await taskOperation({ action: 'create', requestId: context.requestId, filters, queryCapturedAt: run.queryCapturedAt });
                    if (response.task) {
                        window.clearTimeout(budgetTimer); budgetTimer = null;
                        run.task = response.task; run.previewContext = context;
                        await runBatchedCalculation(run);
                        return;
                    }
                }
            }
            const state = await runCalculation(filters, run);
            window.clearTimeout(budgetTimer);
            if (run.cancelledByUser) return;
            lastImportEnvelope = null;
            lastResults = state.results;
            lastMeta = state.meta;
            lastWarehouseEvidence = state.warehouseEvidence;
            const resultDeliveryId = run.resultDeliveryId || makeResultDeliveryId();
            const deliveryState = {
                createdAt: new Date().toISOString(),
                queryCapturedAt: run.queryCapturedAt,
                attemptsTotal: 0,
                deliveryTerminal: false
            };
            setResultCache(lastResults, lastMeta, lastWarehouseEvidence, capturedListUrl, resultDeliveryId, deliveryState);
            run.costReadComplete = true;
            run.costEvidenceComplete = state.meta.scopeDirectoryComplete && !state.meta.orderCountMismatch && !state.meta.detailFailureCount && !state.meta.mappingFailureCount;
            if (!dispatchCostResults(lastResults, lastMeta, lastWarehouseEvidence, resultDeliveryId, deliveryState, run)) taskStage = '本地预览 · 请从工作台登记请求后重新采集';
            expandedRows.clear();
            run.readProgress = null;
            setLoading('核算完成', '正在生成结果表');
            renderResults();
            renderAnomalyBanner();
            renderStatus();
            updateActionState();
            hideLoading();
            showToast('成本采集完成，共 ' + lastResults.length + ' 个仓库 SKU；送达状态以回传提示为准');
            // Cost cache, dispatch and rendering precede every optional ERP request.
            if (catalogCollector) await completeOptionalCatalog(state, run);
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
            window.clearTimeout(budgetTimer);
            if (!run.task && resumableCheckpoint && !run.costReadComplete) taskStage = '待继续 · 原账号未验证，继续时重读';
            if (activeRun === run) activeRun = null;
            renderPageContext();
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
            const mappings = result.mappings.length > 0 ? result.mappings : [{ platformSku: '', platformSkc: '' }];
            mappings.forEach((mapping) => {
                rows.push({
                    warehouseSku: result.warehouseSku,
                    platformSku: mapping.platformSku,
                    platformSkc: mapping.platformSkc || '',
                    orderNumber: selectedPreviewValues(result, 'orderNumber', result.orderNumber).join('\n'),
                    sourceType: selectedPreviewValues(result, 'sourceType', result.sourceType).join('\n'),
                    name: result.name,
                    calcTimes: result.calcTimes,
                    purchaseDates: selectedPreviewValues(result, 'date', result.dateRange).join('\n'),
                    totalQty: result.totalQty,
                    totalPrice: result.totalPrice,
                    unitCost: result.unitCost,
                    supplierName: result.supplierName || '',
                    supplier1688Url: result.supplier1688Url || '',
                    costWarningCount: resultCostWarnings(result).count,
                    costWarningReasons: resultCostWarnings(result).reasons.map((reason) => resultPolicy.costWarningLabel(reason)).join('；'),
                    costWarningRecords: resultCostWarnings(result).records
                });
            });
        });
        return rows;
    }

    function csvCell(value) {
        const text = String(value === undefined || value === null ? '' : value);
        // Quote escaping alone does not prevent spreadsheet formulas. Textify only
        // the exported value, preserving numeric cells and the raw evidence/cache.
        const safeText = typeof value !== 'number' && /^\s*[=+\-@＝＋－＠\u0000-\u001f\u007f]/.test(text)
            ? "'" + text
            : text;
        return '"' + safeText.replace(/"/g, '""') + '"';
    }

    async function copyTextWithFallback(text) {
        let clipboardError = null;
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
                await navigator.clipboard.writeText(text);
                return;
            } catch (error) {
                clipboardError = error;
            }
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.setAttribute('aria-hidden', 'true');
        textarea.style.position = 'fixed';
        textarea.style.top = '0';
        textarea.style.left = '-9999px';
        textarea.style.width = '1px';
        textarea.style.height = '1px';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        try {
            textarea.focus({ preventScroll: true });
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);
            if (!document.execCommand('copy')) {
                throw clipboardError || new Error('document.execCommand(copy) returned false');
            }
        } finally {
            textarea.remove();
        }
    }

    async function copyCosts() {
        if (lastResults.length === 0) return;
        const lines = ['平台SKU\t平台SKC\t仓库SKU\t所选采购单号\t预览单件成本\t供应商1688链接\t疑似异常\t提示原因\t原始提示JSON\t所选采购日期\t所选单号类型\t预览范围'];
        buildExportRows(lastResults).forEach((row) => {
            lines.push([row.platformSku, row.platformSkc, row.warehouseSku, row.orderNumber.replace(/\n/g, '；'), row.unitCost, row.supplier1688Url, row.costWarningCount, row.costWarningReasons, JSON.stringify(row.costWarningRecords), row.purchaseDates.replace(/\n/g, '；'), row.sourceType.replace(/\n/g, '；'), previewScopeLabel()].join('\t'));
        });
        try {
            await copyTextWithFallback(lastImportEnvelope ? JSON.stringify(lastImportEnvelope, null, 2) : lines.join('\n'));
            showToast(lastImportEnvelope ? '已复制完整证据 JSON，可导入工作台' : '已复制兼容表格预览；尚无已接收证据，不能直接作 ERP 正式成本');
        } catch (error) {
            showError(new CostError('复制失败', '当前页面未允许剪贴板写入，请重试或检查浏览器权限。'));
        }
    }

    function exportCsv() {
        if (lastResults.length === 0) return;
        const headers = [
            '仓库SKU', '平台SKU', '平台SKC', '所选单号类型', '所选采购单号', '产品名称', '供应商', '供应商1688链接', '疑似异常', '提示原因', '原始提示JSON',
            '预览次数', '所选采购日期', '总采购量', '总采购价(￥)', '预览单件成本', '预览范围'
        ];
        const lines = [headers.map(csvCell).join(',')];
        buildExportRows(lastResults).forEach((row) => {
            lines.push([
                row.warehouseSku, row.platformSku, row.platformSkc, row.sourceType, row.orderNumber, row.name, row.supplierName, row.supplier1688Url, row.costWarningCount, row.costWarningReasons, JSON.stringify(row.costWarningRecords),
                row.calcTimes, row.purchaseDates, row.totalQty, row.totalPrice, row.unitCost, previewScopeLabel()
            ].map(csvCell).join(','));
        });
        const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'SKU成本核算_' + (resultPolicy.validLedgerPeriod(lastMeta?.ledgerPeriod) || '月份待关联') + '.csv';
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
                result.warehouseSku, result.name, result.orderNumber, result.sourceType, result.supplierName, result.supplier1688Url, mappings,
                ...(result.details || []).map((detail) => [detail.date, detail.sourceType, detail.orderNumber].join(' '))
            ].join(' ').toLowerCase();
            return words.every((word) => haystack.includes(word));
        });
    }

    function renderPlatformCell(result) {
        if (result.mappings.length === 0) {
            return '<span class="erpa-muted">未映射（仅保留仓库 SKU 证据）</span>';
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
        if (result.previewStatus && result.previewStatus !== 'ready') return '<tr class="erpa-detail-row"><td colspan="9"><div class="erpa-detail-wrap">' + renderMappingList(result) + escapeHtml(previewRowStatus(result)) + '</div></td></tr>';
        const rows = result.details.map((detail) => {
            const reasons = warningReasons(detail);
            const hasWarning = reasons.length > 0;
            const warningState = hasWarning
                ? '<span class="erpa-anomaly-badge erpa-anomaly-pending">疑似异常</span><small class="erpa-anomaly-note">' + escapeHtml(formatWarningReasons(reasons)) + '，请在 Lworkstation 利润核算中处理</small>'
                : '<span class="erpa-muted">正常</span>';
            return '<tr class="' + (hasWarning ? 'erpa-detail-anomaly' : '') + '"><td>' + escapeHtml(detail.date) + '</td>' +
            '<td>' + escapeHtml(detail.sourceType) + '</td>' +
            '<td class="erpa-cell-order">' + escapeHtml(detail.orderNumber || '-') + '</td>' +
            '<td class="erpa-cell-number">' + escapeHtml(detail.qty) + '</td>' +
            '<td class="erpa-cell-number">' + escapeHtml(detail.price) + '</td>' +
            '<td class="erpa-cell-number erpa-cell-cost">' + escapeHtml(detail.unitPrice) + '</td>' +
            '<td class="erpa-anomaly-cell">' + warningState + '</td>' +
            '<td>' + renderSupplier1688Link(detail.supplier1688Url) + '</td></tr>';
        }).join('');
        return '<tr class="erpa-detail-row"><td colspan="9"><div class="erpa-detail-wrap">' +
            renderMappingList(result) +
            '<table class="erpa-detail-table"><thead><tr><th>采购日期</th><th>单号类型</th><th>单号</th>' +
            '<th>数量</th><th>总价(￥)</th><th>单价(￥)</th><th>成本状态</th><th>供应商1688链接</th></tr></thead><tbody>' + rows +
            '<tr class="erpa-detail-summary"><td>数量加权平均</td><td></td><td></td>' +
            '<td class="erpa-cell-number">' + escapeHtml(result.totalQty) + '</td>' +
            '<td class="erpa-cell-number">' + escapeHtml(result.totalPrice) + '</td>' +
            '<td class="erpa-cell-number erpa-cell-cost">' + escapeHtml(result.unitCost) + '</td>' +
            '<td><span class="erpa-anomaly-badge erpa-anomaly-confirmed">预览成本</span></td>' +
            '<td>' + renderSupplier1688Link(result.supplier1688Url) + '</td></tr>' +
            '</tbody></table></div></td></tr>';
    }

    function selectedPreviewValues(result, field, fallback) {
        return result.details && result.details.length > 0
            ? result.details.map((detail) => detail[field] || '-')
            : [fallback || ''];
    }

    function renderSelectedOrders(result) {
        const details = result.details && result.details.length > 0
            ? result.details
            : [{ sourceType: result.sourceType, orderNumber: result.orderNumber }];
        return details.map((detail) => '<div>' + escapeHtml(detail.sourceType) + ' · ' + escapeHtml(detail.orderNumber || '-') + '</div>').join('');
    }

    function previewRowStatus(result) {
        return result.previewStatus === 'period_unknown' ? '台账月份待关联' : result.previewStatus === 'evidence_incomplete' ? '采购历史未读齐，需重试' : result.previewStatus === 'no_purchase' ? '台账当月及以前无可用采购' : result.previewStatus === 'evidence_missing' ? '采购证据待补充' : '按台账预览';
    }

    function renderResults() {
        const body = document.getElementById('erpa-table-body');
        const empty = document.getElementById('erpa-empty');
        const tableWrap = document.getElementById('erpa-table-wrap');
        if (!body || !empty || !tableWrap) return;

        const filtered = getFilteredResults();
        resultPage = Math.min(resultPage, Math.max(0, Math.ceil(filtered.length / 50) - 1));
        const results = filtered.slice(resultPage * 50, (resultPage + 1) * 50);
        const pagination = document.getElementById('erpa-result-pages');
        if (pagination) {
            pagination.hidden = filtered.length <= 50;
            document.getElementById('erpa-page-label').textContent = '第 ' + (resultPage + 1) + '/' + Math.max(1, Math.ceil(filtered.length / 50)) + ' 页 · 共 ' + filtered.length + ' 项';
            document.getElementById('erpa-page-prev').disabled = resultPage === 0;
            document.getElementById('erpa-page-next').disabled = (resultPage + 1) * 50 >= filtered.length;
        }
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
            const warnings = resultCostWarnings(result);
            const warningClass = warnings.count > 0 ? ' erpa-result-anomaly' : '';
            const costState = result.previewStatus && result.previewStatus !== 'ready'
                ? '<span class="erpa-anomaly-note">' + escapeHtml(previewRowStatus(result)) + '</span>' : warnings.count > 0
                ? '<span class="erpa-anomaly-badge erpa-anomaly-pending">提示 ' + warnings.count + '</span>'
                : '<span class="erpa-anomaly-badge erpa-anomaly-confirmed">预览</span>';
            const row = '<tr class="erpa-result-row' + (expanded ? ' erpa-expanded' : '') + warningClass + '" data-sku="' + escapeHtml(key) + '">' +
                '<td class="erpa-cell-sku" title="' + escapeHtml(key) + '">' + escapeHtml(key) + '</td>' +
                '<td class="erpa-cell-platform" title="' + escapeHtml(result.mappings.map((item) => item.platformSku + ' · ' + item.platformSkc).join(', ')) + '">' + renderPlatformCell(result) + '</td>' +
                '<td class="erpa-cell-order erpa-selected-records">' + renderSelectedOrders(result) + '</td>' +
                '<td title="' + escapeHtml(result.name) + '">' + escapeHtml(result.name || '-') + '</td>' +
                '<td class="erpa-cell-number">' + result.calcTimes + '</td>' +
                '<td class="erpa-selected-records">' + selectedPreviewValues(result, 'date', result.dateRange).map((date) => '<div>' + escapeHtml(date) + '</div>').join('') + '</td>' +
                '<td class="erpa-cell-number">' + escapeHtml(result.totalQty) + '</td>' +
                '<td class="erpa-cell-number">' + escapeHtml(result.totalPrice) + '</td>' +
                '<td class="erpa-cell-number erpa-cell-cost"><span>' + escapeHtml(result.unitCost ?? '—') + '</span>' + costState + '</td></tr>';
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
        renderPageContext();
        const scope = document.getElementById('erpa-preview-scope');
        if (scope) scope.textContent = previewScopeLabel() + (lastMeta?.previewContextMessage ? ' · ' + lastMeta.previewContextMessage : ' · 按时间最近三笔，数量加权');
        const status = document.getElementById('erpa-statusbar');
        const footerLeft = document.getElementById('erpa-footer-left');
        const footerRight = document.getElementById('erpa-footer-right');
        if (!status || !footerLeft || !footerRight) return;
        if (!lastMeta) {
            updateIdleStatus();
            footerLeft.textContent = '数据链路：目标平台 SKU/SKC → 仓库档案 → 采购证据';
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
            (lastMeta.detailFailureCount ? '<span class="erpa-status-item erpa-status-warn">明细读取失败 <strong>' + lastMeta.detailFailureCount + '</strong></span>' : '') +
            (lastMeta.mappingFailureCount ? '<span class="erpa-status-item erpa-status-warn">平台映射失败 <strong>' + lastMeta.mappingFailureCount + '</strong></span>' : '') +
            (lastMeta.requestContextError ? '<span class="erpa-status-item erpa-status-warn">自动回传上下文异常，本地结果已保留</span>' : '') +
            (lastMeta.excludedMappingCount ? '<span class="erpa-status-item">已排除范围外映射 <strong>' + lastMeta.excludedMappingCount + '</strong></span>' : '') +
            (lastMeta.excludedWarehouseSkuCount ? '<span class="erpa-status-item">未命中仓库SKU <strong>' + lastMeta.excludedWarehouseSkuCount + '</strong></span>' : '') +
            (lastMeta.costWarningCount ? '<span class="erpa-status-item erpa-status-danger">疑似成本异常 <strong>' + lastMeta.costWarningCount + '</strong></span>' : '') +
            '<span class="erpa-status-item">有效采购证据 <strong>' + (lastMeta.evidenceRecordCount || 0) + '</strong></span>' +
            '<span class="erpa-status-item">请求分页 <strong>' + (lastMeta.pageSize || PREFERRED_PAGE_SIZE) + ' 条/页</strong>' + (lastMeta.pageSizeFallback ? '（已回退）' : '') + '</span>' +
            '<span class="erpa-status-item">后台实际返回峰值 <strong>' + (lastMeta.maxReturnedPerPage || 0) + ' 条/页</strong></span>' +
            ((lastMeta.pageSize === PREFERRED_PAGE_SIZE && lastMeta.maxReturnedPerPage > 0 && lastMeta.maxReturnedPerPage < PREFERRED_PAGE_SIZE && lastMeta.reportedOrderCount && lastMeta.reportedOrderCount > lastMeta.maxReturnedPerPage)
                ? '<span class="erpa-status-item erpa-status-warn">ERP 可能将每页限制为 ' + lastMeta.maxReturnedPerPage + ' 条，速度受服务端分页上限影响</span>'
                : '') +
            (lastMeta.orderCountMismatch ? '<span class="erpa-status-item erpa-status-warn">ERP 总数参考值与实际页数据不同，已按分页结果完成读取</span>' : '');
        footerLeft.innerHTML = '筛选：<strong>' + escapeHtml(summarizeFilters(lastMeta.filters)) + '</strong>';
        footerRight.textContent = previewScopeLabel() + ' · 不分单号类型 · 按时间最近' + MAX_RECORDS + '条加权 · ' + (lastMeta.durationMs / 1000).toFixed(1) + '秒' + (lastMeta.cacheRestored ? ' · 临时缓存恢复' : '');
    }

    function updateIdleStatus() {
        const status = document.getElementById('erpa-statusbar');
        if (!status || lastMeta) return;
        status.innerHTML = capturedListUrl ?
            '<span class="erpa-status-item erpa-status-ok"><strong>已捕获最近一次采购查询条件</strong></span>' :
            '<span class="erpa-status-item erpa-status-warn"><strong>等待采购页面查询</strong></span>';
    }

    function beginReadProgress(run, label, total, unit) {
        run.readProgress = { label, total, unit, completed: 0, failures: 0, lanes: new Map() };
        setLoading(label, '');
    }

    function setReadLane(run, key, lane) {
        run.readProgress.lanes.set(key, lane);
        setLoading(run.readProgress.label, '');
    }

    function progressRow(label, completed, total, unit = '', id = '') {
        const known = Number.isFinite(total) && total >= 0 && completed != null;
        const amount = known ? completed + ' / ' + total + ' ' + unit : completed != null ? '已读 ' + completed + ' ' + unit + ' · 总量待确认' : '等待响应';
        return '<div class="erpa-progress-row"><div><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(amount) + '</strong></div>' +
            '<progress ' + (id ? 'id="' + id + '" ' : '') + 'aria-label="' + escapeHtml(label) + '" max="' + (known ? Math.max(1, total) : 1) + '"' + (known ? ' value="' + (total ? Math.min(total, Math.max(0, completed)) : 1) + '"' : '') + '></progress></div>';
    }

    function renderReadProgress() {
        const run = activeRun;
        if (!run) return;
        const host = document.getElementById(run.catalogPhase ? 'erpa-catalog-meters' : 'erpa-loading-meters');
        if (!host) return;
        const batches = run.task?.batches || [];
        let html = '';
        if (batches.length) {
            const total = batches.reduce((n, batch) => n + batch.platformSkcs.length, 0);
            const delivered = batches.filter(batch => batch.deliveryId).reduce((n, batch) => n + batch.platformSkcs.length, 0);
            html += progressRow('成本总回传', delivered, total, 'SKC');
            if (run.catalogPhase) html += progressRow('资料批次检查', batches.filter(batch => ['completed', 'failed'].includes(batch.catalogStatus)).length, batches.length, '批');
        }
        const state = run.readProgress;
        const stageId = run.catalogPhase ? 'erpa-catalog-stage-progress' : 'erpa-progress-bar';
        html += state ? progressRow(state.label + ' · 当前阶段', state.completed, state.total, state.unit, stageId) : progressRow('正在处理', null, null, '', stageId);
        if (state?.failures) html += '<p class="erpa-progress-warning">已结束项中 ' + state.failures + ' 项证据不完整，回传后单独核对</p>';
        if (state?.lanes.size) {
            html += '<div class="erpa-progress-lanes"><div class="erpa-concurrency"><strong>正在处理 ' + state.lanes.size + ' 个目标</strong><span>实际读取 ' + requestSlots + ' / ' + requestLimit + ' 个请求</span></div>';
            if (Date.now() < throttleUntil || requestLimit < 8) html += '<p class="erpa-progress-warning">ERP 已限流，正在降低并发并等待重试</p>';
            for (const [key, lane] of state.lanes) html += '<div data-progress-lane="' + escapeHtml(key) + '">' + progressRow(lane.title, lane.completed, lane.total, lane.unit) + (lane.meta ? '<small>' + escapeHtml(lane.meta) + '</small>' : '') + '</div>';
            html += '</div>';
        }
        host.innerHTML = html;
    }

    function setLoading(title, meta) {
        const stage = activeRun?.readProgress;
        const batches = activeRun?.task?.batches || [];
        const batchIndex = batches.findIndex(batch => batch.batchId === activeRun?.batchId);
        const description = (batchIndex >= 0 ? '第 ' + (batchIndex + 1) + '/' + batches.length + ' 批 · 本批 ' + activeRun.batchSkcs.length + ' SKC · ' : '') + (stage ? stage.completed + ' / ' + stage.total + ' ' + stage.unit + '已处理' : '');
        if (activeRun?.catalogPhase) {
            const status = document.getElementById('erpa-catalog-progress');
            if (status) { status.hidden = false; document.getElementById('erpa-catalog-message').textContent = title + ' · ' + [description, meta].filter(Boolean).join(' · '); }
            renderReadProgress();
            return;
        }
        const loading = document.getElementById('erpa-loading');
        if (!loading) return;
        loading.classList.add('erpa-visible');
        document.getElementById('erpa-loading-title').textContent = title;
        document.getElementById('erpa-loading-meta').textContent = [description, meta].filter(Boolean).join(' · ');
        renderReadProgress();
    }

    function hideLoading() {
        const catalog = document.getElementById('erpa-catalog-progress');
        if (catalog) catalog.hidden = true;
        const loading = document.getElementById('erpa-loading');
        if (loading) loading.classList.remove('erpa-visible');
    }

    function showError(error) {
        const panel = document.getElementById('erpa-error');
        if (!panel) return;
        panel.dataset.tone = error?.code === 'ERP_COLLECTION_PAUSED' ? 'paused' : 'error';
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

    function renderAnomalyBanner() {
        const banner = document.getElementById('erpa-anomaly-banner');
        if (!banner) return;
        const warningCount = lastResults.reduce((sum, result) => sum + Number(resultCostWarnings(result).count || 0), 0);
        if (warningCount === 0) {
            banner.className = 'erpa-anomaly-banner';
            banner.innerHTML = '';
            return;
        }
        banner.className = 'erpa-anomaly-banner erpa-visible';
        banner.innerHTML = '<span class="erpa-anomaly-copy"><strong>发现 ' + warningCount + ' 条疑似成本异常</strong>' +
            '<small>扩展提供预览并回传原始证据。接收成功后可复制完整 JSON；表格和 CSV 仅作预览。修正与正式发布请在 Lworkstation 成本核对页处理。</small></span>';
    }

    function updateActionState() {
        const disabled = lastResults.length === 0;
        const copy = document.getElementById('erpa-copy');
        const csv = document.getElementById('erpa-export');
        if (copy) copy.disabled = disabled;
        if (csv) csv.disabled = disabled;
    }

    async function openPanel() {
        const frame = activePurchaseFrame();
        if (frame) {
            closePanel();
            let origin;
            try { origin = new URL(frame.contentWindow.location.href).origin; } catch { origin = new URL(frame.src).origin; }
            frame.contentWindow.postMessage({ type: 'shopeers.erp.openCostPreview' }, origin);
            return;
        }
        const root = document.getElementById('erpa-cost-root');
        if (!root) return;
        root.classList.add('erpa-open');
        renderAnomalyBanner();
        renderStatus();
        if (isPurchasePage() && !needsLogin() && capturedListUrl && lastResults.length === 0 && !activeRun) {
            try {
                // Read authoritative tasks, including completed ones, before
                // automatic collection; UI refresh is asynchronous and hides them.
                const context = await readPreviewContext(extractQuerySkcs(parseCapturedFilters()), capturedQueryCapturedAt);
                if (context.requestId && window.ShopeersErpDeliveryBridge.collectionTask) {
                    const tasks = await taskOperation({ action: 'list', requestId: context.requestId });
                    if (tasks.tasks?.length) { collectionTaskState = tasks.tasks[0]; updateTaskStatus(collectionTaskState); return; }
                }
                if (context.requestId) {
                    const response = await window.ShopeersErpDeliveryBridge.collectionCheckpoint({ action: 'list', includeCompleted: true });
                    if (!response?.ok) throw new CostError('原任务状态读取失败', '请稍后重试。');
                    const old = response.records?.find(item => item.requestId === context.requestId);
                    if (old) {
                        resumableCheckpoint = old.state === 'completed' ? null : old;
                        taskStage = old.state === 'completed' ? '原任务已完成 · 按当前查询请点重新核算' : '原任务未完成 · 继续原任务或点重新核算';
                        renderPageContext();
                        return;
                    }
                }
                if (!activeRun) await calculate(context.requestId || null, false, null, context);
            } catch (error) { showError(error); }
        }
    }

    async function requestRecalculate() {
        if (activeRun || !isPurchasePage() || needsLogin() || !capturedListUrl) return;
        try {
            const filters = parseCapturedFilters();
            const context = await readPreviewContext(extractQuerySkcs(filters), capturedQueryCapturedAt);
            const response = context.requestId ? await window.ShopeersErpDeliveryBridge.collectionCheckpoint({ action: 'list', includeCompleted: true }) : null;
            if (context.requestId && !response?.ok) throw new CostError('原任务状态读取失败', '请稍后重试。');
            const old = response?.records?.find(item => item.requestId === context.requestId);
            const tasks = context.requestId && window.ShopeersErpDeliveryBridge.collectionTask ? await taskOperation({ action: 'list', requestId: context.requestId }) : null;
            const previousTask = tasks?.tasks?.find(task => task.status !== 'stopped');
            if ((old || previousTask || lastResults.length > 0) && !window.confirm('按当前查询重新采集将从零读取 ERP 采购列表、明细和平台 SKU 映射，并开始新的采集尝试。旧待送达结果会保留；旧任务不能覆盖新任务。确定继续吗？')) return;
            if (activeRun) return;
            if (previousTask) {
                await taskOperation({ action: 'control', taskId: previousTask.taskId, control: 'stop' });
                collectionTaskState = null;
            }
            await calculate(context.requestId || null, Boolean(context.requestId), old?.resultDeliveryId || null, context);
        } catch (error) { showError(error); }
    }

    function closePanel() {
        const root = document.getElementById('erpa-cost-root');
        if (root) root.classList.remove('erpa-open');
    }

    function createUi() {
        if (!document.body || (!isTopFrame && !isPurchasePage())) return false;

        const existingTrigger = document.getElementById('erpa-cost-trigger');
        const existingRoot = document.getElementById('erpa-cost-root');
        if ((existingTrigger || !isTopFrame) && existingRoot) return true;
        if (existingTrigger) existingTrigger.remove();
        if (existingRoot) existingRoot.remove();

        const trigger = document.createElement('button');
        trigger.id = 'erpa-cost-trigger';
        trigger.type = 'button';
        trigger.innerHTML = '<span class="erpa-trigger-icon" aria-hidden="true">▦</span><span>ERP 成本助手</span>';
        trigger.addEventListener('click', openPanel);

        const root = document.createElement('div');
        root.id = 'erpa-cost-root';
        root.innerHTML =
            '<section class="erpa-panel" role="dialog" aria-modal="true" aria-label="SKU 采购成本预览">' +
                '<header class="erpa-header"><div class="erpa-title-wrap">' +
                    '<div class="erpa-title-line"><h2 class="erpa-title">SKU 采购成本预览</h2><span class="erpa-badge">Lworkstation</span></div>' +
                    '<p class="erpa-subtitle" id="erpa-preview-scope">按台账当月及以前采购，取时间最近三笔；完整证据回传工作台</p></div>' +
                    '<button class="erpa-icon-button" id="erpa-close" type="button" title="关闭" aria-label="关闭">×</button></header>' +
                '<div class="erpa-page-context" id="erpa-page-context" role="status" aria-live="polite"></div>' +
                '<div class="erpa-anomaly-banner" id="erpa-anomaly-banner" role="alert"></div>' +
                '<div class="erpa-toolbar">' +
                    '<input class="erpa-search" id="erpa-search" type="search" autocomplete="off" placeholder="搜索仓库 SKU、平台 SKU/SKC、产品名称或单号">' +
                    '<button class="erpa-button erpa-button-primary" id="erpa-recalculate" type="button"><b aria-hidden="true">↻</b><span>重新核算</span></button>' +
                    '<button class="erpa-button" id="erpa-supplement-catalog" type="button"><span>补充资料</span></button>' +
                    '<button class="erpa-button" id="erpa-resume" type="button" hidden>继续未完成采集</button>' +
                    '<button class="erpa-button" id="erpa-retry-batches" type="button" hidden>重试失败批次</button>' +
                    '<button class="erpa-button" id="erpa-copy" type="button"><b aria-hidden="true">⎘</b><span>复制成本</span></button>' +
                    '<button class="erpa-button" id="erpa-retry-delivery" type="button"><span>重试回传</span></button>' +
                    '<button class="erpa-button" id="erpa-export" type="button"><b aria-hidden="true">⇩</b><span>导出 CSV</span></button></div>' +
                '<div class="erpa-status-region"><div id="erpa-task-status" role="status" aria-live="polite"></div><div class="erpa-catalog-progress" id="erpa-catalog-progress" hidden><div><span id="erpa-catalog-message" role="status" aria-live="polite"></span><div id="erpa-catalog-meters"></div></div><button class="erpa-button" id="erpa-cancel-catalog" type="button">取消补充</button></div>' +
                '<div class="erpa-statusbar" id="erpa-statusbar"></div></div>' +
                '<div class="erpa-table-wrap" id="erpa-table-wrap"><table class="erpa-table">' +
                    '<colgroup><col style="width:180px"><col style="width:175px"><col style="width:180px"><col style="width:220px">' +
                    '<col style="width:70px"><col style="width:150px"><col style="width:90px"><col style="width:105px"><col style="width:115px"></colgroup>' +
                    '<thead><tr><th>仓库 SKU</th><th>平台 SKU / SKC</th><th>所选类型 / 采购单号</th><th>产品名称</th>' +
                    '<th>次数</th><th>所选采购日期</th><th>采购量</th><th>采购价(￥)</th><th>预览成本(￥)</th></tr></thead>' +
                    '<tbody id="erpa-table-body"></tbody></table></div>' +
                '<div id="erpa-result-pages" hidden><button class="erpa-button" id="erpa-page-prev" type="button">上一页</button><span id="erpa-page-label"></span><button class="erpa-button" id="erpa-page-next" type="button">下一页</button></div>' +
                '<div class="erpa-empty" id="erpa-empty">暂无核算结果</div>' +
                '<footer class="erpa-footer"><span id="erpa-footer-left"></span><span id="erpa-footer-right"></span></footer>' +
                '<div class="erpa-loading" id="erpa-loading"><div class="erpa-loading-box"><div class="erpa-loading-heading"><div class="erpa-spinner" aria-hidden="true"></div><div>' +
                    '<p class="erpa-loading-title" id="erpa-loading-title" role="status" aria-live="polite"></p><p class="erpa-loading-meta" id="erpa-loading-meta"></p></div></div>' +
                    '<div id="erpa-loading-meters"></div>' +
                    '<div class="erpa-loading-actions"><small>可暂停或停止采集，已送达结果会保留。</small><button class="erpa-button" id="erpa-pause" type="button">暂停</button><button class="erpa-button erpa-button-danger" id="erpa-cancel" type="button">停止</button></div></div></div>' +
                '<div class="erpa-error" id="erpa-error"><div class="erpa-error-box"><h3 class="erpa-error-title" id="erpa-error-title"></h3>' +
                    '<p class="erpa-error-message" id="erpa-error-message"></p><div class="erpa-error-actions">' +
                    '<button class="erpa-button" id="erpa-error-close" type="button">关闭</button>' +
                    '<button class="erpa-button erpa-button-primary" id="erpa-error-retry" type="button">重试</button></div></div></div>' +
            '</section>';

        if (isTopFrame) document.body.appendChild(trigger);
        document.body.appendChild(root);

        const cachedResult = getResultCache();
        if (cachedResult) {
            lastImportEnvelope = cachedResult.importEnvelope || null;
            lastResults = resultPolicy.previewForLedger(cachedResult.results, cachedResult.warehouseEvidence, null);
            lastMeta = Object.assign({}, cachedResult.meta, buildWarningMeta(lastResults), { cacheRestored: true, ledgerPeriod: null });
            lastWarehouseEvidence = cachedResult.warehouseEvidence || null;
            const restoredSnapshot = requestContextPolicy.mergeQuerySnapshot(
                { capturedUrl: capturedListUrl, queryCapturedAt: capturedQueryCapturedAt },
                querySnapshotRestoreAllowed ? {
                    capturedUrl: cachedResult.capturedUrl,
                    queryCapturedAt: cachedResult.queryCapturedAt || cachedResult.meta?.queryCapturedAt,
                    registeredBefore: cachedResult.registeredBefore
                } : {}
            );
            capturedListUrl = restoredSnapshot.capturedUrl;
            capturedQueryCapturedAt = restoredSnapshot.queryCapturedAt;
            const resultDeliveryId = String(cachedResult.resultDeliveryId || '').trim() || makeResultDeliveryId();
            if (!cachedResult.resultDeliveryId) {
                setResultCache(lastResults, lastMeta, lastWarehouseEvidence, capturedListUrl, resultDeliveryId, cachedResult);
            }
            // Delivery retries are owned by extension background storage. Page-origin cache is preview-only.
            if (isPurchasePage()) void restorePreviewContext(cachedResult);
        }

        document.getElementById('erpa-close').addEventListener('click', closePanel);
        document.getElementById('erpa-recalculate').addEventListener('click', requestRecalculate);
        document.getElementById('erpa-supplement-catalog').addEventListener('click', supplementCatalog);
        document.getElementById('erpa-page-prev').addEventListener('click', () => { resultPage = Math.max(0, resultPage - 1); renderResults(); });
        document.getElementById('erpa-page-next').addEventListener('click', () => { resultPage += 1; renderResults(); });
        document.getElementById('erpa-resume').addEventListener('click', resumeCollection);
        document.getElementById('erpa-pause').addEventListener('click', () => { if (activeRun) { activeRun.pauseRequested = true; taskStage = '正在暂停 · 等待当前请求结束'; renderPageContext(); } });
        document.getElementById('erpa-retry-batches').addEventListener('click', async () => { try { if (collectionTaskState && !activeRun) { const response = await taskOperation({ action: 'control', taskId: collectionTaskState.taskId, control: 'retry_failed' }); collectionTaskState = response.task; await resumeCollection(); } } catch (error) { showError(error); } });
        void refreshCheckpoint();
        document.getElementById('erpa-copy').addEventListener('click', copyCosts);
        document.getElementById('erpa-retry-delivery').addEventListener('click', async () => {
            const cached = getResultCache();
            if (!cached?.resultDeliveryId) { showToast('请先采集成本证据'); return; }
            try { handleDeliveryStatus(await window.ShopeersErpDeliveryBridge.retry(cached.resultDeliveryId)); }
            catch (error) { showToast(error.message || '回传重试失败', 'error'); }
        });
        document.getElementById('erpa-export').addEventListener('click', exportCsv);
        document.getElementById('erpa-cancel-catalog').addEventListener('click', () => { if (activeRun) { activeRun.cancelledByUser = true; activeRun.controller.abort(); if (activeRun.task) void taskOperation({ action: 'control', taskId: activeRun.task.taskId, control: 'pause' }).catch(() => {}); } });
        document.getElementById('erpa-cancel').addEventListener('click', () => {
            if (activeRun) {
                activeRun.cancelledByUser = true;
                activeRun.controller.abort();
                if (activeRun.task) void taskOperation({ action: 'control', taskId: activeRun.task.taskId, control: 'stop' }).catch(() => {});
                taskStage = '已取消 · 待继续';
                hideLoading();
                renderPageContext();
            }
        });
        document.getElementById('erpa-error-close').addEventListener('click', hideError);
        document.getElementById('erpa-error-retry').addEventListener('click', requestRecalculate);
        document.getElementById('erpa-search').addEventListener('input', (event) => {
            searchText = event.target.value; resultPage = 0;
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
        if (!documentEventsBound) {
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && !activeRun) closePanel();
            });
            documentEventsBound = true;
        }

        updateActionState();
        renderAnomalyBanner();
        renderStatus();
        renderResults();
        return true;
    }

    function scheduleUiRepair() {
        if (!isTopFrame && !isPurchasePage()) return;
        if ((!isTopFrame || document.getElementById('erpa-cost-trigger')) && document.getElementById('erpa-cost-root')) return;
        window.clearTimeout(uiRepairTimer);
        uiRepairTimer = window.setTimeout(() => {
            uiRepairTimer = null;
            if (createUi()) schedulePageSizeUpgrade();
        }, 0);
    }

    function watchUiIntegrity() {
        if (uiRepairObserver || !document.documentElement || !window.MutationObserver) return;
        uiRepairObserver = new MutationObserver(scheduleUiRepair);
        uiRepairObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    function initWhenReady() {
        if (document.body) {
            createUi();
            schedulePageSizeUpgrade();
            watchUiIntegrity();
            void reportExtensionStatus();
            return;
        }
        document.addEventListener('DOMContentLoaded', () => {
            createUi();
            schedulePageSizeUpgrade();
            watchUiIntegrity();
            void reportExtensionStatus();
        }, { once: true });
    }

    async function reportExtensionStatus() {
        if (!isTopFrame && !isPurchasePage()) return;
        if (statusReportPending) { statusReportQueued = true; return; }
        const bridge = window.ShopeersErpDeliveryBridge;
        if (!bridge || typeof bridge.reportStatus !== 'function') return;
        statusReportPending = true;
        try {
            const loginRequired = needsLogin();
            const response = await bridge.reportStatus({
                ready: true,
                sessionState: loginRequired ? 'login_required' : erpSessionState,
                pageState: loginRequired ? 'login_required' : isPurchasePage() ? (capturedListUrl ? 'query_ready' : 'purchase_ready') : 'page_ready',
                queryAvailable: !loginRequired && isPurchasePage() && Boolean(capturedListUrl),
                userAgent: navigator.userAgent,
            });
            bridgeConnection = response?.ok ? 'connected' : 'disconnected';
        } catch { bridgeConnection = 'disconnected'; }
        finally {
            statusReportPending = false;
            renderPageContext();
            if (statusReportQueued) {
                statusReportQueued = false;
                void reportExtensionStatus();
            }
        }
    }

    function handleRouteChange() {
        const changed = currentPageUrl !== window.location.href;
        currentPageUrl = window.location.href;
        if (changed) {
            taskCache.clear(); resumableCheckpoint = null; taskStage = '';
            querySnapshotRestoreAllowed = false;
            capturedListUrl = '';
            capturedQueryCapturedAt = '';
            if (activeRun) {
                activeRun.cancelledByUser = true;
                activeRun.controller.abort();
                if (activeRun.task) void taskOperation({ action: 'control', taskId: activeRun.task.taskId, control: 'pause' }).catch(() => {});
            }
            if (pageSizeObserver) pageSizeObserver.disconnect();
            pageSizeObserver = null;
            pageSizeObservedBody = null;
        }
        if (!isTopFrame && !isPurchasePage()) closePanel();
        createUi();
        renderPageContext();
        updateIdleStatus();
        schedulePageSizeUpgrade();
        void reportExtensionStatus();
        if (changed) void refreshCheckpoint();
    }

    window.addEventListener('shopeers:erp-v8-route-changed', handleRouteChange);
    window.addEventListener('pageshow', handleRouteChange);
    window.addEventListener('online', () => { void reportExtensionStatus(); });
    window.addEventListener('shopeers:erp-v8-session-observed', (event) => {
        if (!['authenticated', 'login_required'].includes(event.detail?.state)) return;
        erpSessionState = event.detail.state;
        if (erpSessionState === 'login_required') { taskCache.clear(); if (activeRun) activeRun.controller.abort(new CostError('ERP 登录已失效', '请重新登录后继续，目标证据将重新核验。')); }
        if (!isTopFrame) {
            try { window.top.postMessage({ type: 'shopeers.erp.sessionState', state: erpSessionState }, new URL(window.top.location.href).origin); } catch { /* unsupported parent origins receive no signal */ }
        }
        renderPageContext();
        void reportExtensionStatus();
    });
    window.addEventListener('message', (event) => {
        if (isTopFrame && supportedErpUrl(event.origin) && event.data?.type === 'shopeers.erp.sessionState'
            && ['authenticated', 'login_required'].includes(event.data.state)
            && [...document.querySelectorAll('iframe')].some(frame => frame.contentWindow === event.source)) {
            erpSessionState = event.data.state;
            renderPageContext();
            void reportExtensionStatus();
            return;
        }
        if (isTopFrame || event.source !== window.top || !supportedErpUrl(event.origin)
            || event.data?.type !== 'shopeers.erp.openCostPreview' || !isPurchasePage()) return;
        createUi();
        openPanel();
    });

    initWhenReady();
    window.dispatchEvent(new CustomEvent('shopeers:erp-v8-session-replay-request'));
    schedulePageSizeUpgrade();
    reportExtensionStatus();
    window.setInterval(reportExtensionStatus, 15000);
    console.info(PREFIX, `v${EXTENSION_VERSION} 已在卓麟 ERP 启动`);
}());
