import { expect, it, vi } from 'vitest';
vi.mock('../data/database', () => ({ listErpCostInbox: vi.fn() }));
import { syncErpCollectionAdoptions } from './erpCollectionAdoption';
import { readErpCollectionActivity } from './erpCollectionActivity';

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
