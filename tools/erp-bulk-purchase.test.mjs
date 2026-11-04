import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

const requireFrontend = createRequire(new URL('../frontend/package.json', import.meta.url));
const xlsx = requireFrontend('xlsx');
const context = { window: { XLSX: xlsx }, URL, structuredClone, TextDecoder, AbortController, DOMException };
for (const name of ['result-policy.js', 'bulk-purchase.js']) vm.runInNewContext(await fs.readFile(new URL(`../integrations/erp-assistant-extension/src/${name}`, import.meta.url), 'utf8'), context);
const policy = context.window.ShopeersErpResultPolicy;
const module = context.window.ShopeersErpBulkPurchase;
const headers = ['采购单号', '仓库SKU', '平台SKU', '采购数量', '采购单价', '创建时间', '采购状态', '1688订单状态', '供应商名称', '采购链接1688'];
const canonical = value => String(value).toUpperCase();
const digest = buffer => createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
const standard = rows => rows.map((row, index) => ({ order: `PO-${index + 1}`, warehouse: 'WH-A', skus: 'SKU-A', quantity: 2, price: 4,
    date: `2026-10-${String(25 - index).padStart(2, '0')} 12:00:00`, status: '已上架', nativeId: `native-${index + 1}`, ...row }));

function workbook(rows, columns = headers) {
    const values = rows.map(row => {
        const named = { '采购单号': row.order, '仓库SKU': row.warehouse, '平台SKU': row.skus, '采购数量': row.quantity, '采购单价': row.price,
            '创建时间': row.date, '采购状态': row.status, '1688订单状态': row.orderStatus || '已付款', '供应商名称': '合成供应商', '采购链接1688': 'https://detail.1688.com/offer/9000000011.html' };
        return columns.map(column => named[column] ?? '');
    });
    const book = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([columns, ...values]), 'Sheet1');
    return xlsx.write(book, { type: 'array', bookType: 'xlsx', compression: true });
}

// Use the production policy to calculate the normalized evidence; these tests
// exercise source selection and network decisions, not another cost algorithm.
function aggregate(details) {
    const warehouses = [...new Set(details.map(row => row.itemId))].map(warehouseSku => ({ warehouseSku, evidenceComplete: true, sourceWarnings: [], excludedRecords: [],
        purchaseRecords: details.filter(row => row.itemId === warehouseSku).map(row => ({ recordId: row.detailId, warehouseSku,
            purchaseOrderNo: row._purchaseOrderNo, purchaseOrderId: row._purchaseOrderId, quantity: row.purchaseQuantity,
            unitPrice: row.purchaseUnitPrice, purchaseDate: row.creationTime, statusFields: row._orderStatusFields, eligible: true, exclusionReasons: [] })) }));
    return { results: warehouses.map(row => ({ warehouseSku: row.warehouseSku })), warehouseEvidence: { warehouses, excludedDetails: [] }, skippedInvalid: 0 };
}

function harness(rows, { mappings = [], exportError = null, countOffset = 0, columns, expectedSkus = [{ platformSku: 'SKU-A', platformSkc: 'SKC-A' }] } = {}) {
    const bytes = workbook(rows, columns);
    const stats = { exports: 0, lists: 0, mappings: 0, details: 0 }, exportQueries = [], mappingQueries = [];
    const scope = { platformSkcs: [...new Set(expectedSkus.map(row => row.platformSkc))], expectedSkus, ledgerPeriod: '2026-10', requestId: 'REQUEST' };
    const run = { task: { taskId: 'TASK', scopeHash: 'SCOPE', requestSnapshot: scope }, requestId: 'REQUEST', runnerId: 'RUNNER', queryCapturedAt: '2026-11-01T00:00:00Z',
        controller: new AbortController(), querySkcs: ['SKC-A'] };
    const collector = module.create({ policy, aggregate, hash: async buffer => digest(buffer),
        requestExport: async query => { stats.exports++; exportQueries.push(query); if (exportError) throw exportError; return { buffer: bytes }; },
        requestList: async query => {
            stats.lists++;
            const scoped = rows.filter(row => !query.sku.startsWith('WH-') || canonical(row.warehouse) === canonical(query.sku));
            const orders = [...new Map(scoped.map(row => [row.order, { purchaseOrderNo: row.order, purchaseOrderId: row.nativeId, creationTime: row.date, purchaseStatus: '7' }])).values()];
            return { code: 0, count: orders.length + countOffset, data: orders };
        },
        readMappings: async warehouse => { stats.mappings++; mappingQueries.push(warehouse); return { complete: true, catalogMappings: mappings.filter(row => canonical(row.warehouseSku) === canonical(warehouse)) }; },
        readDetails: async order => {
            stats.details++;
            return rows.filter(row => row.order === order.purchaseOrderNo).map(row => ({ itemId: row.warehouse, purchaseQuantity: row.quantity,
                purchaseUnitPrice: row.price, creationTime: row.date, detailId: `native-detail-${row.order}` }));
        },
    });
    return { collector, stats, run, scope, bytes, exportQueries, mappingQueries, collect: () => collector.collect({ sku: 'SKC-A', storeId: '', queryRange: '0', page: 99, limit: 50 }, run, scope) };
}

test('reads reordered headers without selection exports shifting fields', () => {
    const rows = standard([{ price: 3.1415 }]);
    const columns = ['紧急类型', ...headers.toReversed()];
    const bytes = workbook(rows, columns);
    const parsed = module.parseWorkbook(bytes, digest(bytes));
    assert.equal(parsed.records[0].purchaseUnitPrice, 3.1415);
    assert.equal(parsed.records[0]._purchaseOrderNo, 'PO-1');
    assert.equal(parsed.records[0].purchaseQuantity, 2);
});

test('short exact mappings use ledger parents with no mapping requests', async () => {
    const h = harness(standard([{ price: 3 }, { price: 5 }, { price: 4 }]));
    const state = await h.collect();
    assert.equal(state.results[0].unitCost, '4.0000');
    assert.equal(state.results[0].mappings[0].platformSkc, 'SKC-A');
    assert.equal(state.meta.scopeDirectoryComplete, true);
    assert.equal(state.results[0].catalogMappingsComplete,false,'cost identity is sufficient while platform attributes remain on demand');
    assert.deepEqual(h.stats, { exports: 1, lists: 2, mappings: 0, details: 0 });
    assert.equal(h.exportQueries[0].page,undefined);
    assert.equal(h.exportQueries[0].limit,undefined);
});

test('one snapshot feeds multiple result batches without repeated exports', async () => {
    const rows = standard([{ }, { }, { }, { warehouse: 'WH-B', skus: 'SKU-B' }]);
    const h = harness(rows, { expectedSkus: [{ platformSku: 'SKU-A', platformSkc: 'SKC-A' }, { platformSku: 'SKU-B', platformSkc: 'SKC-B' }] });
    const first = await h.collect();
    h.run.querySkcs = ['SKC-B'];
    const second = await h.collect();
    assert.equal(h.exportQueries[0].sku, 'SKC-A SKC-B', 'full task uses the live-verified space-separated query format');
    assert.equal(first.results[0].mappings[0].platformSku, 'SKU-A');
    assert.equal(second.results[0].mappings[0].platformSku, 'SKU-B');
    assert.equal(second.meta.bulkExportCount, 0);
    assert.equal(second.meta.bulkSourceSha256, first.meta.bulkSourceSha256);
    assert.equal(h.stats.exports, 1);
});

test('long lists are ignored and fetched once per warehouse', async () => {
    const long = Array.from({ length: 110 }, (_, index) => `OTHER-${index}`).join(',').padEnd(1024, 'X').slice(0, 1024);
    const h = harness(standard([{ skus: long }, { skus: long }, { skus: long }]), { mappings: [{ platformSku: 'SKU-A', platformSkc: 'SKC-A', warehouseSku: 'WH-A' }] });
    const state = await h.collect();
    assert.equal(state.results[0].mappings[0].platformSku, 'SKU-A');
    assert.equal(h.stats.mappings, 1);
    assert.equal(h.stats.details, 0);
});

test('refuses an ERP parent conflict instead of borrowing a warehouse cost', async () => {
    const h = harness(standard([{ skus: 'X'.repeat(1024) }]), { mappings: [{ platformSku: 'SKU-A', platformSkc: 'WRONG-PARENT', warehouseSku: 'WH-A' }] });
    await assert.rejects(h.collect(), error => error.reason === 'target_mapping_unresolved');
});

test('uses raw mapping length and preserves the original outbound warehouse identifier', async () => {
    const h = harness(standard([{ warehouse:'wH-a',skus:'X'.repeat(1023)+' ' }]),{mappings:[{platformSku:'SKU-A',platformSkc:'SKC-A',warehouseSku:'wH-a'}]});
    const state = await h.collect();
    assert.deepEqual(h.mappingQueries,['wH-a']);
    assert.equal(state.results[0].catalogMappingsComplete,true);
});

test('full-history count mismatch is retained without downloading again for every batch', async () => {
    const h = harness(standard([{}]), { countOffset: 1 });
    await assert.rejects(h.collect(), error => error.reason === 'export_scope_changed');
    await assert.rejects(h.collect(), error => error.reason === 'export_scope_changed');
    assert.equal(h.stats.exports, 1);
});

test('does not retry permission errors as malformed exports', async () => {
    const h = harness(standard([{}]), { exportError: Object.assign(new Error('permission'), { code: 'ERP_PERMISSION_REQUIRED' }) });
    await assert.rejects(h.collect(), error => error.code === 'ERP_PERMISSION_REQUIRED');
    assert.equal(module.interrupted({ code: 'ERP_LOGIN_REQUIRED' }), true);
    assert.equal(module.interrupted({ status: 429 }), true);
    assert.equal(module.interrupted(new DOMException('cancelled', 'AbortError')), true);
});

test('stopped tasks do not send any export and clear starts a fresh source', async () => {
    const h = harness(standard([{}]));
    h.run.controller.abort();
    await assert.rejects(h.collect(), error => error.name === 'AbortError');
    assert.equal(h.stats.exports, 0);
    h.run.controller = new AbortController();
    await h.collect();
    h.collector.clear();
    await h.collect();
    assert.equal(h.stats.exports, 2);
});

test('scope changes invalidate the shared source', async () => {
    const h = harness(standard([{}]));
    await h.collect();
    h.run.task.taskId = 'ANOTHER-TASK';
    await h.collect();
    assert.equal(h.stats.exports, 2);
});

test('duplicate purchase lines fall back instead of double counting', async () => {
    const h = harness(standard([{ order: 'SAME' }, { order: 'SAME' }]));
    await assert.rejects(h.collect(), error => error.reason === 'duplicate_purchase_lines');
});

test('native identities and detail dates resolve the third-purchase boundary', async () => {
    const h = harness(standard([
        { order: 'LATEST', quantity: 10, price: 2, date: '2026-10-20 12:00:00' },
        { order: 'SECOND', quantity: 3, price: 3, date: '2026-10-19 12:00:00' },
        { order: 'BUSINESS-A', quantity: 1, price: 2, date: '2026-10-18 12:00:00', nativeId: 'NATIVE-20' },
        { order: 'BUSINESS-Z', quantity: 10, price: 2, date: '2026-10-18 12:00:00', nativeId: 'NATIVE-3' },
    ]));
    const state = await h.collect();
    assert.equal(state.results[0].unitCost, '2.2142');
    assert.equal(h.stats.details, 2);
    assert.equal(h.stats.lists, 3);
    assert.equal(state.meta.bulkBoundaryOrders, 2);
});

test('one-second differences away from selection boundaries cause no detail requests', async () => {
    const h = harness(standard([{}, {}, {}, { date: '2026-06-01 15:55:50' }]));
    await h.collect();
    assert.equal(h.stats.details, 0);
});

test('month boundary uncertainty uses the original path', async () => {
    const h = harness(standard([{ date: '2026-10-31 23:59:59' }]));
    await assert.rejects(h.collect(), error => error.reason === 'purchase_month_boundary');
});

test('cancelled and future purchases are excluded by the unchanged production policy', async () => {
    const h = harness(standard([{ price: 4 }, { price: 6 }, { price: 100, status: '已作废' }, { price: 200, date: '2026-11-02 12:00:00' }]));
    const state = await h.collect();
    assert.equal(state.results[0].unitCost, '5.0000');
});

test('rejects malformed workbooks, missing columns and lossy order identities', () => {
    assert.throws(() => module.parseWorkbook(new Uint8Array([1, 2, 3]).buffer, 'a'.repeat(64)), error => error.reason === 'invalid_workbook');
    const missing = workbook(standard([{}]), headers.filter(name => name !== '仓库SKU'));
    assert.throws(() => module.parseWorkbook(missing, digest(missing)), error => error.reason === 'purchase_columns_missing');
    const numeric = workbook(standard([{ order: 1234567890123456789 }]));
    assert.throws(() => module.parseWorkbook(numeric, digest(numeric)), error => error.reason === 'purchase_identity_missing');
    const invalidDate = workbook(standard([{ date: '2026-02-30 12:00:00' }]));
    assert.throws(() => module.parseWorkbook(invalidDate, digest(invalidDate)), error => error.reason === 'invalid_purchase_date');
    const alternateCalendar = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(alternateCalendar, xlsx.utils.aoa_to_sheet([headers]), 'Sheet1');
    alternateCalendar.Workbook = { WBProps: { date1904: true } };
    const alternateBytes = xlsx.write(alternateCalendar, { type: 'array', bookType: 'xlsx', compression: true });
    assert.throws(() => module.parseWorkbook(alternateBytes, digest(alternateBytes)), error => error.reason === 'unsupported_workbook');
});

test('changed historical warehouse relationships stay on the original path', async () => {
    const h = harness(standard([{}]));
    h.run.task.requestSnapshot.historyMappings = [{ platformSku: 'SKU-A', platformSkc: 'SKC-A', warehouseSku: 'OLD-WH' }];
    await assert.rejects(h.collect(), error => error.reason === 'historical_mapping_changed');
});
