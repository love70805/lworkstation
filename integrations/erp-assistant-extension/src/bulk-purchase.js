(function (global) {
    'use strict';
    const EXPORT_PATH = '/purchase/purchase/v1/export-purchase-order';
    const MAX_BYTES = 32 * 1024 * 1024;
    const MAX_ROWS = 100000;
    const REQUIRED = ['采购单号', '仓库SKU', '平台SKU', '采购数量', '采购单价', '采购总价', '创建时间', '采购状态', '1688订单状态'];
    const text = value => String(value ?? '').normalize('NFKC').trim();
    const key = value => text(value).toUpperCase();
    const pairKey = (order, warehouse) => JSON.stringify([key(order), key(warehouse)]);
    const fallback = reason => Object.assign(new Error('批量采购需要原方式核验：' + reason), { code: 'ERP_BULK_FALLBACK', reason });
    const interrupted = error => error?.name === 'AbortError' || ['ERP_LOGIN_REQUIRED', 'ERP_PERMISSION_REQUIRED', 'ERP_COLLECTION_PAUSED', 'ERP_SERVICE_UNAVAILABLE'].includes(error?.code) || error?.status === 429;
    function assertRunning(run) { if (run.controller.signal.aborted) throw run.controller.signal.reason || new DOMException('采集已取消', 'AbortError'); }
    function decimal(value) {
        const source = text(value);
        if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(source) || !Number.isFinite(Number(source))) throw fallback('invalid_numeric_field');
        return Number(source);
    }
    function dateText(value, xlsx) {
        let source;
        if (typeof value === 'number') {
            const d = xlsx.SSF.parse_date_code(value);
            if (!d) throw fallback('invalid_purchase_date');
            const pad = number => String(number).padStart(2, '0');
            source = `${d.y}-${pad(d.m)}-${pad(d.d)} ${pad(d.H)}:${pad(d.M)}:${pad(Math.floor(d.S))}`;
        } else source = text(value).replace('T', ' ');
        const parsed = new Date(source.replace(' ', 'T') + 'Z');
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(source) || !Number.isFinite(parsed.getTime())
            || parsed.toISOString().slice(0, 19).replace('T', ' ') !== source) throw fallback('invalid_purchase_date');
        return source;
    }
    function inspectZip(buffer) {
        const bytes = new Uint8Array(buffer);
        if (bytes.byteLength < 22 || bytes.byteLength > MAX_BYTES || bytes[0] !== 80 || bytes[1] !== 75) throw fallback('invalid_workbook');
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let end = -1;
        for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
            if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
        }
        if (end < 0 || view.getUint16(end + 10, true) > 2048) throw fallback('unsupported_workbook');
        let position = view.getUint32(end + 16, true), expanded = 0;
        const count = view.getUint16(end + 10, true);
        for (let index = 0; index < count; index++) {
            if (position + 46 > bytes.length || view.getUint32(position, true) !== 0x02014b50 || (view.getUint16(position + 8, true) & 1)) throw fallback('unsupported_workbook');
            expanded += view.getUint32(position + 24, true);
            if (expanded > 128 * 1024 * 1024) throw fallback('workbook_too_large');
            position += 46 + view.getUint16(position + 28, true) + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
        }
    }
    function parseWorkbook(buffer, digest, xlsx = global.XLSX) {
        if (!xlsx?.read || !/^[a-f0-9]{64}$/.test(digest)) throw fallback('workbook_reader_unavailable');
        inspectZip(buffer);
        const book = xlsx.read(new Uint8Array(buffer), { type: 'array', cellFormula: true, cellHTML: false, cellStyles: false, cellDates: false });
        if (book.Workbook?.WBProps?.date1904) throw fallback('unsupported_workbook');
        let sheet, sheetName, rows, headers;
        for (const name of book.SheetNames) {
            const candidate = book.Sheets[name];
            const range = xlsx.utils.decode_range(candidate['!ref'] || 'A1');
            if (range.e.r > MAX_ROWS || range.e.c > 255) throw fallback('workbook_too_large');
            const values = xlsx.utils.sheet_to_json(candidate, { header: 1, raw: true, defval: null, blankrows: true });
            const names = (values[0] || []).map(text);
            if (REQUIRED.every(header => names.includes(header))) {
                if (sheet) throw fallback('ambiguous_worksheet');
                sheet = candidate; sheetName = name; rows = values; headers = names;
            }
        }
        if (!sheet) throw fallback('purchase_columns_missing');
        if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw fallback('duplicate_headers');
        const columns = Object.fromEntries(headers.map((name, index) => [name, index]));
        const records = [], pairs = new Set(), duplicateWarehouses = new Set(), orders = new Set();
        for (let index = 1; index < rows.length; index++) {
            const values = rows[index];
            if (!values.some(value => value != null && value !== '')) continue;
            const get = name => values[columns[name]];
            for (const name of REQUIRED) {
                if (sheet[xlsx.utils.encode_cell({ r: index, c: columns[name] })]?.f) throw fallback('formula_in_purchase_evidence');
            }
            const warehouseSku = text(get('仓库SKU')), order = text(get('采购单号'));
            if (!warehouseSku || !order || typeof get('采购单号') === 'number' && Math.abs(get('采购单号')) >= 1e15) throw fallback('purchase_identity_missing');
            const pair = pairKey(order, warehouseSku);
            if (pairs.has(pair)) duplicateWarehouses.add(key(warehouseSku));
            pairs.add(pair); orders.add(key(order));
            const supplierName = text(get('供应商名称'));
            const url = text(get('采购链接1688'));
            records.push({ itemId: warehouseSku, detailId: `bulk:${digest}:${sheetName}:${index + 1}`,
                _purchaseOrderNo: order, _purchaseOrderId: order, _orderNo1688: text(get('1688订单号')),
                purchaseQuantity: decimal(get('采购数量')), purchaseUnitPrice: decimal(get('采购单价')),
                purchaseTotalPrice: decimal(get('采购总价')),
                ...(columns['服务单价'] != null ? { serviceUnitPrice: decimal(text(get('服务单价')) || '0') } : {}),
                creationTime: dateText(get('创建时间'), xlsx), platformSkuList: text(get('平台SKU')), platformSkuListLength: String(get('平台SKU') ?? '').length,
                tradeName: text(get('商品名称')), imageUrl: text(get('图片链接')), _supplierName: supplierName,
                _supplier1688Url: url, _supplier1688Links: url ? [{ type: 'product', supplierName, url }] : [],
                _orderStatusFields: { purchaseStatus: text(get('采购状态')), purchaseOrderStatus1688: text(get('1688订单状态')) },
                purchaseCatalog: { purchaseOrderNo: order, productColor: text(get('商品颜色')),
                    specificationAndModel: text(get('规格型号')), model1688: text(get('商品规格型号1688')),
                    purchaseSpecificationAndModel1688: text(get('采购规格型号1688')), purchaseProportion1688: text(get('采购比例1688')) },
            });
        }
        return { records, orders, duplicateWarehouses, rowCount: records.length, digest };
    }
    function create({ policy, requestExport, requestList, readMappings, readDetails, aggregate, hash, onProgress = () => {} }) {
        const snapshots = new Map();
        function clear() { snapshots.clear(); }
        const listRows = response => {
            if (response?.code !== 0 || !Array.isArray(response.data) || !Number.isSafeInteger(Number(response.count)) || Number(response.count) < 0) throw fallback('purchase_count_unavailable');
            return response.data;
        };
        const fingerprint = response => JSON.stringify(listRows(response).map(row => [row.purchaseOrderId, row.purchaseOrderNo, row.creationTime, row.purchaseStatus]));
        async function load(filters, run, context) {
            assertRunning(run);
            const before = await requestList({ ...filters, page: 1, limit: 200 }, run);
            listRows(before);
            onProgress('正在批量采集采购成本', '正在后台读取采购历史');
            const exportFilters = { ...filters };
            delete exportFilters.page; delete exportFilters.limit;
            const exported = await requestExport(exportFilters, run);
            if (!exported?.buffer) throw fallback('export_unavailable');
            assertRunning(run);
            const digest = await hash(exported.buffer);
            const source = parseWorkbook(exported.buffer, digest);
            assertRunning(run);
            const after = await requestList({ ...filters, page: 1, limit: 200 }, run);
            if (Number(before.count) !== Number(after.count) || fingerprint(before) !== fingerprint(after)
                || source.orders.size !== Number(before.count)
                || listRows(before).some(order => !source.orders.has(key(order.purchaseOrderNo)))) throw fallback('export_scope_changed');
            const expected = policy.platformScope(context.expectedSkus, context.platformSkcs);
            const byWarehouse = new Map(), long = new Set(), conflicts = new Set();
            const warehouseIdentifiers = new Map(source.records.map(record => [key(record.itemId), record.itemId]));
            function add(mapping) {
                const target = expected.get(key(mapping.platformSku));
                if (!target) return;
                if (key(target.platformSkc) !== key(mapping.platformSkc)) { conflicts.add(key(mapping.platformSku)); return; }
                const warehouse = key(mapping.warehouseSku);
                if (!byWarehouse.has(warehouse)) byWarehouse.set(warehouse, new Map());
                byWarehouse.get(warehouse).set(key(mapping.platformSku), mapping);
            }
            for (const record of source.records) {
                const warehouse = key(record.itemId);
                if (record.platformSkuListLength >= 1024) { long.add(warehouse); continue; }
                for (const token of record.platformSkuList.split(',')) {
                    const target = expected.get(key(token));
                    if (target) add({ platformSku: target.platformSku, platformSkc: target.platformSkc, warehouseSku: record.itemId });
                }
            }
            const candidates = new Map();
            for (const [warehouse, mappings] of byWarehouse) for (const sku of mappings.keys()) {
                if (!candidates.has(sku)) candidates.set(sku, new Set());
                candidates.get(sku).add(warehouse);
            }
            for (const warehouses of candidates.values()) if (warehouses.size > 1) for (const warehouse of warehouses) long.add(warehouse);
            let mappingRequests = 0;
            // Deduplicate by warehouse, including long lists without a visible
            // target prefix: a requested SKU can be hidden in their tail.
            const pending = [...long];
            const mappingReads = await Promise.allSettled(Array.from({ length: Math.min(4, pending.length) }, async () => {
                while (pending.length) {
                    assertRunning(run);
                    const warehouse = pending.shift();
                    onProgress('正在核对异常 SKU 映射', `${++mappingRequests} / ${long.size}`);
                    const state = await readMappings(warehouseIdentifiers.get(warehouse) || warehouse, run);
                    if (!state.complete) throw fallback('mapping_incomplete');
                    byWarehouse.delete(warehouse);
                    for (const mapping of state.catalogMappings) add(mapping);
                }
            }));
            const failedMapping = mappingReads.find(result => result.status === 'rejected');
            if (failedMapping) throw failedMapping.reason;
            const bySku = new Map();
            for (const [warehouse, mappings] of byWarehouse) for (const sku of mappings.keys()) {
                if (!bySku.has(sku)) bySku.set(sku, new Set());
                bySku.get(sku).add(warehouse);
            }
            const byRecordWarehouse = new Map();
            for (const record of source.records) {
                const warehouse = key(record.itemId);
                if (!byRecordWarehouse.has(warehouse)) byRecordWarehouse.set(warehouse, []);
                byRecordWarehouse.get(warehouse).push(record);
            }
            return { ...source, byWarehouse, bySku, byRecordWarehouse, conflicts, mappingRequests,
                count: Number(before.count), filters, fullMappingWarehouses: new Set(long), resolvedWarehouses: new Set(), boundaryOrders: 0 };
        }
        async function resolveBoundary(snapshot, warehouse, records, run, period) {
            if (snapshot.resolvedWarehouses.has(warehouse)) return;
            const valid = records.filter(row => row.creationTime.slice(0, 7) <= period && row.purchaseQuantity > 0 && row.purchaseUnitPrice >= 0 && !policy.cancelledPurchase(row._orderStatusFields))
                .sort((a, b) => b.creationTime.localeCompare(a.creationTime));
            const third = valid[2], fourth = valid[3];
            if (!third || !fourth || Math.abs(Date.parse(third.creationTime) - Date.parse(fourth.creationTime)) > 1000) return;
            const near = valid.filter(row => Math.abs(Date.parse(row.creationTime) - Date.parse(third.creationTime)) <= 1000);
            if (near.length > 8) throw fallback('purchase_time_ambiguous');
            const orders = [], filters = { ...snapshot.filters, sku: records[0].itemId, page: 1, limit: 200 };
            let response = await requestList(filters, run);
            orders.push(...listRows(response));
            const count = Number(response.count);
            for (let page = 2; orders.length < count; page++) {
                if (page > 100) throw fallback('purchase_time_ambiguous');
                response = await requestList({ ...filters, page }, run);
                const next = listRows(response);
                if (Number(response.count) !== count || !next.length) throw fallback('purchase_time_ambiguous');
                orders.push(...next);
            }
            const byOrder = new Map(orders.map(order => [key(order.purchaseOrderNo), order]));
            if (byOrder.size !== count) throw fallback('purchase_time_ambiguous');
            for (const row of near) {
                assertRunning(run);
                const order = byOrder.get(key(row._purchaseOrderNo));
                if (!order?.purchaseOrderId) throw fallback('purchase_identity_missing');
                const matches = (await readDetails(order, run)).filter(detail => key(detail.itemId) === warehouse);
                if (matches.length !== 1 || Number(matches[0].purchaseQuantity) !== row.purchaseQuantity || Number(matches[0].purchaseUnitPrice) !== row.purchaseUnitPrice
                    || policy.purchaseAmounts(matches[0]).totalPrice !== row.purchaseTotalPrice) throw fallback('purchase_snapshot_changed');
                const detail = matches[0];
                const date = policy.purchaseDateInfo(detail.creationTime);
                if (!date) throw fallback('invalid_purchase_date');
                if (Math.abs(Date.parse(detail.creationTime) - Date.parse(row.creationTime)) > 1000
                    || detail.creationTime.slice(0, 7) !== row.creationTime.slice(0, 7)
                    || detail.purchaseOrderId && text(detail.purchaseOrderId) !== text(order.purchaseOrderId)
                    || policy.cancelledPurchase({ ...policy.purchaseStatusFields(order), ...policy.purchaseStatusFields(detail) }) !== policy.cancelledPurchase(row._orderStatusFields)) throw fallback('purchase_snapshot_changed');
                // Only ambiguous selection boundaries need native detail time
                // and IDs; a harmless one-second difference elsewhere is accepted.
                Object.assign(row, { creationTime: detail.creationTime, _purchaseOrderId: order.purchaseOrderId,
                    detailId: text(detail.detailId || detail.purchaseOrderDetailId || detail.id) || row.detailId, bulkBoundaryVerified: true });
                snapshot.boundaryOrders++;
            }
            const selected = valid.sort((a, b) => b.creationTime.localeCompare(a.creationTime));
            if (selected[3] && Math.abs(Date.parse(selected[2].creationTime) - Date.parse(selected[3].creationTime)) <= 1000
                && (!selected[2].bulkBoundaryVerified || !selected[3].bulkBoundaryVerified)) throw fallback('purchase_time_ambiguous');
            snapshot.resolvedWarehouses.add(warehouse);
        }
        async function collect(filters, run, context) {
            assertRunning(run);
            const whole = run.task?.requestSnapshot || context;
            const scopeSkcs = (whole.platformSkcs || context.platformSkcs).map(item => text(item?.platformSkc ?? item));
            const expectedSkus = whole.expectedSkus || context.expectedSkus;
            const query = { ...filters, sku: scopeSkcs.join(' ') };
            const cacheKey = JSON.stringify([run.task?.taskId || run.requestId, run.task?.scopeHash, run.runnerId, run.queryCapturedAt, expectedSkus, query]);
            const reused = snapshots.has(cacheKey);
            if (!reused) { snapshots.clear(); snapshots.set(cacheKey, load(query, run, { platformSkcs: scopeSkcs, expectedSkus }).then(value => ({ value }), error => {
                if (interrupted(error) || run.controller.signal.aborted) { snapshots.delete(cacheKey); throw error; }
                return { error };
            })); }
            const entry = await snapshots.get(cacheKey);
            assertRunning(run);
            if (entry.error) throw entry.error;
            const snapshot = entry.value;
            const previousBoundaryOrders = snapshot.boundaryOrders;
            const targets = policy.platformScope(context.expectedSkus, run.querySkcs);
            const warehouses = new Set();
            const failures = new Map(), warehouseTargets = new Map();
            const rejectTarget = (target, reason) => failures.set(key(target.platformSkc), { platformSkc: target.platformSkc, reason });
            for (const [sku, target] of targets) {
                const choices = snapshot.bySku.get(sku);
                if (!choices || choices.size !== 1 || snapshot.conflicts.has(sku)) { rejectTarget(target, 'target_mapping_unresolved'); continue; }
                const warehouse = [...choices][0];
                if (snapshot.duplicateWarehouses.has(warehouse)) { rejectTarget(target, 'duplicate_purchase_lines'); continue; }
                const historical = (whole.historyMappings || []).filter(hint => key(hint.platformSku) === sku && hint.warehouseSku);
                if (historical.some(hint => key(hint.warehouseSku) !== warehouse)) { rejectTarget(target, 'historical_mapping_changed'); continue; }
                warehouses.add(warehouse);
                if (!warehouseTargets.has(warehouse)) warehouseTargets.set(warehouse, []);
                warehouseTargets.get(warehouse).push(target);
            }
            for (const warehouse of warehouses) {
                try {
                    const records = snapshot.byRecordWarehouse.get(warehouse);
                    if (!records?.length) throw fallback('purchase_history_missing');
                    const nextMonth = new Date(Date.UTC(Number(context.ledgerPeriod.slice(0, 4)), Number(context.ledgerPeriod.slice(5, 7)), 1));
                    if (records.some(row => Math.abs(Date.parse(row.creationTime.replace(' ', 'T') + 'Z') - nextMonth.getTime()) <= 1000)) throw fallback('purchase_month_boundary');
                    await resolveBoundary(snapshot, warehouse, records, run, context.ledgerPeriod);
                } catch (error) {
                    if (interrupted(error) || run.controller.signal.aborted) throw error;
                    for (const target of warehouseTargets.get(warehouse)) rejectTarget(target, error.reason || 'bulk_source_unavailable');
                }
            }
            // Separate only the affected scopes. Valid targets reuse this same
            // snapshot, while uncertain identities return to native reads.
            if (failures.size) throw Object.assign(fallback([...failures.values()][0].reason), {
                fallbackSkcs: [...failures.values()].map(item => item.platformSkc),
                bulkMetrics: { bulkExportCount: reused ? 0 : 1, bulkMappingRequests: reused ? 0 : snapshot.mappingRequests,
                    bulkBoundaryOrders: snapshot.boundaryOrders - previousBoundaryOrders },
            });
            const details = [...warehouses].flatMap(warehouse => snapshot.byRecordWarehouse.get(warehouse));
            const aggregated = aggregate(details, { allowEmpty: true });
            const products = [...warehouses].map(warehouse => {
                const records = snapshot.byRecordWarehouse.get(warehouse);
                const latest = [...records].sort((a, b) => b.creationTime.localeCompare(a.creationTime))[0];
                const mappings = [...snapshot.byWarehouse.get(warehouse).values()].filter(mapping => targets.has(key(mapping.platformSku)));
                return { warehouseSku: latest.itemId, name: latest.tradeName, imageUrl: latest.imageUrl,
                    supplierNames: [...new Set(records.map(row => row._supplierName).filter(Boolean))],
                    mappings, catalogMappings: mappings, catalogMappingsComplete: snapshot.fullMappingWarehouses.has(warehouse) };
            });
            const costs = new Map(aggregated.results.map(row => [key(row.warehouseSku), row]));
            aggregated.results = products.map(product => ({ ...product, ...costs.get(key(product.warehouseSku)),
                mappings: product.mappings, catalogMappings: product.catalogMappings, catalogMappingsComplete: product.catalogMappingsComplete }));
            for (const warehouse of aggregated.warehouseEvidence.warehouses) { warehouse.evidenceComplete = true; warehouse.sourceWarnings = []; }
            const evidence = { ...aggregated.warehouseEvidence, formatVersion: 1, excludedOrders: [], detailFailures: [], mappingFailures: [] };
            const results = policy.previewForLedger(aggregated.results, evidence, context.ledgerPeriod);
            for (const warehouse of evidence.warehouses) {
                const selected = new Set(results.find(result => key(result.warehouseSku) === key(warehouse.warehouseSku))?.selectedRecordIds || []);
                for (const record of warehouse.purchaseRecords) record.selectedForPreview = selected.has(record.recordId);
            }
            return { results, warehouseEvidence: evidence, catalogInitial: aggregated,
                meta: { querySkcs: run.querySkcs, ledgerPeriod: context.ledgerPeriod, collectionMethod: 'bulk_export',
                    sourceFormat: 'erp-bulk-export-v1', bulkSourceSha256: snapshot.digest, bulkSourceRows: snapshot.rowCount,
                    bulkExportCount: reused ? 0 : 1, bulkMappingRequests: reused ? 0 : snapshot.mappingRequests,
                    bulkBoundaryOrders: snapshot.boundaryOrders - previousBoundaryOrders, scopeDirectoryComplete: true, scopeDirectoryFailures: [],
                    platformScopePolicy: 'ledger_platform_pair', mappingScopeApplied: true, mappingFailureCount: 0,
                    targetMappingFailureCount: 0, orderCountMismatch: false, detailFailureCount: 0,
                    purchaseHistoryScope: 'complete_target_history', historyQueryRange: '0', historyTargetSku: scopeSkcs.join(','),
                    orderCount: snapshot.count, reportedOrderCount: snapshot.count, orderPageCount: reused ? 0 : 2,
                    detailCount: details.length, warehouseSkuCount: warehouses.size, platformSkuCount: targets.size,
                    evidenceRecordCount: evidence.warehouses.reduce((sum, row) => sum + row.purchaseRecords.length, 0),
                    excludedEvidenceCount: evidence.excludedDetails?.length || 0, skippedInvalid: aggregated.skippedInvalid,
                    catalogCoverage: Object.fromEntries(['directory', 'mappings', 'images', 'suppliers', 'purchaseEvidence'].map(group => [group, { state: 'unavailable', reasons: ['catalog_supplement_pending'] }])) } };
        }
        return Object.freeze({ collect, clear });
    }
    global.ShopeersErpBulkPurchase = Object.freeze({ create, parseWorkbook, EXPORT_PATH, MAX_BYTES, interrupted });
})(typeof window === 'object' ? window : globalThis);
