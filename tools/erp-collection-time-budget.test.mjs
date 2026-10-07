import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { collectionReply } from './fixtures/erp-content-checkpoint.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(path.join(root, 'frontend/package.json'));
const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
const pause = () => new Promise(resolve => setTimeout(resolve, 5));

async function slowCollection(cancel) {
  const window = new Window({ url: 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html' });
  const timers = new Map(), armed = [], calls = [], messages = [];
  const nativeSetTimeout = window.setTimeout.bind(window), nativeClearTimeout = window.clearTimeout.bind(window);
  let elapsed = 0, nextTimer = -1;
  // Advance long clocks without changing any production timeout values. Short
  // UI/bridge scheduling stays native, and synthetic responses take 80 seconds.
  window.setTimeout = (callback, ms, ...args) => {
    if (ms < 8000) return nativeSetTimeout(callback, ms, ...args);
    const id = nextTimer--; armed.push(ms);
    timers.set(id, { at: elapsed + ms, callback: () => callback(...args) });
    return id;
  };
  window.clearTimeout = id => { timers.delete(id); nativeClearTimeout(id); };
  const advance = async ms => {
    const target = elapsed + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      elapsed = next[1].at; timers.delete(next[0]); next[1].callback(); await pause();
    }
    elapsed = target; await pause();
  };
  const scope = ['SKC-A', 'SKC-B', 'SKC-C', 'SKC-D', 'SKC-E', 'SKC-F'];
  window.chrome = { runtime: { sendMessage(message, callback) {
    messages.push({ ...structuredClone(message), elapsed });
    callback(collectionReply(message, { platformSkcs: scope }) || (message.type === 'shopeers.erp.catalogContext'
      ? { ok: true, request: { requestId: 'CAT-SLOW', platformSkcs: scope } }
      : { ok: true, status: 'success' }));
  } } };
  window.fetch = raw => {
    const url = new URL(raw), endpoint = url.pathname.split('/').at(-1);
    const target = url.searchParams.get('sku') || url.searchParams.get('purchaseOrderId') || url.searchParams.get('productId') || url.searchParams.get('skuGroup');
    const id = target.split('-').at(-1); calls.push({ endpoint, elapsed });
    const data = endpoint === 'purchase-order-page' ? [{ purchaseOrderId: `PO-${id}` }]
      : endpoint === 'purchase-order-details' ? [{ purchaseOrderDetailId: `D-${id}`, itemId: `WH-${id}`, creationTime: '2026-08-20', purchaseQuantity: 2, purchaseUnitPrice: 4 }]
        : endpoint === 'product-info-sku' ? [{ associatedProductId: `WH-${id}`, barcodeSkuid: `SKU-${id}`, barcodeSkcid: `SKC-${id}` }]
          : [{ itemId: `WH-${id}` }];
    return new Promise(resolve => window.setTimeout(() => resolve({ ok: true, status: 200, json: async () => ({ code: 0, count: data.length, data }) }), 80000));
  };
  try {
    for (const file of ['result-policy.js', 'catalog-collector.js', 'request-context.js', 'shopeers-bridge.js', 'content.js']) {
      window.eval(await readFile(path.join(root, 'integrations/erp-assistant-extension/src', file), 'utf8'));
    }
    await pause();
    window.dispatchEvent(new window.CustomEvent('shopeers:erp-v8-query-captured', { detail: { url: 'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-A' } }));
    window.document.getElementById('erpa-cost-trigger').click();
    for (let i = 0; i < 100 && !calls.length; i++) await pause();
    assert.ok(calls.length);
    for (let i = 0; i < 4; i++) await advance(80000);
    assert.equal(window.document.getElementById('erpa-error').classList.contains('erpa-visible'), false, 'ongoing reads survive the old five-minute limit');
    if (cancel) {
      const count = calls.length;
      window.document.getElementById('erpa-cancel').click(); await pause(); await advance(180000);
      assert.equal(calls.length, count, 'cancel stops new reads even after the former deadline');
      assert.equal(messages.some(message => message.type === 'shopeers.erp.submitCostResult'), false);
      assert.equal(window.document.getElementById('erpa-recalculate').disabled, false);
    } else {
      for (let i = 0; i < 30 && !messages.some(message => message.type === 'shopeers.erp.submitCatalogResult'); i++) await advance(80000);
      const cost = messages.find(message => message.type === 'shopeers.erp.submitCostResult');
      const catalog = messages.find(message => message.type === 'shopeers.erp.submitCatalogResult');
      assert.ok(cost?.elapsed > 300000, 'costs complete after five minutes');
      assert.equal(cost.payload.results.length, 6);
      assert.ok(catalog?.elapsed - cost.elapsed > 60000, 'catalog continues beyond one minute');
      assert.equal(catalog.payload.catalogCoverage.directory.state, 'complete');
      assert.ok(armed.includes(60 * 60 * 1000) && armed.includes(30 * 60 * 1000) && armed.includes(120000));
    }
  } finally { timers.clear(); await window.happyDOM.close(); }
}

await slowCollection(false);
await slowCollection(true);
console.log('ERP extended deadlines: 80-second requests, >5-minute costs, >1-minute catalog and cancellation passed with virtual long clocks.');
