import { expect, it, vi } from 'vitest';
vi.mock('../data/database', () => ({ listErpCostAdoptionStates: vi.fn() }));
import { syncErpCollectionAdoptions } from './erpCollectionAdoption';
import { readErpCollectionActivity } from './erpCollectionActivity';
import { ERP_ADOPTION_COUNTS } from '../../../integrations/contracts/erp-adoption-counts.mjs';
import { handleCollectionTaskRequest } from '../../../tools/erp-collection-tasks.mjs';

it('reports a locally evaluated missing price once, survives restart and reports a later correction', async () => {
  const task = { kind:'collection-task', workspaceId:'FINISHED', taskId:'T', requestId:'R', status:'partial', runMode:'cost',
    expectedSkus:[{platformSkc:'A',platformSku:'S'}], batches:[{status:'incomplete',platformSkcs:['A'],deliveryId:'D'}] };
  const receipt = {workspaceId:task.workspaceId,deliveryId:'D',status:'pending',adoptionPending:false,
    adoption:{state:'pending',processedAt:'2026-11-19T10:43:05Z',summary:{expectedCount:1,missingCount:1,adoptedCount:0}}};
  const report = vi.fn(async (taskId, {workspaceId,deliveryId,adoption}) =>
    handleCollectionTaskRequest([task], {method:'POST', url:new URL('http://localhost/erp/v1/collection-tasks/'+taskId+'/adoption'),
      payload:{workspaceId,deliveryId,state:adoption.state,processedAt:adoption.processedAt,...adoption.summary}}).body);
  const sync = () => syncErpCollectionAdoptions({ workspaceId:task.workspaceId, listTasks:async()=>({tasks:[structuredClone(task)]}),
    listInboxes:async()=>[receipt], report, publishCatalog:async()=>{} });
  await sync();
  expect(task.batches[0]).toMatchObject({adoptionReportedAt:expect.any(String),adoption:{missingCount:1,adoptedCount:0}});
  const recordedAt = task.updatedAt;
  await sync(); await sync();
  expect(task.updatedAt).toBe(recordedAt);
  expect(report).toHaveBeenCalledTimes(1);
  receipt.adoption = {state:'applied',summary:{expectedCount:1,adoptedCount:1,manualEffectiveCount:1}};
  await sync(); await sync();
  expect(report).toHaveBeenCalledTimes(2);
  expect(task.batches[0].adoption).toMatchObject({missingCount:0,adoptedCount:0,manualEffectiveCount:1});
});

it('recognizes a durable matching outcome after restart and sends a changed outcome', async () => {
  const saved = Object.fromEntries(ERP_ADOPTION_COUNTS.map(key => [key, 0]));
  Object.assign(saved, {adoptedCount: 2, manualEffectiveCount: 1, expectedCount: 3});
  const batch = {deliveryId: 'D', status:'delivered', adoptionReportedAt:'saved', adoption:saved};
  const task = {workspaceId:'RESUME', taskId:'T', batches:[batch]};
  const summary = {adoptedCount:3, manualEffectiveCount:1, expectedCount:3};
  const report = vi.fn(), publishCatalog = vi.fn();
  const deps = {workspaceId:'RESUME', listTasks:async()=>({tasks:[task]}), listInboxes:async()=>[
    {workspaceId:'RESUME',deliveryId:'D',status:'applied',adoption:{state:'applied',summary}},
  ], report, publishCatalog};
  await syncErpCollectionAdoptions(deps);
  expect(report).not.toHaveBeenCalled();
  expect(publishCatalog).toHaveBeenCalledOnce();
  summary.adoptedCount = 2;
  await syncErpCollectionAdoptions(deps);
  expect(report).toHaveBeenCalledOnce();
  expect(report.mock.calls[0][1].adoption.summary.adoptedCount).toBe(1);
});

it('finishes the current report when clearing starts and leaves later reports for a new cycle', async () => {
  let stop = false;
  const publishCatalog = vi.fn(), report = vi.fn(async () => { stop = true; });
  const ids = ['A','B'];
  await syncErpCollectionAdoptions({workspaceId:'CLEAR', shouldStop:()=>stop, report, publishCatalog,
    listTasks:async()=>({tasks:[{taskId:'T', batches:ids.map(deliveryId=>({deliveryId}))}]}),
    listInboxes:async()=>ids.map(deliveryId=>({workspaceId:'CLEAR',deliveryId,adoption:{summary:{}}})),
  });
  expect(report).toHaveBeenCalledOnce();
  expect(report.mock.calls[0][1].deliveryId).toBe('A');
  expect(publishCatalog).not.toHaveBeenCalled();
});

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
