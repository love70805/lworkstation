// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import ErpCollectionProgress from './ErpCollectionProgress';
import { isActiveErpCollection } from '../domain/erpCollectionStatus';

it('ends cost timing at the last receipt and locates each unresolved platform mapping', () => {
  const task = { status: 'partial', phase: 'cost', createdAt: '2026-10-17T17:48:00Z', updatedAt: '2026-10-17T20:19:00Z',
    batches: [{ batchId: 'B', platformSkcs: ['SKC-A'], status: 'incomplete', deliveryId: 'D', deliveredAt: '2026-10-17T18:31:00Z', error: '已使用的平台规格映射未确认 1 项' }] };
  const inboxes = [{ deliveryId: 'D', envelope: { batch: { sourceMeta: { mappingFailures: [{ platformSku: 'SKU-A', platformSkc: 'SKC-A', message: '目标平台 SKU/SKC 映射未确认' }] } } } }];
  const html = renderToStaticMarkup(<ErpCollectionProgress task={task} inboxes={inboxes} />);
  expect(html).toContain('成本采集历时 43 分钟'); expect(html).not.toContain('151 分钟');
  expect(html).toContain('成本读取与送达已结束'); expect(html).toContain('当前阶段：成本证据核对');
  expect(html).toContain('平台 SKU：SKU-A'); expect(html).toContain('SKC：SKC-A'); expect(html).toContain('目标平台 SKU/SKC 映射未确认');
});

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
  const html = renderToStaticMarkup(<ErpCollectionProgress showCatalog task={task} />);
  expect(html).toContain('继续获取商品档案');
  expect(html).toContain('成本采集已完成');
  expect(html).not.toContain('停止采集');
  expect(html).not.toContain('当前阶段：');
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
  const html = renderToStaticMarkup(<ErpCollectionProgress showCatalog task={{ status: 'partial', batches }} inboxes={inboxes} />);
  expect(html).toContain('已送达 2 / 3 个 SKC');
  expect(html).toContain('已检查 2 / 3 个 SKC · 已确认齐全 1 个 SKC · 待核对范围 1 个 SKC');
  expect(html).toContain('读取未完成，涉及 1 个 SKC'); expect(html).toContain('SKC：C'); expect(html).toContain('采购列表请求超时');
  expect(html).toContain('成本证据待补齐，涉及 1 个 SKC'); expect(html).toContain('平台 SKU 映射不完整 1 个仓库 SKU');
  expect(html).toContain('商品资料待核对，涉及 1 个 SKC'); expect(html).toContain('图片缺项 1');
  expect(html).not.toContain('批次');
  expect(html).not.toContain('采集未完成'); expect(html).not.toContain('NaN');
});

it('offers material continuation for a partial task with all cost receipts', () => {
  const html = renderToStaticMarkup(<ErpCollectionProgress task={{ status: 'partial', batches: [{ platformSkcs: ['A'], status: 'incomplete', deliveryId: 'D', catalogStatus: 'failed' }] }} />);
  expect(html).toContain('继续原任务'); expect(html).toContain('重试未完成项');
});

it('explains background work and does not ask users to continue an active material read', () => {
  const task = { status: 'cost_complete', phase: 'catalog', batches: [{ platformSkcs: ['A'], status: 'delivered', deliveryId: 'D', catalogStatus: 'running' }] };
  const html = renderToStaticMarkup(<ErpCollectionProgress showCatalog task={task} />);
  expect(html).toContain('正在后台获取商品档案');
  expect(html).toContain('匹配后自动补齐商品资料');
  expect(html).toContain('暂停采集');
  expect(html).not.toContain('继续补充资料');
  expect(html).not.toContain('恢复后请在 ERP 助手点击继续采集');
});

it('removes stale pause and continuation controls after all material checks finish', () => {
  const html = renderToStaticMarkup(<ErpCollectionProgress showCatalog task={{ status: 'cost_complete', phase: 'catalog', batches: [{ platformSkcs: ['A'], status: 'delivered', deliveryId: 'D', catalogStatus: 'completed' }] }} />);
  expect(html).toContain('成本采集与资料检查已结束');
  expect(html).not.toContain('当前阶段：补充资料');
  expect(html).not.toContain('暂停采集');
  expect(html).not.toContain('停止采集');
  expect(html).not.toContain('继续补充资料');
});

it('reports an unavailable service without claiming cached reads are still running', () => {
  const html = renderToStaticMarkup(<ErpCollectionProgress error="本机服务未连接" statusError="本机服务未连接" task={{ status: 'cost_complete', batches: [{ platformSkcs: ['A'], status: 'delivered', deliveryId: 'D', catalogStatus: 'running' }] }} />);
  expect(html).toContain('采集状态暂无法确认');
  expect(html).toContain('本机服务未连接');
  expect(html).not.toContain('正在后台获取商品档案');
  expect(html).not.toContain('暂停采集');
  expect(html).not.toContain('继续补充资料');
  expect(html).not.toContain('class="spin"');
  const queued = renderToStaticMarkup(<ErpCollectionProgress statusError="服务断开" task={{ executionProtocol: 2, status: 'ready', batches: [{ platformSkcs: ['A'], status: 'pending' }] }} />);
  expect(queued).not.toContain('collection-progress-pulse');
});

it('shows whole-task scope and weights progress by SKCs when exception ranges have unequal sizes', () => {
  const task = { costFlow: 'task', status: 'partial', ledgerPeriod: '2026-10',
    expectedSkus: [
      { platformSku: 'SKU-A1', platformSkc: 'A', store: '甲店' },
      { platformSku: 'SKU-A2', platformSkc: 'A', store: '甲店' },
      { platformSku: 'SKU-B', platformSkc: 'B', store: '甲店' },
      { platformSku: 'SKU-C', platformSkc: 'C', store: '乙店' },
      { platformSku: 'SKU-D', platformSkc: 'D', store: '乙店' },
    ],
    batches: [
      { batchId: 'ready', platformSkcs: ['A', 'B', 'C'], status: 'delivered', deliveryId: 'D1' },
      { batchId: 'missing', platformSkcs: ['D'], status: 'failed', error: '仓库映射待补查' },
    ] };
  const html = renderToStaticMarkup(<ErpCollectionProgress task={task} />);
  expect(html).toContain('范围 4 个 SKC / 5 个 SKU');
  expect(html).toContain('已送达 3 / 4 个 SKC');
  expect(html).toContain('aria-label="ERP 成本送达进度" aria-valuemin="0" aria-valuemax="4" aria-valuenow="3"');
  expect(html).toContain('剩余 1 个 SKC');
  expect(html).toContain('SKC：D · 仓库映射待补查');
  expect(html).toContain('重试未完成项');
  expect(html).not.toMatch(/批次|\d+ \/ \d+ 批|固定/);
});

it('keeps delivered costs distinct from unconfirmed or failed local accounting', () => {
  const task = { executionProtocol: 2, costFlow: 'task', catalogMode: 'on_demand', status: 'cost_complete', workspaceId: 'W',
    batches: [{ batchId: 'B', platformSkcs: ['A'], status: 'delivered', deliveryId: 'D' }] };
  const pending = renderToStaticMarkup(<ErpCollectionProgress task={task} inboxes={[{ workspaceId: 'W', deliveryId: 'D', adoptionPending: true }]} />);
  expect(pending).toContain('成本已送达，正在核验并更新利润');
  expect(pending).toContain('正在本机核验并采用成本');
  expect(pending).toContain('采购证据送达不代表核算完成');
  expect(pending).not.toContain('erp-activity-success');
  const failed = renderToStaticMarkup(<ErpCollectionProgress task={task} inboxes={[{ workspaceId: 'W', deliveryId: 'D', adoptionFailure: { message: '本机写入暂不可用' } }]} />);
  expect(failed).toContain('本机核算未完成：本机写入暂不可用');
  expect(failed).toContain('erp-activity-warning');
  expect(failed).not.toContain('erp-activity-success');
});

it('does not use another workspace receipt as this task accounting progress', () => {
  const task = { workspaceId: 'W', status: 'cost_complete', batches: [{ batchId: 'B', platformSkcs: ['A'], status: 'delivered', deliveryId: 'D' }] };
  const html = renderToStaticMarkup(<ErpCollectionProgress task={task} inboxes={[{ workspaceId: 'OTHER', deliveryId: 'D',
    adoptionFailure: { message: '另一工作区失败' }, adoption: { items: [{ state: 'adopted', platformSku: 'SKU-A' }] } }]} />);
  expect(html).toContain('已采用 <strong>0</strong>');
  expect(html).not.toContain('另一工作区失败');
});

it('uses a single progressive bar for actual stage counts and a forward pulse only while active', () => {
  const task = { status: 'running', batches: [{ platformSkcs: ['A'], status: 'running' }], progress: { phase: 'cost', label: '采购明细', completed: 2, total: 10, unit: '订单' } };
  const render = () => renderToStaticMarkup(<ErpCollectionProgress task={task} />);
  let html = render();
  expect(html.match(/role="progressbar"/g)).toHaveLength(1);
  expect(html).toContain('width:20%');
  expect(html).toContain('collection-progress-pulse');
  task.progress.completed = 7;
  expect(render()).toContain('width:70%');
  task.progress = null;
  html = render();
  expect(html).not.toContain('aria-valuenow');
  expect(html).toContain('等待进度确认');
  task.status = 'paused';
  expect(render()).not.toContain('collection-progress-pulse');
});

it('shows only material progress on the product page, including missing material after a finished check', () => {
  const task = { status: 'cost_complete', phase: 'catalog', batches: [
    { platformSkcs: ['A'], deliveryId: 'D', status: 'delivered', catalogStatus: 'failed', catalogError: '图片缺失' },
  ] };
  const html = renderToStaticMarkup(<ErpCollectionProgress task={task} showCatalog catalogOnly />);
  expect(html).toContain('商品档案获取进度');
  expect(html).toContain('待补资料');
  expect(html).toContain('图片缺失');
  expect(html).not.toContain('已采用');
  expect(html).not.toContain('成本回传 ·');
  expect(html.match(/role="progressbar"/g)).toHaveLength(1);
});
