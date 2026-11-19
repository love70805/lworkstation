import { expect, it } from 'vitest';
import { erpCostEditingGuard } from './erpCostEditingGuard';
const task = { workspaceId: 'W', ledgerId: 'L', requestId: 'R', status: 'running', createdAt: '2026-11-13', batches: [{ deliveryId: 'D1' }, {}] };
const receipt = { workspaceId: 'W', ledgerId: 'L', requestId: 'R', deliveryId: 'D1', adoptionPending: false, adoption: { state: 'blocked' } };
const guard = (tasks = [task], inboxes = [receipt], extra = {}) => erpCostEditingGuard({ workspaceId: 'W', ledgerId: 'L', tasks, inboxes, ...extra });
it.each(['ready', 'running', 'pausing', 'paused', 'failed', 'partial', 'interrupted', 'expired'])('keeps incomplete %s costs read-only', status => {
  expect(guard([{ ...task, status }]).blocked).toBe(true);
});
it('waits for the last delivery and local adoption, then permits unresolved anomalies to be reviewed', () => {
  const done = { ...task, status: 'cost_complete', batches: [{ deliveryId: 'D1' }, { deliveryId: 'D2' }] };
  expect(guard([done]).blocked).toBe(true);
  const second = { ...receipt, deliveryId: 'D2', adoptionPending: true };
  expect(guard([done], [receipt, second]).blocked).toBe(true);
  expect(guard([done], [receipt, { ...second, adoptionPending: false }]).blocked).toBe(false);
});
it('unlocks a finished round with failed reads after its actual receipts settle', () => {
  const partial = { ...task, status: 'partial', batches: [
    { status: 'delivered', deliveryId: 'D1' }, { status: 'incomplete', deliveryId: 'D2' }, { status: 'failed' },
  ] };
  const second = { ...receipt, deliveryId: 'D2' };
  expect(guard([partial]).blocked).toBe(true);
  expect(guard([partial], [receipt, { ...second, adoptionPending: true }]).blocked).toBe(true);
  expect(guard([partial], [receipt, { ...second, adoptionFailure: { message: 'write failed' } }]).blocked).toBe(true);
  expect(guard([partial], [receipt, second])).toMatchObject({ blocked: false, title: '本轮成本采集已结束' });
  for (const status of ['partial', 'failed']) {
    expect(guard([{ ...task, status, batches: [{ status: 'failed' }] }], []).blocked).toBe(false);
  }
  for (const status of ['pending', 'running', 'collected']) {
    expect(guard([{ ...partial, batches: [...partial.batches, { status, resultDeliveryId: 'staged' }] }]).blocked).toBe(true);
  }
  expect(guard([{ ...partial, status: 'ready' }], [receipt, second]).blocked).toBe(true);
});
it('does not treat adoption failure or unknown task status as finished', () => {
  const done = { ...task, batches: [{ deliveryId: 'D1' }] };
  expect(guard([done], [{ ...receipt, adoptionFailure: { message: 'write failed' } }]).blocked).toBe(true);
  expect(guard([], [], { error: 'offline' }).blocked).toBe(true);
  expect(guard([], [], { loading: true }).blocked).toBe(true);
});
it('preserves the last verified terminal outcome through a connection failure while protecting writes', () => {
  const done = {...task,status:'partial',batches:[{status:'incomplete',deliveryId:'D1'}]};
  expect(guard([done],[receipt],{error:'offline'})).toMatchObject({blocked:true,title:'本轮成本采集已结束',lastConfirmedFinished:true});
  const unfinished = {...task,ledgerPeriod:'2026-10',batches:[{status:'running',platformSkcs:['P']}]};
  const offline = guard([unfinished],[receipt],{error:'offline'});
  expect(offline).toMatchObject({blocked:true,title:'采集状态暂无法确认',lastConfirmedFinished:false});
  expect(offline.message).toContain('上次确认时，2026-10 采集任务尚未完成，还有 1 个 SKC 未送达');
  expect(guard([done],[{...receipt,adoptionPending:true}],{error:'offline'}).lastConfirmedFinished).toBe(false);
});
it('permits explicit stop only after received results have settled', () => {
  const stopped = { ...task, status: 'stopped' };
  expect(guard([stopped]).blocked).toBe(false);
  expect(guard([stopped], [{ ...receipt, adoptionPending: true }]).blocked).toBe(true);
});
it('does not lock completed costs for optional product collection or another month/workspace', () => {
  expect(guard([{ ...task, runMode: 'catalog', batches: [{ deliveryId: 'D1' }] }]).blocked).toBe(false);
  expect(guard([{ ...task, ledgerId: 'OTHER' }, { ...task, workspaceId: 'OTHER' }], []).blocked).toBe(false);
});
it('recognizes rejected and voided local receipts as settled, rather than waiting forever for them', () => {
  for (const status of ['rejected', 'voided']) expect(guard([{ ...task, batches: [{ deliveryId: 'D1' }] }], [{ ...receipt, status, adoptionPending: true }]).blocked).toBe(false);
});
it('a newer completed request supersedes an old paused request without ignoring an actually running task', () => {
  const old = { ...task, status: 'paused', createdAt: '2026-11-12' };
  const done = { ...task, batches: [{ deliveryId: 'D1' }] };
  expect(guard([old, done]).blocked).toBe(false);
  expect(guard([{ ...old, runnerId: 'active' }, done]).blocked).toBe(true);
});
