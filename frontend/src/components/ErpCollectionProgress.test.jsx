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

it('separates durable cost delivery, finished catalog checks and material completeness', () => {
  const batches = [
    { batchId: '1', platformSkcs: ['A'], status: 'incomplete', deliveryId: 'D1', catalogStatus: 'failed', catalogError: '资料已送达，但尚未齐全：图片缺项 1' },
    { batchId: '2', platformSkcs: ['B'], status: 'delivered', deliveryId: 'D2', catalogStatus: 'completed' },
    { batchId: '3', platformSkcs: ['C'], status: 'failed', error: '采购列表请求超时' },
  ];
  const inboxes = [{ deliveryId: 'D1', envelope: { batch: { warehouseEvidence: { mappingFailures: [{ warehouseSku: 'WH-A' }] } } } }];
  const html = renderToStaticMarkup(<ErpCollectionProgress task={{ status: 'partial', batches }} inboxes={inboxes} />);
  expect(html).toContain('已送达 2 / 3 批');
  expect(html).toContain('已结束 2 / 3 批 · 资料齐全 1 批 · 待补齐 1 批');
  expect(html).toContain('1 批请求失败'); expect(html).toContain('采购列表请求超时');
  expect(html).toContain('1 批成本已送达，证据待补齐'); expect(html).toContain('平台 SKU 映射不完整 1 个仓库 SKU');
  expect(html).toContain('1 批资料待补齐'); expect(html).toContain('图片缺项 1');
  expect(html).not.toContain('采集未完成'); expect(html).not.toContain('NaN');
});

it('offers material continuation for a partial task with all cost receipts', () => {
  const html = renderToStaticMarkup(<ErpCollectionProgress task={{ status: 'partial', batches: [{ platformSkcs: ['A'], status: 'incomplete', deliveryId: 'D', catalogStatus: 'failed' }] }} />);
  expect(html).toContain('继续补充资料'); expect(html).toContain('重试失败批次');
});

it('explains background work and does not ask users to continue an active material read', () => {
  const task = { status: 'cost_complete', phase: 'catalog', batches: [{ platformSkcs: ['A'], status: 'delivered', deliveryId: 'D', catalogStatus: 'running' }] };
  const html = renderToStaticMarkup(<ErpCollectionProgress task={task} />);
  expect(html).toContain('正在后台补充商品资料');
  expect(html).toContain('可以继续使用工作台，无需重复启动');
  expect(html).toContain('暂停采集');
  expect(html).not.toContain('继续补充资料');
  expect(html).not.toContain('恢复后请在 ERP 助手点击继续采集');
});

it('removes stale pause and continuation controls after all material checks finish', () => {
  const html = renderToStaticMarkup(<ErpCollectionProgress task={{ status: 'cost_complete', phase: 'catalog', batches: [{ platformSkcs: ['A'], status: 'delivered', deliveryId: 'D', catalogStatus: 'completed' }] }} />);
  expect(html).toContain('成本采集与资料检查已结束');
  expect(html).not.toContain('暂停采集');
  expect(html).not.toContain('停止采集');
  expect(html).not.toContain('继续补充资料');
});

it('reports an unavailable service without claiming cached reads are still running', () => {
  const html = renderToStaticMarkup(<ErpCollectionProgress error="本机服务未连接" statusError="本机服务未连接" task={{ status: 'cost_complete', batches: [{ platformSkcs: ['A'], status: 'delivered', deliveryId: 'D', catalogStatus: 'running' }] }} />);
  expect(html).toContain('采集状态暂无法确认');
  expect(html).toContain('本机服务未连接');
  expect(html).not.toContain('正在后台补充商品资料');
  expect(html).not.toContain('暂停采集');
  expect(html).not.toContain('继续补充资料');
  expect(html).not.toContain('class="spin"');
});
