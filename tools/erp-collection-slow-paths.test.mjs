import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'integrations/erp-assistant-extension/src');
const require = createRequire(path.join(root, 'frontend/package.json'));
const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
async function until(check, timeout = 3000) { const end = Date.now() + timeout; while (!check()) { if (Date.now() > end) throw new Error('condition timeout'); await pause(5); } }
const response = (data, count = data.length, code = 0) => ({ code, data, count });
const mapping = warehouse => ({ associatedProductId: warehouse, barcodeSkuid: 'SKU-' + warehouse, barcodeSkcid: 'SKC-A', barcodeAttributeSet: '红色' });
const detail = (id, warehouse = 'WH-A') => ({ purchaseOrderDetailId: 'D-' + id, itemId: warehouse, tradeName: '合成商品', creationTime: '2026-08-20', purchaseQuantity: 2, purchaseUnitPrice: 4, supplierName: '合成供应商' });
async function fixture(mode, realClock = false) {
 const window = new Window({ url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html' });
 const messages = [], calls = []; let optional = false, fail = true;
 const started = Date.now();
 if (!realClock) { const schedule = window.setTimeout.bind(window); window.setTimeout = (fn, ms, ...args) => schedule(fn, ms === 60000 ? 160 : ms === 20000 ? 40 : ms === 8000 ? 15 : ms === 5000 ? 100 : ms === 500 ? 5 : ms === 1000 ? 10 : ms, ...args); }
 window.chrome = { runtime: { lastError: null, sendMessage(message, callback) {
   messages.push({ ...JSON.parse(JSON.stringify(message)), at: Date.now() - started });
   if (mode === 'context-hang' && message.type === 'shopeers.erp.previewContext') return;
   callback(message.type === 'shopeers.erp.previewContext' ? { ok: true, ledgerPeriod: '2026-08' } : message.type === 'shopeers.erp.catalogContext' ? { ok: true, request: { requestId: 'CAT-A', platformSkcs: ['SKC-A'] } } : { ok: true, status: 'success', resultDeliveryId: message.payload?.resultDeliveryId });
 } } };
 window.fetch = async (raw, options) => {
   const url = new URL(raw), endpoint = url.pathname.split('/').at(-1); calls.push({ endpoint, params: Object.fromEntries(url.searchParams), at: Date.now() - started });
   if (mode === 'first-hang' && fail && endpoint === 'purchase-order-page') return new Promise(() => {});
   if (mode === 'json-hang' && fail && endpoint === 'purchase-order-page') return { ok: true, json: () => new Promise(() => {}) };
   if ((mode === 'login' || (mode === 'login-detail' && endpoint === 'purchase-order-details')) && fail) return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) };
   let body;
   if (endpoint === 'purchase-order-page') {
     assert.equal(url.searchParams.get('sku'), optional ? 'WH-UNSOLD' : 'SKC-A', 'history reads stay in the captured target or its verified warehouse mapping');
     assert.equal(url.searchParams.get('queryRange'), '0');
     assert.equal(url.searchParams.get('storeId'), 'STORE-A');
     if (optional && mode === 'huge') body = response(Array.from({ length: 50 }, (_, i) => ({ purchaseOrderId: 'H-' + url.searchParams.get('page') + '-' + i })), 100000);
     else body = response([{ purchaseOrderId: 'PO-A' }]);
   } else if (endpoint === 'purchase-order-details') body = response([detail(url.searchParams.get('purchaseOrderId'))]);
   else if (endpoint === 'product-info-sku') body = response([mapping(url.searchParams.get('productId'))]);
   else if (endpoint === 'product-page') {
     optional = true;
     if (mode === 'directory-hang' || mode === 'cancel-optional') return new Promise(() => {});
     if (mode === 'directory-failure') throw new Error('Failed to fetch');
     body = response([{ itemId: 'WH-A' }, { itemId: 'WH-UNSOLD' }, { itemId: 'WH-UNSOLD' }], 2);
   } else throw new Error(endpoint);
   return { ok: true, status: 200, json: async () => body };
 };
 for (const file of ['result-policy.js', 'catalog-collector.js', 'request-context.js', 'shopeers-bridge.js', 'content.js']) window.eval(await readFile(path.join(source, file), 'utf8'));
 await pause(5);
 window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: 'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-A&storeId=STORE-A&limit=20' } }));
 window.document.getElementById('erpa-cost-trigger').click();
 return { window, messages, calls, retry() { fail = false; window.document.getElementById('erpa-error-retry').click(); }, close: () => window.happyDOM.close() };
}
const cost = f => f.messages.find(m => m.type === 'shopeers.erp.submitCostResult');
const catalog = f => f.messages.find(m => m.type === 'shopeers.erp.submitCatalogResult');
for (const mode of ['directory-hang', 'directory-failure', 'huge', 'context-hang']) {
 const f = await fixture(mode);
 try {
  await until(() => cost(f));
  assert.equal(cost(f).payload.results[0].unitCost, mode === 'context-hang' ? null : '4.0000');
  if (mode === 'directory-hang') await until(() => !f.window.document.getElementById('erpa-catalog-progress').hidden);
  assert.equal(f.window.document.getElementById('erpa-loading').classList.contains('erpa-visible'), false, 'optional phase cannot obscure completed table');
  assert.match(f.window.document.getElementById('erpa-table-body').textContent, /WH-A/);
  await until(() => catalog(f));
  assert.ok(cost(f).at <= catalog(f).at);
  if (mode === 'directory-hang') assert.equal(catalog(f).payload.catalogCoverage.directory.state, 'unavailable');
  if (mode === 'huge') {
   const lists = f.calls.filter(c => c.endpoint === 'purchase-order-page');
   assert.ok(lists.length > 11 && lists.length <= 501, 'history continues past ten pages until the optional request/time budget, without a fixed order cap');
   assert.equal(f.calls.filter(c => c.endpoint === 'purchase-order-details').length, 1, 'huge optional history stops before high fan-out details');
   assert.equal(catalog(f).payload.catalogCoverage.purchaseEvidence.state, 'partial');
   assert.equal(catalog(f).payload.warehouseEvidence.warehouses.find(w => w.warehouseSku === 'WH-A').evidenceComplete, true);
  }
  checks.push({ mode, clock: 'accelerated deadlines only; unchanged production code', costMs: cost(f).at, catalogMs: catalog(f).at, requests: f.calls.length });
 } finally { await f.close(); }
}
for (const mode of ['first-hang', 'json-hang', 'login', 'login-detail']) {
 const f = await fixture(mode);
 try {
  await until(() => f.window.document.getElementById('erpa-error').classList.contains('erpa-visible'));
  assert.equal(f.calls.length, mode.startsWith('login') ? (mode === 'login' ? 1 : 2) : 3, 'bounded retries, no second page-size retry chain');
  assert.equal(cost(f), undefined);
  assert.match(f.window.document.getElementById('erpa-error-title').textContent, mode.startsWith('login') ? /登录已失效/ : /超时/);
  if (!mode.startsWith('login')) { f.retry(); await until(() => cost(f)); }
  checks.push({ mode, requestsBeforeRetry: mode.startsWith('login') ? (mode === 'login' ? 1 : 2) : 3, recoverable: !mode.startsWith('login') });
 } finally { await f.close(); }
}
for (const mode of ['first-hang', 'cancel-optional']) {
 const f = await fixture(mode);
 try {
  if (mode === 'cancel-optional') { await until(() => !f.window.document.getElementById('erpa-catalog-progress').hidden); f.window.document.getElementById('erpa-cancel-catalog').click(); }
  else { await until(() => f.calls.length > 0); f.window.document.getElementById('erpa-cancel').click(); }
  const count = f.calls.length; await pause(250); assert.equal(f.calls.length, count, 'cancel stops new requests even when fetch ignores AbortSignal');
  assert.equal(catalog(f), undefined);
  assert.equal(Boolean(cost(f)), mode === 'cancel-optional');
  checks.push({ mode, cancelled: true, requests: count });
 } finally { await f.close(); }
}
if (process.env.ERP_REAL_DEADLINE_QA === '1') {
 const f = await fixture('directory-hang', true);
 try { await until(() => cost(f)); await until(() => catalog(f), 65000); assert.ok(catalog(f).at >= 59000 && catalog(f).at < 65000); checks.push({ mode: 'directory-hang', clock: 'real production 60-second budget', costMs: cost(f).at, catalogMs: catalog(f).at, requests: f.calls.length }); }
 finally { await f.close(); }
}
await mkdir(path.join(root, 'archive/release-0.3.4'), { recursive: true });
await writeFile(path.join(root, process.env.ERP_REAL_DEADLINE_QA === '1' ? 'archive/release-0.3.4/slow-real-production-paths.json' : 'archive/release-0.3.4/slow-production-paths.json'), JSON.stringify({ syntheticResponses: true, productionCode: true, checks }, null, 2));
console.log(JSON.stringify(checks, null, 2));
