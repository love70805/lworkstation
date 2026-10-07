import { expect, it, vi } from 'vitest';
vi.mock('../data/database', () => ({ listErpCostInbox: vi.fn() }));
import { syncErpCollectionAdoptions } from './erpCollectionAdoption';

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
