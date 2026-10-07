(function (global) {
    'use strict';
    const PRODUCT_PATH = '/purchase/product/v1/product-page';
    const MAPPING_PATH = '/purchase/product/v1/product-info-sku';
    const GROUPS = ['directory', 'mappings', 'images', 'suppliers', 'purchaseEvidence'];
    const LIMIT = 100;
    const MAX_PAGES = 1000;
    const key = value => String(value ?? '').normalize('NFKC').trim().toUpperCase();
    const unique = values => [...new Set(values.filter(Boolean))];

    function create({ apiGet: requestApi, readWarehouseEvidence: requestEvidence, policy, budgetMs = 30 * 60 * 1000, maxRequests = Infinity, getCache = () => null, setCache = () => {}, onProgress = () => {} }) {
        async function bounded(operation, run) {
            const signal = run.controller.signal;
            if (run.deadlineAt && Date.now() >= run.deadlineAt) { run.budgetExpired = true; run.controller.abort(new Error('catalog_stage_timeout')); }
            if (signal.aborted) throw signal.reason || new Error('collection_cancelled');
            if (run.requestBudget != null && --run.requestBudget < 0) { run.budgetExpired = true; throw new Error('catalog_request_budget'); }
            let listener;
            const aborted = new Promise((_, reject) => {
                listener = () => reject(signal.reason || new Error('collection_cancelled'));
                signal.addEventListener('abort', listener, { once: true });
            });
            try { return await Promise.race([Promise.resolve().then(operation), aborted]); }
            finally { signal.removeEventListener('abort', listener); }
        }
        const apiGet = (path, params, signal, context, run) => requestApi(path, params, signal, context);
        function list(response, label) {
            if (response?.code !== 0 || !Array.isArray(response.data)) throw new Error(label + ': invalid_response');
            return response.data;
        }
        function count(response) {
            if (response?.count == null || String(response.count).trim() === '') return null;
            const value = Number(response.count);
            if (!Number.isInteger(value) || value < 0) throw new Error('invalid_reported_count');
            return value;
        }
        async function products(skc, run) {
            const cacheKey = 'catalog_products_complete_v1_' + key(skc);
            const cached = getCache(cacheKey);
            if (cached?.complete === true && Array.isArray(cached.records)) return cached;
            const records = new Map();
            let expected = null, pageCount = 0;
            const reasons = [];
            try {
                for (let page = 1; page <= MAX_PAGES; page += 1) {
                    const response = await bounded(() => apiGet(PRODUCT_PATH, { composite: 1, page, limit: LIMIT, skuGroup: skc }, run.controller.signal, '商品档案第 ' + page + ' 页'), run);
                    const data = list(response, 'product-page');
                    pageCount += 1;
                    const reported = count(response);
                    if (page === 1) expected = reported;
                    if (reported !== expected) throw new Error('product_count_changed');
                    let added = 0;
                    for (const record of data) {
                        if (!key(record?.itemId)) throw new Error('product_item_id_missing');
                        if (!records.has(key(record.itemId))) { records.set(key(record.itemId), record); added += 1; }
                    }
                    if (expected != null && records.size > expected) throw new Error('product_count_mismatch');
                    if (expected != null && records.size === expected) {
                        const result = { records: [...records.values()], pageCount, complete: true, reasons: [] };
                        setCache(cacheKey, result);
                        return result;
                    }
                    if (!data.length) {
                        if (expected != null && records.size !== expected) throw new Error('product_count_mismatch');
                        return { records: [...records.values()], pageCount, complete: false, reasons: ['product_count_missing'] };
                    }
                    if (page > 1 && added === 0) throw new Error('product_page_not_advancing');
                }
                throw new Error('product_page_limit');
            } catch (error) {
                if ((run.controller.signal.aborted && !run.budgetExpired) || ['ERP_LOGIN_REQUIRED', 'ERP_COLLECTION_PAUSED'].includes(error.code)) throw error;
                reasons.push(String(error?.message || error));
                return { records: [...records.values()], pageCount, complete: false, reasons };
            }
        }
        async function mappings(warehouseSku, run) {
            const cacheKey = 'catalog_mappings_complete_v1_' + key(warehouseSku);
            const cached = getCache(cacheKey);
            if (cached?.complete === true && Array.isArray(cached.catalogMappings)) return cached;
            let data = [];
            try {
                const response = await bounded(() => apiGet(MAPPING_PATH, { productId: warehouseSku }, run.controller.signal, '仓库 SKU ' + warehouseSku + ' 平台映射'), run);
                data = list(response, 'product-info-sku');
                const reported = count(response);
                if (reported == null || reported !== data.length) throw new Error('mapping_count_mismatch');
                if (data.some(item => key(item?.associatedProductId) !== key(warehouseSku))) throw new Error('mapping_warehouse_mismatch');
                const catalogMappings = policy.normalizeCatalogMappings(data, warehouseSku);
                const result = { catalogMappings, mappings: policy.normalizeMappings(catalogMappings), complete: true, reasons: [], recordCount: data.length };
                setCache(cacheKey, result);
                return result;
            } catch (error) {
                if ((run.controller.signal.aborted && !run.budgetExpired) || ['ERP_LOGIN_REQUIRED', 'ERP_COLLECTION_PAUSED'].includes(error.code)) throw error;
                const safe = data.filter(item => key(item?.associatedProductId) === key(warehouseSku));
                const catalogMappings = policy.normalizeCatalogMappings(safe, warehouseSku);
                return { catalogMappings, mappings: policy.normalizeMappings(catalogMappings), complete: false, reasons: [String(error?.message || error)], recordCount: safe.length };
            }
        }
        async function collectScoped(querySkcs, run, initial = { results: [], warehouseEvidence: { warehouses: [] } }) {
            const scope = unique((Array.isArray(querySkcs) ? querySkcs : []).map(value => String(value).trim())).filter(Boolean);
            if (!scope.length) throw new Error('资料请求缺少已确认平台 SKC。');
            const attemptedAt = new Date().toISOString();
            const coverage = Object.fromEntries(GROUPS.map(group => [group, { state: 'complete', reasons: [], attemptedAt, pageCount: 0, recordCount: 0, missingCount: 0 }]));
            const mark = (group, reason, missing = 1) => { coverage[group].state = 'partial'; coverage[group].reasons.push(reason); coverage[group].missingCount += missing; };
            const results = new Map((initial.results || []).map(result => [key(result.warehouseSku), { ...result }]));
            const evidence = new Map((initial.warehouseEvidence?.warehouses || []).map(entry => [key(entry.warehouseSku), entry]));
            for (const skc of scope) {
                onProgress('商品目录', scope.indexOf(skc), scope.length);
                const state = await products(skc, run);
                coverage.directory.pageCount += state.pageCount;
                coverage.directory.recordCount += state.records.length;
                if (!state.complete) for (const reason of state.reasons) mark('directory', reason);
                for (const record of state.records) {
                    const product = policy.catalogProduct(record), previous = results.get(key(product.warehouseSku));
                    results.set(key(product.warehouseSku), { ...previous, ...product, unitCost: previous?.unitCost ?? null, selectedRecordIds: previous?.selectedRecordIds || [], mappings: previous?.mappings || [], catalogMappings: previous?.catalogMappings || [], name: product.name || previous?.name || '', imageUrl: product.imageUrl || previous?.imageUrl || '', purchaseCatalog: previous?.purchaseCatalog || product.purchaseCatalog, supplierName: previous?.supplierName || product.supplierName, supplier1688Links: previous?.supplier1688Links || [] });
                }
            }
            let completedTargets = 0;
            for (const result of results.values()) {
                onProgress('资料与采购证据', completedTargets++, results.size);
                const state = result.catalogMappingsComplete === true ? { mappings: result.mappings, catalogMappings: result.catalogMappings, complete: true, recordCount: result.catalogMappings.length, reasons: [] } : await mappings(result.warehouseSku, run);
                if (state.complete || result.catalogMappingsComplete !== true) {
                    result.mappings = state.mappings;
                    result.catalogMappings = state.catalogMappings;
                    result.catalogMappingsComplete = state.complete;
                }
                coverage.mappings.recordCount += state.recordCount;
                if (!state.complete) for (const reason of state.reasons) mark('mappings', result.warehouseSku + ':' + reason);
                const scoped = policy.filterCatalogBySkc([result], scope).results[0];
                if (!scoped) continue;
                try {
                    const evidenceKey = 'catalog_purchase_complete_v2_' + JSON.stringify([run.requestId || run.queryCapturedAt || '', run.ledgerPeriod || '', run.filters || {}, key(result.warehouseSku)]);
                    const previousEvidence = evidence.get(key(result.warehouseSku)) || getCache(evidenceKey);
                    const warehouse = previousEvidence?.evidenceComplete === true ? previousEvidence : await bounded(() => requestEvidence(result.warehouseSku, run), run);
                    if (warehouse.evidenceComplete === true) setCache(evidenceKey, warehouse);
                    if (warehouse.evidenceComplete === true || previousEvidence?.evidenceComplete !== true) evidence.set(key(result.warehouseSku), warehouse);
                    if (warehouse.evidenceComplete !== true) mark('purchaseEvidence', result.warehouseSku + ':incomplete_purchase_evidence');
                } catch (error) {
                    if ((run.controller.signal.aborted && !run.budgetExpired) || ['ERP_LOGIN_REQUIRED', 'ERP_COLLECTION_PAUSED'].includes(error.code)) throw error;
                    mark('purchaseEvidence', result.warehouseSku + ':' + String(error?.message || error));
                    if (!evidence.has(key(result.warehouseSku))) evidence.set(key(result.warehouseSku), { warehouseSku: result.warehouseSku, purchaseRecords: [], excludedRecords: [], sourceWarnings: ['purchase_read_failed'], evidenceComplete: false });
                }
                const warehouse = evidence.get(key(result.warehouseSku));
                coverage.purchaseEvidence.recordCount += (warehouse?.purchaseRecords || []).length + (warehouse?.excludedRecords || []).length;
                const purchaseRecords = [...(warehouse?.purchaseRecords || []), ...(warehouse?.excludedRecords || [])];
                result.supplierNames = unique([...(result.supplierNames || []), ...purchaseRecords.map(record => policy.catalogText(record.supplierName))]);
                result.supplier1688Links = policy.normalizeSupplier1688Links([...(result.supplier1688Links || []), ...purchaseRecords.flatMap(record => record.supplier1688Links || [])]);
                if (!result.supplierName && result.supplierNames.length === 1) result.supplierName = result.supplierNames[0];
                if (!result.imageUrl) result.imageUrl = purchaseRecords.map(record => policy.purchaseImageUrl(record)).find(Boolean) || '';
                if (!(result.supplierNames || []).length) mark('suppliers', result.warehouseSku + ':supplier_missing');
                else coverage.suppliers.recordCount += 1;
                if (!result.supplier1688Links.length) mark('suppliers', result.warehouseSku + ':supplier1688_link_missing');
                for (const mapping of scoped.mappings) {
                    if (!mapping.imageUrl && !result.imageUrl) mark('images', mapping.platformSku + ':image_missing');
                    else coverage.images.recordCount += 1;
                }
            }
            const scoped = policy.filterCatalogBySkc([...results.values()], scope);
            onProgress('资料与采购证据', completedTargets, results.size);
            for (const result of scoped.results) {
                const targetSkus = new Set(result.mappings.map(mapping => key(mapping.platformSku)));
                result.catalogMappings = result.catalogMappings.filter(mapping => targetSkus.has(key(mapping.platformSku)) && key(mapping.warehouseSku) === key(result.warehouseSku));
            }
            const warehouseScope = new Set(scoped.results.map(result => key(result.warehouseSku)));
            if (!scoped.results.length) { mark('mappings', 'no_target_skc_mapping'); mark('images', 'no_target_skc_mapping'); mark('suppliers', 'no_target_skc_mapping'); mark('purchaseEvidence', 'no_target_skc_mapping'); }
            for (const group of GROUPS) { coverage[group].reasons = unique(coverage[group].reasons); if (coverage[group].state !== 'complete' && !coverage[group].recordCount) coverage[group].state = 'unavailable'; }
            return { ...scoped, warehouseEvidence: { formatVersion: 1, warehouses: [...evidence.values()].filter(entry => warehouseScope.has(key(entry.warehouseSku))) }, coverage };
        }
        async function collect(querySkcs, parent, initial) {
            if (parent.controller.signal.aborted) throw parent.controller.signal.reason || new Error('collection_cancelled');
            const controller = new AbortController();
            const run = { ...parent, controller, requestBudget: maxRequests, deadlineAt: Date.now() + budgetMs };
            controller.signal.deadlineAt = run.deadlineAt;
            controller.signal.requestBudget = maxRequests;
            const relay = () => controller.abort(parent.controller.signal.reason);
            parent.controller.signal.addEventListener('abort', relay, { once: true });
            if (parent.controller.signal.aborted) relay();
            const timer = setTimeout(() => { run.budgetExpired = true; controller.abort(new Error('catalog_stage_timeout')); }, budgetMs);
            try { return await collectScoped(querySkcs, run, initial); }
            finally { clearTimeout(timer); parent.controller.signal.removeEventListener('abort', relay); }
        }
        return Object.freeze({ products, mappings, collect });
    }
    global.ShopeersErpCatalogCollector = Object.freeze({ create, PRODUCT_PATH, MAPPING_PATH });
})(typeof window === 'object' ? window : globalThis);
