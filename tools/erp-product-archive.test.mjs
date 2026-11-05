import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { scenario } from './erp-collection-batches.test.mjs';

const sandbox = { window: {}, URL, AbortController, setTimeout, clearTimeout };
for (const file of ['result-policy.js', 'catalog-collector.js']) vm.runInNewContext(await readFile(new URL('../integrations/erp-assistant-extension/src/' + file, import.meta.url), 'utf8'), sandbox);
const policy = sandbox.window.ShopeersErpResultPolicy;
const create = sandbox.window.ShopeersErpCatalogCollector.create;
const ids = Array.from({ length: 51 }, (_, i) => `WH-${i}`);
const expectedSkus = ids.map((warehouseSku, i) => ({ platformSku: `SKU-${i}`, platformSkc: 'SKC', warehouseSku }));
const seed = {
  directoryComplete: true,
  results: expectedSkus.map(mapping => ({ warehouseSku: mapping.warehouseSku, unitCost: 4, name: '旧资料',
    mappings: [mapping], catalogMappings: [mapping], catalogMappingsComplete: true })),
  warehouseEvidence: { warehouses: ids.map(warehouseSku => ({ warehouseSku, evidenceComplete: true, purchaseRecords: [{ unitPrice: 4 }], excludedRecords: [] })) },
};
const run = () => ({ controller: new AbortController(), expectedSkus });
const row = warehouseSku => ({ warehouseSku, productName: `档案${warehouseSku}`, attribute: '红色', imageUrl: 'https://images.example.invalid/a.jpg' });
const base = { policy, apiGet: async () => { throw new Error('must reuse durable identities'); }, readWarehouseEvidence: async () => { throw new Error('must reuse durable evidence'); } };
const before = JSON.stringify(seed), batches = [], progress = [];
const result = await create({ ...base, onProgress: (...args) => progress.push(args), readProductArchive: async ids => { batches.push([...ids]); return ids.map(row); } }).collect(['SKC'], run(), seed);
assert.deepEqual(batches.map(ids => ids.length), [50, 1]);
assert.equal(result.results.length, 51);
assert.ok(result.results.every(item => item.name === `档案${item.warehouseSku}` && item.catalogMappings[0].attribute === '红色' && item.unitCost === 4));
assert.equal(JSON.stringify(seed), before, 'catalog enrichment leaves the durable cost source unchanged');
assert.deepEqual(progress.filter(([label]) => label === '获取商品表格档案').map(([,done]) => done), [0, 50, 50, 51]);

const partial = await create({ ...base, readProductArchive: async ids => ids.slice(1).map(row) }).collect(['SKC'], run(), seed);
assert.equal(partial.coverage.directory.state, 'partial');
assert.equal(partial.coverage.directory.missingCount, 2);
const foreign = await create({ ...base, readProductArchive: async ids => [...ids.map(row), row('FOREIGN')] }).collect(['SKC'], run(), seed);
assert.equal(foreign.coverage.directory.state, 'partial');
assert.ok(foreign.results.every(item => item.name === '旧资料'), 'reject the whole conflicting chunk before applying any of it');
for (const code of ['ERP_LOGIN_REQUIRED', 'ERP_COLLECTION_PAUSED']) {
  let calls = 0;
  const collector = create({ ...base, readProductArchive: async () => { calls++; throw Object.assign(new Error(code), { code }); } });
  await assert.rejects(() => collector.collect(['SKC'], run(), seed), error => error.code === code);
  assert.equal(calls, 1, 'interruption must not start the next export chunk');
}

const pipeline = await scenario(10, 'product-archive', { archive: true, returnMetrics: true, firstBatchListLimit: 10 });
const rows = pipeline.catalogs.flatMap(envelope => envelope.rows);
assert.equal(rows.length, 10);
assert.ok(rows.every(item => item.productName === `表格商品${item.warehouseSku}` && item.imageUrl && item.supplier1688Links.length === 1));
assert.ok(rows.every(item => item.platformSku !== 'WRONG' && item.unitCost === undefined));
assert.ok(pipeline.deliveries.every(envelope => envelope.warehouseEvidence.warehouses.every(item => item.purchaseRecords.every(record => record.unitPrice === 4))));
assert.equal(pipeline.calls.filter(call => call.endpoint === 'export-select-goods').length, 2);
console.log('Product archive: real XLSX parsing and delivery, 50-row batching, durable identity reuse, cost isolation, missing/foreign rows and login/pause interruption passed');
