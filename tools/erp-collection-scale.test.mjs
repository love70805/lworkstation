import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'frontend/package.json'));
const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
async function scenario(fault = '') {
  const window = new Window({ url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html' });
  const messages = [], requests = [];
  let fail = fault;
  window.chrome = { runtime: { sendMessage(message, done) { messages.push(structuredClone(message)); done(message.type === 'shopeers.erp.previewContext' ? { ok: true, ledgerPeriod: '2026-08', requestId: 'SYN-REQUEST', platformSkcs: ['SKC-A', 'SKC-B'] } : message.type === 'shopeers.erp.catalogContext' ? { ok: false } : { ok: true, status: 'success' }); } } };
  window.fetch = async raw => {
    const url = new URL(raw), endpoint = url.pathname.split('/').at(-1), page = Number(url.searchParams.get('page'));
    requests.push({ endpoint, page, sku: url.searchParams.get('sku') });
    let data = [], count;
    if (endpoint === 'purchase-order-page') {
      const sku = url.searchParams.get('sku');
      assert.ok(['SKC-A', 'SKC-B'].includes(sku), 'never broaden to company history');
      if (fail === 'cancel' && page === 5) {
        window.document.getElementById('erpa-cancel').click();
        return new Promise(() => {});
      }
      if (fail === 'login' && page === 5) return { ok: false, status: 401 };
      const index = fail === 'repeat' && page === 5 ? 4 : page;
      const total = sku === 'SKC-A' ? 601 : 1;
      data = Array.from({ length: Math.max(0, Math.min(50, total - (index - 1) * 50)) }, (_, i) => ({ purchaseOrderId: `${sku}-${(index - 1) * 50 + i}` }));
      count = fail === 'zero_count' ? 0 : fail === 'drift' && page === 5 ? total + 1 : total;
    } else if (endpoint === 'purchase-order-details') {
      const id = url.searchParams.get('purchaseOrderId'), sku = id.startsWith('SKC-A') ? 'A' : 'B';
      data = [{ purchaseOrderDetailId: id, itemId: 'WH-' + sku, creationTime: '2026-08-20 12:00:00', purchaseQuantity: 2, purchaseUnitPrice: 4 }];
    } else if (endpoint === 'product-info-sku') {
      const sku = url.searchParams.get('productId').slice(-1);
      data = [{ associatedProductId: 'WH-' + sku, barcodeSkuid: 'SKU-' + sku, barcodeSkcid: 'SKC-' + sku }];
    } else throw new Error(endpoint);
    return { ok: true, status: 200, json: async () => ({ code: 0, count: count ?? data.length, data }) };
  };
  const waitFor = async predicate => { const deadline = Date.now() + 10000; while (!predicate()) { if (Date.now() > deadline) throw new Error(window.document.body.textContent); await new Promise(resolve => setTimeout(resolve, 5)); } };
  try {
    for (const name of ['result-policy.js', 'catalog-collector.js', 'request-context.js', 'shopeers-bridge.js', 'content.js']) window.eval(await readFile(path.join(root, 'integrations/erp-assistant-extension/src', name), 'utf8'));
    window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: 'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-A' } }));
    window.document.getElementById('erpa-cost-trigger').click();
    if (fault) {
      await waitFor(() => requests.some(item => item.page === (fault === 'zero_count' ? 1 : 5)) && (fault === 'login' ? window.document.body.textContent.includes('ERP 登录已失效') : !window.document.getElementById('erpa-recalculate').disabled));
      assert.equal(messages.some(item => item.type === 'shopeers.erp.submitCostResult'), false, 'incomplete target cannot submit a complete cost');
      if (fault === 'cancel') {
        fail = '';
        const before = requests.length;
        window.document.getElementById('erpa-recalculate').click();
        await waitFor(() => messages.some(item => item.type === 'shopeers.erp.submitCostResult'));
        const resumedPages = requests.slice(before).filter(item => item.endpoint === 'purchase-order-page' && item.sku === 'SKC-A').map(item => item.page);
        assert.ok(resumedPages.includes(1) && resumedPages.includes(5) && resumedPages.includes(2), 'partial resume verifies every page, including pages after an unchanged first page');
      } else return;
    } else await waitFor(() => messages.some(item => item.type === 'shopeers.erp.submitCostResult'));
    const cost = messages.find(item => item.type === 'shopeers.erp.submitCostResult').payload;
    assert.equal(cost.meta.orderCount, 602);
    assert.equal(cost.meta.orderPageCount, 14);
    assert.deepEqual(cost.meta.querySkcs, ['SKC-A', 'SKC-B'], 'registered full scope overrides display query subset');
    assert.equal(cost.warehouseEvidence.warehouses.every(item => item.evidenceComplete), true);
  } finally { await window.happyDOM.close(); }
}
for (const fault of ['', 'repeat', 'drift', 'cancel', 'login', 'zero_count']) await scenario(fault);


// Exercise the production deadline callback after a known complete target and
// an in-flight partial target. Advance that one clock explicitly instead of
// racing a 110ms deadline against scheduler/CI load. Successful attempts retain
// the real five-minute budget and await observable completion, not a fixed nap.
async function resumeAcrossTargets() {
  const window = new Window({ url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html' });
  const scope = Array.from({ length: 8 }, (_, index) => `SKC-${index}`), requests = [], messages = [];
  let requestId = 'SYN-BUDGET-A';
  let stallSecondTarget = true, currentAccountPrice = 4, expireStageBudget;
  const nativeSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = (callback, ms, ...args) => {
    if (ms === 5 * 60 * 1000) expireStageBudget = () => callback(...args);
    return nativeSetTimeout(callback, ms, ...args);
  };
  const waitFor = async (predicate, message) => {
    const deadline = Date.now() + 10000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(message + ': ' + window.document.body.textContent);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  };
  window.confirm = () => true;
  window.chrome = { runtime: { sendMessage(message, done) {
    messages.push(structuredClone(message));
    done(message.type === 'shopeers.erp.previewContext' ? { ok: true, ledgerPeriod: '2026-08', requestId, platformSkcs: scope } : message.type === 'shopeers.erp.catalogContext' ? { ok: false } : { ok: true, status: 'success' });
  } } };
  window.fetch = async raw => {
    const url = new URL(raw), endpoint = url.pathname.split('/').at(-1);
    let data;
    if (endpoint === 'purchase-order-page') {
      const sku = url.searchParams.get('sku'); requests.push({ requestId, sku });
      assert.ok(scope.includes(sku));
      if (stallSecondTarget && sku === scope[1]) return new Promise(() => {});
      data = [{ purchaseOrderId: `${sku}-ORDER` }];
    } else if (endpoint === 'purchase-order-details') {
      const sku = url.searchParams.get('purchaseOrderId').split('-')[1];
      data = [{ purchaseOrderDetailId: `D-${sku}`, itemId: `WH-${sku}`, creationTime: '2026-08-20 12:00:00', purchaseQuantity: 2, purchaseUnitPrice: currentAccountPrice }];
    } else if (endpoint === 'product-info-sku') {
      const sku = url.searchParams.get('productId').split('-')[1];
      data = [{ associatedProductId: `WH-${sku}`, barcodeSkuid: `SKU-${sku}`, barcodeSkcid: `SKC-${sku}` }];
    } else throw Error(endpoint);
    return { ok: true, status: 200, json: async () => ({ code: 0, count: data.length, data }) };
  };
  try {
    for (const name of ['result-policy.js', 'catalog-collector.js', 'request-context.js', 'shopeers-bridge.js', 'content.js']) {
      const source = await readFile(path.join(root, 'integrations/erp-assistant-extension/src', name), 'utf8');
      if (name === 'content.js') assert.ok(source.includes('const COST_STAGE_BUDGET_MS = 5 * 60 * 1000;'));
      window.eval(source);
    }
    window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: 'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-0' } }));
    for (let attempt = 0; attempt < 2; attempt++) {
      const before = requests.length;
      expireStageBudget = null;
      window.document.getElementById(attempt ? 'erpa-recalculate' : 'erpa-cost-trigger').click();
      await waitFor(() => requests.slice(before).some(item => item.sku === scope[1]), 'partial target must be in flight');
      assert.equal(typeof expireStageBudget, 'function', 'the production stage deadline is armed');
      expireStageBudget();
      await waitFor(() => !window.document.getElementById('erpa-loading').classList.contains('erpa-visible') && window.document.getElementById('erpa-error').classList.contains('erpa-visible') && !window.document.getElementById('erpa-recalculate').disabled && window.document.getElementById('erpa-error-title').textContent === '本次成本读取时间已到', 'deadline must abort and restore the retry action');
      assert.deepEqual(requests.slice(before).map(item => item.sku), scope.slice(0, 2), 'each interrupted attempt starts over at the previously completed target');
      assert.equal(messages.some(message => message.type === 'shopeers.erp.submitCostResult'), false, 'a partial/deadline attempt cannot submit complete costs');
    }
    stallSecondTarget = false;
    currentAccountPrice = 9;
    const completeStart = requests.length;
    window.document.getElementById('erpa-recalculate').click();
    await waitFor(() => messages.some(message => message.type === 'shopeers.erp.submitCostResult') && !window.document.getElementById('erpa-recalculate').disabled, 'one complete budget must deliver every target');
    assert.deepEqual(requests.slice(completeStart).map(item => item.sku), scope, 'one uninterrupted attempt reads every target without stitching prior attempts');
    assert.equal(requests.filter(item => item.sku === 'SKC-0').length, 3, 'unknown account/history forces complete target revalidation on every new attempt, including in the same document');
    const delivered = messages.find(message => message.type === 'shopeers.erp.submitCostResult');
    assert.ok(delivered, 'one uninterrupted full-budget attempt submits after all target lists are complete');
    assert.equal(delivered.payload.meta.orderCount, 8);
    assert.ok(delivered.payload.warehouseEvidence.warehouses.every(item => item.evidenceComplete));
    assert.ok(delivered.payload.results.every(item => Number(item.unitCost) === 9), 'all delivered prices come from this complete attempt');
    currentAccountPrice = 11;
    const changedStart = requests.length;
    window.document.getElementById('erpa-recalculate').click();
    await waitFor(() => messages.filter(message => message.type === 'shopeers.erp.submitCostResult').length === 2 && !window.document.getElementById('erpa-recalculate').disabled, 'same-document reread must finish');
    assert.deepEqual(requests.slice(changedStart).map(item => item.sku), scope);
    assert.ok(messages.filter(message => message.type === 'shopeers.erp.submitCostResult')[1].payload.results.every(item => Number(item.unitCost) === 11), 'previously complete same-document evidence must not retain stale detail prices');
    requestId = 'SYN-BUDGET-B';
    const before = requests.length;
    window.document.getElementById('erpa-recalculate').click();
    await waitFor(() => messages.filter(message => message.type === 'shopeers.erp.submitCostResult').length === 3 && !window.document.getElementById('erpa-recalculate').disabled, 'new request must complete independently');
    assert.equal(requests[before]?.sku, 'SKC-0', 'a new request cannot reuse another request target checkpoint');
  } finally { await window.happyDOM.close(); }
}
await resumeAcrossTargets();
console.log('ERP scale: 602 orders / 14 pages, full targets, repeat/drift/zero-count/login stops, cancellation, deterministic deadline rejection and fresh complete-budget rereads passed');
