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
it('does not treat adoption failure or unknown task status as finished', () => {
  const done = { ...task, batches: [{ deliveryId: 'D1' }] };
  expect(guard([done], [{ ...receipt, adoptionFailure: { message: 'write failed' } }]).blocked).toBe(true);
  expect(guard([], [], { error: 'offline' }).blocked).toBe(true);
  expect(guard([], [], { loading: true }).blocked).toBe(true);
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
