import { expect, it, vi } from 'vitest';
vi.mock('../data/database', () => ({ listErpCostAdoptionStates: vi.fn() }));
import { syncErpCollectionAdoptions } from './erpCollectionAdoption';
import { readErpCollectionActivity } from './erpCollectionActivity';

it('publishes catalog only after every durable calculation report succeeds and uses the returned task state', async () => {
  const task = { workspaceId: 'BARRIER-W', taskId: 'T', catalogMode: 'after_costs', batches: [{ deliveryId: 'D1' }, { deliveryId: 'D2' }] };
  const report = vi.fn().mockResolvedValueOnce({ task: { ...task, batches: [{ deliveryId: 'D1', adoptionReportedAt: 'now' }, { deliveryId: 'D2' }] } })
    .mockRejectedValueOnce(new Error('lost final report'));
  const publishCatalog = vi.fn();
  const deps = { workspaceId: 'BARRIER-W', listTasks: async () => ({ tasks: [task] }), report, publishCatalog,
    listInboxes: async () => ['D1', 'D2'].map(deliveryId => ({ workspaceId: 'BARRIER-W', deliveryId, status: 'applied', adoption: { summary: { adoptedCount: 1 } } })) };
  await expect(syncErpCollectionAdoptions(deps)).rejects.toThrow('lost final report');
  expect(publishCatalog).not.toHaveBeenCalled();
  report.mockResolvedValue({ task: { ...task, batches: task.batches.map(batch => ({ ...batch, adoptionReportedAt: 'confirmed' })) } });
  await syncErpCollectionAdoptions(deps);
  expect(publishCatalog.mock.calls[0][0].tasks[0].batches.every(batch => batch.adoptionReportedAt)).toBe(true);
});

it('withdraws an older pending calculation before reporting the last batch', async () => {
  const task = { workspaceId: 'STALE-W', taskId: 'STALE-T', catalogMode: 'after_costs', batches: [{ deliveryId: 'OLD', adoptionReportedAt: 'old' }, { deliveryId: 'LAST' }] };
  const report = vi.fn().mockImplementation(async (_task, input) => {
    const batch = task.batches.find(batch => batch.deliveryId === input.deliveryId);
    if (input.adoption.state === 'pending') delete batch.adoptionReportedAt;
    else batch.adoptionReportedAt = 'new';
    return { task: structuredClone(task) };
  });
  const publishCatalog = vi.fn();
  await syncErpCollectionAdoptions({ workspaceId: 'STALE-W', listTasks: async () => ({ tasks: [task] }), report, publishCatalog,
    listInboxes: async () => [{ workspaceId: 'STALE-W', deliveryId: 'OLD', adoptionPending: true, adoption: { summary: {} } },
      { workspaceId: 'STALE-W', deliveryId: 'LAST', adoption: { summary: { adoptedCount: 1 } } }] });
  expect(report.mock.calls.map(call => [call[1].deliveryId, call[1].adoption.state])).toEqual([['OLD', 'pending'], ['LAST', undefined]]);
  expect(publishCatalog.mock.calls[0][0].tasks[0].batches[0].adoptionReportedAt).toBeUndefined();
});

it('reports only durable adoption, distinguishes manual costs and retries a lost report', async () => {
  const task = { taskId: 'TASK', batches: [{ deliveryId: 'D' }, { deliveryId: 'PENDING' }] };
  const report = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
  const deps = { workspaceId: 'W', report, listTasks: async () => ({ tasks: [task] }), listInboxes: async () => [
    { workspaceId: 'W', deliveryId: 'D', status: 'applied', adoption: { state: 'applied', summary: { adoptedCount: 3, manualEffectiveCount: 1 } } },
    { workspaceId: 'W', deliveryId: 'PENDING', adoptionPending: true },
  ] };
  await expect(syncErpCollectionAdoptions(deps)).rejects.toThrow('offline');
  await syncErpCollectionAdoptions(deps);
  expect(report).toHaveBeenCalledTimes(2);
  expect(report.mock.calls[1][1].adoption.summary).toMatchObject({ adoptedCount: 2, manualEffectiveCount: 1 });
});

it('publishes existing task reads even when adoption reporting fails and preserves them on disconnect', async () => {
  const task = { taskId: 'ACTIVITY', workspaceId: 'ACTIVITY-W', ledgerId: 'L', status: 'running', batches: [{ status: 'running', platformSkcs: ['A'], deliveryId: 'ACTIVITY-D', secretEvidence: 'not-ui-state' }] };
  const deps = { workspaceId: 'ACTIVITY-W', listTasks: async () => ({ tasks: [task] }), listInboxes: async () => { throw new Error('adoption read failed'); } };
  await expect(syncErpCollectionAdoptions(deps)).rejects.toThrow('adoption read failed');
  expect(readErpCollectionActivity('ACTIVITY-W').tasks[0].status).toBe('running');
  expect(JSON.stringify(readErpCollectionActivity('ACTIVITY-W'))).not.toContain('secretEvidence');
  await expect(syncErpCollectionAdoptions({ ...deps, listTasks: async () => { throw new Error('service offline'); } })).rejects.toThrow('service offline');
  expect(readErpCollectionActivity('ACTIVITY-W')).toMatchObject({ error: 'service offline', tasks: [{ taskId: 'ACTIVITY' }] });
  await syncErpCollectionAdoptions({ ...deps, listTasks: async () => ({ tasks: [] }) });
  expect(readErpCollectionActivity('ACTIVITY-W')).toEqual({ tasks: [], error: '' });
});
