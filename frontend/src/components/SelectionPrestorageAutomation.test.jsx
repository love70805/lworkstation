// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import SelectionPrestorageAutomation from './SelectionPrestorageAutomation';
import { ToastProvider } from './UI';
import { db, DEFAULT_WORKSPACE_ID, saveProductCatalogRecord } from '../data/database';
import { withWorkspaceReset } from '../lib/workspaceBackgroundTasks';
import { syncErpCatalogPublications } from '../data/repositories/erpCatalogPublicationRepository';
let root, container, product;
async function waitFor(check) {
  for (let i = 0; i < 150; i++) {
    let ok; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); ok = await check(); });
    if (ok) return;
  }
  throw new Error(`Timed out: ${container.textContent}`);
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await db.delete(); await db.open();
  ({ product } = await saveProductCatalogRecord({ status: 'draft', draft: {
    name: '后台回传', platformSkc: 'BG', store: '甲店', imageUrl: 'https://example.com/bg.png',
    sourceUrl: 'https://detail.1688.com/offer/1.html', prestorage: true,
    variants: [{ platformSku: 'BG-A', attribute: '红色', salePrice: 20 }],
  } }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<ToastProvider><SelectionPrestorageAutomation /></ToastProvider>));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); db.close(); await db.delete(); });
const receiveCost = () => db.erpCostRows.add({ workspaceId: DEFAULT_WORKSPACE_ID, platformSku: 'BG-A', canonicalPlatformSku: 'BG-A', unitCost: 4, publishedAt: '2026-08-31T00:00:00Z' });
it('promotes on a source change without requiring the catalog page, and does not repeat the audit', async () => {
  expect((await db.products.get(product.id)).status).toBe('draft');
  await act(async () => receiveCost());
  await waitFor(async () => (await db.products.get(product.id)).status === 'active');
  await act(async () => db.products.update(product.id, { imageUrl: '' }));
  await waitFor(async () => (await db.auditEvents.toArray()).filter(event => event.after?.systemSource === 'prestorage-auto-promotion').length === 1);
  expect((await db.products.get(product.id)).status).toBe('active');
});
it('reports a rolled-back automatic write and accepts an explicit retry of the same source', async () => {
  const add = db.auditEvents.add.bind(db.auditEvents);
  const spy = vi.spyOn(db.auditEvents, 'add').mockImplementation(event => event.after?.systemSource === 'prestorage-auto-promotion' ? Promise.reject(new Error('暂时写入失败')) : add(event));
  await act(async () => receiveCost());
  await waitFor(() => container.textContent.includes('自动进入选品库失败'));
  expect((await db.products.get(product.id)).status).toBe('draft');
  spy.mockRestore();
  await act(async () => window.dispatchEvent(new Event('lworkstation:retry-prestorage')));
  await waitFor(async () => (await db.products.get(product.id)).status === 'active');
});
it('defers automatic promotion during restore and retries unchanged sources when maintenance ends', async () => {
  let finish;
  const paused = new Promise(resolve => { finish = resolve; });
  const restore = withWorkspaceReset(() => paused);
  await act(async () => receiveCost());
  await act(async () => new Promise(resolve => setTimeout(resolve, 50)));
  expect((await db.products.get(product.id)).status).toBe('draft');
  await act(async () => { finish(); await restore; });
  await waitFor(async () => (await db.products.get(product.id)).status === 'active');
});

it('keeps automatic archiving closed until the last batch calculation, then promotes exactly once', async () => {
  const workspaceId = DEFAULT_WORKSPACE_ID;
  const binding = { mode: 'after_costs', taskId: 'AUTOMATION-TASK', batchId: 'TASK-B1', attemptId: 'ATTEMPT-1' };
  await act(async () => {
    await db.ledgers.put({ id: 'L', workspaceId, period: '2026-08' });
    await db.erpCostRequests.put({ id: 'R', workspaceId, ledgerId: 'L', ledgerPeriod: '2026-08', platformSkcs: ['BG'] });
    await db.erpCostBatches.put({ id: 'B', workspaceId, ledgerId: 'L', requestId: 'R', status: 'published', sourceContract: {
      batchId: 'SOURCE-B', requestId: 'R', query: { platformSkcs: ['BG'] }, catalogRows: [], sourceMeta: { catalogPublication: binding } } });
    await db.erpCostRows.add({ workspaceId, ledgerId: 'L', batchId: 'B', platformSkc: 'BG', platformSku: 'BG-A', canonicalPlatformSku: 'BG-A', unitCost: 4, publishedAt: '2026-08-31T00:00:00Z' });
  });
  const task = { taskId: binding.taskId, workspaceId, ledgerId: 'L', requestId: 'R', catalogMode: 'after_costs', status: 'cost_complete', batches: [
    { batchId: binding.batchId, attemptId: binding.attemptId, status: 'delivered', deliveryId: 'D1', adoptionReportedAt: '2026-10-22T00:00:00Z' },
    { batchId: 'TASK-B2', attemptId: 'ATTEMPT-2', status: 'delivered', deliveryId: 'D2' },
  ] };
  await act(async () => { await syncErpCatalogPublications({ workspaceId, tasks: [task] }); await new Promise(resolve => setTimeout(resolve, 80)); });
  expect((await db.products.get(product.id)).status).toBe('draft');
  expect((await db.auditEvents.toArray()).some(event => event.after?.systemSource === 'prestorage-auto-promotion')).toBe(false);
  task.batches[1].adoptionReportedAt = '2026-10-22T00:01:00Z';
  await act(async () => syncErpCatalogPublications({ workspaceId, tasks: [task] }));
  await waitFor(async () => (await db.products.get(product.id)).status === 'active');
  expect((await db.auditEvents.toArray()).filter(event => event.after?.systemSource === 'prestorage-auto-promotion')).toHaveLength(1);
});
