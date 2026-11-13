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
    expect(view.description).toContain('已采用成本保持有效');
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

it('explains a delivery pause and keeps the original continuation available', () => {
  const view = erpCollectionPresentation({ executionProtocol: 2, status: 'paused',
    pauseReason: { code: 'ERP_DELIVERY_FAILED', message: '本机成本暂存空间不足。' },
    batches: [{ status: 'collected', resultDeliveryId: 'UNCONFIRMED' }, { status: 'pending' }] });
  expect(view).toMatchObject({ state: 'paused', running: false, canResume: true, tone: 'warning' });
  expect(view.title).toContain('成本回传未完成');
  expect(view.description).toContain('本机成本暂存空间不足');
  expect(view.description).toContain('继续原任务');
  expect(view.description).not.toContain('登录');
});

it('explains permission pauses before the first batch and during optional catalog without claiming logout', () => {
  const task = { status: 'paused', pauseReason: { code: 'ERP_PERMISSION_REQUIRED' }, batches: [{ status: 'pending' }] };
  for (const batches of [task.batches, [{ ...delivered, catalogStatus: 'running' }]]) {
    const view = erpCollectionPresentation({ ...task, batches });
    expect(view).toMatchObject({ state: 'paused', running: false, canResume: true, canRetry: false, tone: 'warning' });
    expect(view.title).toContain('店铺权限校验未通过');
    expect(view.description).toContain('继续原任务');
    expect(view.description).not.toContain('登录');
  }
  expect(erpCollectionPresentation({ ...task, status: 'stopped' }).state).toBe('stopped');
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

it('does not present a delivered cost runner as queued while its lease is being released', () => {
  const task = { executionProtocol: 2, catalogMode: 'on_demand', runMode: 'cost', status: 'cost_complete',
    runnerId: 'RETAINED', batches: [{ ...delivered, adoptionReportedAt: '2026-11-09T00:00:00Z' }] };
  expect(erpCollectionPresentation(task)).toMatchObject({ state: 'cost_completed', running: false, tone: 'success', canStop: false });
  expect(isActiveErpCollection(task)).toBe(false);
  expect(erpCollectionPresentation({ ...task, batches: [{ ...delivered, status: 'incomplete' }] })).toMatchObject({ state: 'attention', running: false, canRetry: true });
  expect(erpCollectionPresentation({ ...task, runMode: 'catalog', status: 'ready' })).toMatchObject({ state: 'queued', canResume: false });
});

it('shows local calculation before automatic catalog and keeps pause available', () => {
  const task = { executionProtocol: 2, catalogMode: 'after_costs', runMode: 'cost', runnerId: 'R', status: 'cost_complete', phase: 'cost_adoption', batches: [delivered] };
  expect(erpCollectionPresentation(task)).toMatchObject({ state: 'cost_adoption', running: true, canResume: false, canStop: true });
  expect(erpCollectionPresentation({ ...task, phase: 'catalog_ready' })).toMatchObject({ state: 'catalog_running', running: true });
  const paused = erpCollectionPresentation({ ...task, status: 'paused', runnerId: null });
  expect(paused.description).toContain('全部成本核算回执');
  expect(paused.canResume).toBe(true);
});

it('marks delivered on-demand work as collection-only until local calculation is confirmed', () => {
  const task = { executionProtocol: 2, costFlow: 'task', catalogMode: 'on_demand', status: 'cost_complete', batches: [delivered] };
  const pending = erpCollectionPresentation(task);
  expect(pending).toMatchObject({ state: 'cost_completed', running: false, tone: 'info', adoptionUnconfirmed: true });
  expect(pending.title).toBe('成本采集已完成');
  expect(pending.description).toContain('本机核算结果尚未确认');
  const confirmed = erpCollectionPresentation({ ...task, batches: [{ ...delivered, adoptionReportedAt: '2026-11-04T00:00:00Z' }] });
  expect(confirmed).toMatchObject({ tone: 'success', adoptionUnconfirmed: false });
  expect(confirmed.description).not.toContain('尚未确认');
});

it('explains task-wide collection and avoids batch instructions for recovery and exceptions', () => {
  const task = { costFlow: 'task', status: 'running', batches: [{ platformSkcs: ['A', 'B', 'C'], status: 'running' }] };
  expect(erpCollectionPresentation(task).description).toContain('整项任务的采购表');
  expect(erpCollectionPresentation(task).description).toContain('缺项与异常按需补查');
  for (const value of [task, { ...task, status: 'paused' }, { ...task, status: 'partial', batches: [{ ...delivered, status: 'incomplete' }] },
    { ...task, status: 'paused', pauseReason: { code: 'ERP_SERVICE_UNAVAILABLE' } }]) {
    expect(erpCollectionPresentation(value).description).not.toContain('批次');
  }
});

it('keeps explicit archive pause and missing metadata visible without a cost-success message', () => {
  const task = { catalogMode: 'on_demand', runMode: 'catalog', status: 'paused', batches: [{ ...delivered, catalogStatus: 'running' }] };
  expect(erpCollectionPresentation(task)).toMatchObject({ state: 'paused', tone: 'warning', canResume: true });
  expect(erpCollectionPresentation({ ...task, status: 'cost_complete', batches: [{ ...delivered, catalogStatus: 'failed' }] })).toMatchObject({ state: 'attention', tone: 'warning', canResume: true });
});
