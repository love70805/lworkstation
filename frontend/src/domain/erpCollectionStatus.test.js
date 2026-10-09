import { expect, it } from 'vitest';
import { erpCollectionPresentation } from './erpCollectionStatus';

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
  expect(erpCollectionPresentation({ status: 'cost_complete', phase: 'cost', batches: [delivered] })).toMatchObject({ state: 'catalog_running', running: true, canResume: false });
});

it('does not claim interrupted reads are still running and keeps continuation available', () => {
  const view = erpCollectionPresentation({ status: 'paused', recoveryRequired: true, phase: 'catalog', batches: [{ ...delivered, catalogStatus: 'running' }] });
  expect(view).toMatchObject({ state: 'paused', running: false, canResume: true });
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
  expect(erpCollectionPresentation({ status: 'cost_complete', batches: [{ ...delivered, catalogStatus: 'failed' }] })).toMatchObject({ state: 'attention', running: false, canResume: true, canRetry: false });
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
