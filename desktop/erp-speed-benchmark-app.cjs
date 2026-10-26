const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { prepareRuntimeExtension, extensionStorageConfig } = require('./extension-runtime.cjs');
const { createInboxServiceController, installExtensionInboxTransport } = require('./inbox-service.cjs');
const { targets, ORDERS, fixture, assertBusinessResult } = require('../tools/fixtures/erp-speed-fixture.cjs');
const { instrument } = require('../tools/fixtures/erp-speed-instrumentation.cjs');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.ERP_BENCH_OUTPUT);
const scratch = path.join(out, 'scratch');
const profile = path.join(scratch, `native-profile-${process.pid}`);
const site = path.join(scratch, 'site');
const adoptionPollMs = Number(process.env.ERP_BENCH_ADOPTION_POLL_MS || 25);
assert.ok(Number.isInteger(adoptionPollMs) && adoptionPollMs >= 25 && adoptionPollMs <= 5000);
const capability = 'synthetic-benchmark-capability-20261027-0123456789';
const purchase = 'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html';
app.setPath('userData', profile);
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const completed = [], windows = new Set();
let inbox, port;
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value;
}
async function call(route, body) {
  const response = await fetch(`http://127.0.0.1:${port}/erp/v1/${route}`, { headers: { authorization: `Bearer ${capability}`, 'content-type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const value = await response.json(); assert.ok(response.ok, `${route}: ${response.status} ${JSON.stringify(value)}`); return value;
}
async function waitFor(check, label, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = await check(); if (value) return value; await pause(25); }
  throw new Error(`Benchmark timeout: ${label}`);
}
function hidden(ses) {
  const win = new BrowserWindow({ show: false, width: 1200, height: 850, webPreferences: { session: ses, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  windows.add(win); return win;
}
const evalIn = (win, code) => win.webContents.executeJavaScript(code);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function union(intervals) {
  const sorted = intervals.filter(x => Number.isFinite(x.end)).map(x => [x.start, x.end]).sort((a, b) => a[0] - b[0]);
  let total = 0, left, right;
  for (const [a, b] of sorted) { if (left === undefined) { left = a; right = b; } else if (a <= right) right = Math.max(right, b); else { total += right - left; left = a; right = b; } }
  return total + (left === undefined ? 0 : right - left);
}
function stats(trace, phase) {
  const spans = trace.spans.filter(x => x.phase === phase);
  const requests = spans.filter(x => x.kind === 'request');
  const queue = spans.filter(x => x.kind === 'queue');
  const perEndpoint = {};
  for (const name of new Set(requests.map(x => x.endpoint))) {
    const values = requests.filter(x => x.endpoint === name);
    perEndpoint[name] = { count: values.length, cumulativeMs: values.reduce((n, x) => n + x.end - x.start, 0), unionMs: union(values) };
  }
  const stages = Object.fromEntries([...new Set(spans.map(x => x.kind))].filter(name => !['queue', 'request'].includes(name)).map(name => [name, { cumulativeMs: spans.filter(x => x.kind === name).reduce((n, x) => n + x.end - x.start, 0), unionMs: union(spans.filter(x => x.kind === name)) }]));
  const cache = trace.cache.filter(x => x.phase === phase);
  const requestKeys = requests.map(x => x.url);
  const edges = requests.flatMap(x => [[x.start, 1], [x.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let active = 0, peak = 0; for (const [, delta] of edges) { active += delta; peak = Math.max(peak, active); }
  return { requestCount: requests.length, uniqueRequestCount: new Set(requestKeys).size, duplicateAttempts: requests.length - new Set(requestKeys).size, requestUnionMs: union(requests), cumulativeRequestMs: requests.reduce((n, x) => n + x.end - x.start, 0), cumulativeQueueMs: queue.reduce((n, x) => n + x.end - x.start, 0), queueUnionMs: union(queue), peak, perEndpoint, stages, cacheHits: cache.filter(x => x.hit).length, cacheMisses: cache.filter(x => !x.hit).length };
}
async function runCase(cap, mode, repetition, extensionDir) {
  const id = `${mode}-${cap}-${repetition}`;
  await inbox?.stop({ wait: true });
  inbox = createInboxServiceController({ executable: process.execPath, scriptPath: path.join(root, 'tools/erp-inbox-server.mjs'), runAsNode: true, port, capability, spoolPath: path.join(profile, id, 'inbox.json') });
  assert.equal((await inbox.start()).ok, true);
  await waitFor(() => call('status').catch(() => false), `${id} isolated inbox`);
  const baseDelay = mode === 'slow' ? 110 : 35;
  const timeoutMs = mode === 'timeout' ? 500 : 120000;
  const faultMode = ['timeout', 'timeout-real'].includes(mode) ? 'timeout' : mode === 'limited' ? 'limited' : '';
  const ses = session.fromPartition(`persist:benchmark-erp-${id}`);
  const localSession = session.fromPartition(`persist:benchmark-local-${id}`);
  const network = [], errors = [], adoption = [], envelopes = [], actualBodies = [];
  let inTask = false, faultUsed = false, browser, popup, local, extensionId;
  installExtensionInboxTransport(ses, () => inbox);
  ses.protocol.handle('https', async request => {
    const url = new URL(request.url);
    assert.equal(url.hostname, 'www.zhuolinkeji.cn', 'No real network fallback');
    if (url.pathname === new URL(purchase).pathname) return new Response('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body><h1>隔离 ERP 基准</h1></body></html>', { headers: { 'content-type': 'text/html' } });
    assert.ok(url.pathname.startsWith('/purchase/'), url.pathname);
    const entry = { url: url.href, endpoint: url.pathname.split('/').at(-1), start: performance.now(), inTask };
    network.push(entry);
    const selectedFault = inTask && !faultUsed && entry.endpoint === 'purchase-order-details' && url.searchParams.get('purchaseOrderId') === 'PO-SKC-0-0' && faultMode;
    if (selectedFault) faultUsed = true;
    await pause(selectedFault && faultMode === 'timeout' ? timeoutMs + 100 : baseDelay);
    entry.end = performance.now();
    if (selectedFault && faultMode === 'limited') { entry.status = 429; return new Response('limited', { status: 429, headers: { 'retry-after': '1' } }); }
    entry.status = 200; return new Response(JSON.stringify(fixture(url)), { headers: { 'content-type': 'application/json' } });
  });
  localSession.protocol.handle('https', async request => {
    const url = new URL(request.url); assert.equal(url.hostname, 'benchmark.invalid');
    if (url.pathname === '/') return new Response('<!doctype html><meta charset="utf-8"><script src="/local.js"></script>', { headers: { 'content-type': 'text/html' } });
    const relative = url.pathname.slice(1), file = path.resolve(site, relative);
    assert.ok(file.startsWith(site + path.sep), 'Benchmark asset path');
    return new Response(await fs.readFile(file), { headers: { 'content-type': 'text/javascript' } });
  });
  try {
    const loaded = await ses.extensions.loadExtension(extensionDir, { allowFileAccess: true });
    extensionId = loaded.id;
    popup = hidden(ses); await popup.loadURL(`chrome-extension://${loaded.id}/popup/popup.html`);
    await evalIn(popup, `chrome.storage.local.set(${JSON.stringify(extensionStorageConfig({ port, capability, workspaceId: 'workspace-default' }))})`);
    local = hidden(localSession); await local.loadURL('https://benchmark.invalid/');
    const context = await evalIn(local, `ERPBenchmarkLocal.setup(${JSON.stringify('BENCH-' + id)},${JSON.stringify(targets)})`);
    const request = { ...context.request, ledgerVersion: context.request.ledgerVersion };
    await call('requests', { request, expectedSkus: targets });
    browser = hidden(ses);
    browser.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    await browser.loadURL(`${purchase}?benchmarkTimeout=${timeoutMs}`);
    await waitFor(() => evalIn(browser, 'Boolean(document.querySelector("#erpa-cost-trigger"))'), 'extension mount');
    await evalIn(browser, 'fetch("/purchase/purchase/v1/purchase-order-page?sku=SKC-0&storeId=BENCH").then(x=>x.json())');
    inTask = true;
    const started = performance.now();
    await evalIn(browser, 'document.querySelector("#erpa-cost-trigger").click()');
    let trace;
    let nextAdoptionPoll = started;
    await waitFor(async () => {
      // The default isolates collection/adoption work. A 5000 ms control models
      // App.jsx's fixed polling cadence, without pretending to mount the full UI.
      if (performance.now() >= nextAdoptionPoll) {
        do { nextAdoptionPoll += adoptionPollMs; } while (nextAdoptionPoll <= performance.now());
        const body = await call('cost-batches?workspaceId=workspace-default');
        const batches = (body.batches || body.records || []).filter(x => x.requestId === request.id && !envelopes.some(y => y.deliveryId === x.deliveryId));
        for (const batch of batches) {
          const adoptStart = performance.now();
          const result = await evalIn(local, `ERPBenchmarkLocal.adopt(${JSON.stringify(batch.envelope)})`);
          adoption.push({ start: adoptStart, end: performance.now(), ...result });
          assert.equal(result.adoptionError, null);
          envelopes.push(batch); actualBodies.push(batch.envelope);
          const taskId = batch.envelope.batch.collectionTask?.taskId || batch.envelope.batch.sourceMeta?.collectionTaskId;
          const allTasks = await call('collection-tasks?workspaceId=workspace-default');
          const task = (allTasks.tasks || allTasks.records || []).find(x => x.requestId === request.id);
          assert.ok(task?.taskId || taskId, 'Actual collection task identity');
          await call(`collection-tasks/${task?.taskId || taskId}/adoption`, { workspaceId: 'workspace-default', deliveryId: batch.deliveryId, ...result.adoption.summary });
        }
      }
      trace = await evalIn(browser, 'JSON.parse(document.documentElement.getAttribute("data-erp-benchmark")||"null")');
      if (trace?.taskEnd) return true;
      return false;
    }, id, mode === 'timeout-real' ? 190000 : 90000);
    const wallMs = performance.now() - started;
    assert.equal(envelopes.length, 2);
    assert.equal(trace.calculations.length, 2);
    assert.equal(trace.costComplete, true);
    assert.deepEqual(errors, []);
    for (const batch of actualBodies) {
      assert.equal(batch.batch.evidenceStatus, 'complete');
      assert.equal(batch.batch.rows.length, 5);
      assert.ok(batch.batch.rows.every(row => row.unitCost === 5 && /^SKU-\d+$/.test(row.platformSku)));
      assert.ok(batch.batch.warehouseEvidence.every(row => row.purchaseRecords.length === ORDERS));
    }
    await evalIn(browser, 'window.dispatchEvent(new Event("erp-benchmark-warm"))');
    trace = await waitFor(async () => { const value = await evalIn(browser, 'JSON.parse(document.documentElement.getAttribute("data-erp-benchmark"))'); return value?.warmEnd ? value : false; }, 'same-task warm calculation');
    assert.deepEqual(trace.errors, []);
    assert.ok(trace.warm.every(x => x.equal), 'Warm cache preserves every business result and history record');
    const semantics = trace.calculations.map(x => JSON.parse(x.semantic));
    const cold = stats(trace, 'cold'), warm = stats(trace, 'warm');
    assert.ok(cold.peak <= cap);
    assert.equal(cold.requestCount, 560 + (faultMode ? 1 : 0));
    assert.equal(warm.requestCount, 0, 'Same-task complete evidence reuse performs no ERP fetch');
    const endCosts = adoption.at(-1).costs.sort((a, b) => a.platformSku.localeCompare(b.platformSku));
    assert.equal(endCosts.length, targets.length);
    assert.ok(endCosts.every(x => x.unitCost === 5));
    const products = adoption.at(-1).products.sort((a, b) => a.platformSku.localeCompare(b.platformSku));
    assert.equal(products.length, targets.length);
    assert.deepEqual(products.map(x => x.platformSku), targets.map(x => x.platformSku).sort());
    assert.ok(products.every(x => x.unitCostExact === '5' && x.profitExact === '88.6' && x.costSource === 'erp'));
    const result = { id, cap, mode, repetition, baseDelayMs: baseDelay, requestTimeoutMs: timeoutMs, acceleratedTimeout: mode === 'timeout', wallMs, taskMs: trace.taskEnd - trace.taskStart, coldCalculationMs: trace.calculations.reduce((n, x) => n + x.end - x.start, 0), warmCalculationMs: trace.warm.reduce((n, x) => n + x.end - x.start, 0), cold, warm, retryCount: trace.calculations.reduce((n, x) => n + x.meta.requestRetryCount, 0), rateLimitCount: trace.calculations.reduce((n, x) => n + x.meta.rateLimitCount, 0), localAdoptionMs: adoption.reduce((n, x) => n + x.receiveAndAdoptMs, 0), localProfitMs: adoption.reduce((n, x) => n + x.profitReadAndComputeMs, 0), semanticDigest: digest(semantics), finalCostDigest: digest(endCosts), nativeVisibleWindows: BrowserWindow.getAllWindows().filter(x => x.isVisible()).length };
    result.costAndAdoptionWallMs = adoption.at(-1).end - started;
    result.adoptionPollMs = adoptionPollMs;
    result.finalProfitDigest = digest(products);
    result.adoptionPollIdleAfterLastAdoptionMs = trace.spans.filter(x => x.kind === 'adoption-poll-wait').reduce((n, x) => n + Math.max(0, x.end - Math.max(x.start, adoption.at(-1).end + performance.timeOrigin - trace.timeOrigin)), 0);
    assert.equal(trace.calculations.reduce((n, x) => n + x.meta.requestCount, 0), cold.requestCount);
    assert.equal(result.nativeVisibleWindows, 0);
    assertBusinessResult({ envelopes: actualBodies, calculations: trace.calculations, adoption });
    await fs.writeFile(path.join(out, `${id}.json`), JSON.stringify({ result, trace, network, adoption, envelopes: actualBodies }, null, 2));
    console.log(JSON.stringify({id,wallMs:Math.round(wallMs),coldMs:Math.round(result.coldCalculationMs),warmMs:Math.round(result.warmCalculationMs),requests:cold.requestCount,peak:cold.peak,localMs:Math.round(result.localAdoptionMs+result.localProfitMs),semanticDigest:result.semanticDigest}));
    return result;
  } catch (error) {
    await fs.writeFile(path.join(out, `${id}-failure.json`), JSON.stringify({ error: error.stack, errors, network, adoption, envelopes: actualBodies, body: browser && !browser.isDestroyed() ? await evalIn(browser, 'document.body.innerText').catch(() => '') : '' }, null, 2));
    throw error;
  } finally {
    if (local && !local.isDestroyed()) await evalIn(local, 'ERPBenchmarkLocal.close()').catch(() => {});
    for (const win of [browser, popup, local]) if (win && !win.isDestroyed()) { windows.delete(win); win.destroy(); }
    if (extensionId) ses.extensions.removeExtension(extensionId);
    ses.protocol.unhandle('https'); localSession.protocol.unhandle('https');
  }
}
app.whenReady().then(async () => {
  try {
    await fs.mkdir(out, { recursive: true }); port = await freePort();
    const caps = process.env.ERP_BENCH_CAPS ? process.env.ERP_BENCH_CAPS.split(',').map(Number) : [8, 10, 12];
    const modes = process.env.ERP_BENCH_MODES?.split(',') || ['normal', 'slow', 'limited', 'timeout'];
    const repeats = Number(process.env.ERP_BENCH_REPEATS || 3);
    assert.ok(caps.length && caps.every(x => [8,10,12].includes(x)));
    assert.ok(modes.length && modes.every(x => ['normal','slow','limited','timeout','timeout-real'].includes(x)));
    assert.ok(Number.isInteger(repeats) && repeats >= 1 && repeats <= 3);
    const directories = new Map();
    for (const cap of caps) {
      const directory = await prepareRuntimeExtension({ sourceDirectory: path.join(root, 'integrations/erp-assistant-extension'), userDataPath: path.join(scratch, `cap-${cap}`), port, runtimeId: 'erp' });
      const sourceFile = path.join(directory, 'src/content.js');
      await fs.writeFile(sourceFile, instrument((await fs.readFile(sourceFile, 'utf8')).replace(/\r\n/g, '\n'), cap));
      directories.set(cap, directory);
    }
    // Rotate the configuration order to reduce systematic warm-machine bias.
    for (let repetition = 1; repetition <= repeats; repetition++) for (const mode of modes) {
      const ordered = [...caps.slice((repetition - 1) % caps.length), ...caps.slice(0, (repetition - 1) % caps.length)];
      for (const cap of ordered) completed.push(await runCase(cap, mode, repetition, directories.get(cap)));
    }
    assert.equal(new Set(completed.map(x => x.semanticDigest)).size, 1, 'Business results/history are invariant across the complete matrix');
    assert.equal(new Set(completed.map(x => x.finalCostDigest)).size, 1);
    assert.equal(new Set(completed.map(x => x.finalProfitDigest)).size, 1);
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ ok: true, runId: process.env.ERP_BENCH_RUN_ID, electron: process.versions.electron, fixture: { targets: targets.length, ordersPerTarget: ORDERS }, results: completed, limitations: ['Synthetic ERP delays; no real account/network.', `Local adoption uses a ${adoptionPollMs} ms benchmark poll; the full product UI ACK/recovery scheduler is not mounted.`, 'Warm timings are a second calculation of the same verified task, not a new task or restart; they include semantic consistency validation.', 'Timeout matrix uses 500 ms only in the disposable test extension; production remains 120000 ms.'] }, null, 2));
  } catch (error) { console.error(error.stack); await fs.writeFile(path.join(out, 'error.json'), JSON.stringify({ message: error.message, stack: error.stack, completed }, null, 2)); process.exitCode = 1; }
  finally { for (const win of windows) if (!win.isDestroyed()) win.destroy(); await inbox?.stop({ wait: true }); app.exit(process.exitCode || 0); }
});
