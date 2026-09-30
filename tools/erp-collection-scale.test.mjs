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
        assert.ok(resumedPages.includes(1) && resumedPages.includes(5) && !resumedPages.includes(2), 'resume verifies first page and reuses prior complete pages');
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


// Exercise the real production loop with a shorter clock budget. Repeated
// attempts must progress across completed targets, not re-spend the entire
// budget re-reading their first pages. No source files are altered by this test.
async function resumeAcrossTargets() {
  const window = new Window({ url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html' });
  const scope = Array.from({ length: 8 }, (_, index) => `SKC-${index}`), requests = [], messages = [];
  let requestId = 'SYN-BUDGET-A';
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
      await new Promise(resolve => setTimeout(resolve, 40));
      data = [{ purchaseOrderId: `${sku}-ORDER` }];
    } else if (endpoint === 'purchase-order-details') {
      const sku = url.searchParams.get('purchaseOrderId').split('-')[1];
      data = [{ purchaseOrderDetailId: `D-${sku}`, itemId: `WH-${sku}`, creationTime: '2026-08-20 12:00:00', purchaseQuantity: 2, purchaseUnitPrice: 4 }];
    } else if (endpoint === 'product-info-sku') {
      const sku = url.searchParams.get('productId').split('-')[1];
      data = [{ associatedProductId: `WH-${sku}`, barcodeSkuid: `SKU-${sku}`, barcodeSkcid: `SKC-${sku}` }];
    } else throw Error(endpoint);
    return { ok: true, status: 200, json: async () => ({ code: 0, count: data.length, data }) };
  };
  try {
    for (const name of ['result-policy.js', 'catalog-collector.js', 'request-context.js', 'shopeers-bridge.js', 'content.js']) {
      let source = await readFile(path.join(root, 'integrations/erp-assistant-extension/src', name), 'utf8');
      if (name === 'content.js') {
        assert.ok(source.includes('const COST_STAGE_BUDGET_MS = 5 * 60 * 1000;'));
        source = source.replace('const COST_STAGE_BUDGET_MS = 5 * 60 * 1000;', 'const COST_STAGE_BUDGET_MS = 110;');
      }
      window.eval(source);
    }
    window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: 'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-0' } }));
    const attempts = [];
    for (let attempt = 0; attempt < 10 && !messages.some(message => message.type === 'shopeers.erp.submitCostResult'); attempt++) {
      const before = requests.length;
      window.document.getElementById(attempt ? 'erpa-recalculate' : 'erpa-cost-trigger').click();
      await new Promise(resolve => setTimeout(resolve, 300));
      attempts.push(requests.slice(before).map(item => item.sku));
    }
    assert.ok(attempts.length > 1, 'the fixture must span multiple budgets');
    assert.deepEqual([...new Set(requests.map(item => item.sku))], scope, 'every pending target is eventually read');
    assert.equal(requests.filter(item => item.sku === 'SKC-0').length, 1, 'completed target is not re-read on each retry');
    const delivered = messages.find(message => message.type === 'shopeers.erp.submitCostResult');
    assert.ok(delivered, 'eventually submits only after all target lists are complete');
    assert.equal(delivered.payload.meta.orderCount, 8);
    assert.ok(delivered.payload.warehouseEvidence.warehouses.every(item => item.evidenceComplete));
    requestId = 'SYN-BUDGET-B';
    const before = requests.length;
    window.document.getElementById('erpa-recalculate').click();
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(requests[before]?.sku, 'SKC-0', 'a new request cannot reuse another request target checkpoint');
  } finally { await window.happyDOM.close(); }
}
await resumeAcrossTargets();
console.log('ERP scale: 602 orders / 14 pages, full targets, repeat/drift/zero-count/login stops, cancellation and cross-budget target resume passed');
