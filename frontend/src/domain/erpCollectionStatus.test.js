import { expect, it } from 'vitest';
import { erpCollectionPresentation, isActiveErpCollection, erpCostCollectionTiming } from './erpCollectionStatus';

it('does not extend finished costs for later adoption reports or optional catalog reads', () => {
  const task = { createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T05:00:00Z', runMode: 'catalog', runnerId: 'material-runner',
    batches: [{ deliveryId: 'D1', deliveredAt: '2026-10-18T00:10:00Z' }, { deliveryId: 'D2', deliveredAt: '2026-10-18T00:43:00Z' }] };
  expect(erpCostCollectionTiming(task)).toEqual({ completed: true, endedAt: '2026-10-18T00:43:00.000Z', elapsedMinutes: 43 });
  delete task.batches[1].deliveryId;
  expect(erpCostCollectionTiming(task)).toMatchObject({ completed: false, elapsedMinutes: 300, endedAt: null });
});

it('leaves historical finished costs without timestamps unknown', () => {
  expect(erpCostCollectionTiming({ createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T05:00:00Z', batches: [{ deliveryId: 'D' }] }))
    .toEqual({ completed: true, elapsedMinutes: null, endedAt: null });
});

const delivered = { platformSkcs: ['A'], status: 'delivered', deliveryId: 'D' };

it('shows actual background material reads without offering resume, including partial cost tasks', () => {
  for (const status of ['cost_complete', 'partial']) {
    const view = erpCollectionPresentation({ status, phase: 'catalog', batches: [{ ...delivered, catalogStatus: 'running' }] });
    expect(view).toMatchObject({ state: 'catalog_running', running: true, canResume: false, canRetry: false });
    expect(view.description).toContain('不阻塞已采用成本');
  }
});

it('distinguishes active cost reads, durable delivery confirmation and preparation', () => {
  expect(erpCollectionPresentation({ status: 'running', batches: [{ status: 'running' }] })).toMatchObject({ state: 'cost_running', running: true });
  expect(erpCollectionPresentation({ status: 'running', batches: [{ status: 'collected' }] }).title).toBe('正在后台确认成本送达');
  expect(erpCollectionPresentation({ status: 'running', batches: [{ status: 'pending' }] })).toMatchObject({ state: 'waiting', running: false, canResume: false });
  expect(erpCollectionPresentation({ status: 'cost_complete', phase: 'cost', batches: [delivered] })).toMatchObject({ state: 'cost_completed', running: false, canResume: true });
});

it('does not infer material execution from a legacy durable delivery or cost exceptions', () => {
  const legacy = { status: 'partial', phase: 'cost', batches: [{ ...delivered, status: 'incomplete' }] };
  expect(erpCollectionPresentation(legacy)).toMatchObject({ state: 'attention', running: false, canRetry: true });
  expect(erpCollectionPresentation({ ...legacy, executionProtocol: 2, runMode: 'cost' }).running).toBe(false);
  expect(erpCollectionPresentation({ ...legacy, executionProtocol: 2, runMode: 'catalog', runnerId: 'R' }))
    .toMatchObject({ state: 'catalog_running', running: true, canResume: false });
});

it('does not claim interrupted reads are still running and keeps continuation available', () => {
  const view = erpCollectionPresentation({ status: 'paused', recoveryRequired: true, phase: 'catalog', batches: [{ ...delivered, catalogStatus: 'running' }] });
  expect(view).toMatchObject({ state: 'cost_completed', running: false, canResume: true, tone: 'success', catalogOnly: true });
});

it('shows an initially prepared paused task as waiting for its first ERP read', () => {
  expect(erpCollectionPresentation({ status: 'paused', batches: [{ status: 'pending' }] }))
    .toMatchObject({ state: 'waiting', running: false, canResume: true });
});

it('ends activity when every material check completes despite the retained catalog phase', () => {
  const view = erpCollectionPresentation({ status: 'cost_complete', phase: 'catalog', batches: [{ ...delivered, catalogStatus: 'completed' }] });
  expect(view).toMatchObject({ state: 'completed', running: false, canResume: false, canStop: false });
});

it('keeps material omissions separate from cost evidence failures', () => {
  expect(erpCollectionPresentation({ status: 'cost_complete', batches: [{ ...delivered, catalogStatus: 'failed' }] })).toMatchObject({ state: 'cost_completed', running: false, canResume: true, canRetry: false, catalogOnly: true });
  expect(erpCollectionPresentation({ status: 'partial', batches: [{ ...delivered, status: 'incomplete', catalogStatus: 'completed' }] })).toMatchObject({ state: 'attention', running: false, canRetry: true, canResume: false });
});

it('shows durable ERP service pause separately from initial waiting and user pause', () => {
  const task = { status: 'paused', pauseReason: { code: 'ERP_SERVICE_UNAVAILABLE', message: 'ERP 返回了维护页面' }, batches: [{ status: 'pending' }] };
  const view = erpCollectionPresentation(task);
  expect(view).toMatchObject({ state: 'paused', running: false, canResume: true, canRetry: false, tone: 'warning' });
  expect(view.title).toContain('ERP 服务暂不可用');
  expect(view.description).toContain('服务恢复后');
  expect(erpCollectionPresentation({ ...task, status: 'running', batches: [{ status: 'running' }] }).state).toBe('cost_running');
});

it('distinguishes a queued continuation and a claimed executor from an actual read', () => {
  const task = { executionProtocol: 2, catalogMode: 'on_demand', runMode: 'cost', status: 'ready', batches: [{ status: 'pending' }] };
  expect(erpCollectionPresentation(task)).toMatchObject({ state: 'queued', running: false, canResume: false, canRetry: false });
  expect(erpCollectionPresentation({ ...task, status: 'running', runnerId: 'RUNNER' })).toMatchObject({ state: 'queued', canResume: false });
  expect(erpCollectionPresentation({ ...task, status: 'running', runnerId: 'RUNNER', batches: [{ status: 'running' }] })).toMatchObject({ state: 'cost_running', running: true });
});

it('finishes cost work without treating optional or stale material activity as running', () => {
  const task = { executionProtocol: 2, catalogMode: 'on_demand', runMode: 'cost', status: 'cost_complete', batches: [delivered] };
  expect(erpCollectionPresentation(task)).toMatchObject({ state: 'cost_completed', running: false, catalogOnly: true, canResume: true, canStop: false });
  expect(isActiveErpCollection(task)).toBe(false);
  expect(erpCollectionPresentation({ ...task, batches: [{ ...delivered, catalogStatus: 'running' }] })).toMatchObject({ state: 'cost_completed', running: false });
  expect(erpCollectionPresentation({ ...task, runMode: 'catalog', runnerId: 'RUNNER', batches: [{ ...delivered, catalogStatus: 'running' }] })).toMatchObject({ state: 'catalog_running', running: true, canResume: false });
  expect(erpCollectionPresentation({ ...task, status: 'partial', batches: [{ ...delivered, status: 'incomplete' }] })).toMatchObject({ canResume: false, canRetry: true });
});
