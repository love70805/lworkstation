// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ErpCollectionProgress from './ErpCollectionProgress';
import { isActiveErpCollection } from '../domain/erpCollectionStatus';

it('does not count a collected idempotency key as a durable delivery or adoption', () => {
  const html = renderToStaticMarkup(<ErpCollectionProgress task={{ status: 'paused', batches: [{ platformSkcs: ['A'], status: 'collected', collectedAt: '2026-10-07T00:00:00Z', resultDeliveryId: 'WAITING-ACK' }] }} />);
  expect(html).toContain('已采集 <strong>1 / 1</strong>');
  expect(html).toContain('已送达 <strong>0 / 1</strong>');
  expect(html).toContain('已采用 <strong>0</strong>');
  expect(html).toContain('停止采集');
});
it('preserves task scope and offers continued supplement after costs arrive', () => {
  const task = { status: 'cost_complete', batches: [{ platformSkcs: ['A'], status: 'delivered', deliveryId: 'D', catalogStatus: 'failed' }] };
  expect(isActiveErpCollection(task)).toBe(true);
  expect(renderToStaticMarkup(<ErpCollectionProgress task={task} />)).toContain('继续补充资料');
  task.batches[0].catalogStatus = 'completed';
  expect(isActiveErpCollection(task)).toBe(false);
});
