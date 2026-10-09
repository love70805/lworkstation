import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

let expireMaterialDeadline;
const sandbox = { window: {}, URL, AbortController, setTimeout: (callback, ms, ...args) => {
  if (ms === 5000) expireMaterialDeadline = callback;
  return setTimeout(callback, ms, ...args);
}, clearTimeout };
for (const file of ['result-policy.js', 'catalog-collector.js']) vm.runInNewContext(await readFile(new URL('../integrations/erp-assistant-extension/src/' + file, import.meta.url), 'utf8'), sandbox);
const policy = sandbox.window.ShopeersErpResultPolicy;
const create = sandbox.window.ShopeersErpCatalogCollector.create;
const delay = () => new Promise(resolve => setTimeout(resolve, 1));
const until = async check => { const end = Date.now() + 3000; while (!check()) { assert.ok(Date.now() < end, 'parallel progress timed out'); await delay(); } };
const scope = ['A','B','C','D','E','F','G'];
const expectedSkus = scope.map(platformSkc => ({ platformSkc, platformSku: 'SKU-' + platformSkc }));
const evidence = skc => ({ warehouseSku: 'W-' + skc, evidenceComplete: true, purchaseRecords: [], excludedRecords: [] });
const product = skc => ({ code: 0, count: 1, data: [{ itemId: 'W-' + skc }] });
const mapping = skc => ({ code: 0, count: 1, data: [{ associatedProductId: 'W-' + skc, barcodeSkcid: skc, barcodeSkuid: 'SKU-' + skc }] });

let activeDirectory = 0, maxDirectory = 0, activeEvidence = 0, maxEvidence = 0;
const directoryGates = new Map(), evidenceGates = new Map(), progress = [];
const collector = create({ policy, onProgress: (...args) => progress.push(args),
  apiGet: async (endpoint, params) => {
    if (!endpoint.endsWith('product-page')) return mapping(params.productId.slice(2));
    maxDirectory = Math.max(maxDirectory, ++activeDirectory);
    await new Promise(resolve => directoryGates.set(params.skuGroup, resolve));
    activeDirectory -= 1;
    return product(params.skuGroup);
  },
  readWarehouseEvidence: async warehouse => {
    maxEvidence = Math.max(maxEvidence, ++activeEvidence);
    await new Promise(resolve => evidenceGates.set(warehouse, resolve));
    activeEvidence -= 1;
    if (warehouse === 'W-C') throw new Error('synthetic_evidence_failure');
    return evidence(warehouse.slice(2));
  }
});
const resultPromise = collector.collect(scope, { controller: new AbortController(), expectedSkus });
await until(() => directoryGates.size === 2);
assert.deepEqual([...directoryGates.keys()], ['A','B']);
// Fast B may finish before A; target assignment and final output stay stable.
directoryGates.get('B')(); directoryGates.delete('B');
await until(() => directoryGates.has('C'));
while (directoryGates.size) { for (const [key, resolve] of [...directoryGates]) { resolve(); directoryGates.delete(key); } await delay(); }
await until(() => evidenceGates.size === 5);
assert.equal(maxDirectory, 2); assert.equal(maxEvidence, 5);
while (evidenceGates.size) { for (const [key, resolve] of [...evidenceGates]) { resolve(); evidenceGates.delete(key); } await delay(); }
const result = await resultPromise;
assert.deepEqual([...result.results.map(item => item.warehouseSku)], scope.map(skc => 'W-' + skc));
assert.deepEqual([...result.warehouseEvidence.warehouses.map(item => item.warehouseSku)], scope.map(skc => 'W-' + skc));
assert.ok(result.coverage.purchaseEvidence.reasons.some(reason => reason.includes('synthetic_evidence_failure')));
assert.equal(result.warehouseEvidence.warehouses.filter(item => item.evidenceComplete).length, 6);
assert.equal(progress.at(-1)[1], 7); assert.equal(progress.at(-1)[2], 7);
assert.ok(progress.some(([, , , detail]) => detail.lane === 1 && detail.active === true));

const controller = new AbortController(); let started = 0;
const paused = create({ policy, readWarehouseEvidence: async () => {}, apiGet: () => { started += 1; return new Promise(() => {}); } });
const interrupted = paused.directory(scope, { controller });
await until(() => started === 2);
controller.abort(new Error('synthetic_cancel'));
await assert.rejects(interrupted, /synthetic_cancel/);
assert.equal(started, 2, 'cancel must not start queued targets');

// A material deadline preserves previously complete cost/evidence and marks
// unfinished targets partial; it must not act like an explicit user cancel.
const catalogResults = scope.map(skc => {
  const catalogMappings = policy.normalizeCatalogMappings(mapping(skc).data, 'W-' + skc);
  return { warehouseSku: 'W-' + skc, unitCost: '4.0000', catalogMappingsComplete: true, catalogMappings, mappings: policy.normalizeMappings(catalogMappings) };
});
let timedEvidenceReads = 0;
const timed = create({ policy, budgetMs: 5000, apiGet: async (endpoint, params) => endpoint.endsWith('product-page') ? product(params.skuGroup) : mapping(params.productId.slice(2)), readWarehouseEvidence: () => { timedEvidenceReads += 1; return new Promise(() => {}); } });
const partialPromise = timed.collect(scope, { controller: new AbortController(), expectedSkus }, { results: catalogResults, warehouseEvidence: { warehouses: [{ ...evidence('A'), purchaseRecords: [{ recordId: 'REC-A', warehouseSku: 'W-A', quantity: 1, unitPrice: 4, purchaseDate: '2026-08-10' }] }] } });
await until(() => timedEvidenceReads === 5);
expireMaterialDeadline();
const partial = await partialPromise;
assert.equal(timedEvidenceReads, 5, 'deadline must not start queued network reads');
assert.equal(partial.results.find(item => item.warehouseSku === 'W-A').unitCost, '4.0000');
assert.equal(partial.warehouseEvidence.warehouses.find(item => item.warehouseSku === 'W-A').evidenceComplete, true);
assert.equal(partial.coverage.purchaseEvidence.state, 'partial');
console.log('Catalog targets: actual 2-directory/5-material parallel reads, ordered results, independent failure, deadline preservation and queued cancellation passed');
